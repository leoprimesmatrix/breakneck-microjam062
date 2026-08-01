import {
  BOUNCE_KICK,
  BOUNCE_SPEED_KEEP,
  BRAKE_CHAIN_GRACE,
  BREAK_KEEP_EASY,
  BREAK_KEEP_HARD,
  CAM_ANCHOR,
  CHAIN_HEAL_AT,
  CHAIN_MULT_CAP,
  CHAIN_TIMEOUT,
  GRAZE_DIST,
  GRAZE_SPEED_BONUS,
  IFRAME_TIME,
  MAX_HEALTH,
  PLAYER_R,
  PX_PER_M,
  SCORE_PER_BREAK,
  SCORE_PER_GRAZE,
  V_BOUNCE_CAP,
  VIEW_H,
} from '../config';
import { Audio } from '../engine/audio';
import { Juice } from '../engine/juice';
import { clamp, lerp, makeRng } from '../engine/math';
import { Particles } from '../engine/particles';
import type { Input } from '../engine/input';
import { Player } from './player';
import { World, type Block } from './world';

export type GameState = 'title' | 'play' | 'dead';

const BEST_KEY = 'breakneck.best.v1';

export class Game {
  state: GameState = 'title';

  readonly player = new Player();
  readonly world = new World();
  readonly juice = new Juice();
  readonly particles = new Particles();
  readonly audio = new Audio();

  depth = 0; // metres
  score = 0;
  bonus = 0;
  chain = 0;
  bestChain = 0;
  chainTimer = 0;
  /** How long the brake has been held, for the chain-forfeit grace window. */
  brakeHeld = 0;
  runTime = 0;
  best = 0;
  isNewBest = false;

  /** Recent positions, newest last, for the motion trail. */
  readonly trail: { x: number; y: number }[] = [];

  /** Floating world-space labels: chain milestones, damage, gate calls. */
  readonly popups: {
    x: number; y: number; text: string;
    life: number; max: number; hot: boolean; big: boolean;
  }[] = [];

  private input: Input;
  private rng = makeRng(1);
  /** Reused each step so collision resolution never allocates. */
  private hits: Block[] = [];

  constructor(input: Input) {
    this.input = input;
    this.best = this.loadBest();
    // Seed a shaft immediately so the title screen has something to scroll.
    this.world.reset((Math.random() * 0xffffffff) >>> 0);
  }

  /**
   * Attract-mode scroll position. Starts deep on purpose: at the surface every
   * block is hardness 1-3 and renders white, so the title showed none of the red
   * that the whole mechanic turns on. Down here the shaft is a proper mix.
   */
  private titleY = 14000;

  get camY() {
    return this.state === 'title' ? this.titleY : this.player.y - VIEW_H * CAM_ANCHOR;
  }

  private popup(x: number, y: number, text: string, hot = false, big = false) {
    // Hard cap: at a 60-chain these would otherwise pile up and shred the frame.
    if (this.popups.length > 20) this.popups.shift();
    const max = big ? 0.85 : 0.55;
    this.popups.push({ x, y, text, life: max, max, hot, big });
  }

  /** Scoring multiplier: the chain, ceilinged. */
  get mult() {
    return Math.min(Math.max(1, this.chain), CHAIN_MULT_CAP);
  }

  private loadBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0; // private mode / blocked storage: not worth failing a run over
    }
  }

  private saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(Math.floor(this.best)));
    } catch {
      /* ignore */
    }
  }

  start() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.rng = makeRng(seed);
    this.world.reset(seed);
    this.player.reset();
    this.juice.reset();
    this.particles.reset();
    this.trail.length = 0;
    this.popups.length = 0;

    this.depth = 0;
    this.score = 0;
    this.bonus = 0;
    this.chain = 0;
    this.bestChain = 0;
    this.chainTimer = 0;
    this.brakeHeld = 0;
    this.runTime = 0;
    this.isNewBest = false;
    this.state = 'play';
    this.audio.setRunning(true);
  }

  // ------------------------------------------------------------------ loop
  step(dtReal: number) {
    // Hitstop freezes everything, including particles. That's what makes it read.
    if (this.juice.consumeHitstop(dtReal)) return;
    this.juice.update(dtReal);

    const dt = dtReal * this.juice.timeScale;

    if (this.state === 'title') {
      // Attract mode: the shaft streams past behind the title, so the game sells
      // itself before a key is ever pressed.
      this.titleY += 250 * dt;
      this.world.ensure(this.titleY + VIEW_H * 1.6);
      this.world.prune(this.titleY);
      // Title says "press any key" and means it — no hunting for the right one.
      if (this.input.takeAnyKey()) this.start();
    } else if (this.state === 'play') {
      this.stepPlay(dt);
    } else if (this.state === 'dead') {
      // Brief lockout so a held key can't skip the death screen instantly.
      this.runTime += dt;
      if (this.runTime > 0.35 && this.input.takeConfirm()) this.start();
    }

    this.particles.update(dt);
  }

  private stepPlay(dt: number) {
    const p = this.player;
    this.runTime += dt;

    const prevY = p.y;
    p.step(dt, this.input);
    p.y = this.resolve(prevY, prevY + p.vy * dt);

    // Depth only ever counts downward progress.
    this.depth = Math.max(this.depth, p.y / PX_PER_M);

    // Chain lapses if you stop breaking things...
    if (this.chain > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chain = 0;
    }

    // ...and braking forfeits it outright. This is the game's central decision:
    // smash through at speed and keep the multiplier, or buy back control and
    // pay for it. Without this cost, braking is a strictly dominant strategy.
    if (this.input.brake) {
      this.brakeHeld += dt;
      if (this.brakeHeld > BRAKE_CHAIN_GRACE) this.chain = 0;
    } else {
      this.brakeHeld = 0;
    }

    this.score = Math.floor(this.depth) + this.bonus;

    this.world.ensure(this.camY + VIEW_H);
    this.world.prune(this.camY);

    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 22) this.trail.shift();

    this.audio.setSpeed(p.speedNorm);

    for (let k = this.popups.length - 1; k >= 0; k--) {
      const pu = this.popups[k];
      pu.life -= dt;
      pu.y -= 46 * dt; // drift against the fall so they stay readable
      if (pu.life <= 0) this.popups.splice(k, 1);
    }

    if (p.health <= 0) this.die();
  }

  private die() {
    this.state = 'dead';
    this.runTime = 0;
    this.popups.length = 0; // otherwise the last hit's label is stranded mid-screen
    this.audio.setRunning(false);
    this.audio.onDeath();
    this.juice.addShake(22);
    this.juice.addFlash(0.85);
    this.juice.addHitstop(0.14);
    this.particles.shards(this.player.x, this.player.y, 0, 46, this.rng, true);

    if (this.score > this.best) {
      this.best = this.score;
      this.isNewBest = true;
      this.saveBest();
    }
  }

  // ------------------------------------------------------------ collision
  /**
   * Swept against the vertical span travelled this step so nothing is tunnelled
   * through at 1800 px/s. Returns the resolved y.
   */
  private resolve(prevY: number, newY: number): number {
    const p = this.player;
    const r = PLAYER_R;
    let finalY = newY;

    // Invulnerability phases you through. Without this a single bounce starts an
    // unrecoverable spiral: -66% speed drops your tier, which turns more of the
    // world red, which forces the next bounce. The i-frame window is the only
    // place a run can be rebuilt, so it has to actually clear space.
    if (p.iframe > 0) return finalY;

    const hits = this.hits;
    hits.length = 0;

    for (const b of this.world.blocks) {
      if (b.dead) continue;
      // Vertical: does [prevY, newY] cross the block's band, expanded by r?
      if (newY + r < b.y || prevY - r > b.y + b.h) continue;

      const dx = Math.abs(p.x - (b.x + b.w * 0.5));
      const solid = r + b.w * 0.5;

      if (dx < solid) {
        hits.push(b);
      } else if (!b.grazed && dx < solid + GRAZE_DIST) {
        b.grazed = true;
        this.onGraze();
      }
    }

    if (hits.length === 0) return finalY;
    hits.sort(byY);

    for (const b of hits) {
      // Tier is re-read each time: a long chain bleeds speed and can drop you
      // below the next block's threshold. The combo is self-limiting by design.
      if (p.tier >= b.hardness) {
        this.onBreak(b);
      } else {
        finalY = b.y - r;
        this.onBounce(b);
        break;
      }
    }

    return finalY;
  }

  private onBreak(b: Block) {
    const p = this.player;
    b.dead = true;

    // Cost scales with how close the break was to your ceiling.
    const marginal = clamp(b.hardness / p.tier, 0, 1);
    p.vy *= lerp(BREAK_KEEP_EASY, BREAK_KEEP_HARD, marginal);

    this.chain++;
    this.chainTimer = CHAIN_TIMEOUT;
    if (this.chain > this.bestChain) this.bestChain = this.chain;
    this.bonus += SCORE_PER_BREAK * this.mult;

    if (this.chain > 0 && this.chain % CHAIN_HEAL_AT === 0) {
      const healed = p.health < MAX_HEALTH;
      p.health = Math.min(MAX_HEALTH, p.health + 1);
      this.juice.addFlash(0.16);
      this.popup(p.x, p.y - 34, healed ? '+1 HULL' : `x${this.chain}`, false, true);
    } else if (this.chain >= 5 && this.chain % 5 === 0) {
      this.popup(p.x, p.y - 30, `x${this.chain}`, false, true);
    }

    // Feedback scales with significance, not with chain length. Chain-scaled
    // hitstop meant a 40-chain froze the sim more often than it ran it; and a
    // paper-thin block punching as hard as a wall reads as mush either way.
    this.particles.shards(
      b.x + b.w * 0.5,
      b.y + b.h * 0.5,
      p.vy,
      b.gate ? 26 : Math.round(lerp(5, 16, marginal)),
      this.rng,
    );
    this.juice.addHitstop(lerp(0.004, 0.05, marginal) + (b.gate ? 0.03 : 0));
    this.juice.addShake(lerp(2, 12, marginal) + (b.gate ? 9 : 0));
    this.audio.onBreak(this.chain, marginal, b.gate);

    if (b.gate) {
      this.juice.addSlowmo(0.2);
      this.juice.addFlash(0.24);
      this.popup(p.x, p.y - 46, 'GATE BROKEN', false, true);
    }
  }

  private onBounce(b: Block) {
    const p = this.player;

    p.vy = Math.max(V_BOUNCE_CAP, -BOUNCE_KICK + p.vy * BOUNCE_SPEED_KEEP * 0.2);
    p.vy = Math.min(p.vy, -BOUNCE_KICK * 0.5);

    // Chip the block so a run can never deadlock against a wall it cannot break.
    // You always have a way through; it just costs health to buy it.
    if (b.hardness > 1) b.hardness--;

    this.chain = 0;
    this.audio.onBounce();

    if (p.iframe <= 0) {
      p.health--;
      p.iframe = IFRAME_TIME;
      this.juice.addShake(16);
      this.juice.addFlash(0.4);
      this.juice.addHitstop(0.09);
      this.particles.shards(p.x, b.y, -200, 18, this.rng, true);
      this.popup(p.x, p.y - 30, `TOO SLOW  ${b.hardness}`, true, true);
    } else {
      this.juice.addShake(6);
      this.juice.addHitstop(0.03);
    }
  }

  private onGraze() {
    const p = this.player;
    p.vy = Math.min(p.vy + GRAZE_SPEED_BONUS, 1e9);
    this.bonus += SCORE_PER_GRAZE * this.mult;
    // A graze keeps a chain alive without breaking anything — the precision line.
    if (this.chain > 0) this.chainTimer = CHAIN_TIMEOUT;
    this.audio.onGraze();
  }
}

const byY = (a: Block, b: Block) => a.y - b.y;
