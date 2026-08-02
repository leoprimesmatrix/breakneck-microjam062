import {
  BOUNCE_MIN_VY,
  BOUNCE_SPEED_KEEP,
  BREAK_KEEP_EASY,
  BREAK_KEEP_HARD,
  CAM_ANCHOR,
  CHAIN_HEAL_AT,
  CHAIN_MULT_CAP,
  CHAIN_TIMEOUT,
  HEAT_REDLINE,
  IFRAME_TIME,
  INTRO_TIME,
  MAX_HEALTH,
  PX_PER_M,
  SCORE_PER_BREAK,
  ZONE_CARD_TIME,
} from '../config';
import { Audio } from '../engine/audio';
import { Juice } from '../engine/juice';
import { lerp, makeRng } from '../engine/math';
import { Particles } from '../engine/particles';
import type { Input } from '../engine/input';
import { view } from '../viewport';
import { paletteAt, zoneIndexAt, zoneName, zoneSub } from './biomes';
import { Heat } from './heat';
import { Player } from './player';
import { World, type Block } from './world';

export type GameState = 'title' | 'play' | 'dead';

/**
 * Bumped to v2 with the heat redesign. Scores from the old tier economy ran an
 * order of magnitude higher, so a carried-over best would sit permanently out of
 * reach and "NEW BEST" could never fire again.
 */
const BEST_KEY = 'breakneck.best.v2';
const RUNS_KEY = 'breakneck.runs.v2';

export type PopupKind = 'chain' | 'heal' | 'melt' | 'fail' | 'burn';

export interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  kind: PopupKind;
  big: boolean;
}

/** End-of-run grade. The single strongest "one more" lever a score game has. */
const RANKS: { min: number; label: string }[] = [
  { min: 50000, label: 'SS' },
  { min: 32000, label: 'S' },
  { min: 20000, label: 'A' },
  { min: 12000, label: 'B' },
  { min: 7000, label: 'C' },
  { min: 0, label: 'D' },
];

export class Game {
  state: GameState = 'title';

  readonly player = new Player();
  readonly world = new World();
  readonly juice = new Juice();
  readonly particles = new Particles();
  readonly audio = new Audio();
  readonly heat = new Heat();

  /**
   * Free-running animation clock, advanced on every state including the title
   * and results screens. Previously the overdrive module's internal pulse was
   * quietly doing this job for the whole game, which meant deleting it would
   * have frozen every menu.
   */
  clock = 0;

  depth = 0; // metres
  score = 0;
  bonus = 0;
  chain = 0;
  bestChain = 0;
  chainTimer = 0;
  runTime = 0;
  best = 0;
  isNewBest = false;
  runs = 0;

  // --- run stats, for the results screen
  breaks = 0;
  meltdowns = 0;
  peakHeat = 0;
  redlineTime = 0;

  // --- zone presentation
  zone = 0;
  zoneCard = 0;
  zoneCardName = '';
  zoneCardSub = '';

  /** Goal/intro card countdown; runs at the start of every run. */
  introT = 0;

  /** Recent positions, newest last, for the motion trail. */
  readonly trail: { x: number; y: number }[] = [];

  /** Floating world-space labels. */
  readonly popups: Popup[] = [];

  private input: Input;
  private rng = makeRng(1);
  /** Reused each step so collision resolution never allocates. */
  private hits: Block[] = [];

  constructor(input: Input) {
    this.input = input;
    this.best = this.loadNum(BEST_KEY);
    this.runs = this.loadNum(RUNS_KEY);
    this.world.reset((Math.random() * 0xffffffff) >>> 0);
  }

  /**
   * Attract-mode scroll position. Starts deep on purpose: near the surface every
   * barrier is GLASS, so the title would show none of the tough material the
   * mechanic turns on.
   */
  private titleY = 14000;

  get camY() {
    return this.state === 'title'
      ? this.titleY
      : this.player.y - view.logicalH * CAM_ANCHOR;
  }

  get camMetres() {
    return Math.max(0, this.camY / PX_PER_M);
  }

  get palette() {
    return paletteAt(this.camMetres);
  }

  get isFirstRun() {
    return this.runs === 0;
  }

  get rank() {
    return RANKS.find((r) => this.score >= r.min)!.label;
  }

  /** Scoring multiplier: heat is the dial, the chain compounds it. */
  get mult() {
    const chainMult = Math.min(Math.max(1, this.chain), CHAIN_MULT_CAP);
    return this.heat.mult * chainMult;
  }

  private popup(x: number, y: number, text: string, kind: PopupKind, big = false) {
    if (this.popups.length > 18) this.popups.shift();
    const max = big ? 0.9 : 0.55;
    this.popups.push({ x, y, text, life: max, max, kind, big });
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
    this.heat.reset();
    this.trail.length = 0;
    this.popups.length = 0;

    this.depth = 0;
    this.score = 0;
    this.bonus = 0;
    this.chain = 0;
    this.bestChain = 0;
    this.chainTimer = 0;
    this.runTime = 0;
    this.isNewBest = false;
    this.breaks = 0;
    this.meltdowns = 0;
    this.peakHeat = 0;
    this.redlineTime = 0;

    this.setZone(0, false);
    this.introT = INTRO_TIME;
    this.state = 'play';
    this.audio.setRunning(true);
  }

  private setZone(index: number, card: boolean) {
    this.zone = index;
    this.zoneCardName = zoneName(index);
    this.zoneCardSub = zoneSub(index);
    this.zoneCard = card ? ZONE_CARD_TIME : 0;
  }

  // ------------------------------------------------------------------ loop
  step(dtReal: number) {
    this.clock += dtReal;

    // Hitstop freezes everything, including particles. That's what makes it read.
    if (this.juice.consumeHitstop(dtReal)) return;
    this.juice.update(dtReal);

    const dt = dtReal * this.juice.timeScale;

    if (this.state === 'title') {
      this.titleY += 250 * dt;
      this.world.ensure(this.titleY + view.logicalH * 1.6);
      this.world.prune(this.titleY);
      if (this.input.takeAnyKey()) this.start();
    } else if (this.state === 'play') {
      this.stepPlay(dt);
    } else if (this.state === 'dead') {
      this.runTime += dt;
      if (this.runTime > 0.45 && this.input.takeConfirm()) this.start();
    }

    this.particles.update(dt);
  }

  private stepPlay(dt: number) {
    const p = this.player;
    this.runTime += dt;

    // --- heat, and the burn it costs
    const burn = this.heat.update(dt, p.speedNorm, this.input.brake);
    p.melting = this.heat.melting;
    p.heat = this.heat.value;
    this.peakHeat = Math.max(this.peakHeat, this.heat.value);

    if (this.heat.justMelted) this.onMeltdown();
    if (this.heat.justCooled) {
      this.juice.addFlash(0.2);
      this.audio.onMeltdownEnd();
    }
    if (this.heat.bandChanged > 0) this.audio.onBand(this.heat.band);

    if (burn > 0 && p.iframe <= 0) {
      this.redlineTime += dt;
      p.health -= burn;
      // Burning is a slow bleed, so it needs continuous feedback or it reads as
      // the game randomly taking hull for no reason.
      this.juice.addShake(1.4 + this.heat.overload * 2.2);
      if (this.rng() < dt * 22) {
        this.particles.shards(p.x, p.y, p.vy * 0.2, 2, this.rng, 'hot');
      }
    }

    const prevY = p.y;
    p.step(dt, this.input);
    p.y = this.resolve(prevY, prevY + p.vy * dt);

    this.depth = Math.max(this.depth, p.y / PX_PER_M);

    const z = zoneIndexAt(this.depth);
    if (z > this.zone) {
      this.setZone(z, true);
      this.juice.addFlash(0.14);
      this.audio.onZone();
    }
    if (this.zoneCard > 0) this.zoneCard -= dt;
    if (this.introT > 0) this.introT -= dt;

    // Chain lapses if you stop breaking things...
    if (this.chain > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) this.chain = 0;
    }

    // Braking no longer forfeits the chain. Venting already costs heat, which is
    // both your melting power and your multiplier; taking the chain as well made
    // cooling strictly dominated and the game punished the one skill it was
    // asking the player to learn.

    this.score = Math.floor(this.depth) + Math.floor(this.bonus);

    this.world.ensure(this.camY + view.logicalH);
    this.world.prune(this.camY);

    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 26) this.trail.shift();

    this.audio.setSpeed(p.speedNorm);
    this.audio.setHeat(this.heat.value, this.heat.melting, this.heat.redlining);

    for (let k = this.popups.length - 1; k >= 0; k--) {
      const pu = this.popups[k];
      pu.life -= dt;
      pu.y -= 46 * dt; // drift against the fall so they stay readable
      if (pu.life <= 0) this.popups.splice(k, 1);
    }

    if (p.health <= 0) this.die();
  }

  private onMeltdown() {
    this.meltdowns++;
    const p = this.player;
    this.juice.addFlash(0.6);
    this.juice.addShake(20);
    this.juice.addSlowmo(0.26);
    this.juice.addPunch(0.05);
    this.particles.ring(p.x, p.y, 1.4);
    this.particles.shards(p.x, p.y, p.vy * 0.4, 34, this.rng, 'molten');
    this.popup(p.x, p.y - 52, 'MELTDOWN', 'melt', true);
    this.audio.onMeltdown();
  }

  private die() {
    this.state = 'dead';
    this.runTime = 0;
    this.popups.length = 0;
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
    const r = view.playerR;
    let finalY = newY;

    // Invulnerability phases you through. Without this a single bounce starts an
    // unrecoverable spiral, and the i-frame window is the only place a run can
    // be rebuilt — so it has to actually clear space.
    if (p.iframe > 0) return finalY;

    const hits = this.hits;
    hits.length = 0;

    for (const b of this.world.blocks) {
      if (b.dead) continue;
      if (newY + r < b.y || prevY - r > b.y + b.h) continue;
      if (Math.abs(p.x - (b.x + b.w * 0.5)) < r + b.w * 0.5) hits.push(b);
    }

    if (hits.length === 0) return finalY;
    hits.sort(byY);

    for (const b of hits) {
      // Heat is re-read each time: a long burn-through bleeds speed and can drop
      // you below the next barrier's threshold. The chain is self-limiting.
      if (this.heat.canMelt(b.material)) {
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

    const marginal = this.heat.marginality(b.material);
    p.vy *= this.heat.melting ? 1 : lerp(BREAK_KEEP_EASY, BREAK_KEEP_HARD, marginal);

    // Going through material heats you. This is the keystone: ploughing is what
    // drives you into the redline, so the hold-the-dive line cooks itself.
    this.heat.addBreak(b.material);

    this.chain++;
    this.chainTimer = CHAIN_TIMEOUT;
    if (this.chain > this.bestChain) this.bestChain = this.chain;
    this.bonus += SCORE_PER_BREAK * this.mult;

    if (this.chain > 0 && this.chain % CHAIN_HEAL_AT === 0) {
      const healed = p.health < MAX_HEALTH;
      p.health = Math.min(MAX_HEALTH, Math.floor(p.health) + 1);
      this.juice.addFlash(0.16);
      this.popup(
        p.x,
        p.y - 34,
        healed ? '+1 HULL' : `x${this.chain}`,
        healed ? 'heal' : 'chain',
        true,
      );
      if (healed) this.audio.onHeal();
    } else if (this.chain >= 5 && this.chain % 5 === 0) {
      this.popup(p.x, p.y - 30, `x${this.chain}`, 'chain', true);
    }

    // Feedback scales with significance, not chain length.
    this.particles.shards(
      b.x + b.w * 0.5,
      b.y + b.h * 0.5,
      p.vy,
      b.gate ? 26 : Math.round(lerp(5, 16, marginal)),
      this.rng,
      this.heat.melting ? 'molten' : 'cool',
    );
    if (marginal > 0.6 || b.gate || this.heat.melting) {
      this.particles.ring(b.x + b.w * 0.5, b.y + b.h * 0.5, b.gate ? 0.9 : 0.5);
    }
    this.juice.addHitstop(lerp(0.004, 0.05, marginal) + (b.gate ? 0.03 : 0));
    this.juice.addShake(lerp(2, 12, marginal) + (b.gate ? 9 : 0));
    this.juice.addPunch(lerp(0.004, 0.02, marginal) + (b.gate ? 0.02 : 0));
    this.audio.onBreak(this.chain, marginal, b.material, b.gate);

    if (b.gate) {
      this.juice.addSlowmo(0.2);
      this.juice.addFlash(0.24);
    }
  }

  private onBounce(b: Block) {
    const p = this.player;

    // Dump most of the speed, but keep FALLING.
    //
    // This used to throw the player upward, and that single line produced an
    // unrecoverable death spiral: the reversal cost all velocity, velocity is
    // what makes heat, heat is what melts material — so one bounce off a plate
    // dropped you below the plate threshold and every subsequent plate bounced
    // you too, four hull in three seconds. Staying on the way down means the
    // i-frame window is spent re-accelerating instead of climbing back to zero.
    p.vy = Math.max(BOUNCE_MIN_VY, p.vy * BOUNCE_SPEED_KEEP);

    // Chip it so a run can never deadlock against a wall it cannot melt. You
    // always have a way through; it just costs hull to buy it.
    const softened = World.chip(b);

    this.chain = 0;
    this.audio.onBounce();

    if (p.iframe <= 0) {
      p.health = Math.floor(p.health) - 1;
      p.iframe = IFRAME_TIME;
      this.juice.addShake(18);
      this.juice.addFlash(0.42);
      this.juice.addHitstop(0.1);
      this.juice.addPunch(0.045);
      this.particles.shards(p.x, b.y, -200, 18, this.rng, 'hot');
      this.particles.ring(p.x, b.y, 0.7);
      this.popup(p.x, p.y - 30, softened ? 'CRACKED IT' : 'TOO COLD', 'fail', true);
    } else {
      this.juice.addShake(6);
      this.juice.addHitstop(0.03);
    }
  }

  /** True while the hull is burning — drives the HUD alarm state. */
  get burning() {
    return this.heat.value >= HEAT_REDLINE && !this.heat.melting;
  }
}

const byY = (a: Block, b: Block) => a.y - b.y;
