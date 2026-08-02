/**
 * Halos, cheaply.
 *
 * `ctx.filter = 'blur(...)'` is the obvious way to make something glow on a
 * canvas, and it is a trap. The backend allocates and blurs a layer the size of
 * the current clip — which is the whole canvas — for *every* draw it applies to.
 * Eight glowing things in a frame (a score, a chain counter, a prompt, a couple
 * of score pops) is eight full-screen Gaussians, and on a 1440x900 Retina panel
 * that measured 226ms a frame: four frames a second, from text.
 *
 * The fix is not to give up the glow. A blur is low-frequency by definition, so
 * it does not need the resolution of the thing it surrounds. Everything here
 * renders a halo into a small scratch buffer, blurs it *there*, and scales the
 * result back up. It is the same Gaussian, computed over a few thousand pixels
 * instead of five million.
 *
 * Two facts about canvas `filter` that this file depends on, both verified
 * rather than assumed:
 *  - the blur radius is in device pixels and ignores the current transform, so
 *    a radius meant in user units has to be scaled on the way in;
 *  - the cost of a filtered draw tracks the *clip*, not the geometry, which is
 *    exactly why shrinking the buffer works.
 */

/** Canvas `filter` is near-universal but not guaranteed; probe it once. */
export const CAN_BLUR = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return false;
    c.filter = 'blur(1px)';
    return c.filter !== 'none' && c.filter !== '';
  } catch {
    return false;
  }
})();

/**
 * Halo resolution relative to the destination. At 0.5 the buffer holds a
 * quarter of the pixels and the blur hides every bit of the difference — the
 * crisp core is always drawn over the top at full resolution.
 */
const GLOW_RES = 0.5;
/** Hard ceiling on the scratch buffer. A full-width wordmark gets softer, not slower. */
const MAX_SCRATCH_PX = 320 * 320;

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

/** One buffer for every halo in the game, grown to the high-water mark. */
function scratchAt(w: number, h: number): CanvasRenderingContext2D {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = scratch.height = 1;
    scratchCtx = scratch.getContext('2d')!;
  }
  if (scratch.width < w || scratch.height < h) {
    // Resizing wipes the canvas, which is fine — the caller clears it anyway.
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  return scratchCtx!;
}

/**
 * Paint a blurred layer over the box `(bx, by, bw, bh)`, given in the caller's
 * current user units, and composite it additively in place.
 *
 * `paint` receives the scratch context — already transformed so it can draw in
 * the caller's coordinates — and `k`, the factor converting a user-unit blur
 * radius into the device pixels that `filter` actually wants.
 *
 * Returns false when the fast path does not apply, so callers can fall back
 * rather than silently lose their glow.
 */
export function glowLayer(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spread: number,
  alpha: number,
  paint: (g: CanvasRenderingContext2D, k: number) => void,
): boolean {
  if (!CAN_BLUR || alpha <= 0.002 || bw <= 0 || bh <= 0) return false;

  const m = ctx.getTransform();
  // A rotated or mirrored transform would need the scratch rotated with it. No
  // caller does that today; bailing keeps this honest if one ever starts.
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) return false;
  const sx = m.a;
  const sy = m.d;
  if (!(sx > 0) || !(sy > 0)) return false;

  const lx = bx - spread;
  const ly = by - spread;
  const lw = bw + spread * 2;
  const lh = bh + spread * 2;

  let res = GLOW_RES;
  let w = Math.ceil(lw * sx * res);
  let h = Math.ceil(lh * sy * res);
  if (w < 1 || h < 1) return false;
  if (w * h > MAX_SCRATCH_PX) {
    // Shrink further rather than give up: an even softer halo is invisible next
    // to the sharp core that lands on top of it.
    const k = Math.sqrt(MAX_SCRATCH_PX / (w * h));
    res *= k;
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }

  const g = scratchAt(w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.clearRect(0, 0, w, h);
  g.setTransform(sx * res, 0, 0, sy * res, -lx * sx * res, -ly * sy * res);

  paint(g, Math.min(sx, sy) * res);

  g.filter = 'none';
  g.setTransform(1, 0, 0, 1, 0, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch!, 0, 0, w, h, m.a * lx + m.e, m.d * ly + m.f, lw * m.a, lh * m.d);
  ctx.restore();
  return true;
}

// --------------------------------------------------------------- radial art
const sprites = new Map<string, HTMLCanvasElement>();

/**
 * A radial falloff baked once into a bitmap.
 *
 * Enemy halos, the player's aura and the orb glows are the same shape at
 * different sizes and colours. Building a gradient object per enemy per frame
 * and evaluating it across a few thousand pixels is real work; a scaled
 * `drawImage` of a cached sprite is one textured quad. Bake at full strength
 * and modulate with `globalAlpha` — every stop scales linearly, so the result
 * is identical.
 */
export function radialSprite(key: string, stops: readonly [number, string][], size = 128) {
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}

/** Draw a cached radial sprite centred on a point, at a given radius. */
export function drawRadial(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  r: number,
  alpha = 1,
) {
  if (r <= 0 || alpha <= 0.002) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}
