/**
 * Every feel-critical number lives here so tuning is one file, not a scavenger hunt.
 * The jam is won or lost on these values, not on architecture.
 */

// ---------------------------------------------------------------- view
export const VIEW_W = 540;
export const VIEW_H = 760;

/** Player sits this far down the screen; the rest is lookahead. */
export const CAM_ANCHOR = 0.34;

// ---------------------------------------------------------------- palette
export const COL = {
  bg: '#0B0B0F',
  fg: '#F2F2F0',
  hot: '#FF2E4C',
  gold: '#FFD23F',
} as const;

// ---------------------------------------------------------------- vertical physics
/** World units are pixels; 10px == 1 metre of depth. */
export const PX_PER_M = 10;

export const GRAVITY = 900; // px/s^2

/**
 * Speed is governed by DRAG, not thrust. Posture changes your frontal area the
 * way a skydiver's does, and terminal velocity falls out of `sqrt(g / k)`.
 *
 * This is what stops the game playing itself. With no drag you pin the top tier
 * in two seconds of doing nothing; with drag, every tier above neutral has to be
 * earned by holding a tuck — which is exactly when you can barely steer.
 *
 *   neutral  ->  ~870 px/s  =  290 km/h  =  tier 4
 *   tuck     -> ~1680 px/s  =  560 km/h  =  tier 9
 *   brake    ->  ~330 px/s  =  110 km/h  =  tier 1
 *
 * The tuck terminal sits just *past* the tier-9 threshold rather than on it:
 * velocity approaches terminal asymptotically, so a value of exactly 540 would
 * leave the top tier forever a hair out of reach. Tier 9 is now a razor's edge —
 * reachable at full commitment, and lost the moment you break anything.
 */
export const DRAG_NEUTRAL = GRAVITY / (870 * 870);
export const DRAG_TUCK = GRAVITY / (1680 * 1680);
export const DRAG_BRAKE = GRAVITY / (330 * 330);
/** How fast the body changes shape between postures. */
export const DRAG_SHIFT_RATE = 9;

export const V_START = 130; // opening speed
export const V_MAX = 1850; // hard ceiling; drag normally settles well below it
/** Bounces are allowed to throw you upward; gravity always wins it back. */
export const V_BOUNCE_CAP = -540;

/** vy (px/s) -> km/h on the HUD. Tuned so V_MAX reads a bit over 600 km/h. */
export const KMH_PER_PX = 1 / 3;

/**
 * Hardness tiers. tier = clamp(floor(kmh / KMH_PER_TIER), 1, 9)
 * A block breaks when tier >= hardness, so the speed readout *is* the damage number.
 */
export const KMH_PER_TIER = 60;
export const MAX_TIER = 9;

// ---------------------------------------------------------------- lateral control
/**
 * THE core mechanic: steering authority decays as speed rises.
 * Fast enough to break anything == barely able to aim.
 */
export const LAT_ACCEL_SLOW = 3600;
export const LAT_ACCEL_FAST = 950;
export const LAT_MAX_SLOW = 440;
export const LAT_MAX_FAST = 155;
/** Exponential damping applied to lateral velocity each second. */
export const LAT_DAMP = 7.5;

// ---------------------------------------------------------------- impacts
/**
 * Speed retained on a break, scaled by how marginal the break was.
 * Smashing a 1 at tier 9 is nearly free — that's the power fantasy. Smashing a 9
 * at tier 9 costs real momentum — that's the tension. A single flat cost gave
 * neither, and made high density mathematically unsurvivable.
 */
export const BREAK_KEEP_EASY = 0.995; // hardness far below your tier
export const BREAK_KEEP_HARD = 0.9; // hardness right at your tier
/** Fraction retained when you bounce off something too hard. */
export const BOUNCE_SPEED_KEEP = 0.45;
/** Upward kick on a failed impact, px/s. */
export const BOUNCE_KICK = 260;
/** Seconds of invulnerability after taking a hit. */
export const IFRAME_TIME = 0.9;

export const MAX_HEALTH = 3;

// ---------------------------------------------------------------- world grid
export const COLS = 9;
export const CELL_W = VIEW_W / COLS; // 60
export const CELL_H = 46;

/** Vertical gap between generated rows, eased down as the run gets deeper. */
export const ROW_GAP_START = 132;
export const ROW_GAP_END = 98;
/**
 * Depth (metres) at which the generator reaches full intensity.
 * A strong run reaches ~3200m, so ramping over 5200 meant the player never met
 * the hard content at all: at 1000m everything was still hardness 1-3 and
 * nothing on screen was ever red.
 */
export const RAMP_DEPTH = 3000;

/**
 * Hardness ramps on its own, much shorter curve. Sharing the density ramp meant
 * blocks only reached 6 by the depth a good run ends, while the player sits at
 * tier 7-9 — so nothing on screen was ever red and the threat never materialised.
 * Hardness has to outrun reachable tier early for the world to recolour at all.
 */
export const HARD_RAMP_DEPTH = 1800;

/** Fraction of columns filled, at the start and at full intensity. */
export const DENSITY_START = 0.5;
export const DENSITY_END = 0.68;

/** A full-width skill-check wall every this many metres. */
export const GATE_EVERY_M = 500;

// ---------------------------------------------------------------- player
export const PLAYER_R = 11;

// ---------------------------------------------------------------- scoring
/** Near-miss distance, in px, that counts as a GRAZE. */
export const GRAZE_DIST = 16;
/** Chain length that refunds a health pip. */
export const CHAIN_HEAL_AT = 10;
/**
 * Seconds without a break before the chain lapses. Rows arrive every 0.1-0.6s at
 * speed, so this has to be tight: at 2.6s the chain never lapsed and simply
 * counted run length. Under a second, threading empty air costs you the combo,
 * which is what makes smashing a choice rather than a side effect.
 */
export const CHAIN_TIMEOUT = 0.85;
/**
 * Braking drops the chain. Without this the safe play (brake, weave, never risk
 * an impact) also keeps the combo, and there is no decision left in the game.
 * The grace window stops a reflexive tap from erasing a long run.
 */
export const BRAKE_CHAIN_GRACE = 0.16;
/** Multiplier ceiling, so a long run can't run the score away from a sharp one. */
export const CHAIN_MULT_CAP = 25;
/** Threading a near-miss rewards a small speed kick, px/s. */
export const GRAZE_SPEED_BONUS = 26;

export const SCORE_PER_BREAK = 10;
export const SCORE_PER_GRAZE = 15;
