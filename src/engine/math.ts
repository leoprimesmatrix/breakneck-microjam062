export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Normalised 0..1 position of v between a and b, clamped. */
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);

export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

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

export const randRange = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);

export const randInt = (rng: () => number, lo: number, hi: number) =>
  Math.floor(lo + rng() * (hi - lo + 1));
