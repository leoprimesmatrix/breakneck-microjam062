/**
 * AFTERBURN — every tunable in one place.
 *
 * The design in one sentence: you cannot walk, you cannot shoot, you can only
 * *strike* — a blinding straight-line burst that kills whatever it passes
 * through. Holding the button to aim slows the world down, so the player always
 * sets the tempo. Speed is the only weapon, and thinking time is the only fuel.
 */

// ----------------------------------------------------------------- arena
/**
 * Arena AREA is constant; only its aspect follows the window. Holding area
 * fixed is what keeps a wave that is tuned on a laptop still tuned on an
 * ultrawide — enemy counts, travel times and spawn density are all authored
 * against a fixed amount of floor.
 */
export const ARENA_AREA = 1240 * 720;
export const ARENA_ASPECT_MIN = 0.62;
export const ARENA_ASPECT_MAX = 1.95;

/** Player radius in arena units. Everything else is sized against this. */
export const PLAYER_R = 15;

// ----------------------------------------------------------------- strike
/** Peak speed of a strike, arena units per second. Deliberately absurd. */
export const STRIKE_SPEED = 3050;
/** Base distance of one strike. */
export const STRIKE_RANGE = 430;
/** Each kill mid-strike buys this much extra travel — chains carry you. */
export const STRIKE_RANGE_PER_KILL = 116;
/** Hard ceiling so a huge chain cannot loop the arena forever. */
export const STRIKE_RANGE_MAX = 1500;
/** Minimum gap between strikes. Just enough that a mash reads as two strikes. */
export const STRIKE_COOLDOWN = 0.09;
/** Speed retained the instant a strike ends. The drift afterwards is the risk. */
export const DRIFT_KEEP = 0.16;
/** Exponential drag applied to drift. Higher = you stop sooner. */
export const DRIFT_DRAG = 3.4;

// ------------------------------------------------------------------ focus
/**
 * FOCUS is the slow-motion fuel. Aiming spends it, killing refills it. That
 * single exchange is the whole economy: the game gives you thinking time only
 * in return for aggression, so camping and panicking cost the same thing.
 */
export const FOCUS_MAX = 100;
export const FOCUS_DRAIN = 46; // per second of aiming
export const FOCUS_REGEN = 9; // per second while not aiming
export const FOCUS_PER_KILL = 22;
export const FOCUS_WAVE_REFILL = 55;

/** Time scale while aiming with focus left, and once it has run dry. */
export const AIM_TIMESCALE = 0.11;
export const AIM_TIMESCALE_DRY = 0.62;
/** Seconds to ease between time scales. Snapping is what makes slow-mo cheap. */
export const TIMESCALE_EASE = 0.085;

// ------------------------------------------------------------------- hull
export const MAX_HULL = 3;
export const IFRAME_TIME = 1.25;
/** Knockback speed applied away from whatever hit you. */
export const HURT_KNOCKBACK = 620;

// ------------------------------------------------------------------ score
export const SCORE_PER_KILL = 100;
export const COMBO_TIMEOUT = 3.0;
export const COMBO_CAP = 30;
export const WAVE_CLEAR_BONUS = 250;

// ------------------------------------------------------------- presentation
export const SPAWN_TELEGRAPH = 0.9;
export const WAVE_CARD_TIME = 2.1;
export const WAVE_BREATHER = 1.5;
export const HINT_CARD_TIME = 3.4;

/**
 * Multi-kill names. Index = kills in a single strike, minus two.
 * Naming the payoff is most of what makes a player chase it again.
 */
export const MULTI_NAMES = [
  'DOUBLE',
  'TRIPLE',
  'QUAD',
  'RAMPAGE',
  'SLAUGHTER',
  'ANNIHILATION',
  'IMPOSSIBLE',
];

// ------------------------------------------------------------------ colour
/**
 * A tight palette, authored as [r,g,b] so everything can be alpha-blended and
 * additively composited without string parsing in the hot loop.
 *
 * The rule that holds it together: **you are the only cold light in a warm,
 * hostile room.** Everything player-side — ship, strike, focus, hull — is ice.
 * Every enemy sits in one warm family, ember through violet. The environment
 * is near-monochrome graphite so the actors own all of the saturation. One
 * glance at any frame answers the only question that matters: cold kills warm.
 *
 * (Earlier drafts had a cyan mote — the most common enemy wearing the player's
 * own colour — and a green seeder that belonged to nothing. If a colour cannot
 * say whose side it is on, it does not get to be saturated.)
 */
export type RGB = readonly [number, number, number];

export const COL = {
  void: [6, 7, 11] as RGB,
  floor: [13, 15, 22] as RGB,
  grid: [42, 52, 76] as RGB,
  gridHot: [86, 118, 172] as RGB,
  wall: [132, 158, 198] as RGB,

  player: [126, 230, 255] as RGB,
  playerCore: [244, 251, 255] as RGB,
  strike: [156, 240, 255] as RGB,

  focus: [96, 214, 250] as RGB,
  hull: [122, 240, 198] as RGB,
  danger: [255, 74, 92] as RGB,
  warn: [255, 178, 74] as RGB,

  mote: [255, 154, 92] as RGB,
  seeder: [255, 108, 176] as RGB,
  ward: [186, 126, 255] as RGB,
  lancer: [255, 86, 64] as RGB,
  spine: [255, 208, 96] as RGB,

  ink: [232, 240, 250] as RGB,
  dim: [124, 138, 164] as RGB,
} as const;

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
