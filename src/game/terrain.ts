import type { Rng } from '../engine/math';
import { theme } from '../sectors';
import { view } from '../viewport';

/**
 * Things in the room that the strike cannot pass through.
 *
 * A pillar is an interior wall, and framing it that way is what keeps the
 * game's one promise intact. "Everything on the line dies" has always been a
 * claim about what the line *touches*; the arena boundary has always been
 * allowed to cut the line short, and `wallDistance` has always clamped it. This
 * moves that same rule inboard. The preview still shows exactly where the ship
 * stops, which is the only thing the player is asked to trust.
 *
 * It earns its place because the aim preview is the best-looking thing in the
 * game and, until now, nothing has ever *interrupted* it. A line that ends
 * against a slab — and a shutter that drops through one in bullet time while
 * the player watches — is that visual doing something it has never done.
 *
 * ## Why a singleton
 *
 * `solveStrike` has seven call sites. Threading terrain through as a parameter
 * is seven edits and a widened dev hook, every one of them a chance for one
 * caller to pass something a different caller did not — which is exactly the
 * class of bug the one-solver rule exists to prevent. A module singleton is
 * zero edits, and it is what `view`, `quality` and `settings` already are.
 *
 * ## Why rectangles
 *
 * Axis-aligned boxes, not circles, for three reasons that point the same way.
 * `onResize` remaps the world by scaling x and y independently, and a circle
 * scaled unevenly stops being a circle while a rectangle is still a rectangle.
 * Ray-versus-box is the exact slab test in a dozen lines with no tangent case
 * to get wrong. And a machined slab is what this floor is already made of.
 */

/** Half-extents, so a block is a centre and a size like everything else here. */
export interface Block {
  x: number;
  y: number;
  /** Half-width and half-height. */
  w: number;
  h: number;
  mode: 'solid' | 'shutter';
  /** Shutter phase offset, 0..1 of a period. */
  phase: number;
  /** Shutter period, seconds. */
  period: number;
  /** Resolved once per update; the solver and the physics both read this. */
  solid: boolean;
  /** 0..1 ramp before a shutter closes. Cosmetic, but it is the fair warning. */
  warn: number;
  /** So two slabs do not wear the same scratches. */
  seed: number;
}

/** How long a shutter telegraphs before it drops. */
const SHUTTER_WARN = 0.5;
/** Fraction of a shutter's cycle spent open. */
const SHUTTER_OPEN = 0.45;

/** Which axis a body was pushed out along, so the caller can kill that velocity. */
export type Axis = '' | 'x' | 'y';

class Terrain {
  readonly list: Block[] = [];
  private clock = 0;

  clear() {
    this.list.length = 0;
    this.clock = 0;
  }

  add(x: number, y: number, w: number, h: number, seed: number): Block {
    const b: Block = {
      x, y, w, h,
      mode: 'solid', phase: 0, period: 4,
      solid: true, warn: 0, seed,
    };
    this.list.push(b);
    return b;
  }

  update(dt: number) {
    if (!this.list.length) return;
    this.clock += dt;
    for (const b of this.list) {
      if (b.mode !== 'shutter') continue;
      const t = (this.clock / b.period + b.phase) % 1;
      // Open for less than half the cycle, on purpose. A gap that is briefer
      // than the wall is one you have to take when it is offered, which is the
      // decision the whole game is built on, applied to the floor.
      b.solid = t >= SHUTTER_OPEN;
      const toClose = (SHUTTER_OPEN - t) * b.period;
      b.warn = !b.solid && toClose < SHUTTER_WARN ? 1 - toClose / SHUTTER_WARN : 0;
    }
  }

  /** Is this point inside a solid block, with an optional margin? */
  contains(x: number, y: number, margin = 0) {
    for (const b of this.list) {
      if (!b.solid) continue;
      if (Math.abs(x - b.x) <= b.w + margin && Math.abs(y - b.y) <= b.h + margin) return true;
    }
    return false;
  }

  /**
   * Push a body out of any block it is inside, along the shallowest axis.
   *
   * Shallowest-axis resolution is what stops a body that clipped a corner from
   * being fired diagonally across the room: it leaves by the face it was
   * closest to getting out of, which is the face it came in through.
   */
  evict(o: { x: number; y: number }, r: number): Axis {
    for (const b of this.list) {
      if (!b.solid) continue;
      const dx = o.x - b.x;
      const dy = o.y - b.y;
      const ox = b.w + r - Math.abs(dx);
      const oy = b.h + r - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) {
        o.x = b.x + (dx >= 0 ? b.w + r : -(b.w + r));
        return 'x';
      }
      o.y = b.y + (dy >= 0 ? b.h + r : -(b.h + r));
      return 'y';
    }
    return '';
  }
}

export const terrain = new Terrain();

/**
 * Distance along a unit ray at which it enters a box, or -1.
 *
 * Returns 0 when the origin is already inside, matching `rayCircle` — a ship
 * that has somehow ended up inside a pillar should stop there rather than sail
 * out through the far face.
 */
export function rayBox(
  ox: number, oy: number, dx: number, dy: number, b: Block,
): number {
  const minX = b.x - b.w;
  const maxX = b.x + b.w;
  const minY = b.y - b.h;
  const maxY = b.y + b.h;
  if (ox >= minX && ox <= maxX && oy >= minY && oy <= maxY) return 0;

  let near = -Infinity;
  let far = Infinity;

  // A ray parallel to a slab either misses it outright or lies within it for
  // its whole length; the reciprocal would be a signed infinity either way, so
  // that axis is settled by inspection rather than by arithmetic.
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t0 = (minX - ox) * inv;
    let t1 = (maxX - ox) * inv;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t0 = (minY - oy) * inv;
    let t1 = (maxY - oy) * inv;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    near = Math.max(near, t0);
    far = Math.min(far, t1);
  }

  if (near > far || far < 0) return -1;
  return Math.max(0, near);
}

// ------------------------------------------------------------------- layouts
/**
 * Layouts are generated, never authored.
 *
 * A hand-placed room is a content pipeline, a content pipeline wants a level
 * editor, and a level editor is how an afternoon's work becomes a project. Two
 * recipes keyed off the sector cover what the fight needs, and a seeded
 * generator gives a room the same furniture every time without anyone having
 * to draw it.
 */
export function makeTerrain(rng: Rng) {
  terrain.clear();
  if (theme.terrain === 'none') return;

  const { arenaW, arenaH } = view;
  // Nothing near the middle. That is where the player starts and where a
  // wave's first arrivals converge, and a slab there turns the opening of
  // every wave into a blind corner.
  const cx = arenaW * 0.5;
  const cy = arenaH * 0.5;
  const clearR = Math.min(arenaW, arenaH) * 0.24;

  if (theme.terrain === 'pillars') {
    // A jittered lattice, thinned to roughly half. Jitter rather than a true
    // grid: evenly spaced pillars read as architecture, unevenly spaced ones
    // read as a place that has been used for something.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        if (rng() < 0.42) continue;
        const x = arenaW * (0.18 + i * 0.215) + (rng() - 0.5) * 62;
        const y = arenaH * (0.22 + j * 0.28) + (rng() - 0.5) * 52;
        if (Math.hypot(x - cx, y - cy) < clearR) continue;
        terrain.add(x, y, 26 + rng() * 30, 26 + rng() * 30, rng() * 1000);
      }
    }
    return;
  }

  // Shutters: bars on offset phases, spread across the room, so a heading that
  // is open now is rarely still open in a moment.
  for (let i = 0; i < 3; i++) {
    const b = terrain.add(
      arenaW * (0.27 + i * 0.23),
      arenaH * (i % 2 === 0 ? 0.29 : 0.71),
      17,
      arenaH * 0.16,
      rng() * 1000,
    );
    b.mode = 'shutter';
    b.period = 3.6 + i * 0.7;
    b.phase = i / 3;
  }
}
