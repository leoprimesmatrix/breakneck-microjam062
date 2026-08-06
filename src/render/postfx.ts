import { COL, rgba } from '../config';
import { clamp } from '../engine/math';
import type { Game } from '../game/game';
import { theme } from '../sectors';
import { view } from '../viewport';
import { quality } from './quality';

/**
 * Screen-space post: bloom, chromatic aberration, vignette, flash, grain.
 *
 * The world is drawn once into an offscreen buffer instead of straight to the
 * canvas — you cannot bloom or split channels on pixels you have already handed
 * to the compositor. The HUD is deliberately *not* in that buffer; it is drawn
 * onto the real canvas afterwards so its text never picks up a fringe.
 *
 * **Everything happens inside that buffer, and it leaves by a single blit.**
 * That is the whole performance story of this file. An earlier version applied
 * each effect to the visible canvas in turn: eight full-resolution blend passes
 * a frame, several of them reading the destination back. Measured on an M3 at
 * 1470x956 with a 2x device ratio that was 9.7ms a frame of pure fill rate
 * against 1.0ms of actual work — and on a fanless machine it only gets worse as
 * the chassis warms. The buffer is 70% of the visible resolution, so the same
 * effect costs half as much there, and a pass that never touches the real
 * canvas is a pass the compositor never has to think about.
 *
 * Nothing here uses `ctx.filter`. See `glow.ts` for why that matters; the bloom
 * below is a downsample pyramid instead, which is both cheaper and a better
 * falloff than a single blur.
 */

/** Half-size buffers for the chromatic split; the fringe is soft anyway. */
const TINT_DIV = 2;
/** Cap on scene-buffer pixels; a 4K window must not allocate a 33MP blur. */
const MAX_PIXELS = 2_600_000;

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

interface Level {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
}

function makeLevel(w: number, h: number): Level {
  const c = makeCanvas(w, h);
  return { c, g: c.getContext('2d')! };
}

export class PostFX {
  readonly scene: HTMLCanvasElement;
  readonly sceneCtx: CanvasRenderingContext2D;

  /** Bloom pyramid, coarsest last. */
  private bloom: Level[] = [];
  /** Two half-size buffers for the chromatic split and its accumulation. */
  private tint: Level;
  private ghostAcc: Level;

  private grain: HTMLCanvasElement;
  private grainPattern: CanvasPattern | null = null;
  private scanTile: HTMLCanvasElement | null = null;
  private scanPattern: CanvasPattern | null = null;
  private vignette: CanvasGradient | null = null;
  private vignetteKey = '';
  private edge: CanvasGradient | null = null;
  private edgeKey = '';

  private q = 1;
  private lastW = 0;
  private lastH = 0;
  private lastDiv = 0;
  private grainPhase = 0;

  constructor() {
    this.scene = makeCanvas(2, 2);
    this.sceneCtx = this.scene.getContext('2d', { alpha: false })!;
    this.tint = makeLevel(2, 2);
    this.ghostAcc = makeLevel(2, 2);
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

    // Three pyramid levels. The coarsest is a few thousand pixels, so the whole
    // chain costs less than one full-resolution pass used to.
    this.bloom = [];
    let lw = w;
    let lh = h;
    for (let i = 0; i < 3; i++) {
      lw = Math.max(1, Math.round(lw / div));
      lh = Math.max(1, Math.round(lh / div));
      this.bloom.push(makeLevel(lw, lh));
    }

    const tw = Math.max(1, Math.round(w / TINT_DIV));
    const th = Math.max(1, Math.round(h / TINT_DIV));
    this.tint = makeLevel(tw, th);
    this.ghostAcc = makeLevel(tw, th);
    this.vignette = null;
    this.edge = null;
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
    c.filter = 'none';
    // The room's void, not the palette's. This clear is what shows through the
    // letterboxing when the arena's aspect does not match the window's, so a
    // sector whose surround stayed the old black would wear a frame of the
    // previous room around it.
    c.fillStyle = rgba(theme.void, 1);
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
  /**
   * A downsample pyramid, accumulated coarse-to-fine and composited once.
   *
   * Each level is a bilinear box average of the one above, so three levels give
   * a soft, wide falloff that a single blur radius cannot — and the arithmetic
   * happens on canvases of a few thousand pixels rather than a few million.
   */
  private buildBloom(levels: number) {
    const n = Math.min(levels, this.bloom.length);
    let src: HTMLCanvasElement = this.scene;
    for (let i = 0; i < n; i++) {
      const L = this.bloom[i];
      L.g.setTransform(1, 0, 0, 1, 0, 0);
      L.g.globalCompositeOperation = 'source-over';
      L.g.globalAlpha = 1;
      L.g.clearRect(0, 0, L.c.width, L.c.height);
      L.g.drawImage(src, 0, 0, L.c.width, L.c.height);
      // Bright pass, on the first level only.
      //
      // This pyramid had no threshold, so it bloomed the entire frame — the
      // near-black floor included — and lifted the blacks the neon actors are
      // supposed to sit against. Measured, the six rooms had a luma standard
      // deviation of 18.6 to 22.7: a flat picture, and not by intent.
      //
      // canvas2d has no shader to threshold with, but `multiply` from the same
      // source squares every channel, which is a perfectly good soft knee. A
      // floor at 0.08 falls to 0.006 and stops blooming; a strike at 0.95 stays
      // at 0.90 and still does. It costs one extra blit on a buffer a few
      // thousand pixels wide, and `src !== dst` here so it is well defined.
      if (i === 0) {
        L.g.globalCompositeOperation = 'multiply';
        L.g.drawImage(src, 0, 0, L.c.width, L.c.height);
        L.g.globalCompositeOperation = 'source-over';
      }
      src = L.c;
    }
    // Fold coarse levels down into level 0, so only one buffer is composited.
    for (let i = n - 1; i > 0; i--) {
      const dst = this.bloom[i - 1];
      dst.g.globalCompositeOperation = 'lighter';
      dst.g.globalAlpha = 0.72;
      dst.g.drawImage(this.bloom[i].c, 0, 0, dst.c.width, dst.c.height);
      dst.g.globalAlpha = 1;
      dst.g.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Isolate one channel by multiplying the scene with a pure primary. Both
   * ghosts are accumulated in a half-size buffer and composited together, so
   * the fringe costs one pass rather than two — and it runs at exactly the
   * moment the screen is busiest, which is the moment that matters.
   */
  private buildGhosts(ab: number) {
    const t = this.tint.g;
    const tw = this.tint.c.width;
    const th = this.tint.c.height;
    const acc = this.ghostAcc.g;

    acc.setTransform(1, 0, 0, 1, 0, 0);
    acc.globalCompositeOperation = 'source-over';
    acc.globalAlpha = 1;
    acc.clearRect(0, 0, tw, th);

    // Half-buffer offset: the shift is authored in CSS pixels.
    const k = (ab * this.q) / TINT_DIV;
    for (const [mult, dx] of [['#ff0044', -k], ['#00ffee', k]] as const) {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'source-over';
      t.globalAlpha = 1;
      t.clearRect(0, 0, tw, th);
      t.drawImage(this.scene, dx, 0, tw, th);
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = mult;
      t.fillRect(0, 0, tw, th);
      t.globalCompositeOperation = 'source-over';

      acc.globalCompositeOperation = 'lighter';
      acc.drawImage(this.tint.c, 0, 0);
    }
    acc.globalCompositeOperation = 'source-over';
  }

  /**
   * Every full-frame effect, applied inside the scene buffer.
   *
   * Called after the world is drawn and before the single blit out. Ordering is
   * the same as it always was — fringe, bloom, vignette, danger, flash — it
   * simply happens somewhere cheaper.
   */
  post(game: Game) {
    const Q = quality.current;
    const c = this.sceneCtx;
    const w = this.scene.width;
    const h = this.scene.height;
    const speed = game.player.speedNorm;
    const j = game.juice;

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    const ab = Q.chroma ? speed * 5.2 + j.fringe * 4.4 : 0;
    if (ab > 0.4) {
      this.buildGhosts(ab);
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = clamp(0.1 + ab * 0.03, 0, 0.42);
      c.drawImage(this.ghostAcc.c, 0, 0, w, h);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }

    if (Q.bloom > 0) {
      this.buildBloom(Q.bloom > 1 ? 3 : 2);
      // Kept low: additive bloom compounds, and the enemy silhouettes have to
      // stay legible at the exact moment the screen is brightest — which is the
      // moment the player is deciding where to go next.
      c.globalCompositeOperation = 'lighter';
      // Raised hard from 0.3, because the bright pass above squares the buffer
      // and a thresholded bloom carries a fraction of the energy an
      // unthresholded one did. At 0.52 the blacks came back beautifully — deep
      // black went from nothing to a quarter of the range's frame — but the
      // highlights lost their glow with them and contrast did not move at all.
      // A high alpha is only dangerous when the floor is in the buffer. It
      // isn't any more, so the neon can have all of it.
      //
      // Clamped to 1 and not beyond: `globalAlpha` outside [0,1] is ignored by
      // the spec, so the assignment would silently no-op and leave whatever the
      // previous alpha happened to be. Extra gain comes from a second additive
      // pass instead, which is well defined.
      const gain = 0.92 + speed * 0.18 + j.flash * 0.4;
      const b = this.bloom[0].c;
      c.globalAlpha = clamp(gain, 0, 1);
      c.drawImage(b, -6, -6, w + 12, h + 12);
      if (gain > 1) {
        c.globalAlpha = clamp(gain - 1, 0, 1);
        c.drawImage(b, -6, -6, w + 12, h + 12);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }

    // Vignette. After bloom, so the corners actually stay dark. Built once per
    // buffer size and dimmed with globalAlpha — scaling every stop by a
    // constant is exactly what globalAlpha does.
    const key = `${w}x${h}`;
    if (this.vignetteKey !== key || !this.vignette) {
      const g = c.createRadialGradient(
        w * 0.5, h * 0.5, Math.min(w, h) * 0.26,
        w * 0.5, h * 0.5, Math.max(w, h) * 0.78,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      this.vignette = g;
      this.vignetteKey = key;
    }
    // Was a flat 0.5 + aim, ungated and identical in every room — and since it
    // is strongest exactly where the surround is, it was erasing the horizon
    // each sector had just been given. Rooms that own their darkness (blackout)
    // still want it; rooms with weather out there want much less of it.
    c.globalAlpha = theme.vignette + game.aimBlend * 0.22;
    c.fillStyle = this.vignette;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;

    // Danger bleed at the top and bottom edges while the hull is critical.
    if (game.inDanger) {
      if (this.edgeKey !== key || !this.edge) {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, rgba(COL.danger, 1));
        g.addColorStop(0.25, rgba(COL.danger, 0));
        g.addColorStop(0.75, rgba(COL.danger, 0));
        g.addColorStop(1, rgba(COL.danger, 1));
        this.edge = g;
        this.edgeKey = key;
      }
      c.globalAlpha = 0.12 + 0.12 * Math.sin(game.clock * 7);
      c.fillStyle = this.edge;
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }

    if (j.flash > 0.002) {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = rgba(j.flashCol, Math.min(0.85, j.flash));
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
    }

    // Grain lives here rather than over the finished frame: half the pixels,
    // and it stops the one blend mode that reads the destination back from
    // touching the HUD, which was never meant to be post-processed anyway.
    if (Q.grain) {
      this.grainPhase = (this.grainPhase + 11) % 160;
      if (!this.grainPattern) this.grainPattern = c.createPattern(this.grain, 'repeat');
      if (this.grainPattern) {
        c.save();
        c.globalCompositeOperation = 'overlay';
        c.globalAlpha = 0.05 + speed * 0.03;
        c.fillStyle = this.grainPattern;
        c.translate(-this.grainPhase, (this.grainPhase * 1.7) % 160);
        c.fillRect(0, 0, w + 160, h + 160);
        c.restore();
      }
    }
  }

  /**
   * The finished world, blitted out in one pass.
   *
   * NB: the caller's transform (device-pixel-ratio scaling) is left alone —
   * everything from here down is authored in CSS pixels.
   */
  composite(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.scene, 0, 0, view.w, view.h);
    ctx.restore();
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

  /**
   * Scanlines over everything, last — the one effect that deliberately crosses
   * the HUD, because a scanline that stops at the readouts stops reading as a
   * screen. 3px pitch, very low contrast.
   *
   * `source-over`, not `multiply`: the source here is pure black, and
   * `black * dst` composited at alpha a is `(1-a)*dst` — the exact result of
   * painting black over it at the same alpha. Identical image, no readback.
   */
  finish(ctx: CanvasRenderingContext2D) {
    if (!quality.current.grain) return;
    const scan = this.ensureScanline(ctx);
    if (!scan) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = scan;
    ctx.fillRect(0, 0, view.w * view.dpr, view.h * view.dpr);
    ctx.restore();
  }
}
