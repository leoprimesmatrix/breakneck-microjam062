import { clamp } from './engine/math';

/**
 * The playfield fills the entire canvas. There is no shaft, no surround, no
 * letterbox — the game *is* the window.
 *
 * The hard constraint for a vertical faller is that **vertical lookahead must be
 * constant**. Visible depth is reaction time: at 1500 px/s, seeing 760 units
 * ahead is half a second to react, and seeing 400 is a quarter. Scale to fit the
 * width and a widescreen monitor gets less than half the reaction time of a
 * phone, which is not a different layout — it is a different, unplayable game.
 *
 * So: scale by HEIGHT, and let leftover width become more lanes.
 *
 *   scale    = viewportH / LOGICAL_H       // lookahead pinned
 *   logicalW = viewportW / scale           // varies with aspect
 *   cols     = logicalW / TARGET_CELL_W    // lanes, not wider lanes
 *
 * Keeping lane *width* near-constant and varying lane *count* is what makes this
 * fair. The ship stays the same size relative to a lane, obstacle density is
 * already authored as a fraction of columns, and lateral speed expressed in
 * lanes-per-second comes out to the same px/s it always was. A 9-lane phone and
 * a 22-lane monitor play the same; one just sees more of the shaft at once.
 */

/** Fixed vertical authoring height. This is the reaction-time budget. */
export const LOGICAL_H = 760;

/** Desired lane width in logical units. Sized against the ship, not the screen. */
export const TARGET_CELL_W = 64;

/**
 * Lane bounds.
 *
 * The ceiling matters more than it looks. Uncapped, a 1440x860 window derived
 * twenty-two lanes: the rows became long thin walls, the ship was a speck in a
 * field it could only ever interact with a fraction of, and the shaft stopped
 * reading as a shaft. Past the cap the lanes get WIDER rather than more
 * numerous, which keeps the composition and the ship-to-lane ratio intact while
 * still filling the window exactly.
 */
export const MIN_COLS = 7;
export const MAX_COLS = 14;

/** Ship radius as a fraction of lane width, so it scales with the field. */
const PLAYER_R_FRAC = 0.18;

export interface Viewport {
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  /** CSS pixels per logical unit. */
  scale: number;
  /** Playfield size in logical units. Both vary with aspect. */
  logicalW: number;
  logicalH: number;
  cols: number;
  cellW: number;
  /** Ship radius, scaled to the lane so it fills the same share everywhere. */
  playerR: number;
}

/**
 * Module-level singleton rather than a threaded parameter.
 *
 * Every draw call and most of the sim needs the field width. Threading it would
 * touch ~60 signatures for a value that is, genuinely, global per frame — there
 * is exactly one canvas. `main.ts` owns updating it; everything else reads.
 */
export const view: Viewport = {
  w: 540,
  h: 760,
  dpr: 1,
  scale: 1,
  logicalW: 576,
  logicalH: LOGICAL_H,
  cols: 9,
  cellW: 64,
  playerR: 11,
};

/** Convenience: horizontal centre of the field, in logical units. */
export const midX = () => view.logicalW * 0.5;

/**
 * Recompute for a new canvas size. Returns true if anything changed, so callers
 * can skip reallocating offscreen buffers on the common no-op frame.
 */
export function updateViewport(cssW: number, cssH: number, dpr: number): boolean {
  if (cssW <= 0 || cssH <= 0) return false;

  let scale = cssH / LOGICAL_H;
  let logicalW = cssW / scale;
  let logicalH = LOGICAL_H;

  const cols = clamp(Math.round(logicalW / TARGET_CELL_W), MIN_COLS, MAX_COLS);
  // Lanes tile the field exactly, so the playfield truly reaches both edges.
  // Past MAX_COLS this is what widens them instead of adding more.
  const cellW = logicalW / cols;

  const changed =
    view.w !== cssW ||
    view.h !== cssH ||
    view.dpr !== dpr ||
    view.cols !== cols ||
    Math.abs(view.logicalW - logicalW) > 0.01;

  view.w = cssW;
  view.h = cssH;
  view.dpr = dpr;
  view.scale = scale;
  view.logicalW = logicalW;
  view.logicalH = logicalH;
  view.cols = cols;
  view.cellW = cellW;
  view.playerR = cellW * PLAYER_R_FRAC;

  return changed;
}

/**
 * Lateral speed is authored in LANES per second and converted here.
 *
 * The invariant that matters is "how fast can I reach the next lane", not "how
 * fast can I cross the field" — dodging is always a local, one-or-two-lane
 * decision. Anchoring to lanes keeps that identical at 7 lanes and at 26.
 */
export const lanesToPx = (lanesPerSec: number) => lanesPerSec * view.cellW;
