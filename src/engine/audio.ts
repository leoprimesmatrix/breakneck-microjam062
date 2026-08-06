import type { EnemyKind } from '../game/enemies';
import { Music } from './music';
import { gainFor, saveSettings, settings } from '../settings';

/**
 * Every sound effect in this game is synthesised: no samples, no licensing, no
 * load time. The soundtrack is the one exception — ten recorded tracks, played
 * by `Music` as a shuffled bag (see there for why).
 *
 * The idea worth knowing is what happens when the player holds to aim. The
 * music enters bullet time with them: a low-pass closes over the whole music
 * bus and a sub drone swells underneath it, so slow motion *sounds* slow. What
 * deliberately does **not** happen is a playback-rate change — dragging a
 * recorded track down in speed is the sound of a tape stalling, and it would
 * undo in one gesture everything the rest of the mix is doing.
 *
 * The recorded tracks and the fallback sequencer get separate filters. They
 * want different corners: the synthesised bus is written for a deliberately
 * warm 6 kHz ceiling, and applying that to a mastered stereo track would just
 * sound like a blanket over the speakers.
 */

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 3, 5, 7, 10];
/** i - VI - VII - v, one chord per bar. */
const PROGRESSION = [0, -4, -2, 7];
const ROOT = 55; // A1

const hz = (semis: number) => ROOT * Math.pow(2, semis / 12);

const KIND_WAVE: Record<EnemyKind, OscillatorType> = {
  mote: 'triangle',
  seeder: 'sine',
  ward: 'square',
  lancer: 'sawtooth',
  spine: 'square',
};

/** Music bus level while a run is live, and while it is not. */
const TRACK_GAIN = 0.62;
const TRACK_GAIN_IDLE = 0.5;
/** ...and while the game is paused, a step further back again. */
const TRACK_GAIN_PAUSED = 0.34;

/**
 * The pause filter: deeper than bullet time's, and resonant where bullet
 * time's is flat.
 *
 * Pause borrows the gesture the player already knows from holding to aim — the
 * room closing over the music — but it must not be mistaken for it. So it goes
 * further down (340 Hz against 700) and, more importantly, sounds different on
 * the way: lifting Q puts a bump right at the corner, which turns a blanket
 * over the speakers into a filter audibly *closing*. Bullet time is a held
 * breath; pause is the hatch sealing.
 */
const PAUSE_CORNER = 340;
const PAUSE_Q = 2.0;
/** Q while open. Anything above ~0.7 colours the top end for no reason. */
const OPEN_Q = 0.7;
/**
 * How long the hatch takes to shut.
 *
 * A *duration*, swept exponentially, rather than the time constant the rest of
 * this file uses — because pitch is heard in octaves and an approach that is
 * even in hertz is not even in anything the ear cares about. Measured: easing
 * 20 kHz towards 340 Hz on a 0.22 s time constant is still sitting at 7.5 kHz
 * a fifth of a second in, having spent that whole time in the two octaves
 * nobody can tell apart, and only sounds like it starts moving near the end.
 * A constant rate in octaves closes at an even, deliberate pace all the way
 * down, which is the sound the gesture is imitating.
 */
const PAUSE_CLOSE = 0.45;
/**
 * Opening back up is a time constant again, and deliberately the same one
 * `setIntensity` uses: the frame after the player un-pauses, `setIntensity`
 * starts writing this parameter every frame anyway, so matching it means the
 * two agree instead of overlapping.
 */
const PAUSE_OPEN = 0.09;
/** The sub drone under a paused screen — the engines still turning over. */
const PAUSE_DRONE = 0.07;

/**
 * Time constant of the soundtrack's swell into the title.
 *
 * An exponential approach rather than a hard start: at full level from sample
 * one the music arrives as a slam, which startles rather than lands. This
 * reaches roughly two-thirds of level in one time constant and is effectively
 * full at three — so with 0.45 it is up to ~95% by 1.35 s, which is the beat
 * the wordmark comes to rest on (`SHIP_LAND` in `screens.ts`). The track still
 * *starts* on the flash, so the cold open keeps its sync; it just rises into
 * the title instead of shouting over it.
 *
 * A time constant, not a scheduled ramp, specifically so the run-start and
 * pause ducks in `setRunning` can interrupt it mid-swell without either
 * fighting a queued automation curve or jumping.
 */
const TRACK_RISE = 0.45;

export class Audio {
  readonly tracks = new Music();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private sfx!: GainNode;
  private sfxComp!: DynamicsCompressorNode;
  /** The room. One convolver, fed by a send off the SFX bus. */
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private trackBus!: GainNode;
  private trackFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;

  /**
   * The player's two volume controls, as their own stage in the graph.
   *
   * They are separate nodes rather than a scale factor folded into the gains
   * already here because almost every one of those gains is automated —
   * bullet time, the pause duck, the crossfade, the swell on the first note.
   * A control that multiplied into them would have to be re-applied by every
   * one of those, and would be silently undone by whichever ramped last.
   * One node per bus, downstream of all the automation, is the whole feature.
   */
  private sfxTrim!: GainNode;
  private musicTrim!: GainNode;

  private droneGain: GainNode | null = null;
  private alarmGain: GainNode | null = null;

  private muted = settings.muted;
  private running = false;
  private paused = false;
  /** Whether the sequencer has already stood down for a recorded track. */
  private sequencerYielded = false;
  private dilation = 1;
  private combo = 1;
  private danger = false;

  private nextTime = 0;
  private step = 0;

  get enabled() {
    return this.ctx !== null && !this.muted;
  }

  get isMuted() {
    return this.muted;
  }

  /** Whether an AudioContext exists at all. False means this machine gets no sound. */
  get ready() {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture; safe to call repeatedly. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;

      /**
       * The mix, in order, and why each link is there.
       *
       * A synthesised game usually gives itself away in the bus structure
       * rather than in the voices: a dozen bare oscillators wired straight to
       * the destination will clip the instant three of them land together, sit
       * in no space at all, and get louder in exact proportion to how much is
       * happening — which is precisely backwards, because the busiest moment is
       * the one the player most needs to read.
       *
       *   voices → [pan] → sfx → soft clip → glue comp → master → limiter → out
       *                                   └→ send → room ──────┘
       *
       * The soft clip rounds transients instead of squaring them off, the glue
       * compressor makes a five-kill chain sit *behind* the first kill rather
       * than five times in front of it, the room gives every sound the same
       * space so they belong to one place, and the limiter is the seatbelt: the
       * music and the effects are summed there and nothing downstream of it can
       * distort no matter how many things die at once.
       */
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -2;
      this.limiter.knee.value = 4;
      this.limiter.ratio.value = 14;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.16;
      this.limiter.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.limiter);

      // The two player-facing trims, sitting between each bus and the master.
      this.sfxTrim = ctx.createGain();
      this.sfxTrim.gain.value = gainFor(settings.sfx);
      this.sfxTrim.connect(this.master);

      this.musicTrim = ctx.createGain();
      this.musicTrim.gain.value = gainFor(settings.music);
      this.musicTrim.connect(this.master);

      // A small, dark plate. Long enough to be a room, short enough that a
      // chain of kills does not turn into a wash.
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.impulse(ctx, 1.05, 3.4);
      const verbReturn = ctx.createGain();
      verbReturn.gain.value = 0.85;
      // Through the SFX trim, not straight to the master: the room is part of
      // the effects, and a reverb that stayed up while its sources came down
      // would turn a quiet mix into a wash of tails with nothing to belong to.
      this.verb.connect(verbReturn).connect(this.sfxTrim);

      this.sfxComp = ctx.createDynamicsCompressor();
      // Threshold measured, not guessed: at -19 dB the glue was catching the
      // lock tick and the UI blips as well, which flattened the quiet end of
      // the mix into the loud end and cost the instrumentation its distance.
      // -14 leaves everything below a kill untouched and only leans on the
      // events that pile up.
      this.sfxComp.threshold.value = -14;
      this.sfxComp.knee.value = 12;
      this.sfxComp.ratio.value = 2.8;
      this.sfxComp.attack.value = 0.003;
      this.sfxComp.release.value = 0.13;

      const shaper = ctx.createWaveShaper();
      shaper.curve = Audio.softClip();
      shaper.oversample = '2x';

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.82;
      this.sfx.connect(shaper).connect(this.sfxComp).connect(this.sfxTrim);

      // Post-compressor send: the room hears what the mix hears, so a squashed
      // chain does not throw a full-strength tail per kill.
      this.verbSend = ctx.createGain();
      this.verbSend.gain.value = 0.17;
      this.sfxComp.connect(this.verbSend).connect(this.verb);

      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 6000;
      this.musicFilter.Q.value = 0.6;

      this.music = ctx.createGain();
      this.music.gain.value = 0;
      this.music.connect(this.musicFilter).connect(this.musicTrim);

      // Recorded music, on its own filter — see the note at the top of the file.
      this.trackFilter = ctx.createBiquadFilter();
      this.trackFilter.type = 'lowpass';
      this.trackFilter.frequency.value = 20000;
      this.trackFilter.Q.value = 0.7;

      this.trackBus = ctx.createGain();
      // Silent until the first note, then swelled up by `riseMusic`.
      this.trackBus.gain.value = 0;
      this.trackBus.connect(this.trackFilter).connect(this.musicTrim);

      if (this.tracks.attach(ctx, this.trackBus)) {
        this.tracks.onFirstNote(() => this.riseMusic());
        this.tracks.start();
      }

      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;

      this.startDrone();
      this.nextTime = ctx.currentTime;
    } catch {
      this.ctx = null; // audio is a bonus, never a hard failure
    }
  }

  setMuted(v: boolean) {
    this.muted = v;
    settings.muted = v;
    saveSettings();
    if (this.ctx) this.master.gain.setTargetAtTime(v ? 0 : 0.85, this.ctx.currentTime, 0.03);
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  // ----------------------------------------------------------------- volumes
  get musicVolume() {
    return settings.music;
  }

  get sfxVolume() {
    return settings.sfx;
  }

  /**
   * Both volume setters ramp rather than jump. A gain stepped instantly is a
   * discontinuity in the waveform, which is audible as a click — and a slider
   * being dragged sets it every frame, so an instant set would fizz the whole
   * way across the track. 25ms is under the ear's resolution and long enough
   * to be a slope instead of an edge.
   */
  setMusicVolume(v: number) {
    settings.music = v < 0 ? 0 : v > 1 ? 1 : v;
    saveSettings();
    if (this.ctx) {
      this.musicTrim.gain.setTargetAtTime(gainFor(settings.music), this.ctx.currentTime, 0.025);
    }
  }

  setSfxVolume(v: number) {
    settings.sfx = v < 0 ? 0 : v > 1 ? 1 : v;
    saveSettings();
    if (this.ctx) {
      this.sfxTrim.gain.setTargetAtTime(gainFor(settings.sfx), this.ctx.currentTime, 0.025);
    }
  }

  /**
   * Bring the soundtrack up from silence on the first note. Fired from the
   * downbeat rather than from the gesture, so the swell and the title's cold
   * open are the same event. See `TRACK_RISE`.
   */
  private riseMusic() {
    if (!this.ctx) return;
    this.trackBus.gain.setTargetAtTime(
      this.running ? TRACK_GAIN : TRACK_GAIN_IDLE,
      this.ctx.currentTime,
      TRACK_RISE,
    );
  }

  setRunning(on: boolean) {
    this.running = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // The sequencer is a fallback, not a second layer: it plays only when there
    // is no recorded track to play instead.
    this.music.gain.setTargetAtTime(on && !this.tracks.active ? 0.42 : 0.0, t, 0.2);
    // Recorded music keeps going through the title, the pause and the results
    // screen — a soundtrack that cuts out the moment you die makes the results
    // screen feel like a crash. It only steps back a little.
    //
    // While paused, `setPaused` owns the bus level and the filter; deferring
    // here is what lets the two be called in either order without one ramping
    // over the top of the other.
    this.trackBus.gain.setTargetAtTime(
      this.paused ? TRACK_GAIN_PAUSED : on ? TRACK_GAIN : TRACK_GAIN_IDLE,
      t,
      0.3,
    );
    // `setIntensity` stops being called the instant a run ends, so a player who
    // dies mid-aim would be left listening through the bullet-time low-pass for
    // as long as the results screen is up. Open it here rather than there.
    if (!on && !this.paused) {
      this.trackFilter.frequency.setTargetAtTime(20000, t, 0.25);
    }
    if (!on) this.setAlarm(false);
  }

  /**
   * Seal the room over the music while the game is paused.
   *
   * Everything keeps running — the track plays on, the crossfades still land on
   * time — but it is heard from outside: the low-pass closes, the resonance
   * blooms at the corner, the bus steps back, and the sub drone comes up
   * underneath so the silence has a floor rather than a hole. Stopping the
   * music outright was the alternative, and it makes a pause feel like a crash.
   *
   * Call this *before* `setRunning(false)` when pausing and *after*
   * `setRunning(true)` when resuming, so that in both directions the last word
   * on each parameter comes from whichever of the two actually knows the answer.
   */
  setPaused(on: boolean) {
    this.paused = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    this.sweep(this.trackFilter.frequency, on ? PAUSE_CORNER : 20000, t, on);
    // The fallback sequencer gets the same gesture from its own warmer ceiling,
    // so a player whose tracks failed to load still hears the hatch shut.
    this.sweep(this.musicFilter.frequency, on ? PAUSE_CORNER : 6000, t, on);
    this.sweep(this.trackFilter.Q, on ? PAUSE_Q : OPEN_Q, t, on, true);
    this.trackBus.gain.setTargetAtTime(
      on ? TRACK_GAIN_PAUSED : this.running ? TRACK_GAIN : TRACK_GAIN_IDLE,
      t,
      on ? 0.3 : 0.12,
    );
    if (this.droneGain) {
      // Slower than the filter in both directions: the drone should arrive
      // after the room has closed and leave before the player notices it went.
      this.droneGain.gain.setTargetAtTime(on ? PAUSE_DRONE : 0, t, on ? 0.45 : 0.14);
    }
    // The hull alarm is a warning, and a warning nobody is playing against is
    // just noise — so pause silences it. It has to be put back by hand on the
    // way out: `setIntensity` only fires on a *change* of danger, and coming
    // back to one hull left is not a change.
    if (on) this.setAlarm(false);
    else if (this.danger) this.setAlarm(true);
  }

  /**
   * Move a filter parameter into or out of the pause.
   *
   * Closing is a scheduled ramp so the sweep has a fixed, even shape; opening
   * is an approach so that `setIntensity`, which takes this parameter back over
   * on the very next frame, agrees with it rather than landing on top of a
   * ramp still in flight. Either way the current value is read and re-anchored
   * first, which is what makes a pause-and-immediately-unpause pick up from
   * wherever the sweep had actually reached instead of jumping.
   */
  private sweep(p: AudioParam, to: number, t: number, closing: boolean, linear = false) {
    p.cancelScheduledValues(t);
    // `exponentialRampToValueAtTime` is undefined through zero, and a filter
    // corner is never legitimately there anyway.
    p.setValueAtTime(Math.max(p.value, 0.001), t);
    if (!closing) p.setTargetAtTime(to, t, PAUSE_OPEN);
    else if (linear) p.linearRampToValueAtTime(to, t + PAUSE_CLOSE);
    else p.exponentialRampToValueAtTime(to, t + PAUSE_CLOSE);
  }

  /**
   * @param timeScale current simulation time scale — 1 normal, ~0.1 aiming
   * @param speed     0..1 player speed
   * @param combo     current multiplier, gates the lead layer
   * @param danger    one hull left
   */
  setIntensity(timeScale: number, speed: number, combo: number, danger: boolean) {
    this.dilation = timeScale;
    this.combo = combo;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const slow = timeScale < 0.45;

    this.musicFilter.frequency.setTargetAtTime(slow ? 620 : 2400 + speed * 4200, t, 0.09);
    // Same gesture on the recorded bus, but from wide open rather than from a
    // warm ceiling: the drop has to be audible without the normal state sounding
    // muffled. 700 Hz is roughly "heard through the hull".
    this.trackFilter.frequency.setTargetAtTime(slow ? 700 : 20000, t, 0.09);
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(slow ? 0.11 : 0.0, t, 0.12);
    }
    if (danger !== this.danger) {
      this.danger = danger;
      this.setAlarm(danger);
    }
  }

  // ------------------------------------------------------------------ voices
  /**
   * A soft clipper, not a distortion. `tanh` rounds the top of a transient
   * where a hard ceiling would square it off, which is the difference between
   * a hit that sounds loud and a hit that sounds broken.
   */
  private static curve: Float32Array<ArrayBuffer> | null = null;
  private static softClip() {
    if (Audio.curve) return Audio.curve;
    const n = 2048;
    const c = new Float32Array(new ArrayBuffer(n * 4));
    const k = 1.7;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    Audio.curve = c;
    return c;
  }

  /**
   * The room, synthesised: decaying noise, one-pole low-passed so the tail is
   * dark. White noise shaped by an envelope alone sounds like a cymbal being
   * faded out; rooms lose their top end first, and that single filter is what
   * makes this read as a space rather than as an effect.
   *
   * The two channels are generated independently, which is the whole reason to
   * bother — decorrelated tails are what a listener hears as width.
   */
  private impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        prev = prev * 0.74 + (Math.random() * 2 - 1) * 0.26;
        d[i] = prev * (1 - i / len) ** decay;
      }
    }
    return buf;
  }

  private env(node: AudioNode, peak: number, attack: number, decay: number, when: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    node.connect(g);
    return g;
  }

  /**
   * Where a voice lands in the mix.
   *
   * Panning by where the thing actually was is the cheapest realism in the
   * file: a kill on the left edge of the arena belongs on the left, and once
   * that is true the arena stops being a picture with a soundtrack. Kept well
   * short of hard-panned — a sound that leaves one speaker entirely reads as a
   * bug on headphones.
   */
  private out(pan: number, wet = 0): AudioNode {
    const ctx = this.ctx!;
    let node: AudioNode = this.sfx;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      p.connect(this.sfx);
      node = p;
    }
    if (wet > 0) {
      // An extra shove into the room for the events that deserve to ring: the
      // send off the bus is deliberately conservative so the small stuff stays
      // dry and close.
      const s = ctx.createGain();
      s.gain.value = wet;
      s.connect(this.verb);
      const fan = ctx.createGain();
      fan.gain.value = 1;
      fan.connect(node);
      fan.connect(s);
      return fan;
    }
    return node;
  }

  /**
   * One tonal voice.
   *
   * Two things here are new and both are the difference between "synthesised"
   * and "sounds like a game": every pitch is jittered by a few cents, so the
   * same event fired ten times in two seconds never phases into a machine gun;
   * and a voice can carry its own low-pass with its own sweep, which is how a
   * body sound gets to open and close rather than just get louder and quieter.
   */
  private tone(
    freq: number,
    type: OscillatorType,
    peak: number,
    decay: number,
    when: number,
    bend = 1,
    v: {
      pan?: number;
      wet?: number;
      attack?: number;
      cutoff?: number;
      sweep?: number;
      q?: number;
      jitter?: number;
    } = {},
  ) {
    const ctx = this.ctx!;
    const f = freq * (1 + (Math.random() - 0.5) * (v.jitter ?? 0.014));
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, when);
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(f * bend, when + decay);

    let src: AudioNode = osc;
    if (v.cutoff) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(v.cutoff, when);
      if (v.sweep) filt.frequency.exponentialRampToValueAtTime(v.sweep, when + decay);
      filt.Q.value = v.q ?? 0.8;
      osc.connect(filt);
      src = filt;
    }

    const g = this.env(src, peak, v.attack ?? 0.004, decay, when);
    g.connect(this.out(v.pan ?? 0, v.wet ?? 0));
    osc.start(when);
    osc.stop(when + decay + 0.08);
  }

  private hiss(
    when: number,
    peak: number,
    decay: number,
    freq: number,
    type: BiquadFilterType = 'bandpass',
    sweepTo = 0,
    v: { pan?: number; wet?: number; q?: number; attack?: number } = {},
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    // Start somewhere random in a two-second buffer, so the same noise burst is
    // never literally the same waveform twice.
    const off = Math.random() * 1.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, when);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, when + decay);
    filt.Q.value = v.q ?? 1.2;
    src.connect(filt);
    const g = this.env(filt, peak, v.attack ?? 0.003, decay, when);
    g.connect(this.out(v.pan ?? 0, v.wet ?? 0));
    src.start(when, off);
    src.stop(when + decay + 0.1);
  }

  /**
   * The transient. Two milliseconds of high noise on the front of a sound,
   * doing nothing you could hum and everything for whether the hit reads as
   * contact. It is the single most-missed ingredient in synthesised game
   * audio — without it every event sounds like it *faded in*, however fast.
   */
  private click(when: number, peak: number, freq = 3600, pan = 0) {
    this.hiss(when, peak, 0.016, freq, 'highpass', 0, { pan, attack: 0.0006 });
  }

  /**
   * Struck metal.
   *
   * A bell is not a chord — its partials are *inharmonic*, which is exactly why
   * a stack of octaves and fifths sounds like a synthesiser and these ratios
   * sound like something got hit. Higher partials decay faster, as they do in
   * anything physical.
   */
  private metal(
    when: number,
    base: number,
    peak: number,
    decay: number,
    pan = 0,
    wet = 0.35,
    ratios: readonly number[] = [1, 1.73, 2.61, 3.94, 5.42],
  ) {
    ratios.forEach((r, i) => {
      this.tone(base * r, i < 2 ? 'triangle' : 'sine', peak / (1 + i * 1.35), decay / (1 + i * 0.7),
        when, 1, { pan, wet: i === 0 ? wet : 0, jitter: 0.02 });
    });
  }

  /**
   * A body. Pitch dropping fast under an amplitude envelope — the same
   * construction as a kick drum, because a kick drum is what "something heavy
   * happened here" sounds like.
   */
  private thump(when: number, from: number, to: number, peak: number, decay: number, pan = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(to, when + decay * 0.7);
    const g = this.env(osc, peak, 0.003, decay, when);
    g.connect(this.out(pan));
    osc.start(when);
    osc.stop(when + decay + 0.08);
  }

  private startDrone() {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    for (const [mult, type] of [[1, 'sine'], [1.5, 'sine'], [2.005, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = ROOT * 0.5 * mult;
      const og = ctx.createGain();
      og.gain.value = mult === 1 ? 0.6 : 0.25;
      o.connect(og).connect(g);
      o.start();
    }
    this.droneGain = g;
  }

  private setAlarm(on: boolean) {
    if (!this.ctx) return;
    if (on && !this.alarmGain) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.sfx);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 128;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1.6;
      const lg = ctx.createGain();
      lg.gain.value = 0.055;
      lfo.connect(lg).connect(g.gain);
      o.connect(g);
      o.start();
      lfo.start();
      this.alarmGain = g;
    } else if (!on && this.alarmGain) {
      this.alarmGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.alarmGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.alarmGain.disconnect();
      this.alarmGain = null;
    }
  }

  // --------------------------------------------------------------------- sfx
  /**
   * Every effect below is built the same way, and it is the way effects are
   * built when someone is being paid to do it:
   *
   *   TRANSIENT  a click or a noise spit, ~2 ms, no pitch — *contact*
   *   BODY       the pitched part, usually with its own filter moving — *what*
   *   TAIL       noise or partials decaying out — *where, and how big*
   *
   * A single oscillator with an amplitude envelope gives you the middle one
   * only, which is why one-line synth effects all sound like a phone menu.
   *
   * The mix order is load-bearing and was *measured* off the bus rather than
   * guessed from the peak arguments — which is the only way to get it right,
   * because the glue compressor moves every one of these numbers. Peak level
   * at the compressor output, one voice at a time:
   *
   *   ui .07 < lock .12 < strike .51 < kill .59 ≈ wall .59 ≈ blocked .61 ≈
   *   hurt .62 < multi .62–.66 < death .77 < five-kill chain .83
   *
   * Failure is loud because failure is information; the multi-kill is louder
   * still, because it is the only thing in the game the player is chasing.
   */
  onStrike(targets: number, pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // The launch. A body leaving at speed is three things at once: the shove
    // (a sub dropping), the tear (a saw opening a low-pass as it climbs) and
    // the air (noise sweeping up). The old version had only the air.
    this.click(t, 0.09, 4200, pan);
    this.thump(t, 230, 62, 0.17, 0.2, pan);
    this.tone(160, 'sawtooth', 0.12, 0.2, t, 3.1, {
      pan, cutoff: 520, sweep: 5200, q: 2.4,
    });
    this.hiss(t, 0.2, 0.3, 420, 'bandpass', 6200, { pan, wet: 0.12, q: 0.9 });
    // Committing to a line with something on it is a different act from
    // committing to an empty one, and the ear should know before the eye does.
    if (targets > 0) this.tone(hz(36), 'sine', 0.06, 0.12, t, 1.6, { pan });
  }

  onKill(kind: EnemyKind, chainIndex: number, combo: number, pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    const i = Math.min(chainIndex, 24);
    const deg = PENTA[i % PENTA.length] + 12 * Math.min(3, Math.floor(i / PENTA.length));
    const f = hz(deg + 48);
    const first = chainIndex <= 1;

    this.click(t, 0.08, 3400, pan);
    // The chest. Heaviest on the first kill and lighter down the chain: five
    // sub thumps inside 60 ms sum into mud, and the chain's job is to get
    // *brighter*, not lower.
    this.thump(t, 175, 50, first ? 0.17 : 0.11, first ? 0.13 : 0.09, pan);
    // The body of the thing that died. Each species keeps its own waveform —
    // this is the only place in the mix where a player can hear *what* they
    // killed — but it now speaks through a filter that opens with the chain.
    this.tone(f, KIND_WAVE[kind], 0.15, 0.14, t, 0.86, {
      pan, cutoff: 1200 + i * 900, sweep: 700, q: 1.4,
    });
    // Struck metal on top: inharmonic partials, so a kill rings like a hull
    // being holed rather than like a note being played.
    // Three partials rather than the full five: a kill is the most-repeated
    // event in the game and a five-chain would otherwise build ~120 nodes
    // inside 60 ms. The top two partials are the least of what makes it read
    // as metal, and they are the first thing a weak machine should not pay for.
    this.metal(t, f * 2, 0.055, 0.3 + Math.min(0.2, i * 0.04), pan, 0.3, [1, 1.73, 2.61]);
    this.hiss(t, 0.1, 0.07, 2400 + combo * 60, 'highpass', 0, { pan });
  }

  /**
   * The aim line acquiring one more target. Pitch climbs with the count, so a
   * sweep across a pack plays a rising scale. Kept short and quiet: it fires
   * during slow motion, against the filtered music, and must read as
   * instrumentation rather than as a reward — the reward is the release.
   */
  onLock(count: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(hz(52 + Math.min(count, 8) * 2), 'sine', 0.05, 0.07, t, 1.1, {
      attack: 0.002, jitter: 0.004,
    });
    this.click(t, 0.022, 6400);
  }

  /**
   * A strike arriving in empty air: the brake-thud. Deliberately the quietest
   * arrival in the game — a whiff must be *marked*, never rewarded.
   */
  onArrive(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.thump(t, 96, 42, 0.13, 0.13, pan);
    this.hiss(t, 0.05, 0.09, 620, 'lowpass', 0, { pan });
  }

  onOrbPop(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.click(t, 0.05, 5200, pan);
    this.tone(hz(60), 'sine', 0.06, 0.07, t, 1.9, { pan, jitter: 0.05 });
  }

  onMulti(n: number, pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A stacked chord, each voice a beat late — the payoff should bloom, and
    // it is the one moment in the game allowed to use the room properly.
    const degs = [0, 7, 12, 19, 24];
    // The chord blooms, which means it has no front — and an event with no
    // transient is one the ear files as music rather than as a thing that just
    // happened. The crack goes on the front; the bloom stays behind it.
    this.click(t, 0.16, 3000, pan * 0.5);
    for (let i = 0; i < Math.min(n, degs.length); i++) {
      this.tone(hz(degs[i] + 24), i === 0 ? 'sawtooth' : 'triangle',
        0.155 - i * 0.015, 0.55, t + i * 0.045, 1, {
          pan: pan * 0.5, wet: 0.4, cutoff: 2400 + i * 900, sweep: 900,
        });
    }
    // Measured against the rest of the mix: a multi-kill landing *quieter* than
    // the single kill inside it is the one ordering the ear will not forgive.
    this.thump(t, 120, 44, 0.27, 0.26, pan * 0.5);
    this.hiss(t, 0.16, 0.55, 800, 'bandpass', 6400, { wet: 0.5, q: 0.8 });
  }

  onBlocked(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A shield stopping a ship: struck plate, and nothing tonal to enjoy about
    // it. The ratios are wide and inharmonic — this must never sound like a
    // note, because a note is a reward.
    this.click(t, 0.14, 2600, pan);
    this.metal(t, 300, 0.2, 0.42, pan, 0.45, [1, 1.41, 2.11, 2.98, 4.17]);
    this.tone(190, 'square', 0.12, 0.26, t, 0.62, { pan, cutoff: 1400, sweep: 400 });
    this.hiss(t, 0.18, 0.2, 2600, 'bandpass', 900, { pan, wet: 0.25 });
  }

  onWall(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // Full speed into steel. Heavier than a kill, lighter than a wound — the
    // wall is a mistake, not an injury.
    this.click(t, 0.14, 2200, pan);
    this.thump(t, 130, 38, 0.34, 0.2, pan);
    this.metal(t, 148, 0.06, 0.34, pan, 0.3);
    this.hiss(t, 0.13, 0.12, 780, 'lowpass', 0, { pan, wet: 0.2 });
  }

  onHurt(hullLeft: number, pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // Damage: a low saw collapsing through a closing filter, with the air
    // knocked out of the room around it.
    this.click(t, 0.12, 1800, pan);
    this.tone(240, 'sawtooth', 0.3, 0.5, t, 0.14, { pan, cutoff: 2200, sweep: 260, q: 3 });
    this.hiss(t, 0.28, 0.36, 1500, 'lowpass', 380, { pan, wet: 0.3 });
    // One hull left. A slow low knell under the hit — the only sound in the
    // game that is a warning rather than a report.
    if (hullLeft <= 1) this.tone(hz(1), 'sine', 0.2, 1.1, t, 0.5, { wet: 0.4 });
  }

  onDeath() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // The one place the room is allowed to be heard fully: everything else in
    // this game is close and dry, so the tail on this reads as the arena
    // emptying out.
    this.tone(420, 'sawtooth', 0.3, 1.4, t, 0.05, { cutoff: 2600, sweep: 200, q: 2, wet: 0.5 });
    this.hiss(t, 0.3, 1.0, 900, 'lowpass', 220, { wet: 0.6 });
    this.thump(t, 150, 34, 0.3, 0.5);
    for (let i = 0; i < 3; i++) {
      this.tone(hz(12 - i * 5), 'triangle', 0.11, 1.2, t + i * 0.1, 0.7, { wet: 0.45 });
    }
    // A knell over the collapse. Struck, low, and left to ring.
    this.metal(t + 0.06, 196, 0.09, 1.6, 0, 0.6);
  }

  onHeal() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    [0, 7, 12].forEach((d, i) =>
      this.tone(hz(d + 36), 'triangle', 0.11, 0.34, t + i * 0.05, 1, { wet: 0.3, cutoff: 3200 }),
    );
  }

  onWave(n: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A door opening on the next room: three rising notes and a breath of air.
    const base = 24 + (n % 4) * 2;
    [0, 5, 7].forEach((d, i) =>
      this.tone(hz(base + d), 'sine', 0.1, 0.5, t + i * 0.09, 1, { wet: 0.3, cutoff: 2600 }),
    );
    this.thump(t, 110, 40, 0.14, 0.28);
    this.hiss(t, 0.07, 0.45, 3600, 'highpass', 0, { wet: 0.25 });
  }

  onWaveClear() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    [0, 3, 7, 12].forEach((d, i) =>
      this.tone(hz(d + 36), 'triangle', 0.1, 0.65, t + i * 0.06, 1, {
        wet: 0.35, cutoff: 2200 + i * 700,
      }),
    );
  }

  onLancerMark(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // Two clipped beeps: a machine deciding where you are. Short, dry, and
    // high enough to cut through everything else without being loud.
    this.tone(760, 'square', 0.045, 0.05, t, 1, { pan, cutoff: 2600 });
    this.tone(940, 'square', 0.04, 0.05, t + 0.075, 1, { pan, cutoff: 2600 });
  }

  onLancerCharge(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A capacitor filling. Rising on two fronts at once — noise band and saw
    // pitch — which is the sound the ear reads as "about to happen".
    this.hiss(t, 0.12, 0.34, 600, 'bandpass', 3000, { pan, q: 3 });
    this.tone(150, 'sawtooth', 0.09, 0.34, t, 2.4, { pan, cutoff: 900, sweep: 3400 });
  }

  onOrb(pan = 0) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(520, 'sine', 0.045, 0.15, t, 0.68, { pan, cutoff: 2400, jitter: 0.05 });
    this.click(t, 0.02, 5200, pan);
  }

  onHint() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(hz(48), 'sine', 0.06, 0.22, t, 1, { wet: 0.25 });
    this.tone(hz(55), 'sine', 0.045, 0.26, t + 0.07, 1, { wet: 0.25 });
  }

  onComboLost() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // Down, dull, and gone. A loss should never be as pretty as a gain.
    this.tone(300, 'sine', 0.05, 0.24, t, 0.52, { cutoff: 1200, sweep: 500 });
  }

  onUiMove() {
    if (!this.enabled) return;
    this.tone(880, 'sine', 0.035, 0.05, this.ctx!.currentTime, 1, { jitter: 0.006 });
  }

  // ------------------------------------------------------------------- music
  /**
   * Called every frame. Advances the recorded soundtrack, then runs the
   * sequencer's lookahead scheduler if there is no recorded track to defer to.
   *
   * The track side runs even while muted: a crossfade that stops halfway
   * because someone pressed M would come back wrong when they pressed it again.
   */
  tick() {
    if (!this.ctx) return;
    this.tracks.tick();

    // Recorded music arrives asynchronously — `play()` is a promise, and on a
    // cold cache it can resolve a second or two after the run has started. Ramp
    // the sequencer out at whatever moment that turns out to be.
    if (this.tracks.active !== this.sequencerYielded) {
      this.sequencerYielded = this.tracks.active;
      this.music.gain.setTargetAtTime(
        this.running && !this.sequencerYielded ? 0.42 : 0,
        this.ctx.currentTime,
        0.2,
      );
    }

    if (!this.enabled || !this.running || this.tracks.active) return;
    const ctx = this.ctx;
    const slow = this.dilation < 0.45;
    const bpm = slow ? 66 : 132;
    const stepDur = 60 / bpm / 4; // sixteenths

    const horizon = ctx.currentTime + 0.14;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 24) {
      this.schedule(this.nextTime, this.step, slow);
      this.nextTime += stepDur;
      this.step++;
    }
    if (this.nextTime < ctx.currentTime - 0.4) this.nextTime = ctx.currentTime;
  }

  private schedule(when: number, step: number, slow: boolean) {
    const ctx = this.ctx!;
    const bus = this.music;
    // Bullet time drops everything a clean octave, so it stays in key.
    const shift = slow ? -12 : 0;
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const chord = PROGRESSION[bar];
    const s = step % 16;

    // Kick.
    if (s === 0 || s === 6 || s === 10) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, when);
      o.frequency.exponentialRampToValueAtTime(44, when + 0.1);
      const g = this.env(o, 0.5, 0.002, 0.13, when);
      g.connect(bus);
      o.start(when);
      o.stop(when + 0.2);
    }

    // Snare-ish noise on the backbeat.
    if (s === 4 || s === 12) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 1800;
      src.connect(filt);
      const g = this.env(filt, 0.14, 0.002, 0.1, when);
      g.connect(bus);
      src.start(when);
      src.stop(when + 0.2);
    }

    // Hats, thinned out in bullet time so the slow section breathes.
    if (!slow && s % 2 === 1) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 2;
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 7000;
      src.connect(filt);
      const g = this.env(filt, s % 4 === 3 ? 0.05 : 0.028, 0.002, 0.03, when);
      g.connect(bus);
      src.start(when);
      src.stop(when + 0.09);
    }

    // Bass.
    if (s % 2 === 0) {
      const pat = [0, 0, 12, 0, 7, 0, 5, 0];
      const deg = chord + pat[(s / 2) % pat.length] + shift;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(deg + 12);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = slow ? 320 : 900;
      o.connect(filt);
      const g = this.env(filt, 0.2, 0.005, 0.16, when);
      g.connect(bus);
      o.start(when);
      o.stop(when + 0.28);
    }

    // Lead arpeggio — earns its way in as the combo climbs.
    if (this.combo >= 3 && s % 2 === 1) {
      const deg = chord + MINOR[(step * 3) % MINOR.length] + 36 + shift;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz(deg);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 3200;
      o.connect(filt);
      const g = this.env(filt, Math.min(0.06, 0.02 + this.combo * 0.004), 0.004, 0.09, when);
      g.connect(bus);
      o.start(when);
      o.stop(when + 0.16);
    }

    // Pad — a held fifth under everything, only in bullet time.
    if (slow && s === 0) {
      for (const d of [0, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(chord + d + 24 + shift);
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 700;
        o.connect(filt);
        const g = this.env(filt, 0.05, 0.12, 1.1, when);
        g.connect(bus);
        o.start(when);
        o.stop(when + 1.4);
      }
    }
  }
}
