import {
  AIM_TIMESCALE,
  AIM_TIMESCALE_DRY,
  COL,
  COMBO_CAP,
  COMBO_TIMEOUT,
  FOCUS_DRAIN,
  FOCUS_MAX,
  FOCUS_PER_KILL,
  FOCUS_REGEN,
  FOCUS_WAVE_REFILL,
  HINT_CARD_TIME,
  HURT_KNOCKBACK,
  IFRAME_TIME,
  MAX_HULL,
  MULTI_NAMES,
  PLAYER_R,
  STRIKE_RANGE_PER_KILL,
  TIMESCALE_EASE,
  WAVE_BREATHER,
  WAVE_CARD_TIME,
  WAVE_CLEAR_BONUS,
  type RGB,
} from '../config';
import { Audio } from '../engine/audio';
import type { Input } from '../engine/input';
import { Juice } from '../engine/juice';
import { TAU, clamp, damp, makeRng, randRange, type Rng } from '../engine/math';
import { Particles } from '../engine/particles';
import { view } from '../viewport';
import { ORB_R, SPECS, Swarm, silhouette, type Enemy, type EnemyKind } from './enemies';
import { Player } from './player';
import { clonePlan, solveStrike, type StrikePlan } from './strike';
import { Director } from './waves';

export type GameState = 'title' | 'play' | 'paused' | 'dead';
export type PopupKind = 'score' | 'multi' | 'good' | 'bad' | 'wave';

export interface Popup {
  x: number;
  y: number;
  vy: number;
  text: string;
  sub: string;
  kind: PopupKind;
  col: RGB;
  life: number;
  max: number;
  scale: number;
}

export interface HintCard {
  kind: EnemyKind;
  life: number;
}

/** A strike line burned into the floor, fading. */
export interface Scar {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  max: number;
}

/** A scorch mark where something died. */
export interface Burn {
  x: number;
  y: number;
  r: number;
  col: RGB;
  life: number;
  max: number;
}

const BEST_KEY = 'afterburn.best.v1';
const WAVE_KEY = 'afterburn.wave.v1';
const RUNS_KEY = 'afterburn.runs.v1';

/**
 * Thresholds calibrated against instrumented runs: a competent run dies around
 * wave 10 for ~70k, and the wave-clear bonus scales with the wave number, so
 * the curve has to be superlinear or every long run collapses into one grade.
 */
const RANKS: { min: number; label: string; note: string }[] = [
  { min: 180000, label: 'SS', note: 'Nothing survives the line.' },
  { min: 85000, label: 'S', note: 'Surgical.' },
  { min: 38000, label: 'A', note: 'Reading the whole board.' },
  { min: 15000, label: 'B', note: 'Getting dangerous.' },
  { min: 5000, label: 'C', note: 'Finding the rhythm.' },
  { min: 0, label: 'D', note: 'Hold longer. Aim through more.' },
];

export const ENEMY_COL: Record<EnemyKind, RGB> = {
  mote: COL.mote,
  seeder: COL.seeder,
  ward: COL.ward,
  lancer: COL.lancer,
  spine: COL.spine,
};

export class Game {
  state: GameState = 'title';

  readonly player = new Player();
  readonly swarm = new Swarm();
  readonly director = new Director();
  readonly juice = new Juice();
  readonly particles = new Particles();
  readonly audio = new Audio();

  /** Free-running real-time clock. Menus animate off this. */
  clock = 0;
  /** Smoothed simulation time scale, 0..1. Drives audio and post as well. */
  timeScale = 1;
  /** Wall-clock seconds of the current run. */
  runTime = 0;
  /** Seconds since the run ended, for staging the results screen. */
  deadTime = 0;
  /** Seconds since the title screen appeared, for staging its entrance. */
  titleTime = 0;

  /** False until the cold open has fired; the game sits in standby until then. */
  armed = false;
  /** True between the first gesture and the first note. Usually one frame. */
  arming = false;
  /** Seconds spent waiting for that first note, so a stalled fetch cannot hang. */
  private armTime = 0;
  /** Seconds on the standby screen, for its own quiet animation. */
  standbyTime = 0;
  /** Swallows the igniting gesture so it cannot also start the run. */
  private armGate = false;

  score = 0;
  combo = 1;
  comboTimer = 0;
  bestCombo = 1;
  bestMulti = 0;
  kills = 0;

  wave = 0;
  waveCard = 0;
  waveClear = 0;
  private breather = 0;

  best = 0;
  bestWave = 0;
  runs = 0;
  isNewBest = false;

  /** Live preview of the strike the player is currently lining up. */
  aim: StrikePlan | null = null;
  aimAngle = -Math.PI / 2;
  aiming = false;
  /** 0..1 how "dry" the focus meter is; drives the desaturation of aim mode. */
  aimBlend = 0;

  readonly popups: Popup[] = [];
  readonly hints: HintCard[] = [];
  /**
   * The floor remembers. Strike lines scar it for a couple of seconds, kills
   * scorch it for longer. Cosmetically cheap, psychologically load-bearing: an
   * arena that keeps the marks of what you did reads as a place, and a place is
   * the one thing procedurally-flavoured games always fail to feel like.
   */
  readonly scars: Scar[] = [];
  readonly burns: Burn[] = [];
  /** Species met this run, in the order they were met — the pause codex. */
  readonly seenKinds = new Set<EnemyKind>();

  /**
   * Tutorial progress — all of it self-clearing, none of it blocking, and all
   * of it strictly ordered so two lessons never print in the same place.
   */
  hasHeld = false;
  hasStruck = false;
  moveTaught = 0;
  focusTaught = 0;
  private focusPending = false;

  /** Public so the renderer can draw the reticle where the player is pointing. */
  readonly input: Input;
  private rng: Rng = makeRng(12345);
  private hitBuf: number[] = [];
  /** Seconds a pending release stays live while waiting for the cooldown. */
  private strikeBuffer = 0;
  /** Attract-mode ghost, so the title screen demonstrates the verb. */
  private ghostTimer = 0;

  constructor(input: Input) {
    this.input = input;
    this.best = this.load(BEST_KEY);
    this.bestWave = this.load(WAVE_KEY);
    this.runs = this.load(RUNS_KEY);
    this.player.reset();
    this.beginAttract();
    // The cold open does *not* fire here. See `arm`.
  }

  /**
   * The player's first gesture.
   *
   * The title's cold open is a flashbulb, and it is written to be the moment
   * the soundtrack kicks in. A browser will not let a page make a sound until
   * someone has interacted with it, so firing the bang on page load meant it
   * always went off in silence and the music joined some seconds later,
   * wherever the player happened to click — two events that should have been
   * one. So the bang waits for the gesture instead of racing it: the room idles
   * in the dark until this is called, and then detonates on the downbeat.
   *
   * This only *requests* the music. `ignite` is what fires, once the audio is
   * genuinely audible — see `stepTitle`.
   */
  arm() {
    if (this.armed || this.arming) return;
    this.arming = true;
    this.armTime = 0;
    this.audio.ensure();
    // Nothing to wait for on a machine that cannot make sound at all.
    if (!this.audio.ready) {
      this.ignite();
      return;
    }
    // Off the event rather than the frame poll in `stepTitle`, which stays as a
    // backstop: a frame of slack here is a frame of the flash landing late.
    this.audio.tracks.onFirstNote(() => this.ignite());
  }

  /**
   * Detonate the title. Called on the frame the first note actually sounds.
   *
   * The screen-space flash lives in `screens.ts` because the title is drawn
   * after the world is composited — but shake, lens punch and a hard chromatic
   * fringe all belong to the scene buffer, and firing them here is what makes
   * the arena *lurch* under the wordmark instead of sitting there politely
   * while it lands.
   */
  private ignite() {
    if (this.armed) return;
    this.armed = true;
    this.arming = false;
    this.armGate = true;
    this.titleTime = 0;
    // Re-seed the room so the attract show starts with the music rather than
    // halfway through a drift it began during standby.
    this.beginAttract();
    this.juice.addShake(30);
    this.juice.addPunch(0.22);
    this.juice.addFringe(1.8);
    this.juice.addFlash(1, COL.playerCore);
  }

  private load(key: string) {
    try {
      return Number(localStorage.getItem(key)) || 0;
    } catch {
      return 0;
    }
  }

  private save(key: string, v: number) {
    try {
      localStorage.setItem(key, String(Math.floor(v)));
    } catch {
      /* private browsing — never worth failing a run over */
    }
  }

  get rank() {
    return RANKS.find((r) => this.score >= r.min)!;
  }

  get focusFrac() {
    return clamp(this.player.focus / FOCUS_MAX, 0, 1);
  }

  get inDanger() {
    return this.state === 'play' && this.player.hull <= 1;
  }

  // --------------------------------------------------------------- lifecycle
  private beginAttract() {
    this.swarm.reset();
    this.particles.reset();
    this.scars.length = 0;
    this.burns.length = 0;
    this.rng = makeRng((Math.random() * 0xffffffff) >>> 0);
    this.player.reset();
    // NB: titleTime is deliberately *not* reset here. Attract mode restocks the
    // field whenever it runs dry, and resetting the clock would restart the
    // wordmark's draw-on every few seconds — the title would never settle.
    for (let i = 0; i < 7; i++) {
      const k: EnemyKind = i % 3 === 0 ? 'mote' : i % 3 === 1 ? 'ward' : 'seeder';
      this.swarm.spawn(
        k,
        randRange(this.rng, 120, view.arenaW - 120),
        randRange(this.rng, 120, view.arenaH - 120),
        this.rng,
        0,
        0.55,
      );
    }
  }

  start() {
    this.rng = makeRng((Math.random() * 0xffffffff) >>> 0);
    this.player.reset();
    this.swarm.reset();
    this.particles.reset();
    this.juice.reset();
    this.director.reset();
    this.popups.length = 0;
    this.hints.length = 0;
    this.scars.length = 0;
    this.burns.length = 0;
    this.seenKinds.clear();

    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.bestCombo = 1;
    this.bestMulti = 0;
    this.kills = 0;
    this.runTime = 0;
    this.deadTime = 0;
    this.isNewBest = false;
    this.timeScale = 1;
    this.wave = 0;
    this.waveClear = 0;
    this.breather = 0;
    this.hasHeld = false;
    this.hasStruck = false;
    this.moveTaught = 0;
    this.focusTaught = 0;
    this.focusPending = false;
    this.strikeBuffer = 0;

    this.state = 'play';
    this.audio.setRunning(true);
    this.nextWave();

    // Dropping in. The same beat as the title's arrival, half the size: the run
    // should start on an impact rather than on a cut.
    this.juice.addFlash(0.75, COL.playerCore);
    this.juice.addPunch(0.16);
    this.juice.addFringe(1.2);
    this.juice.addShake(15);
    this.particles.ring(this.player.x, this.player.y, COL.strike, 260, 0.5, 5);
    this.particles.ring(this.player.x, this.player.y, COL.playerCore, 150, 0.34, 3);
  }

  private nextWave() {
    this.wave++;
    this.director.begin(this.wave, this.rng);
    this.waveCard = WAVE_CARD_TIME;
    this.player.focus = Math.min(FOCUS_MAX, this.player.focus + FOCUS_WAVE_REFILL);
    this.audio.onWave(this.wave);

    // Every fourth wave hands back a hull point. Long runs should be winnable
    // after a mistake, not permanently poisoned by one.
    if (this.wave % 4 === 0 && this.player.hull < MAX_HULL) {
      this.player.hull++;
      this.pushPopup(this.player.x, this.player.y - 42, '+1 HULL', '', 'good', COL.hull, 1.1);
      this.audio.onHeal();
    }
  }

  private die() {
    this.state = 'dead';
    this.deadTime = 0;
    this.audio.setRunning(false);
    this.audio.onDeath();
    this.juice.addHitstop(0.24);
    this.juice.addShake(34);
    this.juice.addFlash(1, COL.danger);
    this.juice.addPunch(0.14);
    this.juice.addSlowmo(0.9);
    this.particles.burst(this.player.x, this.player.y, COL.player, 64, 1.5, this.rng);
    this.particles.ring(this.player.x, this.player.y, COL.player, 300, 0.8, 6);
    this.particles.ring(this.player.x, this.player.y, COL.danger, 190, 0.6, 4);
    this.addBurn(this.player.x, this.player.y, 64, COL.danger);

    this.runs++;
    this.save(RUNS_KEY, this.runs);
    if (this.score > this.best) {
      this.best = this.score;
      this.isNewBest = true;
      this.save(BEST_KEY, this.best);
    }
    if (this.wave > this.bestWave) {
      this.bestWave = this.wave;
      this.save(WAVE_KEY, this.bestWave);
    }
  }

  // -------------------------------------------------------------------- loop
  step(dtReal: number) {
    this.clock += dtReal;
    this.input.update(dtReal);

    if (this.juice.consumeHitstop(dtReal)) return;
    this.juice.update(dtReal);

    if (this.state === 'title') this.stepTitle(dtReal);
    else if (this.state === 'play') this.stepPlay(dtReal);
    else if (this.state === 'paused') this.stepPaused(dtReal);
    else this.stepDead(dtReal);
  }

  /**
   * How long to wait for the first note before giving up and firing anyway.
   *
   * The track is buffered from page load, so in practice this is reached only
   * when the network has stalled or the browser has refused playback outright.
   * A player staring at a dead screen is a worse failure than a bang without
   * music, so the wait is short.
   */
  private static readonly ARM_TIMEOUT = 0.9;

  private stepTitle(dtReal: number) {
    // Standby: the room idles in the dark until the player's first gesture,
    // because that gesture is the earliest instant a browser will let the
    // soundtrack start. See `arm`.
    if (!this.armed) {
      this.standbyTime += dtReal;
      // A slow drift, not a freeze: a completely static first frame reads as a
      // game that has crashed before it started.
      const dt = dtReal * 0.25;
      this.swarm.targetX = view.arenaW * 0.5 + Math.cos(this.clock * 0.22) * 240;
      this.swarm.targetY = view.arenaH * 0.5 + Math.sin(this.clock * 0.17) * 150;
      this.swarm.update(dt);
      this.particles.update(dt);

      if (this.arming) {
        this.armTime += dtReal;
        if (this.audio.tracks.audible || this.armTime > Game.ARM_TIMEOUT) this.ignite();
      }

      // Drain input, or the gesture that armed the game would also be read as
      // the one that starts the run and the title would never be seen.
      this.input.takeConfirm();
      this.input.takeRelease();
      return;
    }

    this.titleTime += dtReal;
    const dt = dtReal * 0.6;
    this.swarm.targetX = view.arenaW * 0.5 + Math.cos(this.clock * 0.4) * 260;
    this.swarm.targetY = view.arenaH * 0.5 + Math.sin(this.clock * 0.31) * 170;
    this.swarm.update(dt);
    this.particles.update(dt);
    this.stepMarks(dt);

    // A ghost strike every few seconds, so the title screen teaches the verb
    // before a single word of instruction is read.
    this.ghostTimer -= dtReal;
    if (this.ghostTimer <= 0) {
      this.ghostTimer = randRange(this.rng, 1.6, 2.8);
      this.ghostStrike();
    }

    // The gesture that ignited the title is still sitting in the input buffer:
    // it was pressed during standby, but it is released a frame or two *after*
    // the cold open fires, so it latches a confirm that nothing has consumed.
    // Left alone, the single click that lights the screen also skips straight
    // past it and the title is never seen. Swallow that gesture, and keep
    // swallowing until it is actually let go — otherwise holding the button
    // down through the cold open skips it too.
    if (this.armGate) {
      this.input.takeConfirm();
      if (!this.input.holding) this.armGate = false;
    } else if (this.titleTime > 0.5 && this.input.takeConfirm()) {
      this.start();
    }
    this.input.takeRelease();
  }

  /** Attract-mode flourish: kill something on screen with a visible line. */
  private ghostStrike() {
    const live = this.swarm.list.filter((e) => e.alive && e.spawn <= 0);
    if (!live.length) {
      this.beginAttract();
      return;
    }
    const t = live[Math.floor(this.rng() * live.length)];
    const a = Math.atan2(t.y - this.player.y, t.x - this.player.x);
    const plan = solveStrike(this.swarm, this.player.x, this.player.y, a);
    this.player.begin(clonePlan(plan));

    for (const h of plan.hits) {
      if (h.blocked || !h.enemy) continue;
      h.enemy.alive = false;
      const col = ENEMY_COL[h.enemy.kind];
      this.particles.shatter(
        h.enemy.x, h.enemy.y, silhouette(h.enemy.kind, h.enemy.r), h.enemy.rot,
        col, plan.dx * 200, plan.dy * 200, this.rng,
      );
      this.particles.burst(h.enemy.x, h.enemy.y, col, 12, 1, this.rng);
      this.particles.ring(h.enemy.x, h.enemy.y, col, 78, 0.4, 2.5);
      this.addBurn(h.enemy.x, h.enemy.y, h.enemy.r * 2.1, col);
    }
    this.player.x = plan.x0 + plan.dx * plan.dist;
    this.player.y = plan.y0 + plan.dy * plan.dist;
    this.addScar(plan.x0, plan.y0, this.player.x, this.player.y);
    this.player.endStrike();
    this.juice.addShake(4);

    // Keep the attract field stocked.
    if (this.swarm.liveCount < 5) {
      const kinds: EnemyKind[] = ['mote', 'ward', 'seeder', 'lancer'];
      this.swarm.spawn(
        kinds[Math.floor(this.rng() * kinds.length)],
        randRange(this.rng, 120, view.arenaW - 120),
        randRange(this.rng, 120, view.arenaH - 120),
        this.rng,
        0.5,
        0.55,
      );
    }
  }

  /**
   * Enter the pause screen. Also used when the tab loses focus, which is why it
   * lives here rather than inline in `stepPlay`.
   */
  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    // Nothing consumes the confirm edge during a run, so the player's last
    // strike is still sitting there latched — and `stepPaused` accepts a
    // confirm as "resume". Left alone, the pause screen appears for exactly one
    // frame and then dismisses itself. Drain it here, the same way the title
    // drains the click that ignited it.
    this.input.takeConfirm();
    // See `Audio.setPaused` for why the order is this way round here and the
    // other way round on the way out.
    this.audio.setPaused(true);
    this.audio.setRunning(false);
  }

  private stepPaused(dtReal: number) {
    this.player.tick(dtReal * 0.15, false);
    if (this.input.takePause() || this.input.takeConfirm()) {
      this.state = 'play';
      this.audio.setRunning(true);
      this.audio.setPaused(false);
    }
    this.input.takeRelease();
  }

  private stepDead(dtReal: number) {
    this.deadTime += dtReal;
    const dt = dtReal * 0.35;
    this.swarm.targetX = this.player.x;
    this.swarm.targetY = this.player.y;
    this.swarm.update(dt);
    this.particles.update(dt);
    this.stepPopups(dt);
    this.stepMarks(dt);
    if (this.deadTime > 0.8 && (this.input.takeConfirm() || this.input.takeRelease())) {
      this.start();
    }
  }

  // ------------------------------------------------------------------- play
  private stepPlay(dtReal: number) {
    const p = this.player;

    if (this.input.takePause()) {
      this.pause();
      return;
    }

    this.aiming = this.input.holding && !p.striking;
    if (this.aiming) this.hasHeld = true;

    // --- time dilation. Target is chosen in one place so aim-slow, impact-slow
    //     and normal time can never fight each other.
    const dry = p.focus <= 0;
    const base = p.striking ? 1 : this.aiming ? (dry ? AIM_TIMESCALE_DRY : AIM_TIMESCALE) : 1;
    const target = base * this.juice.slowScale;
    // Asymmetric: ease *into* slow motion so the world settles, snap *out* of it
    // so the strike leaves at full speed on the very first frame. A symmetric
    // curve spends the first tenth of every strike accelerating, and that is
    // precisely the tenth that is supposed to feel violent.
    const ease = target > this.timeScale ? TIMESCALE_EASE * 0.28 : TIMESCALE_EASE;
    this.timeScale = damp(this.timeScale, target, 1 / ease, dtReal);
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, 14, dtReal);

    const dt = dtReal * this.timeScale;
    this.runTime += dtReal;

    // --- focus burns on REAL time. Charging in dilated time would otherwise be
    //     nearly free, and the whole economy would collapse.
    if (this.aiming) {
      p.focus = Math.max(0, p.focus - FOCUS_DRAIN * dtReal);
    } else if (!p.striking) {
      p.focus = Math.min(FOCUS_MAX, p.focus + FOCUS_REGEN * dtReal);
    }

    p.tick(dtReal, this.aiming);

    // --- aim
    if (!p.striking) {
      this.aimAngle = this.input.aimAngleFrom(p.x, p.y);
      if (this.input.pointerActive) this.input.syncKeyAngle(this.aimAngle);
      this.aim = solveStrike(this.swarm, p.x, p.y, this.aimAngle, 0);
    } else {
      this.aim = null;
    }

    // --- commit. A release that lands during the strike cooldown is buffered
    //     rather than dropped: releasing a fraction too early is the single most
    //     common input mistake, and eating the input teaches the player that the
    //     game is unresponsive rather than that they were early.
    if (this.input.takeRelease()) this.strikeBuffer = 0.16;
    if (this.strikeBuffer > 0) {
      this.strikeBuffer -= dtReal;
      if (p.canStrike) {
        this.strikeBuffer = 0;
        this.launch();
      }
    }

    // --- movement
    if (p.striking) {
      const done = p.advanceStrike(dt, this.hitBuf);
      for (const idx of this.hitBuf) this.resolveHit(idx);
      if (done) this.finishStrike();
    } else {
      p.drift(dt, this.aimAngle);
    }

    // --- world
    this.swarm.targetX = p.x;
    this.swarm.targetY = p.y;
    this.swarm.firedOrbs = 0;
    this.swarm.lancerMarks = 0;
    this.swarm.lancerCharges = 0;
    this.swarm.update(dt);
    if (this.swarm.lancerMarks) this.audio.onLancerMark();
    if (this.swarm.lancerCharges) this.audio.onLancerCharge();
    if (this.swarm.firedOrbs) this.audio.onOrb();

    if (this.waveCard > 0) this.waveCard -= dtReal;
    if (this.waveClear > 0) this.waveClear -= dtReal;
    for (let i = this.hints.length - 1; i >= 0; i--) {
      this.hints[i].life -= dtReal;
      if (this.hints[i].life <= 0) this.hints.splice(i, 1);
    }
    // Lessons run one at a time, in the order they become relevant: how to move
    // before what the resource does. Two prompts sharing the same patch of
    // screen is how a tutorial turns into noise.
    if (this.moveTaught > 0) {
      this.moveTaught -= dtReal;
      if (this.moveTaught <= 0 && this.focusPending) {
        this.focusPending = false;
        this.focusTaught = HINT_CARD_TIME;
      }
    } else if (this.focusTaught > 0) {
      this.focusTaught -= dtReal;
    }

    this.director.update(dt, this.swarm, this.rng, p.x, p.y);
    this.noticeNewKinds();

    // --- damage
    if (!p.striking && p.iframe <= 0) this.checkContact();

    // --- wave flow
    if (this.breather > 0) {
      this.breather -= dtReal;
      if (this.breather <= 0) this.nextWave();
    } else if (this.director.emptied && this.swarm.liveCount === 0) {
      this.clearWave();
    }

    // --- combo decay
    if (this.combo > 1) {
      this.comboTimer -= dtReal;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.audio.onComboLost();
      }
    }

    this.stepPopups(dt);
    this.stepMarks(dt);
    this.particles.update(dt);
    this.audio.setIntensity(this.timeScale, p.speedNorm, this.combo, this.inDanger);

    if (p.hull <= 0) this.die();
  }

  private stepPopups(dt: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const q = this.popups[i];
      q.life -= dt;
      q.y += q.vy * dt;
      q.vy *= Math.exp(-3.2 * dt);
      if (q.life <= 0) this.popups.splice(i, 1);
    }
  }

  /** Fade the floor's memory on sim time, so slow motion preserves it. */
  private stepMarks(dt: number) {
    for (let i = this.scars.length - 1; i >= 0; i--) {
      const s = this.scars[i];
      s.life -= dt;
      if (s.life <= 0) this.scars.splice(i, 1);
    }
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.life -= dt;
      if (b.life <= 0) this.burns.splice(i, 1);
    }
  }

  private addScar(x0: number, y0: number, x1: number, y1: number) {
    if (this.scars.length > 12) this.scars.shift();
    this.scars.push({ x0, y0, x1, y1, life: 2.2, max: 2.2 });
  }

  private addBurn(x: number, y: number, r: number, col: RGB) {
    if (this.burns.length > 26) this.burns.shift();
    this.burns.push({ x, y, r, col, life: 8, max: 8 });
  }

  private pushPopup(
    x: number,
    y: number,
    text: string,
    sub: string,
    kind: PopupKind,
    col: RGB,
    scale = 1,
  ) {
    if (this.popups.length > 22) this.popups.shift();
    const max = kind === 'multi' ? 1.25 : 0.72;
    this.popups.push({
      x: clamp(x, 90, view.arenaW - 90),
      y: clamp(y, 60, view.arenaH - 60),
      vy: kind === 'multi' ? -34 : -66,
      text,
      sub,
      kind,
      col,
      life: max,
      max,
      scale,
    });
  }

  // ------------------------------------------------------------------ strike
  private launch() {
    const p = this.player;
    const plan = clonePlan(solveStrike(this.swarm, p.x, p.y, this.aimAngle, 0));
    const first = !this.hasStruck;
    p.begin(plan);
    this.hasStruck = true;
    // The single most important thing a new player has to be told, and the one
    // thing no amount of watching the ship will make obvious: there is no other
    // movement. Everything you do to reposition is a strike.
    if (first && this.runs < 3) this.moveTaught = 3.4;

    this.audio.onStrike(plan.hits.length);
    this.juice.addPunch(0.05 + Math.min(0.06, plan.kills * 0.014));
    this.juice.addKick(plan.dx, plan.dy, 7);
    this.juice.addFringe(0.5);
    this.particles.spall(p.x, p.y, this.aimAngle + Math.PI * 0.5, COL.strike, 10, this.rng);
    this.particles.ring(p.x, p.y, COL.strike, 74, 0.3, 3);
  }

  private resolveHit(index: number) {
    const p = this.player;
    const plan = p.plan;
    if (!plan) return;
    const hit = plan.hits[index];

    if (hit.blocked && hit.enemy) {
      this.onBlocked(hit.enemy, hit.x, hit.y);
      return;
    }

    if (hit.enemy) this.killEnemy(hit.enemy, plan.dx, plan.dy, true);
    else if (hit.orb) this.killOrb(hit.orb, plan.dx, plan.dy);
  }

  private killEnemy(e: Enemy, dx: number, dy: number, byStrike: boolean) {
    if (!e.alive) return;
    e.alive = false;
    const spec = SPECS[e.kind];
    const col = ENEMY_COL[e.kind];

    this.kills++;
    const gain = Math.round(spec.score * this.combo);
    this.score += gain;
    this.combo = Math.min(COMBO_CAP, this.combo + 1);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = COMBO_TIMEOUT;
    this.player.focus = Math.min(FOCUS_MAX, this.player.focus + FOCUS_PER_KILL);

    if (byStrike) this.player.strikeKills++;

    if (e.kind === 'seeder') this.swarm.burst(e, this.rng);

    const power = e.kind === 'spine' ? 1.5 : e.kind === 'mote' ? 0.9 : 1.2;
    const ang = Math.atan2(dy, dx);
    // The body breaks into its own edges first — *that* shape died, in its own
    // colour — and the generic debris underneath is thinned to make room.
    this.particles.shatter(e.x, e.y, silhouette(e.kind, e.r), e.rot, col, dx * 240, dy * 240, this.rng);
    this.particles.burst(e.x, e.y, col, Math.round(13 * power) + 8, power, this.rng);
    this.particles.ring(e.x, e.y, col, 96 * power, 0.42, 3.4);
    this.particles.ring(e.x, e.y, COL.playerCore, 46 * power, 0.24, 2.2);
    this.particles.plate(e.x, e.y, ang, COL.playerCore, 150 * power);
    // Spall thrown along the strike axis: debris should look like it was
    // knocked off by something travelling through, not like a firework.
    this.particles.spall(e.x, e.y, ang, col, 10, this.rng);
    this.addBurn(e.x, e.y, e.r * 2.1, col);
    this.pushPopup(e.x, e.y - e.r - 12, `+${gain}`, '', 'score', col, 0.72);

    // Hitstop shrinks as a chain grows: the first kill should land like a
    // hammer, the fifth should feel like the line is simply not stopping.
    const n = this.player.strikeKills;
    this.juice.addHitstop(Math.max(0.014, 0.05 - n * 0.006));
    this.juice.addShake(6 + Math.min(10, n * 1.6));
    this.juice.addFlash(0.1 + Math.min(0.16, n * 0.03), col);
    this.juice.addFringe(0.35);
    this.audio.onKill(e.kind, n, this.combo);

    if (this.runs < 3 && this.kills === 1) {
      if (this.moveTaught > 0) this.focusPending = true;
      else this.focusTaught = HINT_CARD_TIME;
    }
  }

  private killOrb(o: { x: number; y: number; alive: boolean }, dx: number, dy: number) {
    if (!o.alive) return;
    o.alive = false;
    this.score += Math.round(40 * this.combo);
    this.player.focus = Math.min(FOCUS_MAX, this.player.focus + FOCUS_PER_KILL * 0.35);
    this.particles.burst(o.x, o.y, COL.spine, 10, 0.7, this.rng);
    this.particles.ring(o.x, o.y, COL.spine, 34, 0.26, 2);
    this.particles.plate(o.x, o.y, Math.atan2(dy, dx), COL.playerCore, 54);
    this.juice.addHitstop(0.01);
    this.juice.addShake(3);
    this.audio.onOrbPop();
  }

  private onBlocked(e: Enemy, x: number, y: number) {
    const p = this.player;
    p.travelled = p.plan ? p.plan.dist : p.travelled;
    p.stun = 0.34;
    e.flash = 1;

    const away = Math.atan2(p.y - e.y, p.x - e.x);
    p.vx = Math.cos(away) * 430;
    p.vy = Math.sin(away) * 430;

    this.juice.addHitstop(0.1);
    this.juice.addShake(15);
    this.juice.addFlash(0.3, COL.ward);
    this.juice.addPunch(0.05);
    this.juice.addKick(Math.cos(away), Math.sin(away), 9);
    this.particles.ring(x, y, COL.ward, 96, 0.42, 4);
    this.particles.spall(x, y, away, COL.ward, 16, this.rng);
    this.pushPopup(x, y - 40, 'BLOCKED', 'FLANK IT', 'bad', COL.ward);
    this.audio.onBlocked();
  }

  private finishStrike() {
    const p = this.player;
    const plan = p.plan;
    const n = p.strikeKills;

    if (plan) this.addScar(plan.x0, plan.y0, p.x, p.y);

    if (plan && plan.hitWall && !plan.blocked) {
      this.particles.spall(p.x, p.y, this.aimAngle + Math.PI * 0.5, COL.wall, 12, this.rng);
      this.juice.addShake(6);
      this.audio.onWall();
    }

    if (n >= 2) {
      const bonus = 100 * n * (n - 1);
      this.score += bonus;
      this.bestMulti = Math.max(this.bestMulti, n);
      const name = MULTI_NAMES[Math.min(n - 2, MULTI_NAMES.length - 1)];
      this.pushPopup(p.x, p.y - 54, name, `+${bonus}`, 'multi', COL.playerCore, 1 + n * 0.06);
      this.juice.addFlash(0.16 + n * 0.05, COL.strike);
      this.juice.addSlowmo(Math.min(0.34, 0.1 + n * 0.05));
      this.juice.addShake(10 + n * 2);
      this.audio.onMulti(n);
    }

    p.endStrike();
  }

  // ---------------------------------------------------------------- contact
  private checkContact() {
    const p = this.player;
    for (const e of this.swarm.list) {
      if (!e.alive || e.spawn > 0) continue;
      const r = e.r + PLAYER_R * 0.8;
      if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < r * r) {
        this.hurt(e.x, e.y, ENEMY_COL[e.kind]);
        return;
      }
    }
    for (const o of this.swarm.orbs) {
      if (!o.alive) continue;
      const r = ORB_R + PLAYER_R * 0.8;
      if ((p.x - o.x) ** 2 + (p.y - o.y) ** 2 < r * r) {
        o.alive = false;
        this.particles.burst(o.x, o.y, COL.spine, 12, 0.8, this.rng);
        this.hurt(o.x, o.y, COL.spine);
        return;
      }
    }
  }

  private hurt(fromX: number, fromY: number, col: RGB) {
    const p = this.player;
    p.hull--;
    p.iframe = IFRAME_TIME;
    this.combo = 1;

    const a = Math.atan2(p.y - fromY, p.x - fromX);
    p.vx = Math.cos(a) * HURT_KNOCKBACK;
    p.vy = Math.sin(a) * HURT_KNOCKBACK;

    this.juice.addHitstop(0.12);
    this.juice.addShake(22);
    this.juice.addFlash(0.55, COL.danger);
    this.juice.addPunch(0.09);
    this.juice.addSlowmo(0.3);
    this.juice.addKick(Math.cos(a), Math.sin(a), 14);
    this.particles.burst(p.x, p.y, COL.danger, 26, 1.2, this.rng);
    this.particles.ring(p.x, p.y, COL.danger, 150, 0.5, 5);
    this.particles.ring(p.x, p.y, col, 92, 0.4, 3);
    this.addBurn(p.x, p.y, 34, COL.danger);
    this.pushPopup(p.x, p.y - 46, `-1 HULL`, '', 'bad', COL.danger, 1.05);
    this.audio.onHurt(p.hull);
  }

  // ------------------------------------------------------------------ waves
  private clearWave() {
    const bonus = WAVE_CLEAR_BONUS * this.wave;
    this.score += bonus;
    this.waveClear = 1.6;
    this.breather = WAVE_BREATHER;
    // Any orbs still in the air are swept, so a wave never ends on a stray shot.
    for (const o of this.swarm.orbs) {
      if (!o.alive) continue;
      o.alive = false;
      this.particles.burst(o.x, o.y, COL.spine, 8, 0.6, this.rng);
    }
    this.pushPopup(
      view.arenaW * 0.5,
      view.arenaH * 0.42,
      `WAVE ${pad(this.wave)} CLEAR`,
      `+${bonus}`,
      'wave',
      COL.hull,
      1.15,
    );
    this.juice.addFlash(0.2, COL.hull);
    this.audio.onWaveClear();
  }

  /** Queue a rule card the first time a species shows up in this run. */
  private noticeNewKinds() {
    for (const e of this.swarm.list) {
      if (!e.alive) continue;
      if (this.seenKinds.has(e.kind)) continue;
      this.seenKinds.add(e.kind);
      if (e.kind === 'mote') continue; // the tutorial already covers these
      this.hints.push({ kind: e.kind, life: HINT_CARD_TIME });
      this.audio.onHint();
    }
  }

  /** Bonus range the current aim would earn — used to draw the chain preview. */
  get aimBonusRange() {
    return this.aim ? this.aim.kills * STRIKE_RANGE_PER_KILL : 0;
  }

  /** 0..1 alarm pulse, shared by HUD and post so they beat together. */
  get alarm() {
    return this.inDanger ? 0.5 + 0.5 * Math.sin(this.clock * 7) : 0;
  }

  /** Angle used for cosmetic flourishes that need a "forward". */
  get facing() {
    return this.player.striking ? this.player.angle : this.aimAngle;
  }

  get comboFrac() {
    return this.combo > 1 ? clamp(this.comboTimer / COMBO_TIMEOUT, 0, 1) : 0;
  }

  get waveProgress() {
    const total = Math.max(1, this.director.planned);
    const left = this.swarm.liveCount + (total - this.director.spawned);
    return clamp(1 - left / total, 0, 1);
  }

  /** Ambient drift for the background field, independent of the sim clock. */
  get drift() {
    return (this.clock * 0.06) % TAU;
  }

  /**
   * The arena changes shape when the window does. Everything in flight is
   * remapped proportionally rather than clamped, so a mid-run resize never
   * dumps the swarm into a corner or strands the player outside the walls.
   */
  onResize(prevW: number, prevH: number) {
    if (prevW <= 0 || prevH <= 0) return;
    const sx = view.arenaW / prevW;
    const sy = view.arenaH / prevH;
    if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4) return;

    const p = this.player;
    p.x *= sx;
    p.y *= sy;
    if (p.plan) {
      // A strike solved against the old arena is no longer meaningful; land it.
      p.endStrike();
    }
    for (const e of this.swarm.list) {
      e.x *= sx;
      e.y *= sy;
    }
    for (const o of this.swarm.orbs) {
      o.x *= sx;
      o.y *= sy;
    }
    for (const q of this.popups) {
      q.x *= sx;
      q.y *= sy;
    }
    p.trail.length = 0;
  }
}

export const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
export { RANKS };
