/**
 * Every feel-critical number lives here so tuning is one file, not a scavenger hunt.
 * The jam is won or lost on these values, not on architecture.
 */

// ---------------------------------------------------------------- view
/** The shaft. Gameplay is authored in this space and never changes size. */
export const VIEW_W = 540;
export const VIEW_H = 760;

/**
 * The canvas is full-bleed; the shaft is centred inside it and the leftover
 * width becomes the surround. Letterboxing the shaft into dead black is what
 * made the game read as a squashed strip on a desktop monitor.
 */
export const SURROUND_MIN = 0.06; // keep a sliver of surround even when tight

/** Player sits this far down the screen; the rest is lookahead. */
export const CAM_ANCHOR = 0.36;

// ---------------------------------------------------------------- palette
/**
 * Base ink. Biomes recolour everything on top of this (see `game/biomes.ts`);
 * these are the neutral fallbacks and the colours that never shift.
 */
export const COL = {
  bg: '#06070C',
  fg: '#F4F6FF',
  hot: '#FF2E4C',
  gold: '#FFC53D',
  od: '#FFE27A', // overdrive
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
 *   tuck     -> ~1545 px/s  =  515 km/h  =  tier 8
 *   brake    ->  ~330 px/s  =  110 km/h  =  tier 1
 *
 * The tuck terminal deliberately lands in tier 8, NOT tier 9.
 *
 * It used to sit at 1680 (tier 9), and that single number was why the game was
 * boring: holding W pinned the top tier, the top tier breaks literally
 * everything the generator can emit, and so there was never a block on screen
 * that had to be steered around. The entire premise — "fast enough to break
 * anything means unable to aim" — was never actually tested, because aiming was
 * optional.
 *
 * At tier 8 sustained, hardness-9 blocks are real walls. Tier 9 is reachable
 * only transiently: on the acceleration overshoot out of a gate, or by stacking
 * graze bonuses. That makes the top of the shaft a thing you visit, not a thing
 * you park in.
 */
export const DRAG_NEUTRAL = GRAVITY / (870 * 870);
export const DRAG_TUCK = GRAVITY / (1545 * 1545);
export const DRAG_BRAKE = GRAVITY / (330 * 330);
/** How fast the body changes shape between postures. */
export const DRAG_SHIFT_RATE = 9;

/**
 * Opening speed. This has swung both ways: 130 felt dead, so it went to 300 —
 * and at 300 the first blocks arrived before a new player had read a single
 * thing on screen, which made the whole game feel like being shot into a wall.
 *
 * The fix is not the number, it is what surrounds it: the run now opens with a
 * calibration stretch (soft, sparse blocks — see CALIBRATION_M) and an intro
 * card stating the goal, so a slow launch is spent *learning* rather than
 * waiting. 150 gives roughly three readable seconds before the first choice.
 */
export const V_START = 150;

/**
 * Depth (metres) of the on-ramp. Until here the generator emits only sparse
 * hardness 1-2 blocks — everything is breakable at neutral speed, so the first
 * lesson ("touch a block you outrun, it shatters") teaches itself before the
 * first block that can actually hurt shows up.
 */
export const CALIBRATION_M = 260;

/** Seconds the goal/intro card holds at the start of every run. */
export const INTRO_TIME = 3;
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
export const LAT_ACCEL_FAST = 1050;
export const LAT_MAX_SLOW = 440;
export const LAT_MAX_FAST = 170;
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
/**
 * At 0.9 a marginal break barely dented momentum, drag restored it inside a
 * third of a second, and ploughing had no downside. The cost has to be steep
 * enough that a run of hard breaks visibly drops you a tier — that drop is what
 * turns the world red again and forces the player back to steering.
 */
export const BREAK_KEEP_HARD = 0.84;
/** Fraction retained when you bounce off something too hard. */
export const BOUNCE_SPEED_KEEP = 0.45;
/** Upward kick on a failed impact, px/s. */
export const BOUNCE_KICK = 260;
/** Seconds of invulnerability after taking a hit. */
export const IFRAME_TIME = 0.9;

/**
 * Four, not three. Measured runs were ending at 13-16 seconds, which is too
 * short to reach the second zone, see overdrive more than once, or feel like a
 * run at all — a score-attack game needs long enough for a story to develop.
 */
export const MAX_HEALTH = 4;

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
export const RAMP_DEPTH = 3600;

/**
 * Hardness ramps on its own, much shorter curve. Sharing the density ramp meant
 * blocks only reached 6 by the depth a good run ends, while the player sits at
 * tier 7-9 — so nothing on screen was ever red and the threat never materialised.
 * Hardness has to outrun reachable tier early for the world to recolour at all.
 */
export const HARD_RAMP_DEPTH = 2400;

/** Fraction of columns filled, at the start and at full intensity. */
export const DENSITY_START = 0.5;
export const DENSITY_END = 0.68;

/** A full-width skill-check wall every this many metres. */
export const GATE_EVERY_M = 500;

// ---------------------------------------------------------------- zones
/**
 * The shaft changes character every ZONE_DEPTH metres. Purely presentational,
 * but it is what converts "a number going up" into "somewhere I am travelling
 * to" — the run now has chapters, and each one announces itself.
 */
export const ZONE_DEPTH = 700;
/** Seconds the zone name card stays up. */
export const ZONE_CARD_TIME = 2.5;

// ---------------------------------------------------------------- player
export const PLAYER_R = 11;

// ---------------------------------------------------------------- scoring
/** Near-miss distance, in px, that counts as a GRAZE. */
export const GRAZE_DIST = 18;
/** Chain length that refunds a health pip. */
export const CHAIN_HEAL_AT = 10;
/**
 * Seconds without a break before the chain lapses. Rows arrive every 0.1-0.6s at
 * speed, so this has to be tight: at 2.6s the chain never lapsed and simply
 * counted run length. Under a second, threading empty air costs you the combo,
 * which is what makes smashing a choice rather than a side effect.
 */
export const CHAIN_TIMEOUT = 0.7;
/**
 * Braking drops the chain. Without this the safe play (brake, weave, never risk
 * an impact) also keeps the combo, and there is no decision left in the game.
 * The grace window stops a reflexive tap from erasing a long run.
 */
export const BRAKE_CHAIN_GRACE = 0.16;
/**
 * Multiplier ceiling, so a long run can't run the score away from a sharp one.
 * Measured chains were reaching 65-80, so a cap of 25 was being pinned within
 * seconds and the multiplier stopped being a thing you played for.
 */
export const CHAIN_MULT_CAP = 15;
/** Threading a near-miss rewards a small speed kick, px/s. */
export const GRAZE_SPEED_BONUS = 26;

export const SCORE_PER_BREAK = 10;
export const SCORE_PER_GRAZE = 15;

// ---------------------------------------------------------------- overdrive
/**
 * The payoff the game was missing. Breaks and grazes charge a meter; when it
 * fills you get a short window where hardness stops mattering entirely and you
 * plough the shaft. Previously the reward for a long chain was a bigger number
 * and nothing else — no moment, no release, nothing to chase.
 *
 * It is deliberately generous to trigger and short to hold: the loop is
 * charge -> unleash -> lose it -> chase it again, several times a run.
 */
export const OD_CHARGE_PER_BREAK = 0.075;
export const OD_CHARGE_PER_GRAZE = 0.04;
/** Overdrive charge is spent, not decayed — but a lapsed chain bleeds it. */
export const OD_BLEED_ON_CHAIN_LOSS = 0.25;
/**
 * Charge does not accrue while overdrive is running, so its duration eats into
 * the next fill. At 4.6s over a ~17s run that left room for exactly one trigger
 * per run; 4.0s plus a faster fill lands on two, which is what makes it read as
 * a rhythm rather than a one-off.
 */
export const OD_TIME = 4;
/** Score multiplier while overdriven, on top of the chain multiplier. */
export const OD_SCORE_MULT = 2;
/** Extra downward pull during overdrive, px/s^2 — you accelerate through it. */
export const OD_GRAVITY_BONUS = 520;
