/**
 * Fully procedural WebAudio. No asset files, no licensing, no load time.
 *
 * Two ideas carry the whole soundtrack:
 *  - break SFX walk *up* a minor-pentatonic scale as the chain grows, so a long
 *    combo plays as a rising melodic run. That ascending line is the hook.
 *  - the music's tempo is driven by your actual velocity, so the score literally
 *    accelerates with you. Speed is the instrument.
 */

// Minor pentatonic: every interval is consonant with every other, so notes can
// fire in any order at any density and never sound wrong.
const PENTATONIC = [0, 3, 5, 7, 10];
const ROOT_HZ = 110; // A2

const semitone = (n: number) => ROOT_HZ * Math.pow(2, n / 12);

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;

  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  private noiseBuffer!: AudioBuffer;

  private speedNorm = 0;
  private muted = false;
  private running = false;

  /** Sequencer state. */
  private nextNoteTime = 0;
  private step = 0;

  get enabled() {
    return this.ctx !== null && !this.muted;
  }

  /**
   * Must be called from a user gesture — browsers start every AudioContext
   * suspended. Safe to call repeatedly.
   */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.85;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.0;
      this.musicBus.connect(this.master);

      // --- wind: filtered noise whose brightness and level track velocity
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      const wind = ctx.createBufferSource();
      wind.buffer = buf;
      wind.loop = true;

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 400;
      this.windFilter.Q.value = 0.7;

      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;

      wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
      wind.start();

      this.nextNoteTime = ctx.currentTime;
    } catch {
      this.ctx = null; // audio is a bonus, never a hard failure
    }
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /** Music only plays during a run. */
  setRunning(on: boolean) {
    this.running = on;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.15);
    if (!on) this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  setSpeed(norm: number) {
    this.speedNorm = norm;
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    // Wind rises steeply so the top end of the dive feels genuinely dangerous.
    this.windGain.gain.setTargetAtTime(0.02 + norm * norm * 0.3, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(300 + norm * 2100, t, 0.08);
  }

  // ------------------------------------------------------------------ sfx
  private env(
    node: AudioNode,
    peak: number,
    attack: number,
    decay: number,
    when: number,
  ): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    node.connect(g);
    return g;
  }

  private noiseBurst(when: number, peak: number, decay: number, freq: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1 + Math.random() * 0.4;

    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = 1.1;

    src.connect(filt);
    const g = this.env(filt, peak, 0.002, decay, when);
    g.connect(this.sfxBus);
    src.start(when);
    src.stop(when + decay + 0.05);
  }

  /**
   * @param chain  current chain length — drives the rising melodic run
   * @param marginal 0..1 how close the break was to your ceiling
   */
  onBreak(chain: number, marginal: number, isGate: boolean) {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;

    // Walk up the pentatonic, climbing octaves; cap so it stays in a musical range.
    const idx = Math.min(chain, 40);
    const deg = PENTATONIC[idx % PENTATONIC.length];
    const oct = Math.min(Math.floor(idx / PENTATONIC.length), 4);
    const freq = semitone(deg + oct * 12 + 24);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, when);
    // A touch of downward pitch bend gives it a percussive "chip" rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(freq * 0.82, when + 0.09);

    const peak = 0.16 + marginal * 0.16;
    const g = this.env(osc, peak, 0.004, 0.1 + marginal * 0.08, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 0.24);

    // Marginal breaks get grit; trivial ones stay clean so plowing feels smooth.
    if (marginal > 0.45 || isGate) {
      this.noiseBurst(when, 0.1 + marginal * 0.12, 0.07, 1400 + marginal * 1800);
    }
    if (isGate) {
      const sweep = ctx.createOscillator();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(freq * 0.5, when);
      sweep.frequency.exponentialRampToValueAtTime(freq * 2, when + 0.3);
      const sg = this.env(sweep, 0.14, 0.01, 0.34, when);
      sg.connect(this.sfxBus);
      sweep.start(when);
      sweep.stop(when + 0.4);
    }
  }

  onBounce() {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.22);
    const g = this.env(osc, 0.3, 0.003, 0.26, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 0.34);

    this.noiseBurst(when, 0.26, 0.16, 700, 'lowpass');
  }

  onGraze() {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, when);
    const g = this.env(osc, 0.05, 0.001, 0.05, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  onDeath() {
    if (!this.enabled) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, when);
    osc.frequency.exponentialRampToValueAtTime(28, when + 0.9);
    const g = this.env(osc, 0.32, 0.005, 0.95, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 1.05);

    this.noiseBurst(when, 0.34, 0.5, 500, 'lowpass');
  }

  // ---------------------------------------------------------------- music
  /**
   * Lookahead scheduler. Called every frame; queues notes slightly ahead of the
   * audio clock so timing never depends on requestAnimationFrame jitter.
   */
  tick() {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;

    // Tempo rides velocity — the score accelerates because you do.
    const bpm = 96 + this.speedNorm * 84;
    const stepDur = 60 / bpm / 2; // eighth notes

    const horizon = ctx.currentTime + 0.12;
    let guard = 0;
    while (this.nextNoteTime < horizon && guard++ < 16) {
      this.scheduleStep(this.nextNoteTime, this.step);
      this.nextNoteTime += stepDur;
      this.step++;
    }
    // If the tab was backgrounded the clock can fall far behind; resync.
    if (this.nextNoteTime < ctx.currentTime - 0.5) this.nextNoteTime = ctx.currentTime;
  }

  private scheduleStep(when: number, step: number) {
    const ctx = this.ctx!;
    const n = this.speedNorm;

    // Layer 1 — pulse, always present.
    if (step % 2 === 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, when);
      osc.frequency.exponentialRampToValueAtTime(44, when + 0.09);
      const g = this.env(osc, 0.32, 0.003, 0.1, when);
      g.connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.16);
    }

    // Layer 2 — bassline, enters at moderate speed.
    if (n > 0.3) {
      const pattern = [0, 0, 7, 0, 5, 0, 3, 0];
      const deg = pattern[step % pattern.length];
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = semitone(deg);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 300 + n * 1400;
      osc.connect(filt);
      const g = this.env(filt, 0.1 + n * 0.06, 0.005, 0.13, when);
      g.connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.2);
    }

    // Layer 3 — arpeggio, only at genuinely high speed.
    if (n > 0.62) {
      const deg = PENTATONIC[step % PENTATONIC.length];
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = semitone(deg + 24);
      const g = this.env(osc, 0.045, 0.004, 0.09, when);
      g.connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.14);
    }
  }
}
