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
  private melting = false;
  private heat = 0;
  private redlining = false;
  /** Continuous redline alarm — created lazily, held for the burn's duration. */
  private alarmOsc: OscillatorNode | null = null;
  private alarmGain: GainNode | null = null;

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
    if (!on) {
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      // The burn alarm must not outlive the run that started it.
      this.stopAlarm();
      this.redlining = false;
    }
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
   * @param chain    current chain length — drives the rising melodic run
   * @param marginal 0..1 how close the break was to your heat ceiling
   * @param material 0..3 — tougher material gets a lower, grittier body
   */
  onBreak(chain: number, marginal: number, material: number, isGate: boolean) {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;

    // Walk up the pentatonic, climbing octaves; cap so it stays in a musical range.
    const idx = Math.min(chain, 40);
    const deg = PENTATONIC[idx % PENTATONIC.length];
    const oct = Math.min(Math.floor(idx / PENTATONIC.length), 4);
    // Tougher material sits lower — glass tinkles, plate thuds.
    const freq = semitone(deg + oct * 12 + 24 - material * 3);

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
    // Grit on marginal breaks and on anything heavier than a grate; plain
    // material stays clean so ploughing glass still feels smooth.
    if (marginal > 0.45 || isGate || material >= 2) {
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

  /**
   * Heat drives the mix. The redline gets a continuous alarm rather than a
   * one-shot: the hull is burning for as long as you stay up there, and a
   * single beep would let the player forget they are on fire.
   */
  setHeat(value: number, melting: boolean, redlining: boolean) {
    this.heat = value;
    this.melting = melting;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (redlining && !this.redlining) this.startAlarm();
    else if (!redlining && this.redlining) this.stopAlarm();
    this.redlining = redlining;

    if (this.alarmOsc && this.alarmGain) {
      // Pitch and level ride how deep into the redline you are.
      const over = Math.max(0, (value - 0.82) / 0.18);
      this.alarmOsc.frequency.setTargetAtTime(320 + over * 190, t, 0.05);
      this.alarmGain.gain.setTargetAtTime(0.03 + over * 0.05, t, 0.05);
    }
  }

  private startAlarm() {
    if (!this.ctx || this.alarmOsc) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 320;
    // Tremolo via a second oscillator on the gain: a wavering tone reads as an
    // alarm, a steady one reads as a synth pad.
    const g = ctx.createGain();
    g.gain.value = 0.0;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(g).connect(this.sfxBus);
    osc.start();
    lfo.start();
    this.alarmOsc = osc;
    this.alarmGain = g;
  }

  private stopAlarm() {
    if (!this.ctx || !this.alarmOsc || !this.alarmGain) return;
    const t = this.ctx.currentTime;
    this.alarmGain.gain.setTargetAtTime(0, t, 0.05);
    this.alarmOsc.stop(t + 0.3);
    this.alarmOsc = null;
    this.alarmGain = null;
  }

  /**
   * Overdrive stinger: a fifth stacked on the root, swept upward under a noise
   * whoosh. Loud, short, unmistakable — the audio has to confirm the state
   * change before the player has finished reading the word on screen.
   */
  onMeltdown() {
    if (!this.enabled) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;

    for (const [mult, type, peak] of [
      [1, 'sawtooth', 0.2],
      [1.5, 'sawtooth', 0.15],
      [2, 'square', 0.1],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(ROOT_HZ * mult, when);
      osc.frequency.exponentialRampToValueAtTime(ROOT_HZ * mult * 4, when + 0.42);
      const g = this.env(osc, peak, 0.008, 0.5, when);
      g.connect(this.sfxBus);
      osc.start(when);
      osc.stop(when + 0.6);
    }
    this.noiseBurst(when, 0.3, 0.45, 2600, 'highpass');
  }

  onMeltdownEnd() {
    if (!this.enabled) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(ROOT_HZ * 3, when);
    osc.frequency.exponentialRampToValueAtTime(ROOT_HZ * 0.75, when + 0.34);
    const g = this.env(osc, 0.13, 0.006, 0.36, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 0.45);
  }

  /** Zone arrival: an open fifth, high and clean, over a soft noise swell. */
  onZone() {
    if (!this.enabled) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;
    for (const [deg, delay] of [[0, 0], [7, 0.07], [12, 0.14]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = semitone(deg + 36);
      const g = this.env(osc, 0.11, 0.01, 0.55, when + delay);
      g.connect(this.sfxBus);
      osc.start(when + delay);
      osc.stop(when + delay + 0.7);
    }
    this.noiseBurst(when, 0.07, 0.5, 3400, 'highpass');
  }

  /**
   * Crossed into a hotter band — a new material just became meltable. A short
   * rising blip whose pitch tracks the band, so the ear learns the ladder
   * without the eye leaving the shaft. Cooling stays silent: braking already has
   * its own feedback, and a sad blip every time you vent would read as being
   * punished for playing correctly.
   */
  onBand(band: number) {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;
    const f = 440 + band * 150;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 0.78, when);
    osc.frequency.exponentialRampToValueAtTime(f, when + 0.06);
    const g = this.env(osc, 0.07, 0.004, 0.12, when);
    g.connect(this.sfxBus);
    osc.start(when);
    osc.stop(when + 0.2);
  }

  onHeal() {
    if (!this.enabled || !this.running) return;
    const ctx = this.ctx!;
    const when = ctx.currentTime;
    for (const [deg, delay] of [[0, 0], [7, 0.06]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = semitone(deg + 24);
      const g = this.env(osc, 0.14, 0.005, 0.22, when + delay);
      g.connect(this.sfxBus);
      osc.start(when + delay);
      osc.stop(when + delay + 0.3);
    }
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

    // Tempo rides velocity — the score accelerates because you do. Overdrive
    // shifts the whole sequencer up a gear so the payoff is audible, not just
    // a louder version of the same groove.
    const bpm = (96 + this.speedNorm * 84) * (this.melting ? 1.34 : 1);
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

    // Layer 3 — arpeggio. Enters on speed OR heat, so a hot, controlled run
    // sounds as intense as a reckless fast one.
    if (n > 0.62 || this.heat > 0.55 || this.melting) {
      const deg = PENTATONIC[step % PENTATONIC.length];
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = semitone(deg + 24);
      const g = this.env(osc, 0.045, 0.004, 0.09, when);
      g.connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.14);
    }

    // Layer 4 — overdrive only: an octave-up lead doubling the arpeggio, plus a
    // hat on the off-beat. Exists purely so the payoff sounds like a different
    // piece of music rather than the same one with the gain up.
    if (this.melting) {
      const deg = PENTATONIC[(step * 2) % PENTATONIC.length];
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = semitone(deg + 36);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 2600;
      osc.connect(filt);
      const g = this.env(filt, 0.05, 0.004, 0.08, when);
      g.connect(this.musicBus);
      osc.start(when);
      osc.stop(when + 0.13);

      if (step % 2 === 1) this.noiseBurst(when, 0.035, 0.04, 7000, 'highpass');
    }
  }
}
