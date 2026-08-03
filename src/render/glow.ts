/**
 * Halos, as one accumulated buffer.
 *
 * This file has now been wrong twice, in the same way, and the second time is
 * the interesting one.
 *
 * The first version blurred each glowing thing on the visible canvas with
 * `ctx.filter`, which allocates a layer the size of the clip — the whole canvas
 * — per draw. Eight glowing strings cost eight full-screen Gaussians: 226ms a
 * frame. The obvious fix was to blur each halo in a *small* buffer instead, and
 * by CPU time that looked solved: the frame dropped to 1ms of script.
 *
 * It was not solved. Measuring wall-clock throughput with a flush — CPU *and*
 * GPU — showed 6.1ms a frame, of which 4.0ms was still text glow. The cost was
 * never the pixels. Apple's GPU is tile-based and deferred: every `ctx.filter`
 * is a save-layer, every save-layer is a render-target switch, and every switch
 * flushes the tile buffer no matter how few pixels it covers. Six glowing
 * strings at two blur passes each plus a blit back is roughly eighteen render
 * passes a frame, and eighteen render passes is a fanless laptop at 30fps.
 *
 * So: **one buffer, one blur, one composite, for every halo on a target.**
 * Callers stamp their shape into the accumulator as they draw; the whole thing
 * is blurred by successive halving — bilinear downscale by two is an exact 2x2
 * box average, so a chain of them is a real filter and not an approximation —
 * and composited additively once, at the end.
 *
 * Three consequences worth knowing:
 *  - `ctx.filter` no longer appears anywhere in the frame loop.
 *  - Halo width is no longer a per-string parameter. It does not need to be:
 *    bolder, larger type stamps fatter strokes and therefore glows wider, on
 *    its own, which is what bloom actually does.
 *  - Compositing additively *over* the crisp text rather than under it is
 *    correct, not a shortcut. The cores are already at full brightness, so
 *    adding light around them is exactly a glow — and it is one pass, not two.
 */

import { rgba, type RGB } from '../config';

/** Accumulator resolution, relative to the target's device pixels. */
const RES = 0.4;
/** Halvings of the accumulator. Each doubles the halo's reach. */
const LEVELS = 3;

interface Buf {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

function makeBuf(w: number, h: number): Buf {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return { c, g: c.getContext('2d')! };
}

export class Glow {
  private buf: Buf = makeBuf(1, 1);
  private levels: Buf[] = [];
  private w = 0;
  private h = 0;
  /** Nothing emitted this frame — skip the clear, the blur and the composite. */
  private used = false;
  private enabled = true;

  /**
   * Size the accumulator to a target canvas, in that canvas's device pixels.
   * Call once per frame before anything draws to that target.
   */
  begin(deviceW: number, deviceH: number, enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return;
    const w = Math.max(1, Math.round(deviceW * RES));
    const h = Math.max(1, Math.round(deviceH * RES));
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.buf = makeBuf(w, h);
      this.levels = [];
      let lw = w;
      let lh = h;
      for (let i = 0; i < LEVELS; i++) {
        lw = Math.max(1, lw >> 1);
        lh = Math.max(1, lh >> 1);
        this.levels.push(makeBuf(lw, lh));
      }
    }
    this.used = false;
  }

  /**
   * Stamp a shape into the accumulator, in the *caller's* current user
   * coordinates. `paint` gets a context already transformed to match.
   */
  emit(ctx: CanvasRenderingContext2D, paint: (g: CanvasRenderingContext2D) => void) {
    if (!this.enabled) return;
    const m = ctx.getTransform();
    // A rotated or mirrored target would need the buffer rotated with it; no
    // caller does that, and bailing keeps this honest if one ever starts.
    if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || !(m.a > 0) || !(m.d > 0)) return;

    const g = this.buf.g;
    if (!this.used) {
      this.used = true;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
    }
    g.setTransform(m.a * RES, 0, 0, m.d * RES, m.e * RES, m.f * RES);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    // Round joins, always: fattened mitres grow spikes at every corner, which is
    // exactly what made an earlier fat-stroke glow look like a blob.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    paint(g);
  }

  /** Blur everything stamped this frame and add it to the target, once. */
  flush(ctx: CanvasRenderingContext2D, deviceW: number, deviceH: number, alpha = 1) {
    if (!this.enabled || !this.used) return;

    // Successive halving. Bilinear downscale by exactly two averages a 2x2
    // block, so this chain is a genuine box blur widening at each step.
    let src = this.buf.c;
    for (const L of this.levels) {
      L.g.setTransform(1, 0, 0, 1, 0, 0);
      L.g.globalCompositeOperation = 'source-over';
      L.g.globalAlpha = 1;
      L.g.clearRect(0, 0, L.c.width, L.c.height);
      L.g.drawImage(src, 0, 0, L.c.width, L.c.height);
      src = L.c;
    }
    // Fold the coarse levels back down so only one buffer is composited.
    for (let i = this.levels.length - 1; i > 0; i--) {
      const dst = this.levels[i - 1];
      dst.g.globalCompositeOperation = 'lighter';
      dst.g.globalAlpha = 0.8;
      dst.g.drawImage(this.levels[i].c, 0, 0, dst.c.width, dst.c.height);
      dst.g.globalAlpha = 1;
      dst.g.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    // Only the blurred chain is composited. The accumulator itself holds hard
    // fattened strokes — adding those back would draw a bright outline around
    // every glyph and blow the counters out into unreadable slabs, which is
    // exactly what it did the first time this was tried.
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.levels[0].c, 0, 0, deviceW, deviceH);
    ctx.restore();
    this.used = false;
  }
}

/**
 * Two accumulators: one for the world buffer, one for the visible canvas.
 * `active` is what `drawVec` and friends stamp into — the renderer points it at
 * the right one before each phase, so nothing downstream has to know which
 * canvas it is drawing to.
 */
export const sceneGlow = new Glow();
export const uiGlow = new Glow();
export let active: Glow = uiGlow;

export function setGlowTarget(g: Glow) {
  active = g;
}

// --------------------------------------------------------------- radial art
const sprites = new Map<string, HTMLCanvasElement>();

/**
 * Ceiling on the sprite cache.
 *
 * A cache of canvases is the most expensive thing in this renderer to get
 * wrong, because the backing stores do not live in the JS heap: an unbounded
 * key space here shows up as the whole machine going treacly, with a heap
 * profile that stays flat and innocent the entire time, and it outlives a
 * reload because the memory is the renderer process's rather than the page's.
 *
 * It happened: a seeder's cavity glow baked its animated brightness into the
 * key, so five on screen minted thirty 128px canvases a second — about 1.4 GB a
 * minute, never released. The rule callers follow is to key on constants and
 * pulse with `globalAlpha`, which is free and exact. This is the net under that
 * rule rather than a substitute for it: the honest working set is a couple of
 * dozen entries, so reaching this bound means something is keying on a float.
 */
const MAX_SPRITES = 128;

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
  if (sprites.size >= MAX_SPRITES) {
    // Dropping the lot costs one frame of rebaking. Leaking is unbounded, so
    // this trade is never close.
    if (import.meta.env.DEV) {
      console.warn(`radialSprite: cache hit ${MAX_SPRITES} entries and was cleared. ` +
        `Something is keying on a varying value — newest key was "${key}".`);
    }
    sprites.clear();
  }
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

/**
 * The two falloffs every lit thing in the game uses, shared rather than
 * redefined per module: a wide soft *halo* that says "this object is a light
 * source standing in a dark room", and a tighter *glow* for the emissive parts
 * themselves. Both are keyed on their arguments, so a hundred call sites across
 * the scene and the ship still only ever bake one bitmap each.
 */
export const haloSprite = (col: RGB) =>
  radialSprite(`halo${col}`, [
    [0, rgba(col, 0.24)],
    [0.5, rgba(col, 0.07)],
    [1, rgba(col, 0)],
  ]);

export const glowSprite = (col: RGB, inner: number) =>
  radialSprite(`glow${col}:${inner}`, [
    [0, rgba(col, inner)],
    [1, rgba(col, 0)],
  ]);

/**
 * A hard-cored flare: white-hot at the centre, falling to the colour, then out.
 * This is what an engine bell or a muzzle looks like, and a plain single-stop
 * falloff never gets there — the core has to clip to white or it reads as a
 * coloured smudge rather than as something too bright to look at.
 */
export const flareSprite = (col: RGB, inner = 1) =>
  radialSprite(`flare${col}:${inner}`, [
    [0, `rgba(255,255,255,${inner})`],
    [0.22, rgba(col, inner * 0.85)],
    [0.6, rgba(col, inner * 0.2)],
    [1, rgba(col, 0)],
  ]);

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
