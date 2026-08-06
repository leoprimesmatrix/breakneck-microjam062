import {
  AIM_TIMESCALE,
  AIM_TIMESCALE_DRY,
  BURN_CAP,
  BURN_LIFE,
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
  SCAR_CAP,
  SCAR_LIFE,
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
import { TAU, clamp, damp, dampAngle, makeRng, randRange, type Rng } from '../engine/math';
import { Particles } from '../engine/particles';
import { SECTOR_ORDER, SECTOR_WAVES, SECTORS, setSector, theme } from '../sectors';
import type { UiHit } from '../settings';
import { view } from '../viewport';
import { ORB_R, SPECS, Swarm, silhouette, type Enemy, type EnemyKind } from './enemies';
import { Player } from './player';
import { clonePlan, solveStrike, type StrikePlan } from './strike';
import { makeTerrain, terrain } from './terrain';
import { Director, waveDef } from './waves';

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
/** Furthest sector index reached. The whole save format is still integers. */
const SECT_KEY = 'afterburn.sector.v1';

/** The longer pause a sector boundary earns, with the chapter card inside it. */
const SECTOR_BREATHER = 3.4;

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
  bulwark: COL.bulwark,
  choir: COL.choir,
  warden: COL.warden,
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

  /** True while the settings panel is up, over the title or over the pause. */
  settingsOpen = false;
  /**
   * Clickable rectangles, cleared and re-pushed by the renderer every frame.
   * See `render/settings.ts` for why the UI is immediate-mode.
   */
  readonly uiHits: UiHit[] = [];
  /** Id of the slider currently being dragged, or null. */
  uiDrag: string | null = null;

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
  /** Same idea as `armGate`, for the results screen. Set in `die`. */
  private deadGate = false;
  /** Kill count the aim line last announced; see the lock tick in `stepPlay`. */
  private aimKillsPrev = 0;
  private lockCooldown = 0;

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

  // ------------------------------------------------------------- campaign
  /** True for the score-attack mode that never ends; false is the campaign. */
  endless = false;
  /** Index into `SECTOR_ORDER` of the room currently being fought. */
  sectorIx = 0;
  /** Where this run began, so a death retries the sector rather than the game. */
  private startIx = 0;
  /** A finished campaign. Read by the results screen for its headline. */
  won = false;
  /** Seconds left on the sector chapter card. */
  sectorCard = 0;
  /** Set when the mid-breather room swap has fired, so it fires once. */
  private sectorSwapped = true;

  best = 0;
  bestWave = 0;
  runs = 0;
  isNewBest = false;
  /** Furthest sector index ever reached, for the title's CONTINUE row. */
  furthest = 0;

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
  /** Seconds left in the ghost's hold. Above zero, the attract ship is aiming. */
  private ghostAim = 0;
  /** Where the ghost's hold is sweeping to. */
  private ghostAngle = -Math.PI / 2;

  constructor(input: Input) {
    this.input = input;
    this.best = this.load(BEST_KEY);
    this.bestWave = this.load(WAVE_KEY);
    this.runs = this.load(RUNS_KEY);
    this.furthest = Math.min(this.load(SECT_KEY), SECTOR_ORDER.length - 1);
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

  /**
   * The live warden, if one is on the field. Stateless on purpose — a scan of
   * forty slots once a frame costs nothing, and a cached reference would need
   * resetting at every one of the places a swarm can be emptied, each of which
   * is a bug waiting for the one that gets missed.
   */
  get boss(): Enemy | null {
    for (const e of this.swarm.list) {
      if (e.alive && e.kind === 'warden') return e;
    }
    return null;
  }

  /**
   * Where in the stereo field something at arena X belongs.
   *
   * Kills, blocks, wall hits and orb pops all now carry their position into the
   * mix, which costs one number per call and buys the single most convincing
   * thing a small game can do with sound: an event on the left edge of the room
   * is *heard* on the left. Deliberately short of hard-panned — anything past
   * about 0.7 vanishes from one ear on headphones and reads as a fault.
   */
  private panAt(x: number) {
    return clamp((x / Math.max(1, view.arenaW)) * 2 - 1, -1, 1) * 0.7;
  }

  // --------------------------------------------------------------- lifecycle
  private beginAttract() {
    this.swarm.reset();
    this.particles.reset();
    this.scars.length = 0;
    this.burns.length = 0;
    this.rng = makeRng((Math.random() * 0xffffffff) >>> 0);
    this.player.reset();
    this.ghostAim = 0;
    this.ghostTimer = 0.5;
    this.aiming = false;
    this.aim = null;
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

  /**
   * Re-furnish the room for whatever sector is current.
   *
   * Separate from `start` because a sector change and a run start are two
   * different events that happen to need the same thing done — and by the time
   * the campaign is swapping rooms mid-run, this is the one call it has to
   * make rather than a list of them it could get wrong.
   */
  rebuildRoom() {
    makeTerrain(this.rng);
  }

  /**
   * Which sector, which wave within it, and how far past the authored
   * campaign, for an absolute wave number. The one mapping between the flat
   * counter everything already uses and the structure the campaign added —
   * kept as a single function so it cannot be computed two ways.
   */
  private waveSlot(absWave: number) {
    const ix = Math.floor((absWave - 1) / SECTOR_WAVES);
    return {
      ix: ix % SECTOR_ORDER.length,
      sector: SECTOR_ORDER[ix % SECTOR_ORDER.length],
      waveIn: ((absWave - 1) % SECTOR_WAVES) + 1,
      heat: Math.max(0, absWave - SECTOR_ORDER.length * SECTOR_WAVES),
    };
  }

  start(opts: { sector?: number; endless?: boolean } = {}) {
    this.endless = opts.endless ?? false;
    this.startIx = clamp(opts.sector ?? 0, 0, SECTOR_ORDER.length - 1);
    this.sectorIx = this.startIx;
    this.won = false;
    this.sectorCard = 0;
    this.sectorSwapped = true;
    setSector(SECTOR_ORDER[this.sectorIx]);
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
    // Furniture is per run, not per wave: a room you learned the shape of in
    // wave one is a room you can still use in wave nine, and re-rolling it
    // between waves would make that knowledge worthless.
    this.rebuildRoom();

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
    // The absolute wave counter keeps counting across sectors — a campaign
    // started at the foundry begins at wave 9, because it *is* wave 9.
    this.wave = this.startIx * SECTOR_WAVES;
    this.waveClear = 0;
    this.breather = 0;
    this.hasHeld = false;
    this.hasStruck = false;
    this.moveTaught = 0;
    this.focusTaught = 0;
    this.focusPending = false;
    this.strikeBuffer = 0;
    // The attract ghost may have been mid-hold when the player pressed start.
    this.ghostAim = 0;
    this.aiming = false;
    this.aim = null;
    this.aimBlend = 0;

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
    const slot = this.waveSlot(this.wave);
    this.director.begin(waveDef(slot.sector, slot.waveIn, this.endless ? slot.heat : 0, this.rng), this.wave);
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
    this.endRun(false);
  }

  private endRun(won: boolean) {
    this.state = 'dead';
    this.won = won;
    this.deadTime = 0;
    // Every pointer-down and every Space press latches a confirm edge, and
    // nothing in a run consumes them — so by the time anyone dies, one is
    // guaranteed to be sitting there. Left alone, `stepDead` reads it the
    // instant the 0.8 s gate opens and the results screen dismisses *itself*:
    // score, best, and the retry prompt gone before they can be read. Same
    // disease as the pause screen's, same cure: drain on entry, then gate on
    // the hold so a player who died mid-aim must actually let go and press
    // again before anything restarts. A victory earns the same protection —
    // the one screen in the game that says you won must not dismiss itself.
    this.input.takeConfirm();
    this.input.takeRelease();
    this.deadGate = true;
    this.audio.setRunning(false);
    if (won) {
      // The end of a campaign is a detonation of light, not of loss.
      this.juice.addFlash(1, COL.playerCore);
      this.juice.addPunch(0.18);
      this.juice.addSlowmo(1.1);
      this.juice.addShake(20);
      this.particles.ring(this.player.x, this.player.y, COL.strike, 340, 0.9, 6);
      this.particles.ring(this.player.x, this.player.y, COL.playerCore, 220, 0.7, 4);
      this.audio.onWaveClear();
    } else {
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
    }

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

    // Screen-space UI reads input before the game does, and eats whatever it
    // uses. That is what stops a click on the gear from also starting the run,
    // and Escape from resuming a paused game instead of closing the panel.
    this.stepUi();

    if (this.state === 'title') this.stepTitle(dtReal);
    else if (this.state === 'play') this.stepPlay(dtReal);
    else if (this.state === 'paused') this.stepPaused(dtReal);
    else this.stepDead(dtReal);
  }

  // ---------------------------------------------------------------------- ui
  /**
   * Hit-test the cursor against the rectangles the renderer pushed last frame,
   * and consume whatever the panel uses.
   *
   * Only pointer presses count. `takeConfirm` is also latched by Space and
   * Enter, and a player pressing Space on the title screen must not be treated
   * as having clicked whatever the mouse was left resting on.
   */
  private stepUi() {
    const input = this.input;
    const px = input.cursorScreenX();
    const py = input.cursorScreenY();

    // A drag owns the pointer until it is released, wherever it wanders. Sliders
    // that stop tracking the moment the cursor leaves the track are the single
    // most common way a hand-rolled one feels broken.
    if (this.uiDrag) {
      const track = this.uiHits.find((h) => h.id === this.uiDrag);
      if (track) this.applySlider(this.uiDrag, (px - track.x) / track.w);
      if (!input.holding) this.uiDrag = null;
      input.takeConfirm();
      input.takePointerDown();
      input.takeRelease();
      return;
    }

    const pressed = input.takePointerDown();
    const hit = pressed
      ? this.uiHits.find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h)
      : undefined;

    if (hit) {
      if (hit.id === 'gear') this.settingsOpen = !this.settingsOpen;
      else if (hit.id === 'close') this.settingsOpen = false;
      else if (hit.id === 'mute') this.audio.toggleMute();
      else if (hit.id === 'music' || hit.id === 'sfx') {
        this.uiDrag = hit.id;
        this.applySlider(hit.id, (px - hit.x) / hit.w);
      } else if (hit.id.startsWith('go:')) {
        // The title's mode rows. Confirm (Space, click anywhere else) still
        // starts the campaign from the top — these are the alternatives:
        // continue from the furthest sector reached, or the endless mode.
        const mode = hit.id.slice(3);
        if (mode === 'continue') this.start({ sector: this.furthest });
        else if (mode === 'endless') this.start({ endless: true });
      }
      this.audio.onUiMove();
      input.takeConfirm();
      input.takeRelease();
      return;
    }

    if (!this.settingsOpen) return;

    // The panel is up, so it owns every gesture until it is closed — including
    // the click that lands outside it, which would otherwise start the run
    // happening behind it.
    if (input.takePause()) {
      this.settingsOpen = false;
      this.audio.onUiMove();
    }
    input.takeConfirm();
    input.takeRelease();
  }

  private applySlider(id: string, v: number) {
    const c = v < 0 ? 0 : v > 1 ? 1 : v;
    if (id === 'music') this.audio.setMusicVolume(c);
    else this.audio.setSfxVolume(c);
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
    // The ghost flies first: it decides whether the room is in slow motion.
    this.stepAttract(dtReal);
    const dt = dtReal * 0.6 * this.timeScale;
    this.swarm.targetX = view.arenaW * 0.5 + Math.cos(this.clock * 0.4) * 260;
    this.swarm.targetY = view.arenaH * 0.5 + Math.sin(this.clock * 0.31) * 170;
    this.swarm.update(dt);
    this.particles.update(dt);
    this.stepMarks(dt);

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

  /**
   * The attract show — the title screen flying the game's only verb.
   *
   * The old version was a teleport with a particle burst stapled to it: it
   * called `begin` (which sets the hull's elongation to full), assigned the
   * player straight to the far end of the line, and ended the strike in the
   * same frame. Nothing ever called `player.tick` on the title screen, so the
   * three things that tick decays — stretch, charge, roll — never decayed. The
   * ship sat in the middle of the title permanently scaled 3.3x along its nose
   * and squashed to 0.58 across, frozen, with an afterimage trail whose
   * lifetimes were never counted down either. It read as a rendering bug
   * because it was one.
   *
   * Now the ghost runs the player's own code path — `tick`, `drift`,
   * `advanceStrike`, `endStrike` — and plays the full beat: drift, hold (the
   * room slows and the aim line finds its targets, live), commit, and coast
   * out on the momentum the strike leaves behind. The title screen shows the
   * hold *and* the release, which is the half of the verb it was never
   * teaching, and the ship is a machine in flight rather than a smear.
   */
  private stepAttract(dtReal: number) {
    const p = this.player;

    // Slow motion while the ghost holds, exactly as `stepPlay` does it, so the
    // title's dilation and the game's are the same effect and not two.
    const target = p.striking ? 1 : this.aiming ? AIM_TIMESCALE : 1;
    const ease = target > this.timeScale ? TIMESCALE_EASE * 0.28 : TIMESCALE_EASE;
    this.timeScale = damp(this.timeScale, target, 1 / ease, dtReal);
    // Deliberately short of the full 1 the player's hold reaches: the title
    // already has a scrim over the room, and stacking the aim vignette on top
    // of it at full strength buries the attract show it exists to frame.
    this.aimBlend = damp(this.aimBlend, this.aiming ? 0.55 : 0, 14, dtReal);

    p.tick(dtReal, this.aiming);

    if (p.striking) {
      // Strikes run on real time. Everything else on the title is dilated, and
      // a dilated strike is a slow strike — the one thing this game must never
      // look like.
      const done = p.advanceStrike(dtReal, this.hitBuf);
      for (const i of this.hitBuf) this.ghostHit(i);
      if (done) this.ghostFinish();
      return;
    }

    if (this.ghostAim > 0) {
      // Holding. The aim sweeps onto the target rather than snapping to it, so
      // the preview line visibly acquires — the same read the player gets.
      this.ghostAim -= dtReal;
      this.aimAngle = dampAngle(this.aimAngle, this.ghostAngle, 6, dtReal);
      this.aim = solveStrike(this.swarm, p.x, p.y, this.aimAngle, 0);
      if (this.ghostAim <= 0) this.ghostLaunch();
    } else {
      this.aiming = false;
      this.aim = null;
      this.ghostTimer -= dtReal;
      if (this.ghostTimer <= 0) this.ghostAcquire();
    }

    p.drift(dtReal * 0.6 * this.timeScale, this.aimAngle);
  }

  /** Pick something worth killing and start the hold. */
  private ghostAcquire() {
    const live = this.swarm.list.filter((e) => e.alive && e.spawn <= 0 && !this.shielded(e));
    if (!live.length) {
      this.beginAttract();
      this.ghostTimer = 0.6;
      return;
    }
    // Prefer the angle that takes the most with it — the attract show should
    // demonstrate the game being played well, not adequately.
    let best = live[0];
    let bestKills = -1;
    const tries = Math.min(live.length, 5);
    for (let i = 0; i < tries; i++) {
      const e = live[Math.floor(this.rng() * live.length)];
      const a = Math.atan2(e.y - this.player.y, e.x - this.player.x);
      const k = solveStrike(this.swarm, this.player.x, this.player.y, a, 0).kills;
      if (k > bestKills) {
        bestKills = k;
        best = e;
      }
    }
    this.ghostAngle = Math.atan2(best.y - this.player.y, best.x - this.player.x);
    this.ghostAim = randRange(this.rng, 0.55, 0.85);
    this.aiming = true;
  }

  /** Is this thing behind a shield that faces us? Attract mode never whiffs. */
  private shielded(e: Enemy) {
    if (e.kind !== 'ward') return false;
    const plan = solveStrike(this.swarm, this.player.x, this.player.y,
      Math.atan2(e.y - this.player.y, e.x - this.player.x), 0);
    return plan.blocked;
  }

  private ghostLaunch() {
    const p = this.player;
    this.ghostAim = 0;
    this.aiming = false;
    p.begin(clonePlan(solveStrike(this.swarm, p.x, p.y, this.aimAngle, 0)));
    this.aim = null;
    this.juice.addKick(p.plan!.dx, p.plan!.dy, 5);
    this.juice.addFringe(0.4);
    this.particles.spall(p.x, p.y, this.aimAngle + Math.PI * 0.5, COL.strike, 8, this.rng);
    this.particles.ring(p.x, p.y, COL.strike, 66, 0.28, 2.6);
  }

  /**
   * A kill in attract mode: all of the spectacle, none of the bookkeeping. No
   * score, no combo, no tutorial state — the title screen must never leave a
   * number behind for the run that follows it to inherit.
   */
  private ghostHit(index: number) {
    const plan = this.player.plan;
    if (!plan) return;
    const h = plan.hits[index];
    const e = h.enemy;
    if (h.blocked || !e || !e.alive) return;

    e.alive = false;
    const col = ENEMY_COL[e.kind];
    const ang = Math.atan2(plan.dy, plan.dx);
    if (e.kind === 'seeder') this.swarm.burst(e, this.rng);
    this.particles.shatter(
      e.x, e.y, silhouette(e.kind, e.r), e.rot, col, plan.dx * 240, plan.dy * 240, this.rng,
    );
    this.particles.burst(e.x, e.y, col, 16, 1, this.rng);
    this.particles.ring(e.x, e.y, col, 92, 0.4, 3.2);
    this.particles.ring(e.x, e.y, COL.playerCore, 44, 0.22, 2);
    this.particles.plate(e.x, e.y, ang, COL.playerCore, 140);
    this.particles.spall(e.x, e.y, ang, col, 9, this.rng);
    this.addBurn(e.x, e.y, e.r * 2.1, col);
    this.player.strikeKills++;

    // Half the shake and none of the hitstop of a real kill: the title is being
    // watched, not played, and a menu that stutters reads as a menu that lags.
    this.juice.addShake(5 + Math.min(7, this.player.strikeKills * 1.5));
    this.juice.addFlash(0.06, col);
    this.juice.addKick(plan.dx, plan.dy, 2.5);
  }

  private ghostFinish() {
    const p = this.player;
    const plan = p.plan;
    if (plan) this.addScar(plan.x0, plan.y0, p.x, p.y);
    if (p.strikeKills >= 2) this.juice.addFlash(0.1 + p.strikeKills * 0.03, COL.strike);
    p.endStrike();
    this.ghostTimer = randRange(this.rng, 0.9, 1.7);

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
    if (this.deadGate) {
      // Swallow everything left over from the run (and the frantic mashing
      // that follows a death) until the button is actually up.
      this.input.takeConfirm();
      this.input.takeRelease();
      if (!this.input.holding) this.deadGate = false;
    } else if (this.deadTime > 0.8 && (this.input.takeConfirm() || this.input.takeRelease())) {
      // Retry means retry *here*: the sector is the checkpoint, so a death in
      // the derelict restarts the derelict rather than the whole campaign.
      // Endless restarts endless; a finished campaign rolls back to the top.
      this.start({ sector: this.won ? 0 : this.sectorIx, endless: this.endless });
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

    // The line acquiring targets is the hold half of the verb, and it used to
    // be mute. A tick per newly-acquired kill, pitch climbing with the count —
    // sweeping across a pack plays a rising scale, which is both feedback and
    // bait. Rising-only, with a small cooldown so a target flickering on the
    // line's edge cannot zipper.
    this.lockCooldown = Math.max(0, this.lockCooldown - dtReal);
    if (this.aiming && this.aim) {
      const k = this.aim.kills;
      if (this.lockCooldown <= 0 && k > this.aimKillsPrev) {
        this.audio.onLock(k);
        this.aimKillsPrev = k;
        this.lockCooldown = 0.05;
      } else if (this.lockCooldown <= 0 && k < this.aimKillsPrev) {
        this.aimKillsPrev = k;
      }
    } else {
      this.aimKillsPrev = 0;
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
    //
    // On dilated time, not real time, and that is the whole feature. While the
    // player holds, the world runs at a ninth speed and the aim solve re-runs
    // every frame — so a closing shutter is watched falling through the preview
    // line, cutting it short a few units at a time. The game's best-looking
    // thing, doing something it has never done.
    terrain.update(dt);
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
      // The room changes at the card's halfway mark, while the screen is
      // holding on the sector name — a cut disguised as a beat.
      if (!this.sectorSwapped && this.breather <= SECTOR_BREATHER * 0.5) {
        this.sectorSwapped = true;
        this.swapSector();
      }
      if (this.breather <= 0) this.nextWave();
    } else if (this.director.emptied && this.swarm.liveCount === 0) {
      this.clearWave();
    }
    if (this.sectorCard > 0) this.sectorCard -= dtReal;

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
    if (this.scars.length > SCAR_CAP) this.scars.shift();
    this.scars.push({ x0, y0, x1, y1, life: SCAR_LIFE, max: SCAR_LIFE });
  }

  private addBurn(x: number, y: number, r: number, col: RGB) {
    if (this.burns.length > BURN_CAP) this.burns.shift();
    this.burns.push({ x, y, r, col, life: BURN_LIFE, max: BURN_LIFE });
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

    this.audio.onStrike(plan.hits.length, this.panAt(p.x));
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

    // Stopped is not blocked, and the difference is the whole reason terrain
    // gets its own arm here. A shield stops you because you read the fight
    // wrong, and `onBlocked` stuns you for it. A slab stops you because it is
    // in the way, the preview said so before you committed, and the ship
    // simply arrived. Punishing geometry as though it were a mistake is how a
    // room full of cover starts feeling like a room full of traps.
    if (hit.blocked && hit.block) {
      this.onSlab(hit.x, hit.y);
      return;
    }

    // A warden's plate stopping the strike is not a rebuff, it is the fight
    // working: the plate breaks. Checked before the shield branch, because a
    // warden hit also satisfies `blocked && enemy`.
    if (hit.blocked && hit.enemy && hit.enemy.kind === 'warden') {
      this.breakPlate(hit.enemy, hit.x, hit.y);
      return;
    }

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

    const power =
      e.kind === 'spine' ? 1.5
      : e.kind === 'bulwark' ? 1.5
      : e.kind === 'mote' || e.kind === 'choir' ? 0.9
      : 1.2;
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
    // The first is special-cased because the old curve gave it 44 ms — two and
    // a half frames, a hiccup — while a *blocked* strike got 100 ms. Failure
    // must never land harder than success.
    const n = this.player.strikeKills;
    this.juice.addHitstop(n === 1 ? 0.085 : Math.max(0.016, 0.055 - n * 0.006));
    this.juice.addShake(8 + Math.min(12, n * 2));
    this.juice.addFlash(0.1 + Math.min(0.16, n * 0.03), col);
    // Each kill tugs the camera along the strike axis. addKick is additive, so
    // a long chain compounds toward launch strength and the line drags the
    // whole screen with it.
    this.juice.addKick(dx, dy, 3.5);
    this.juice.addFringe(0.35);
    this.audio.onKill(e.kind, n, this.combo, this.panAt(e.x));

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
    this.audio.onOrbPop(this.panAt(o.x));
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
    this.audio.onBlocked(this.panAt(x));
  }

  /**
   * The strike breaking one of a warden's plates.
   *
   * Reads as a kill, not a rebuff, because it is one: heavy stop, the plate's
   * arc shattering off the ring, score. The stun is roughly half the shield's
   * — the ship still has to disengage from a wall it just hit, but punishing a
   * correct hit as hard as a wrong one teaches the player the fight is unfair,
   * and this fight is nothing but these hits until the last one.
   */
  private breakPlate(e: Enemy, x: number, y: number) {
    const p = this.player;
    p.travelled = p.plan ? p.plan.dist : p.travelled;
    p.stun = 0.18;
    e.flash = 1;

    const away = Math.atan2(p.y - e.y, p.x - e.x);
    const i = Swarm.plateAt(e, x, y);
    if (Swarm.breakPlate(e, i)) {
      const col = ENEMY_COL.warden;
      const gain = Math.round(150 * this.combo);
      this.score += gain;
      // The broken arc tumbles off: a small curved slab, built at the break.
      const arc: [number, number][] = [];
      const slice = TAU / 12;
      for (let k = 0; k <= 4; k++) arc.push([Math.cos((k / 4) * slice) * e.r, Math.sin((k / 4) * slice) * e.r]);
      for (let k = 4; k >= 0; k--) arc.push([Math.cos((k / 4) * slice) * e.r * 0.62, Math.sin((k / 4) * slice) * e.r * 0.62]);
      this.particles.shatter(x, y, arc, away, col, p.plan ? p.plan.dx * 200 : 0, p.plan ? p.plan.dy * 200 : 0, this.rng);
      this.particles.ring(x, y, col, 70, 0.36, 3);
      this.pushPopup(x, y - 34, `${gain}`, Swarm.platesLeft(e) ? '' : 'EXPOSED', 'score', col);
      this.juice.addHitstop(0.08);
      this.juice.addShake(13);
      this.juice.addFlash(0.16, col);
      this.audio.onKill('warden', 0, this.combo, this.panAt(x));
    } else {
      // The ring turned a dead plate under the contact between launch and
      // arrival. Nothing to break; it is a wall for a frame.
      this.audio.onWall(this.panAt(x));
    }
    p.vx = Math.cos(away) * 360;
    p.vy = Math.sin(away) * 360;
    this.juice.addKick(Math.cos(away), Math.sin(away), 7);
  }

  /**
   * The strike arriving against a slab.
   *
   * Deliberately the arena-wall feedback rather than the shield's: no stun, no
   * knockback, no popup telling the player off. The preview drew the line
   * stopping exactly here before they let go, so this is a landing, not a
   * mistake — and the only thing it owes them is the weight of having hit
   * something solid at three thousand units a second.
   */
  private onSlab(x: number, y: number) {
    const p = this.player;
    this.particles.spall(p.x, p.y, this.aimAngle + Math.PI * 0.5, theme.wall, 10, this.rng);
    this.particles.ring(x, y, theme.wall, 44, 0.3, 2.5);
    this.juice.addHitstop(0.03);
    this.juice.addShake(10);
    this.juice.addPunch(0.035);
    this.audio.onWall(this.panAt(x));
  }

  private finishStrike() {
    const p = this.player;
    const plan = p.plan;
    const n = p.strikeKills;

    if (plan) this.addScar(plan.x0, plan.y0, p.x, p.y);

    if (plan && plan.hitWall && !plan.blocked) {
      // A ship at full strike speed meeting a steel wall. The camera slams
      // into it along the travel direction; the fiction does not permit this
      // to read softer than popping an orb.
      //
      // The debris is the room's wall rather than the palette's, because this
      // is the one particle burst in the game that is made of the scenery: it
      // is chips off whatever you just hit, and in a warm room those chips are
      // warm.
      this.particles.spall(p.x, p.y, this.aimAngle + Math.PI * 0.5, theme.wall, 12, this.rng);
      this.juice.addHitstop(0.03);
      this.juice.addShake(11);
      this.juice.addKick(plan.dx, plan.dy, 9);
      this.juice.addPunch(0.04);
      this.audio.onWall(this.panAt(p.x));
    } else if (plan && !plan.blocked && n === 0) {
      // The whiff. A strike that kills nothing and stops mid-air used to end
      // in total silence — no particles, no shake, no sound, the launch whoosh
      // just trailing off. The absence of reward is the lesson, but absence of
      // *arrival* reads as the game not noticing. A soft brake-thud, quieter
      // than any kill, marks the stop while keeping success louder than
      // failure.
      this.particles.spall(p.x, p.y, Math.atan2(plan.dy, plan.dx), COL.strike, 8, this.rng);
      this.particles.ring(p.x, p.y, COL.strike, 56, 0.26, 2.5);
      this.juice.addShake(4);
      this.juice.addKick(plan.dx, plan.dy, 4);
      this.audio.onArrive(this.panAt(p.x));
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
      this.audio.onMulti(n, this.panAt(p.x));
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
    this.audio.onHurt(p.hull, this.panAt(p.x));
  }

  // ------------------------------------------------------------------ waves
  private clearWave() {
    const bonus = WAVE_CLEAR_BONUS * this.wave;
    this.score += bonus;
    this.waveClear = 1.6;
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

    // The campaign is over when the last authored wave clears. `endRun`
    // reuses the death path's drain-and-gate machinery wholesale — that logic
    // records being got wrong twice, and a victory screen that dismisses
    // itself before it can be read is the same disease.
    if (!this.endless && this.wave >= SECTOR_ORDER.length * SECTOR_WAVES) {
      this.endRun(true);
      return;
    }

    // A sector boundary earns a longer breather with the chapter card in it;
    // the room itself changes underneath the card, mid-breather.
    const next = this.waveSlot(this.wave + 1);
    if (next.waveIn === 1) {
      this.breather = SECTOR_BREATHER;
      this.sectorCard = SECTOR_BREATHER;
      this.sectorSwapped = false;
    } else {
      this.breather = WAVE_BREATHER;
    }
  }

  /**
   * The mid-breather room swap: the sector changes under a white flash while
   * the chapter card is up. Rides the existing breather rather than adding a
   * state — during a breather the field is empty by construction, which is
   * the only precondition a room swap actually has.
   */
  private swapSector() {
    const slot = this.waveSlot(this.wave + 1);
    this.sectorIx = slot.ix;
    setSector(slot.sector);
    this.rebuildRoom();
    if (!this.endless && slot.ix > this.furthest) {
      this.furthest = slot.ix;
      this.save(SECT_KEY, this.furthest);
    }
    this.juice.addFlash(1, theme.gridHot);
    this.juice.addShake(24);
    this.juice.addFringe(1.5);
    this.juice.addPunch(0.12);
    this.particles.ring(this.player.x, this.player.y, COL.playerCore, 240, 0.5, 4);
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
    // Rectangles survive a non-uniform scale as rectangles, which is most of
    // why the furniture is boxes: a circle remapped by two different factors is
    // an ellipse, and an ellipse is a shape the slab test cannot describe.
    for (const b of terrain.list) {
      b.x *= sx;
      b.y *= sy;
      b.w *= sx;
      b.h *= sy;
    }
    p.trail.length = 0;
  }
}

export const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
export { RANKS };
