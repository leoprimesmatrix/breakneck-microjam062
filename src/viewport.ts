import { ARENA_AREA, ARENA_ASPECT_MAX, ARENA_ASPECT_MIN } from './config';
import { clamp } from './engine/math';

/**
 * Screen geometry.
 *
 * Two coordinate spaces exist and it is worth being precise about them:
 *
 *  - **arena space** — where the game lives. Origin at the arena's top-left,
 *    `arenaW x arenaH` units. Constant area (see `ARENA_AREA`), aspect follows
 *    the window so the shape feels native without changing the balance.
 *  - **screen space** — CSS pixels. The arena is centred inside it and scaled to
 *    fit with a small margin; whatever is left over is *surround*, and the
 *    surround is drawn as art (floor spill, vignette, frame glow) rather than
 *    left as a letterbox.
 *
 * Everything downstream reads this module rather than being handed a viewport,
 * because there is exactly one canvas and threading it would touch every
 * signature in the renderer for no gain.
 */

export interface Viewport {
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  dpr: number;

  /** Arena size in arena units. */
  arenaW: number;
  arenaH: number;

  /** arena unit -> CSS pixel. */
  scale: number;
  /** Top-left of the arena in CSS pixels. */
  originX: number;
  originY: number;

  /** Whole canvas expressed in arena units, for full-bleed background art. */
  fullW: number;
  fullH: number;
  /** Arena top-left within that full-bleed space (i.e. the surround margin). */
  padX: number;
  padY: number;
}

export const view: Viewport = {
  w: 1280,
  h: 720,
  dpr: 1,
  arenaW: 1240,
  arenaH: 720,
  scale: 1,
  originX: 0,
  originY: 0,
  fullW: 1240,
  fullH: 720,
  padX: 0,
  padY: 0,
};

/**
 * Surround kept free of playfield, as a fraction of each axis. Vertical is the
 * larger of the two on purpose: that gutter is where the HUD lives, and a HUD
 * that sits *beside* the arena rather than on top of it never once obscures a
 * target the player is lining up.
 */
const MARGIN_X = 0.028;
const MARGIN_Y = 0.098;

export function updateViewport(cssW: number, cssH: number, dpr: number): boolean {
  if (cssW <= 0 || cssH <= 0) return false;

  const usableW = cssW * (1 - MARGIN_X * 2);
  const usableH = cssH * (1 - MARGIN_Y * 2);

  // Aspect is taken from the *usable* box, not the window, so the arena fills
  // the space the HUD leaves rather than the space the window has.
  const aspect = clamp(usableW / usableH, ARENA_ASPECT_MIN, ARENA_ASPECT_MAX);
  const arenaW = Math.sqrt(ARENA_AREA * aspect);
  const arenaH = Math.sqrt(ARENA_AREA / aspect);

  const scale = Math.min(usableW / arenaW, usableH / arenaH);

  const originX = (cssW - arenaW * scale) * 0.5;
  const originY = (cssH - arenaH * scale) * 0.5;

  const changed =
    view.w !== cssW ||
    view.h !== cssH ||
    view.dpr !== dpr ||
    Math.abs(view.arenaW - arenaW) > 0.01;

  view.w = cssW;
  view.h = cssH;
  view.dpr = dpr;
  view.arenaW = arenaW;
  view.arenaH = arenaH;
  view.scale = scale;
  view.originX = originX;
  view.originY = originY;
  view.fullW = cssW / scale;
  view.fullH = cssH / scale;
  view.padX = originX / scale;
  view.padY = originY / scale;

  return changed;
}

/** Convert a screen (CSS pixel) point into arena units. */
export function screenToArena(sx: number, sy: number) {
  return {
    x: (sx - view.originX) / view.scale,
    y: (sy - view.originY) / view.scale,
  };
}
