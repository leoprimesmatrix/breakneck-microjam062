export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Easing curves. Everything on screen that moves uses one of these. */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - clamp01(t), 5);
export const easeOutExpo = (t: number) =>
  t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t));

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Frame-rate independent approach that respects angle wrap-around. */
export function dampAngle(current: number, target: number, rate: number, dt: number) {
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}

/** Small, fast, seedable PRNG (mulberry32) so runs can be reproduced while tuning. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const randRange = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

