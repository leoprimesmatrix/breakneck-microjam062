/**
 * Every feel-critical number lives here so tuning is one file, not a scavenger hunt.
 * The jam is won or lost on these values, not on architecture.
 *
 * Playfield dimensions are NOT here — they are runtime values that depend on the
 * window, and live in `viewport.ts`.
 */

/** Player sits this far down the screen; the rest is lookahead. */
export const CAM_ANCHOR = 0.36;

// ---------------------------------------------------------------- palette
export const COL = {
  bg: '#06070C',
  fg: '#F4F6FF',
  hot: '#FF2E4C',
  /** The one molten colour. Previously redeclared in five places, two variants. */
  molten: [255, 214, 96],
} as const;

// ---------------------------------------------------------------- vertical physics
/** World units are pixels; 10px == 1 metre of depth. */
export const PX_PER_M = 10;

export const GRAVITY = 900; // px/s^2

/**
 * Speed is governed by DRAG, not thrust. Posture changes your frontal area the
 * way a skydiver's does, and terminal velocity falls out of `sqrt(g / k)`.
 *
 *   neutral  ->  ~870 px/s
 *   tuck     -> ~1545 px/s
 *   brake    ->  ~330 px/s
 *
 * These sit deliberately either side of the heat equilibrium (~827 px/s): a
 * neutral fall drifts slowly hotter, a tuck cooks you, the air-brake dumps heat.
 * Posture IS the thermostat.
 */
export const DRAG_NEUTRAL = GRAVITY / (870 * 870);
export const DRAG_TUCK = GRAVITY / (1545 * 1545);
export const DRAG_BRAKE = GRAVITY / (330 * 330);
/** How fast the body changes shape between postures. */
export const DRAG_SHIFT_RATE = 9;

export const V_START = 150;
export const V_MAX = 1850; // hard ceiling; drag normally settles well below it
/** Bounces are allowed to throw you upward; gravity always wins it back. */
export const V_BOUNCE_CAP = -540;

/** vy (px/s) -> km/h. Flavour readout only — it no longer decides anything. */
export const KMH_PER_PX = 1 / 3;

// ---------------------------------------------------------------- heat
/**
 * THE mechanic. One resource with three jobs:
 *
 *   1. it is your weapon      — heat melts material, nothing else does
 *   2. it is your score rate  — the multiplier rides the same dial
 *   3. it is what kills you   — past the redline it burns through the hull
 *
 * This replaces the old speed-tier-versus-hardness-digit comparison, which asked
 * the player to do arithmetic at 600 km/h and so was simply ignored — leaving
 * "hold W" strictly optimal. Heat has a *continuous cost*, so max speed is no
 * longer free, and the moment-to-moment question becomes "how long dare I stay
 * hot?" instead of nothing at all.
 */

/** Heat gained per second at full speed. Quadratic in speed, like real drag heating. */
export const HEAT_GAIN = 0.3;
/**
 * Passive bleed per second, always on.
 *
 * This value places the thermal equilibrium, and the placement is the single
 * most important number in the game. gain = vent at speedNorm ~0.62, which sits
 * ABOVE the neutral-posture terminal (0.47) and below the tuck terminal (0.83).
 *
 * That ordering is deliberate and load-bearing: a player who does nothing now
 * *cools*, goes cold, cannot melt anything, and bounces off the first real
 * barrier. Heat has to be actively dived for. At the first tuning pass the
 * equilibrium sat just under neutral, so a bot pressing no keys at all drifted
 * to full heat and outran a bot holding the dive — which is the same "the game
 * plays itself" failure the redesign existed to remove.
 */
export const HEAT_VENT = 0.115;
/** Braking vents hard — it is the deliberate cooling action. */
export const BRAKE_VENT_MULT = 3.5;

/**
 * Smashing generates heat. This is the keystone of the whole redesign: ploughing
 * through material is what drives you into the redline, so the "hold W and break
 * everything" strategy now actively cooks the player who uses it.
 */
export const HEAT_PER_BREAK = 0.018;
/** Tougher material dumps proportionally more heat into you. */
export const HEAT_PER_BREAK_MAT = 0.5;

/** Above this, the hull burns. */
export const HEAT_REDLINE = 0.82;
/**
 * Hull pips per second lost in the redline. Climbing from the redline to a
 * meltdown takes ~2s of diving, so at these rates a meltdown costs roughly one
 * hull pip — it is bought, not found.
 */
export const REDLINE_DPS_MIN = 1.1;
export const REDLINE_DPS_MAX = 2.4;

/** Meltdown: heat hits 1.0. Melts anything, cannot be hurt. */
export const MELTDOWN_TIME = 3.2;
/**
 * Heat left when a meltdown ends — just below the redline, NOT zero.
 *
 * Dumping to zero made overheating strictly free: the meltdown was a reward for
 * hitting the ceiling and it wiped the danger on the way out, so the optimal
 * line was to cook constantly and never think. Emerging still hot means the
 * decision — dive back through the redline for another one, or vent and cool —
 * lands immediately and repeatedly.
 */
export const MELTDOWN_END_HEAT = 0.45;
/** Extra downward pull during meltdown — you accelerate through it. */
export const MELTDOWN_GRAVITY = 520;

/**
 * Score multiplier at zero heat and at full heat. Risk and reward, one dial.
 * Kept modest because it compounds with the chain — at 4x heat against a 15x
 * chain the product was 60 and a single good run scored six figures.
 */
export const HEAT_MULT_COLD = 1;
export const HEAT_MULT_HOT = 2;
/**
 * Meltdown multiplies on top of that — but only slightly.
 *
 * At 2x it compounded with heat (2.5) and chain (8) to 40x per break, while a
 * meltdown also removes every reason to stop breaking. One lucky meltdown was
 * worth five times an entire careful run, so score measured luck rather than
 * skill. The meltdown's real reward is the four seconds of invulnerability and
 * the CORE walls it opens, not a scoring windfall.
 */
export const MELTDOWN_MULT = 1.3;

// ---------------------------------------------------------------- materials
/**
 * Barriers are made of something, not labelled with a number. Material is read
 * from silhouette and opacity in peripheral vision — no focusing, no comparing,
 * no arithmetic. That is the entire point.
 */
export type Material = 0 | 1 | 2 | 3;
export const GLASS: Material = 0;
export const GRATE: Material = 1;
export const PLATE: Material = 2;
export const CORE: Material = 3;

/** Heat at which each material starts to melt. CORE needs a full meltdown. */
export const MELT_AT: readonly number[] = [0, 0.25, 0.55, Infinity];

export const MATERIAL_NAME = ['GLASS', 'GRATE', 'PLATE', 'CORE'] as const;

/** Heat band names, aligned to the thresholds that unlock each material. */
export const BANDS = [
  { at: 0, name: 'COOL' },
  { at: 0.25, name: 'WARM' },
  { at: 0.55, name: 'HOT' },
  { at: HEAT_REDLINE, name: 'SEARING' },
] as const;

// ---------------------------------------------------------------- lateral control
/**
 * Authored in LANES per second, not pixels — see `viewport.ts`. The field is
 * 7 lanes wide on a phone and 26 on a monitor; what has to stay constant is how
 * fast you reach the *next* lane, because dodging is always a local decision.
 *
 * Authority still decays with speed: fast enough to melt anything means barely
 * able to aim.
 */
export const LAT_LANES_SLOW = 7.3;
export const LAT_LANES_FAST = 2.8;
export const LAT_ACCEL_LANES_SLOW = 60;
export const LAT_ACCEL_LANES_FAST = 17.5;
/** Exponential damping applied to lateral velocity each second. */
export const LAT_DAMP = 7.5;

// ---------------------------------------------------------------- impacts
/**
 * Speed retained on a break, by how tough the material was relative to your heat.
 * Melting GLASS while searing is nearly free — that is the power fantasy.
 * Melting PLATE the instant you can costs real momentum — that is the tension.
 */
export const BREAK_KEEP_EASY = 0.995;
export const BREAK_KEEP_HARD = 0.84;
/** Fraction of speed retained when you bounce off something you cannot melt. */
export const BOUNCE_SPEED_KEEP = 0.3;
/** Floor so a bounce never stalls you; you keep falling, just slowly. */
export const BOUNCE_MIN_VY = 180;
/**
 * Seconds of invulnerability after taking a hit. This is the only window in
 * which a run can be rebuilt, so it has to be long enough to actually
 * re-accelerate — at 0.9s the player was still slow when it expired and simply
 * bounced again.
 */
export const IFRAME_TIME = 1.1;

export const MAX_HEALTH = 4;

// ---------------------------------------------------------------- world grid
/**
 * Row height. Raised from 46: with lanes widening to ~90 units on a desktop,
 * a 46-tall barrier is a 2:1 sliver and adjacent ones merge into a single
 * featureless band. Taller blocks keep the material signatures legible.
 */
export const CELL_H = 58;

/** Vertical gap between generated rows, eased down as the run gets deeper. */
export const ROW_GAP_START = 132;
export const ROW_GAP_END = 98;
/** Depth (metres) at which the generator reaches full density. */
export const RAMP_DEPTH = 3600;
/** Material toughness ramps on its own, shorter curve. */
export const MATERIAL_RAMP_DEPTH = 2400;

/** Fraction of columns filled, at the start and at full intensity. */
export const DENSITY_START = 0.5;
export const DENSITY_END = 0.68;

/** A full-width CORE wall every this many metres. Meltdown or bust. */
export const GATE_EVERY_M = 500;

/**
 * Depth of the on-ramp. Until here the generator emits only sparse GLASS, so the
 * first thing a new player does is melt something by accident and get the whole
 * premise for free.
 */
export const CALIBRATION_M = 260;

/** Seconds the goal card holds at the start of every run. */
export const INTRO_TIME = 3;

// ---------------------------------------------------------------- zones
export const ZONE_DEPTH = 700;
export const ZONE_CARD_TIME = 2.5;

// ---------------------------------------------------------------- player
// Ship radius is NOT here — it scales with lane width so the ship occupies the
// same share of a lane at 7 lanes and at 14. See `view.playerR` in viewport.ts.

// ---------------------------------------------------------------- scoring
/**
 * Chain length that repairs a hull pip. Raised from 10: with the redline now
 * bleeding hull continuously, healing every ten breaks refunded the burn faster
 * than it could be spent and the redline stopped costing anything.
 */
export const CHAIN_HEAL_AT = 16;
/**
 * Seconds without a break before the chain lapses.
 *
 * Note that braking no longer forfeits the chain outright. It used to, back when
 * the brake was purely a safety button that needed a cost attached. Venting is
 * now the brake's real job, and it already costs you heat — which is both your
 * melting power and your multiplier. Charging the chain on top of that made
 * venting strictly dominated, and a bot that never vented outscored one that did
 * by eight to one.
 */
export const CHAIN_TIMEOUT = 0.7;
/** Multiplier ceiling, so a long run can't run away from a sharp one. */
export const CHAIN_MULT_CAP = 6;

export const SCORE_PER_BREAK = 14;
