import type { EnemyKind } from '../game/enemies';

/**
 * Fully procedural WebAudio. No asset files, no licensing, no load time.
 *
 * The one idea worth knowing: when the player holds to aim, the *music* enters
 * bullet time with them — the sequencer halves its tempo, every voice drops a
 * clean octave, and a low-pass closes over the whole bus. Because the notes are
 * synthesised rather than sampled, that transposition stays perfectly in key, so
 * slow motion sounds like the track shifting gear rather than like a tape being
 * dragged. That single effect does more for the feel of the mechanic than any
 * amount of on-screen vignette.
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

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;

  private droneGain: GainNode | null = null;
  private alarmGain: GainNode | null = null;

  private muted = false;
  private running = false;
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

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(ctx.destination);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.9;
      this.sfx.connect(this.master);

      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 6000;
      this.musicFilter.Q.value = 0.6;

      this.music = ctx.createGain();
      this.music.gain.value = 0;
      this.music.connect(this.musicFilter).connect(this.master);

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
    if (this.ctx) this.master.gain.setTargetAtTime(v ? 0 : 0.85, this.ctx.currentTime, 0.03);
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setRunning(on: boolean) {
    this.running = on;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(on ? 0.42 : 0.0, this.ctx.currentTime, 0.2);
    if (!on) this.setAlarm(false);
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
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(slow ? 0.11 : 0.0, t, 0.12);
    }
    if (danger !== this.danger) {
      this.danger = danger;
      this.setAlarm(danger);
    }
  }

  // ------------------------------------------------------------------ voices
  private env(node: AudioNode, peak: number, attack: number, decay: number, when: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    node.connect(g);
    return g;
  }

  private tone(
    freq: number,
    type: OscillatorType,
    peak: number,
    decay: number,
    when: number,
    bend = 1,
    bus: GainNode = this.sfx,
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, when + decay);
    const g = this.env(osc, peak, 0.004, decay, when);
    g.connect(bus);
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
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, when);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, when + decay);
    filt.Q.value = 1.2;
    src.connect(filt);
    const g = this.env(filt, peak, 0.003, decay, when);
    g.connect(this.sfx);
    src.start(when);
    src.stop(when + decay + 0.1);
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
  onStrike(targets: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A rising whoosh: bandpass sweeping up is the cheapest convincing "fast".
    this.hiss(t, 0.22, 0.24, 500, 'bandpass', 5200);
    this.tone(hz(24), 'sawtooth', 0.1, 0.16, t, 2.4);
    if (targets > 0) this.tone(hz(36), 'sine', 0.06, 0.1, t, 1.6);
  }

  onKill(kind: EnemyKind, chainIndex: number, combo: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    const i = Math.min(chainIndex, 24);
    const deg = PENTA[i % PENTA.length] + 12 * Math.min(3, Math.floor(i / PENTA.length));
    const f = hz(deg + 48);
    this.tone(f, KIND_WAVE[kind], 0.16, 0.13, t, 0.86);
    this.tone(f * 2, 'sine', 0.05, 0.07, t);
    this.hiss(t, 0.11, 0.06, 2600 + combo * 60, 'highpass');
  }

  onOrbPop() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(hz(60), 'sine', 0.09, 0.06, t, 1.8);
    this.hiss(t, 0.06, 0.04, 4200, 'highpass');
  }

  onMulti(n: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // A stacked chord, each voice a beat late — the payoff should bloom.
    const degs = [0, 7, 12, 19, 24];
    for (let i = 0; i < Math.min(n, degs.length); i++) {
      this.tone(hz(degs[i] + 24), i === 0 ? 'sawtooth' : 'triangle', 0.13 - i * 0.014, 0.5, t + i * 0.045);
    }
    this.hiss(t, 0.16, 0.5, 900, 'bandpass', 6000);
  }

  onBlocked() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    // Two detuned squares an augmented fourth apart: unmistakably "wrong".
    this.tone(320, 'square', 0.16, 0.22, t, 0.6);
    this.tone(453, 'square', 0.12, 0.2, t, 0.6);
    this.hiss(t, 0.2, 0.16, 3000, 'bandpass');
  }

  onWall() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(88, 'sine', 0.16, 0.14, t, 0.5);
    this.hiss(t, 0.1, 0.08, 900, 'lowpass');
  }

  onHurt(hullLeft: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(240, 'sawtooth', 0.3, 0.5, t, 0.14);
    this.hiss(t, 0.3, 0.34, 1400, 'lowpass');
    if (hullLeft <= 1) this.tone(hz(1), 'sine', 0.2, 0.9, t, 0.5);
  }

  onDeath() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(420, 'sawtooth', 0.3, 1.3, t, 0.05);
    this.hiss(t, 0.32, 0.9, 700, 'lowpass');
    for (let i = 0; i < 3; i++) {
      this.tone(hz(12 - i * 5), 'triangle', 0.12, 1.1, t + i * 0.1, 0.7);
    }
  }

  onHeal() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    [0, 7, 12].forEach((d, i) => this.tone(hz(d + 36), 'triangle', 0.12, 0.3, t + i * 0.05));
  }

  onWave(n: number) {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    const base = 24 + (n % 4) * 2;
    [0, 5, 7].forEach((d, i) => this.tone(hz(base + d), 'sine', 0.1, 0.45, t + i * 0.09));
    this.hiss(t, 0.08, 0.4, 4000, 'highpass');
  }

  onWaveClear() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    [0, 3, 7, 12].forEach((d, i) =>
      this.tone(hz(d + 36), 'triangle', 0.11, 0.6, t + i * 0.06),
    );
  }

  onLancerMark() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(660, 'square', 0.05, 0.1, t, 1.5);
  }

  onLancerCharge() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.hiss(t, 0.14, 0.3, 700, 'bandpass', 2600);
    this.tone(150, 'sawtooth', 0.1, 0.3, t, 2.2);
  }

  onOrb() {
    if (!this.enabled) return;
    this.tone(520, 'sine', 0.045, 0.14, this.ctx!.currentTime, 0.7);
  }

  onHint() {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(hz(48), 'sine', 0.07, 0.2, t);
    this.tone(hz(55), 'sine', 0.05, 0.24, t + 0.07);
  }

  onComboLost() {
    if (!this.enabled) return;
    this.tone(300, 'sine', 0.05, 0.2, this.ctx!.currentTime, 0.55);
  }

  onUiMove() {
    if (!this.enabled) return;
    this.tone(880, 'sine', 0.04, 0.05, this.ctx!.currentTime);
  }

  // ------------------------------------------------------------------- music
  /** Lookahead scheduler; called every frame against the audio clock. */
  tick() {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
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
