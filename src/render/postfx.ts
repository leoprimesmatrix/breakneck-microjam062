import { COL, rgba } from '../config';
import { clamp } from '../engine/math';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { CAN_BLUR } from './glow';
import { quality } from './quality';

/**
 * Screen-space post: bloom, chromatic aberration, vignette, flash, grain.
 *
 * The world is drawn once into an offscreen buffer instead of straight to the
 * canvas — you cannot bloom or split channels on pixels you have already handed
 * to the compositor. The HUD is deliberately *not* in that buffer; it is drawn
 * onto the real canvas afterwards so its text never picks up a fringe.
 *
 * Everything here degrades rather than fails. Canvas `filter` is the only exotic
 * feature used and there is a manual fallback, so no path through this file can
 * leave a judge looking at a black rectangle.
 */

const TINT_DIV = 2;
/** Cap on scene-buffer pixels; a 4K window must not allocate a 33MP blur. */
const MAX_PIXELS = 2_600_000;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

export class PostFX {
  readonly scene: HTMLCanvasElement;
  readonly sceneCtx: CanvasRenderingContext2D;

  private bloom: HTMLCanvasElement;
  private bloomCtx: CanvasRenderingContext2D;
  private tint: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement;
  private grainPattern: CanvasPattern | null = null;
  private scanTile: HTMLCanvasElement | null = null;
  private scanPattern: CanvasPattern | null = null;
  private vignette: CanvasGradient | null = null;
  private vignetteKey = '';

  private readonly canFilter = CAN_BLUR;
  private q = 1;
  private lastW = 0;
  private lastH = 0;
  private lastDiv = 0;
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

  /** One static noise tile, scrolled. Per-frame noise is a per-pixel JS loop. */
  private buildGrain() {
    const S = 160;
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

  private ensureSize() {
    const Q = quality.current;
    let q = clamp(view.dpr, 1, 2) * Q.sceneScale;
    while (view.w * q * view.h * q > MAX_PIXELS && q > 0.4) q -= 0.1;
    const w = Math.round(view.w * q);
    const h = Math.round(view.h * q);
    const div = Q.bloomDiv;
    if (w === this.lastW && h === this.lastH && div === this.lastDiv) return;
    this.q = q;
    this.lastW = w;
    this.lastH = h;
    this.lastDiv = div;
    this.scene.width = w;
    this.scene.height = h;
    this.bloom.width = Math.max(1, Math.round(w / div));
    this.bloom.height = Math.max(1, Math.round(h / div));
    this.tint.width = Math.max(1, Math.round(w / TINT_DIV));
    this.tint.height = Math.max(1, Math.round(h / TINT_DIV));
  }

  /**
   * Scene context, transformed into arena units and carrying the camera —
   * shake and lens punch live in this transform, which is precisely why the HUD
   * drawn later stays rock steady while the world is being thrown around.
   */
  begin(game: Game): CanvasRenderingContext2D {
    this.ensureSize();
    const c = this.sceneCtx;
    const q = this.q;
    const s = view.scale * q;

    const shakeX = game.juice.offsetX();
    const shakeY = game.juice.offsetY();
    const zoom = 1 + game.juice.punch;

    // Zoom about a point biased toward the player, so an impact reads as the
    // camera lurching at the action rather than at the middle of the room.
    const fx = view.arenaW * 0.5 + (game.player.x - view.arenaW * 0.5) * 0.4;
    const fy = view.arenaH * 0.5 + (game.player.y - view.arenaH * 0.5) * 0.4;

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = rgba(COL.void, 1);
    c.fillRect(0, 0, this.scene.width, this.scene.height);

    c.setTransform(
      s * zoom,
      0,
      0,
      s * zoom,
      view.originX * q + (shakeX - fx * (zoom - 1)) * s,
      view.originY * q + (shakeY - fy * (zoom - 1)) * s,
    );
    return c;
  }

  // ---------------------------------------------------------------- bloom
  private buildBloom(amount: number) {
    const b = this.bloomCtx;
    const bw = this.bloom.width;
    const bh = this.bloom.height;

    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.globalAlpha = 1;
    b.clearRect(0, 0, bw, bh);

    if (this.canFilter) {
      b.filter = `blur(${(2.6 + amount * 2.4).toFixed(2)}px)`;
      b.drawImage(this.scene, 0, 0, bw, bh);
      b.filter = 'none';
    } else {
      // Manual box blur: the same image summed at small offsets. Cheap at 1/3
      // resolution and visually close enough for a halo.
      b.globalAlpha = 0.2;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy += 2) b.drawImage(this.scene, dx, dy, bw, bh);
      }
      b.globalAlpha = 1;
    }
  }

  /**
   * Isolate one channel by multiplying the scene with a pure primary, then add
   * it back offset. Two of those in opposite directions is a convincing lens
   * fringe, and it only runs when there is speed to justify it.
   */
  private ghost(ctx: CanvasRenderingContext2D, mult: string, dx: number, a: number) {
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
    ctx.drawImage(this.tint, dx, 0, view.w, view.h);
  }

  /** Blit the finished world into `ctx` with post applied. */
  composite(ctx: CanvasRenderingContext2D, game: Game) {
    const Q = quality.current;
    const speed = game.player.speedNorm;
    const j = game.juice;
    const ab = Q.chroma ? speed * 5.2 + j.fringe * 4.4 : 0;

    // NB: the caller's transform (device-pixel-ratio scaling) is left alone —
    // everything from here down is authored in CSS pixels.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.scene, 0, 0, view.w, view.h);

    if (ab > 0.4) {
      const a = clamp(0.1 + ab * 0.03, 0, 0.42);
      this.ghost(ctx, '#ff0044', -ab, a);
      this.ghost(ctx, '#00ffee', ab, a);
    }

    if (Q.bloom > 0) {
      this.buildBloom(speed * 0.6 + j.flash);
      ctx.globalCompositeOperation = 'lighter';
      // Two draws — a wide soft halo, then a tighter brighter core — read as a
      // real bloom curve. Kept low: additive bloom compounds, and the enemy
      // silhouettes have to stay legible at the exact moment the screen is
      // brightest, which is the moment the player is deciding where to go next.
      ctx.globalAlpha = clamp(0.25 + speed * 0.08, 0, 1);
      ctx.drawImage(this.bloom, -7, -7, view.w + 14, view.h + 14);
      if (Q.bloom > 1) {
        ctx.globalAlpha = clamp(0.12 + speed * 0.05, 0, 1);
        ctx.drawImage(this.bloom, 0, 0, view.w, view.h);
      }
    }
    ctx.restore();

    // Vignette. Drawn after bloom so the corners actually stay dark.
    //
    // Built once per window size and modulated with `globalAlpha` rather than
    // rebuilt whenever the aim depth changes: scaling every stop by a constant
    // is exactly what globalAlpha does, so this is the same image without a new
    // gradient object and a fresh ramp evaluation every frame.
    const key = `${view.w}x${view.h}`;
    if (this.vignetteKey !== key || !this.vignette) {
      const g = ctx.createRadialGradient(
        view.w * 0.5, view.h * 0.5, Math.min(view.w, view.h) * 0.26,
        view.w * 0.5, view.h * 0.5, Math.max(view.w, view.h) * 0.78,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      this.vignette = g;
      this.vignetteKey = key;
    }
    ctx.save();
    ctx.globalAlpha = 0.5 + game.aimBlend * 0.22;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();

    if (j.flash > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(j.flashCol, Math.min(0.85, j.flash));
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }
  }

  /**
   * One tile of the scanline pattern, built at device resolution so the lines
   * land on whole pixels instead of being resampled into a grey wash.
   */
  private ensureScanline(ctx: CanvasRenderingContext2D) {
    const dpr = Math.max(1, Math.round(view.dpr));
    const pitch = 3 * dpr;
    if (!this.scanTile || this.scanTile.height !== pitch) {
      const c = makeCanvas(4, pitch);
      const g = c.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, 4, dpr);
      this.scanTile = c;
      this.scanPattern = null;
    }
    if (!this.scanPattern) this.scanPattern = ctx.createPattern(this.scanTile, 'repeat');
    return this.scanPattern;
  }

  /** Grain + scanlines over everything, last. */
  finish(ctx: CanvasRenderingContext2D, game: Game) {
    // Two fullscreen passes, one of them a blend mode that has to read the
    // frame back. It is the first thing worth losing on a machine that is
    // struggling, and the last thing anyone would notice missing.
    if (!quality.current.grain) return;
    this.grainPhase = (this.grainPhase + 11) % 160;

    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.042 + game.player.speedNorm * 0.03;
    if (!this.grainPattern) this.grainPattern = ctx.createPattern(this.grain, 'repeat');
    if (this.grainPattern) {
      ctx.fillStyle = this.grainPattern;
      ctx.translate(-this.grainPhase, (this.grainPhase * 1.7) % 160);
      ctx.fillRect(0, 0, view.w + 160, view.h + 160);
    }
    ctx.restore();

    // 3px pitch, very low contrast: enough to read as a screen, not enough to
    // fight the art or moire at odd device ratios.
    //
    // A tiled pattern rather than a loop of hairlines. Three hundred separate
    // rects is three hundred draw calls a mobile GPU does not need to make, and
    // it buys nothing a four-pixel tile does not.
    //
    // `source-over`, not `multiply`: the source here is pure black, and
    // `black * dst` composited at alpha a is `(1-a)*dst` — the exact result of
    // painting black over it at the same alpha. Identical image, no readback.
    const scan = this.ensureScanline(ctx);
    if (scan) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = scan;
      ctx.fillRect(0, 0, view.w * view.dpr, view.h * view.dpr);
      ctx.restore();
    }
  }
}
