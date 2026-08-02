import {
  BANDS,
  BRAKE_VENT_MULT,
  HEAT_GAIN,
  HEAT_MULT_COLD,
  HEAT_MULT_HOT,
  HEAT_PER_BREAK,
  HEAT_PER_BREAK_MAT,
  HEAT_REDLINE,
  HEAT_VENT,
  MELT_AT,
  MELTDOWN_END_HEAT,
  MELTDOWN_MULT,
  MELTDOWN_TIME,
  REDLINE_DPS_MAX,
  REDLINE_DPS_MIN,
  type Material,
} from '../config';
import { clamp, lerp } from '../engine/math';

/**
 * Heat: the whole game, in one number.
 *
 * The version this replaces compared a speed *tier* against a hardness *digit*
 * printed on each block. That is arithmetic, and nobody does arithmetic at
 * 600 km/h — so players ignored the numbers, and since speed had no cost, the
 * dominant strategy was to hold the dive and never think again.
 *
 * Heat fixes both faults with one mechanic:
 *
 *   - it is READ, not computed. Your hull glows; barriers glow when you can melt
 *     them. "Can I go through that?" is answered by looking, like judging a jump.
 *   - it has a COST. Diving heats you, and *smashing heats you more*, so the
 *     hold-W line drives itself into the redline and starts burning hull. The
 *     player is now permanently asked "how long dare I stay hot?"
 *
 * It also absorbs the old overdrive: meltdown is simply the top of this curve
 * rather than a second meter with its own charge economy.
 */
export class Heat {
  /** 0..1. The only number that matters. */
  value = 0;

  /** Meltdown state — the payoff at the top of the curve. */
  melting = false;
  /** 1 at trigger, draining to 0. Drives both duration and effect intensity. */
  meltT = 0;

  /** Free-running clock for pulsing visuals. Never reset; safe on every screen. */
  pulse = 0;

  /** Set for the step the state changed, consumed by renderer/audio. */
  justMelted = false;
  justCooled = false;
  /** Band index last step, so a crossing can be detected and sounded. */
  private lastBand = 0;
  bandChanged = 0;

  reset() {
    this.value = 0;
    this.melting = false;
    this.meltT = 0;
    this.justMelted = false;
    this.justCooled = false;
    this.lastBand = 0;
    this.bandChanged = 0;
  }

  /** 0..3 — which named band we are in. */
  get band() {
    let b = 0;
    for (let i = 0; i < BANDS.length; i++) if (this.value >= BANDS[i].at) b = i;
    return b;
  }

  get bandName() {
    return BANDS[this.band].name;
  }

  /** True once the hull is taking burn damage. */
  get redlining() {
    return !this.melting && this.value >= HEAT_REDLINE;
  }

  /** How far into the redline, 0..1. Drives damage rate and the alarm. */
  get overload() {
    if (this.value < HEAT_REDLINE) return 0;
    return clamp((this.value - HEAT_REDLINE) / (1 - HEAT_REDLINE), 0, 1);
  }

  /** Meltdown intensity 0..1: punches in fast, then drains with the timer. */
  get meltIntensity() {
    if (!this.melting) return 0;
    return this.meltT > 0.88 ? (1 - this.meltT) / 0.12 : this.meltT / 0.88;
  }

  /** Can the current heat melt this material? */
  canMelt(m: Material) {
    if (this.melting) return true;
    return this.value >= MELT_AT[m];
  }

  /**
   * How marginal a break is, 0 (trivial) .. 1 (only just possible). Drives the
   * momentum cost and how hard the impact feels.
   *
   * Two terms, and both are needed:
   *
   *   toughness — what the material inherently costs to go through
   *   headroom  — how far past its melting point you actually are
   *
   * Weighing headroom alone was a real bug: GLASS melts at heat 0, so a cold
   * player always had "no headroom" over it and every pane of glass was scored
   * as a maximally marginal break costing 13% of velocity. Ploughing a soft
   * gauntlet — the exact thing that is supposed to build heat — bled so much
   * speed that terminal velocity was never reached and heat never climbed past
   * 0.3. Multiplying by toughness makes glass free at any temperature, which is
   * what "glass" is supposed to mean.
   */
  marginality(m: Material) {
    if (this.melting) return 0;
    const need = MELT_AT[m];
    if (!isFinite(need)) return 1;
    const toughness = m / 3;
    const headroom = clamp((this.value - need) / 0.35, 0, 1);
    return toughness * (1 - headroom);
  }

  /** Score multiplier. Riding the redline IS the scoring strategy. */
  get mult() {
    const base = lerp(HEAT_MULT_COLD, HEAT_MULT_HOT, this.value);
    return this.melting ? base * MELTDOWN_MULT : base;
  }

  /**
   * Smashing dumps heat into you, scaled by what you just went through.
   *
   * Past the redline that contribution is throttled hard. Otherwise ploughing a
   * dense row rockets you from redline to meltdown in well under a second, the
   * burn never gets time to bite, and the meltdown — which is supposed to be
   * bought with roughly a hull pip — comes out nearly free. The last stretch has
   * to be paid for in dive time, with the hull burning the whole way.
   */
  addBreak(m: Material) {
    if (this.melting) return;
    const gain = HEAT_PER_BREAK * (1 + m * HEAT_PER_BREAK_MAT);
    const throttle = this.value >= HEAT_REDLINE ? 0.3 : 1;
    this.value = clamp(this.value + gain * throttle, 0, 1);
  }

  /**
   * @param speedNorm 0..1 fall speed
   * @param braking   is the air-brake held
   * @returns hull damage to apply this step (0 unless redlining)
   */
  update(dt: number, speedNorm: number, braking: boolean): number {
    this.pulse += dt;
    this.justMelted = false;
    this.justCooled = false;
    this.bandChanged = 0;

    if (this.melting) {
      this.meltT -= dt / MELTDOWN_TIME;
      if (this.meltT <= 0) {
        this.meltT = 0;
        this.melting = false;
        this.justCooled = true;
        // Emerge STILL HOT, just under the redline — not cold. Dumping to zero
        // made the meltdown wipe the danger that earned it, so overheating was
        // free and the whole risk/reward dial went slack.
        this.value = MELTDOWN_END_HEAT;
        this.lastBand = this.band;
      }
      return 0;
    }

    // Quadratic in speed: heating scales with the square of velocity, same shape
    // as the drag that produces it.
    const gain = speedNorm * speedNorm * HEAT_GAIN;
    const vent = HEAT_VENT * (braking ? BRAKE_VENT_MULT : 1);
    this.value = clamp(this.value + (gain - vent) * dt, 0, 1);

    const b = this.band;
    if (b !== this.lastBand) {
      this.bandChanged = b > this.lastBand ? 1 : -1;
      this.lastBand = b;
    }

    if (this.value >= 1) {
      this.trigger();
      return 0;
    }

    if (this.value >= HEAT_REDLINE) {
      return lerp(REDLINE_DPS_MIN, REDLINE_DPS_MAX, this.overload) * dt;
    }
    return 0;
  }

  private trigger() {
    this.melting = true;
    this.meltT = 1;
    this.justMelted = true;
  }
}
