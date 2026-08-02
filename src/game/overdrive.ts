import {
  OD_BLEED_ON_CHAIN_LOSS,
  OD_CHARGE_PER_BREAK,
  OD_CHARGE_PER_GRAZE,
  OD_TIME,
} from '../config';
import { clamp } from '../engine/math';

/**
 * The payoff.
 *
 * The original loop had no release: a long chain paid out a larger number and
 * nothing else, so there was no moment to chase and no reason to take the risky
 * line. Overdrive converts accumulated skill into a few seconds of pure power —
 * hardness stops mattering, you cannot be hurt, and the whole screen agrees with
 * you about it.
 *
 * The economy is deliberately fast: roughly eighteen breaks to fill, spent in
 * under five seconds. Charge → unleash → lose it → chase it again, several
 * times per run, is a much stronger hook than one climactic combo per run.
 */
export class Overdrive {
  /** 0..1 — fills from breaks and grazes. */
  charge = 0;
  active = false;
  /** 1 at trigger, ramping to 0; drives both duration and effect intensity. */
  t = 0;
  /** Free-running phase for pulsing visuals, never reset mid-run. */
  pulse = 0;

  /** Set for the step in which the state changed, consumed by the renderer/audio. */
  justTriggered = false;
  justEnded = false;

  reset() {
    this.charge = 0;
    this.active = false;
    this.t = 0;
    this.justTriggered = false;
    this.justEnded = false;
  }

  /** Intensity 0..1 for effects: rises fast on trigger, falls off as it drains. */
  get intensity() {
    if (!this.active) return 0;
    // Punch in over the first 12% so the trigger frame is the loudest one.
    return this.t > 0.88 ? (1 - this.t) / 0.12 : this.t / 0.88;
  }

  addBreak() {
    if (!this.active) this.charge = clamp(this.charge + OD_CHARGE_PER_BREAK, 0, 1);
  }

  addGraze() {
    if (!this.active) this.charge = clamp(this.charge + OD_CHARGE_PER_GRAZE, 0, 1);
  }

  /** A lapsed or forfeited chain bleeds the meter — holding it has to cost. */
  onChainLost() {
    if (!this.active) this.charge = clamp(this.charge - OD_BLEED_ON_CHAIN_LOSS, 0, 1);
  }

  /** True if the meter is full and overdrive is not already running. */
  get ready() {
    return !this.active && this.charge >= 1;
  }

  trigger() {
    if (this.active) return false;
    this.active = true;
    this.t = 1;
    this.charge = 0;
    this.justTriggered = true;
    return true;
  }

  update(dt: number) {
    this.pulse += dt;
    this.justTriggered = false;
    this.justEnded = false;
    if (!this.active) return;

    this.t -= dt / OD_TIME;
    if (this.t <= 0) {
      this.t = 0;
      this.active = false;
      this.justEnded = true;
    }
  }
}
