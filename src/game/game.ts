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
  INTRO_TIME,
  MAX_HEALTH,
  OD_SCORE_MULT,
  PLAYER_R,
  PX_PER_M,
  SCORE_PER_BREAK,
  SCORE_PER_GRAZE,
  V_BOUNCE_CAP,
  VIEW_H,
  ZONE_CARD_TIME,
} from '../config';
import { Audio } from '../engine/audio';
import { Juice } from '../engine/juice';
import { clamp, lerp, makeRng } from '../engine/math';
import { Particles } from '../engine/particles';
import type { Input } from '../engine/input';
import { paletteAt, zoneIndexAt, zoneName } from './biomes';
import { Overdrive } from './overdrive';
import { Player } from './player';
import { World, type Block } from './world';

export type GameState = 'title' | 'play' | 'dead';

const BEST_KEY = 'breakneck.best.v1';
const RUNS_KEY = 'breakneck.runs.v1';

export type PopupKind = 'chain' | 'heal' | 'gate' | 'fail' | 'od' | 'zone';

export interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  kind: PopupKind;
  big: boolean;
}

/**
 * End-of-run grade. The single strongest "one more" lever a score game has.
 *
 * Calibrated against simulated runs rather than guessed. A bot that holds the
 * dive and never steers medians ~17k; a bot that does nothing at all medians
 * ~9k. So B is "you committed to the dive", and A upward has to come from
 * actually threading the hardness-9 walls that a held dive cannot break.
 */
const RANKS: { min: number; label: string }[] = [
  { min: 50000, label: 'SS' },
  { min: 34000, label: 'S' },
  { min: 22000, label: 'A' },
  { min: 13000, label: 'B' },
  { min: 6000, label: 'C' },
  { min: 0, label: 'D' },
];

export class Game {
  state: GameState = 'title';

  readonly player = new Player();
  readonly world = new World();
  readonly juice = new Juice();
  readonly particles = new Particles();
  readonly audio = new Audio();
  readonly od = new Overdrive();

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
  runs = 0;

  // --- run stats, for the results screen
  breaks = 0;
  grazes = 0;
  odTriggers = 0;
  topKmh = 0;

  // --- zone presentation
  zone = 0;
  zoneCard = 0;
  zoneCardName = '';
  zoneCardSub = '';

  /** Goal/intro card countdown; runs at the start of every run. */
  introT = 0;

  /**
   * Live POWER feedback. The tier IS the game's core number, but it used to
   * exist only as maths inside the collision check — nothing on screen ever
   * said "you are a 7 right now". The badge pop is driven from here.
   */
  lastTier = 1;
  tierPop = 0;
  /** +1 when the last tier change was upward, -1 downward. */
  tierPopDir = 1;

  /** Nearest live gate below the player: distance in metres, or -1. */
  gateDist = -1;
  gateHard = 0;

  /** Recent positions, newest last, for the motion trail. */
  readonly trail: { x: number; y: number }[] = [];

  /** Floating world-space labels: chain milestones, damage, gate calls. */
  readonly popups: Popup[] = [];

  private input: Input;
  private rng = makeRng(1);
  /** Reused each step so collision resolution never allocates. */
  private hits: Block[] = [];

  constructor(input: Input) {
    this.input = input;
    this.best = this.loadNum(BEST_KEY);
    this.runs = this.loadNum(RUNS_KEY);
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

  /** Depth in metres at the camera, used for palette selection on every screen. */
  get camMetres() {
    return Math.max(0, this.camY / PX_PER_M);
  }

  get palette() {
    return paletteAt(this.camMetres);
  }

  /** True until the player has finished a run; gates the tutorial prompts. */
  get isFirstRun() {
    return this.runs === 0;
  }

  get rank() {
    return RANKS.find((r) => this.score >= r.min)!.label;
  }

  private popup(x: number, y: number, text: string, kind: PopupKind, big = false) {
    // Hard cap: at a 60-chain these would otherwise pile up and shred the frame.
    if (this.popups.length > 18) this.popups.shift();
    const max = big ? 0.9 : 0.55;
    this.popups.push({ x, y, text, life: max, max, kind, big });
  }

  /** Scoring multiplier: the chain, ceilinged, doubled while overdriven. */
  get mult() {
    const base = Math.min(Math.max(1, this.chain), CHAIN_MULT_CAP);
    return this.od.active ? base * OD_SCORE_MULT : base;
  }

  private loadNum(key: string) {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0; // private mode / blocked storage: not worth failing a run over
    }
  }

  private saveNum(key: string, v: number) {
    try {
      localStorage.setItem(key, String(Math.floor(v)));
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
    this.od.reset();
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
    this.breaks = 0;
    this.grazes = 0;
    this.odTriggers = 0;
    this.topKmh = 0;
    // No zone card at the start — the intro card owns the opening beat, and two
    // stacked announcements is how the old start managed to say nothing.
    this.setZone(0, false);
    this.introT = INTRO_TIME;
    this.lastTier = this.player.tier;
    this.tierPop = 0;
    this.tierPopDir = 1;
    this.gateDist = -1;
    this.gateHard = 0;
    this.state = 'play';
    this.audio.setRunning(true);
  }

  private setZone(index: number, card: boolean) {
    this.zone = index;
    this.zoneCardName = zoneName(index);
    // Sub-line comes from the biome table via the palette's source biome.
    this.zoneCardSub = BIOME_SUB[index % BIOME_SUB.length];
    this.zoneCard = card ? ZONE_CARD_TIME : 0;
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
      this.od.pulse += dt;
      // Title says "press any key" and means it — no hunting for the right one.
      if (this.input.takeAnyKey()) this.start();
    } else if (this.state === 'play') {
      this.stepPlay(dt);
    } else if (this.state === 'dead') {
      // Brief lockout so a held key can't skip the death screen instantly.
      this.runTime += dt;
      this.od.pulse += dt;
      if (this.runTime > 0.45 && this.input.takeConfirm()) this.start();
    }

    this.particles.update(dt);
  }

  private stepPlay(dt: number) {
    const p = this.player;
    this.runTime += dt;

    this.od.update(dt);
    if (this.od.justEnded) {
      this.juice.addFlash(0.2);
      this.audio.onOverdriveEnd();
    }

    p.overdriven = this.od.active;
    const prevY = p.y;
    p.step(dt, this.input);
    p.y = this.resolve(prevY, prevY + p.vy * dt);

    // Depth only ever counts downward progress.
    this.depth = Math.max(this.depth, p.y / PX_PER_M);
    this.topKmh = Math.max(this.topKmh, p.kmh);

    // Zone announcements. Presentation only, but it turns a rising number into
    // an itinerary — the player can name how far they got.
    const z = zoneIndexAt(this.depth);
    if (z > this.zone) {
      this.setZone(z, true);
      this.juice.addFlash(0.14);
      this.audio.onZone();
    }
    if (this.zoneCard > 0) this.zoneCard -= dt;
    if (this.introT > 0) this.introT -= dt;

    // POWER badge feedback. Tier is re-read after collisions so the pop lands
    // on the same frame the number actually changed.
    if (p.tier !== this.lastTier) {
      this.tierPopDir = p.tier > this.lastTier ? 1 : -1;
      this.tierPop = 1;
      if (this.tierPopDir > 0) this.audio.onPowerUp(p.tier);
      this.lastTier = p.tier;
    }
    this.tierPop = Math.max(0, this.tierPop - dt * 3.4);

    // Nearest gate below, for the incoming-wall warning. The array is small
    // (~150 blocks) and this runs on the fixed step without allocating.
    this.gateDist = -1;
    let gy = Infinity;
    for (const b of this.world.blocks) {
      if (!b.gate || b.dead) continue;
      const d = b.y - p.y;
      if (d > 0 && b.y < gy) {
        gy = b.y;
        this.gateHard = b.hardness;
      }
    }
    if (gy < Infinity) this.gateDist = (gy - p.y) / PX_PER_M;

    // Chain lapses if you stop breaking things...
    if (this.chain > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.loseChain();
    }

    // ...and braking forfeits it outright. This is the game's central decision:
    // smash through at speed and keep the multiplier, or buy back control and
    // pay for it. Without this cost, braking is a strictly dominant strategy.
    if (this.input.brake) {
      this.brakeHeld += dt;
      if (this.brakeHeld > BRAKE_CHAIN_GRACE && this.chain > 0) this.loseChain();
    } else {
      this.brakeHeld = 0;
    }

    this.score = Math.floor(this.depth) + this.bonus;

    this.world.ensure(this.camY + VIEW_H);
    this.world.prune(this.camY);

    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 26) this.trail.shift();

    this.audio.setSpeed(p.speedNorm);
    this.audio.setOverdrive(this.od.active);

    for (let k = this.popups.length - 1; k >= 0; k--) {
      const pu = this.popups[k];
      pu.life -= dt;
      pu.y -= 46 * dt; // drift against the fall so they stay readable
      if (pu.life <= 0) this.popups.splice(k, 1);
    }

    if (p.health <= 0) this.die();
  }

  private loseChain() {
    if (this.chain <= 0) return;
    this.chain = 0;
    this.od.onChainLost();
  }

  private die() {
    this.state = 'dead';
    this.runTime = 0;
    this.popups.length = 0; // otherwise the last hit's label is stranded mid-screen
    this.od.reset();
    this.audio.setRunning(false);
    this.audio.onDeath();
    this.juice.addShake(24);
    this.juice.addFlash(0.9);
    this.juice.addHitstop(0.16);
    this.particles.shards(this.player.x, this.player.y, 0, 54, this.rng, 'hot');
    this.particles.ring(this.player.x, this.player.y, 1);

    this.runs++;
    this.saveNum(RUNS_KEY, this.runs);

    if (this.score > this.best) {
      this.best = this.score;
      this.isNewBest = true;
      this.saveNum(BEST_KEY, this.best);
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
      // Overdrive suspends the check entirely — that *is* the reward.
      if (this.od.active || p.tier >= b.hardness) {
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
    this.breaks++;

    // Cost scales with how close the break was to your ceiling. Overdrive is
    // frictionless by design: the fantasy is ploughing, not grinding.
    const marginal = this.od.active ? 0 : clamp(b.hardness / p.tier, 0, 1);
    p.vy *= this.od.active ? 1 : lerp(BREAK_KEEP_EASY, BREAK_KEEP_HARD, marginal);

    this.chain++;
    this.chainTimer = CHAIN_TIMEOUT;
    if (this.chain > this.bestChain) this.bestChain = this.chain;
    this.bonus += SCORE_PER_BREAK * this.mult;

    this.od.addBreak();
    if (this.od.ready) this.triggerOverdrive();

    if (this.chain > 0 && this.chain % CHAIN_HEAL_AT === 0) {
      const healed = p.health < MAX_HEALTH;
      p.health = Math.min(MAX_HEALTH, p.health + 1);
      this.juice.addFlash(0.16);
      this.popup(p.x, p.y - 34, healed ? '+1 HULL' : `x${this.chain}`, healed ? 'heal' : 'chain', true);
      if (healed) this.audio.onHeal();
    } else if (this.chain >= 5 && this.chain % 5 === 0) {
      this.popup(p.x, p.y - 30, `x${this.chain}`, 'chain', true);
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
      this.od.active ? 'od' : 'cool',
    );
    if (marginal > 0.6 || b.gate || this.od.active) {
      this.particles.ring(b.x + b.w * 0.5, b.y + b.h * 0.5, b.gate ? 0.9 : 0.5);
    }
    this.juice.addHitstop(lerp(0.004, 0.05, marginal) + (b.gate ? 0.03 : 0));
    this.juice.addShake(lerp(2, 12, marginal) + (b.gate ? 9 : 0));
    this.juice.addPunch(lerp(0.004, 0.02, marginal) + (b.gate ? 0.02 : 0));
    this.audio.onBreak(this.chain, marginal, b.gate);

    if (b.gate) {
      this.juice.addSlowmo(0.2);
      this.juice.addFlash(0.24);
      this.popup(p.x, p.y - 46, 'GATE BROKEN', 'gate', true);
    }
  }

  private triggerOverdrive() {
    if (!this.od.trigger()) return;
    this.odTriggers++;
    const p = this.player;
    this.juice.addFlash(0.55);
    this.juice.addShake(18);
    this.juice.addSlowmo(0.26);
    this.juice.addPunch(0.05);
    this.particles.ring(p.x, p.y, 1.4);
    this.particles.shards(p.x, p.y, p.vy * 0.4, 34, this.rng, 'od');
    this.popup(p.x, p.y - 52, 'OVERDRIVE', 'od', true);
    this.audio.onOverdrive();
  }

  private onBounce(b: Block) {
    const p = this.player;

    p.vy = Math.max(V_BOUNCE_CAP, -BOUNCE_KICK + p.vy * BOUNCE_SPEED_KEEP * 0.2);
    p.vy = Math.min(p.vy, -BOUNCE_KICK * 0.5);

    // Chip the block so a run can never deadlock against a wall it cannot break.
    // You always have a way through; it just costs health to buy it.
    if (b.hardness > 1) b.hardness--;

    this.loseChain();
    this.audio.onBounce();

    if (p.iframe <= 0) {
      p.health--;
      p.iframe = IFRAME_TIME;
      this.juice.addShake(18);
      this.juice.addFlash(0.42);
      this.juice.addHitstop(0.1);
      this.juice.addPunch(0.045);
      this.particles.shards(p.x, b.y, -200, 18, this.rng, 'hot');
      this.particles.ring(p.x, b.y, 0.7);
      this.popup(p.x, p.y - 30, `TOO SLOW · NEED ${b.hardness + 1}`, 'fail', true);
    } else {
      this.juice.addShake(6);
      this.juice.addHitstop(0.03);
    }
  }

  private onGraze() {
    const p = this.player;
    p.vy = Math.min(p.vy + GRAZE_SPEED_BONUS, 1e9);
    this.bonus += SCORE_PER_GRAZE * this.mult;
    this.grazes++;
    this.od.addGraze();
    if (this.od.ready) this.triggerOverdrive();
    // A graze keeps a chain alive without breaking anything — the precision line.
    if (this.chain > 0) this.chainTimer = CHAIN_TIMEOUT;
    this.audio.onGraze();
  }
}

/** Parallel to BIOMES in `biomes.ts`; kept here to avoid a circular import. */
const BIOME_SUB = [
  'COLD STEEL · THE SHAFT OPENS',
  'IT GETS HOT ON THE WAY DOWN',
  'EVERYTHING HERE IS BRITTLE',
  'DO NOT SLOW DOWN HERE',
  'NOTHING BELOW BUT FURTHER',
];

const byY = (a: Block, b: Block) => a.y - b.y;
