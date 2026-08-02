import type { RGB } from '../config';
import { COL } from '../config';

/**
 * Impact feedback: freeze frames, shake, flashes, lens punch.
 *
 * Deliberately isolated from the simulation — nothing in here can change an
 * outcome, which means it can be tuned to the edge of tasteless without any
 * risk of making the game unfair.
 */
export class Juice {
  /** Seconds of frozen simulation remaining. */
  hitstop = 0;
  /** Current shake magnitude in arena units. */
  shake = 0;
  /** Directional kick, decays independently of the random shake. */
  kickX = 0;
  kickY = 0;
  /** 0..1 screen flash, with its own colour. */
  flash = 0;
  flashCol: RGB = COL.ink;
  /** Seconds of slow motion remaining (independent of aim-time dilation). */
  slowmo = 0;
  /** Lens zoom kick as a fraction of 1. */
  punch = 0;
  /** Extra chromatic aberration on top of the speed-driven amount. */
  fringe = 0;

  private seed = Math.random() * 1000;
  private t = 0;

  reset() {
    this.hitstop = 0;
    this.shake = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.flash = 0;
    this.slowmo = 0;
    this.punch = 0;
    this.fringe = 0;
  }

  addHitstop(s: number) {
    if (s > this.hitstop) this.hitstop = s;
  }

  addShake(m: number) {
    if (m > this.shake) this.shake = m;
  }

  addKick(dx: number, dy: number, m: number) {
    this.kickX += dx * m;
    this.kickY += dy * m;
  }

  addFlash(a: number, col: RGB = COL.ink) {
    if (a > this.flash) {
      this.flash = a;
      this.flashCol = col;
    }
  }

  addSlowmo(s: number) {
    if (s > this.slowmo) this.slowmo = s;
  }

  addPunch(a: number) {
    if (a > this.punch) this.punch = a;
  }

  addFringe(a: number) {
    if (a > this.fringe) this.fringe = a;
  }

  /** Multiplier applied to sim time by *impact* slow motion. */
  get slowScale() {
    return this.slowmo > 0 ? 0.26 : 1;
  }

  update(dtReal: number) {
    this.t += dtReal;
    if (this.slowmo > 0) this.slowmo -= dtReal;

    this.shake *= Math.exp(-10 * dtReal);
    if (this.shake < 0.04) this.shake = 0;

    const k = Math.exp(-13 * dtReal);
    this.kickX *= k;
    this.kickY *= k;

    this.flash *= Math.exp(-15 * dtReal);
    if (this.flash < 0.004) this.flash = 0;

    this.punch *= Math.exp(-12 * dtReal);
    if (this.punch < 0.0004) this.punch = 0;

    this.fringe *= Math.exp(-8 * dtReal);
    if (this.fringe < 0.002) this.fringe = 0;
  }

  consumeHitstop(dtReal: number) {
    if (this.hitstop <= 0) return false;
    this.hitstop -= dtReal;
    return true;
  }

  offsetX() {
    return this.shake === 0 && this.kickX === 0
      ? 0
      : Math.sin(this.t * 91 + this.seed) * this.shake + this.kickX;
  }

  offsetY() {
    return this.shake === 0 && this.kickY === 0
      ? 0
      : Math.cos(this.t * 107 + this.seed * 1.7) * this.shake + this.kickY;
  }
}
