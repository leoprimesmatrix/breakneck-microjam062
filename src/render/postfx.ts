import { clamp } from '../engine/math';
import { view } from '../viewport';

/**
 * Screen-space post: bloom, chromatic aberration, grain, scanlines.
 *
 * The game is drawn once into an offscreen scene buffer instead of straight to
 * the canvas, which is what makes any of this possible — you cannot bloom or
 * split channels on pixels you have already handed to the compositor.
 *
 * The buffer's aspect now follows the window rather than a fixed 540x760 shaft,
 * so it is reallocated whenever the viewport changes shape.
 *
 * Everything here degrades rather than fails. Canvas `filter` is the only exotic
 * feature used, and there is a manual fallback for it, so nothing in this file
 * can leave a judge staring at a black rectangle.
 */

/** Bloom runs at 1/BLOOM_DIV of scene resolution; the blur hides the loss. */
const BLOOM_DIV = 3;
/** Aberration ghosts run at half res — they are 2px-offset blurs anyway. */
const TINT_DIV = 2;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

/** Canvas2D `filter` is well supported but not universal; detect once. */
function detectFilterSupport(): boolean {
  try {
    const c = makeCanvas(2, 2).getContext('2d');
    if (!c) return false;
    c.filter = 'blur(1px)';
    return c.filter !== 'none' && c.filter !== '';
  } catch {
    return false;
  }
}

export interface CompositeOpts {
  /** Canvas size in CSS pixels — the scene fills all of it. */
  w: number;
  h: number;
  /** 0..1 — drives aberration width and bloom lift. */
  speed: number;
  /** 0..1 meltdown intensity; blows the bloom out and warms it. */
  melt: number;
  /** 0..1 how deep into the redline; skews the fringe hot. */
  burn: number;
}

export class PostFX {
  readonly scene: HTMLCanvasElement;
  readonly sceneCtx: CanvasRenderingContext2D;

  private bloom: HTMLCanvasElement;
  private bloomCtx: CanvasRenderingContext2D;
  private tint: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement;

  private readonly canFilter = detectFilterSupport();
  private lastW = 0;
  private lastH = 0;
  private grainPhase = 0;

  constructor() {
    this.scene = makeCanvas(2, 2);
    this.sceneCtx = this.scene.getContext('2d', { alpha: false })!;
    this.bloom = makeCanvas(2, 2);
    this.bloomCtx = this.bloom.getContext('2d')!;
    this.tint = makeCanvas(2, 2);
    this.tintCtx = this.tint.getContext('2d')!;
    this.grain = this.buildGrain();
  }

  /**
   * Static noise tile, generated once. Regenerating grain per frame is a
   * per-pixel JS loop at 60Hz; scrolling one tile by a random offset is
   * indistinguishable and free.
   */
  private buildGrain() {
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /**
   * Size the buffers to the current viewport. Capped so an enormous window on a
   * retina display does not allocate a scene buffer nobody can afford to blur.
   */
  private ensureSize() {
    const q = clamp(view.scale * view.dpr, 0.5, 2);
    const w = Math.round(view.logicalW * q);
    const h = Math.round(view.logicalH * q);
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;

    this.scene.width = w;
    this.scene.height = h;
    this.bloom.width = Math.max(1, Math.round(w / BLOOM_DIV));
    this.bloom.height = Math.max(1, Math.round(h / BLOOM_DIV));
    this.tint.width = Math.max(1, Math.round(w / TINT_DIV));
    this.tint.height = Math.max(1, Math.round(h / TINT_DIV));
  }

  /** Scene context, transformed so callers draw in logical units. */
  begin(): CanvasRenderingContext2D {
    this.ensureSize();
    const c = this.sceneCtx;
    c.setTransform(
      this.scene.width / view.logicalW,
      0,
      0,
      this.scene.height / view.logicalH,
      0,
      0,
    );
    return c;
  }

  // ---------------------------------------------------------------- bloom
  /**
   * Downscale-blur-add. There is no threshold pass: the palette keeps the
   * background near black, so an additive composite of the blurred scene is
   * already a threshold — dark pixels contribute nothing, bright ones halo.
   */
  private buildBloom(melt: number) {
    const b = this.bloomCtx;
    const bw = this.bloom.width;
    const bh = this.bloom.height;

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.clearRect(0, 0, bw, bh);

    if (this.canFilter) {
      b.filter = `blur(${(2.4 + melt * 2).toFixed(2)}px)`;
      b.drawImage(this.scene, 0, 0, bw, bh);
      b.filter = 'none';
    } else {
      // Manual box blur: the same image summed at small offsets. Cheaper than
      // it looks at 1/3 resolution and visually close enough for a halo.
      b.globalAlpha = 0.2;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy += 2) {
          b.drawImage(this.scene, dx, dy, bw, bh);
        }
      }
      b.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ aberration
  /**
   * Isolate one channel by multiplying the scene with a pure primary, then add
   * the result back offset. Two of these in opposite directions is a convincing
   * lens fringe, and it only runs once the fall is fast enough to justify it.
   */
  private ghost(
    ctx: CanvasRenderingContext2D,
    o: CompositeOpts,
    mult: string,
    dx: number,
    a: number,
  ) {
    const t = this.tintCtx;
    const tw = this.tint.width;
    const th = this.tint.height;

    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    t.clearRect(0, 0, tw, th);
    t.drawImage(this.scene, 0, 0, tw, th);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = mult;
    t.fillRect(0, 0, tw, th);
    t.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(this.tint, dx, 0, o.w, o.h);
  }

  // ---------------------------------------------------------------- output
  /** Blit the finished scene into `ctx` (canvas CSS-pixel space) with post. */
  composite(ctx: CanvasRenderingContext2D, o: CompositeOpts) {
    // Fringe width. Kept modest: past about 6px the split stops reading as a
    // lens and starts reading as a rendering fault.
    const ab = Math.max(0, o.speed - 0.4) * 7 + o.melt * 2.2 + o.burn * 1.6;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.scene, 0, 0, o.w, o.h);

    if (ab > 0.35) {
      this.ghost(ctx, o, '#ff0000', -ab, clamp(0.12 + ab * 0.03, 0, 0.4));
      this.ghost(ctx, o, '#00ffff', ab, clamp(0.12 + ab * 0.03, 0, 0.4));
    }

    this.buildBloom(o.melt);
    ctx.globalCompositeOperation = 'lighter';
    // Wide soft halo, then a tighter brighter core — two draws read as a real
    // bloom curve instead of a flat glow. Kept low because additive bloom
    // compounds, and the material silhouettes must stay legible.
    ctx.globalAlpha = clamp(0.26 + o.speed * 0.16 + o.melt * 0.16, 0, 1);
    ctx.drawImage(this.bloom, -6, -6, o.w + 12, o.h + 12);
    ctx.globalAlpha = clamp(0.13 + o.speed * 0.11 + o.melt * 0.13, 0, 1);
    ctx.drawImage(this.bloom, 0, 0, o.w, o.h);

    ctx.restore();
  }

  /** Grain + scanlines over the whole canvas, after everything else. */
  finish(ctx: CanvasRenderingContext2D, w: number, h: number, speed: number, melt: number) {
    this.grainPhase = (this.grainPhase + 7) % 128;

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.05 + speed * 0.045;
    const p = ctx.createPattern(this.grain, 'repeat');
    if (p) {
      ctx.fillStyle = p;
      ctx.translate(-this.grainPhase, (this.grainPhase * 1.7) % 128);
      ctx.fillRect(0, 0, w + 128, h + 128);
    }
    ctx.restore();

    // Scanlines: 3px pitch, very low contrast. Enough to read as a screen, not
    // enough to fight the art or alias into moire at odd device ratios.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16 + melt * 0.06;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }
}
