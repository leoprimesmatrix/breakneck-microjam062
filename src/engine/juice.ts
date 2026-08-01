/**
 * Impact feedback: freeze frames, screenshake, flashes, slow motion.
 * Kept separate from the sim so effects can never change gameplay outcomes.
 */
export class Juice {
  /** Seconds of frozen simulation remaining. */
  hitstop = 0;
  /** Current shake magnitude in px. */
  shake = 0;
  /** 0..1 white-out. */
  flash = 0;
  /** Seconds of slow motion remaining. */
  slowmo = 0;

  private shakeSeed = Math.random() * 1000;
  private t = 0;

  reset() {
    this.hitstop = 0;
    this.shake = 0;
    this.flash = 0;
    this.slowmo = 0;
  }

  addHitstop(seconds: number) {
    if (seconds > this.hitstop) this.hitstop = seconds;
  }

  addShake(magnitude: number) {
    if (magnitude > this.shake) this.shake = magnitude;
  }

  addFlash(amount: number) {
    if (amount > this.flash) this.flash = amount;
  }

  addSlowmo(seconds: number) {
    if (seconds > this.slowmo) this.slowmo = seconds;
  }

  /** Multiplier applied to sim dt. */
  get timeScale() {
    return this.slowmo > 0 ? 0.3 : 1;
  }

  /** Advances effect timers on real (unscaled) time. */
  update(dtReal: number) {
    this.t += dtReal;
    if (this.slowmo > 0) this.slowmo -= dtReal;
    // Shake and flash decay fast; a long tail reads as mushy rather than punchy.
    this.shake *= Math.exp(-11 * dtReal);
    if (this.shake < 0.05) this.shake = 0;
    // Flash decays hard: a full-screen wash on a 3-colour palette has to be a
    // 2-3 frame punctuation mark, never a tint the art has to live underneath.
    this.flash *= Math.exp(-26 * dtReal);
    if (this.flash < 0.004) this.flash = 0;
  }

  /** Consume frozen time; returns true if the sim should be skipped this step. */
  consumeHitstop(dtReal: number) {
    if (this.hitstop <= 0) return false;
    this.hitstop -= dtReal;
    return true;
  }

  offsetX() {
    if (this.shake === 0) return 0;
    return Math.sin(this.t * 97 + this.shakeSeed) * this.shake;
  }

  offsetY() {
    if (this.shake === 0) return 0;
    return Math.cos(this.t * 113 + this.shakeSeed * 1.7) * this.shake;
  }
}
