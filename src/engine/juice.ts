import type { RGB } from '../config';
import { COL } from '../config';
import { clamp01 } from './math';

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
  /** What the largest live request asked for, which sets how deep it goes. */
  private slowPeak = 0;
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
    this.slowPeak = 0;
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
    if (s > this.slowmo) {
      this.slowmo = s;
      this.slowPeak = s;
    }
  }

  /**
   * Impacts landing in the same frame should add up rather than shout over
   * each other.
   *
   * `addHitstop` takes the max, which is right when two unrelated things
   * happen at once — but a strike travelling 3050 units per second puts
   * several kills inside one 8ms step, and taking the max meant five
   * simultaneous kills froze the game for exactly as long as one did. The
   * biggest moment in the game was landing as its smallest.
   */
  stackHitstop(s: number, cap: number) {
    this.hitstop = Math.min(cap, this.hitstop + s);
  }

  addPunch(a: number) {
    if (a > this.punch) this.punch = a;
  }

  addFringe(a: number) {
    if (a > this.fringe) this.fringe = a;
  }

  /**
   * Multiplier applied to sim time by *impact* slow motion.
   *
   * This used to return a flat 0.26 for any non-zero `slowmo`, which made the
   * field a boolean wearing a number: a double kill and a five-kill rampage
   * dropped into identical slow motion and differed only in how long they
   * stayed there. Now the depth scales with how big the moment was, and the
   * tail eases back to real time instead of snapping, so the exit from a
   * rampage feels like a release rather than a cut.
   */
  get slowScale() {
    if (this.slowmo <= 0) return 1;
    const depth = clamp01(this.slowPeak / 0.5);
    const floor = 0.42 - depth * 0.24;
    const k = clamp01(this.slowmo / Math.max(0.001, this.slowPeak));
    return 1 + (floor - 1) * k;
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
