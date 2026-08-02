import type { Game } from '../game/game';
import { drawHud } from './hud';
import { PostFX } from './postfx';
import { drawScene, effectivePalette } from './scene';
import { drawDead, drawTitle } from './screens';
import { drawSurround, measure } from './surround';

/**
 * Frame orchestration.
 *
 * Five passes, in this order, because each one depends on the last:
 *
 *   1. surround   — the exterior, in canvas pixels, filling the whole window
 *   2. scene      — the shaft, into an offscreen buffer at shaft resolution
 *   3. composite  — that buffer blitted back with bloom and chromatic split
 *   4. hud        — drawn straight onto the canvas so it stays sharp
 *   5. finish     — grain and scanlines over everything
 *
 * The scene has to be offscreen for step 3 to exist at all, and the HUD has to
 * be outside it or the bloom would smear the one thing that must stay legible.
 */

const fx = new PostFX();

/** Below this flank width there is no room for exterior telemetry. */
const COMPACT_FLANK = 132;

export function render(
  ctx: CanvasRenderingContext2D,
  game: Game,
  w: number,
  h: number,
  dpr: number,
) {
  const v = measure(w, h);
  const odI = game.od.intensity;
  const pal = effectivePalette(game.palette, odI);
  const speed = game.state === 'title' ? 0.42 : game.player.speedNorm;

  // --- 1. exterior, in CSS pixel space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  drawSurround(ctx, v, game, pal);

  // --- 2. shaft, offscreen
  fx.setQuality(v.scale * dpr);
  drawScene(fx.begin(), game, pal);

  // --- 3. composite with post
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.composite(ctx, {
    ox: v.ox,
    oy: v.oy,
    ow: v.ow,
    oh: v.oh,
    speed,
    overdrive: odI,
    glow: pal.glow,
  });

  // --- 4. hud and overlays, in shaft-local logical units
  const s = v.scale * dpr;
  ctx.setTransform(s, 0, 0, s, v.ox * dpr, v.oy * dpr);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  drawHud(ctx, game, pal, v.flank < COMPACT_FLANK);
  if (game.state === 'title') drawTitle(ctx, game, pal);
  else if (game.state === 'dead') drawDead(ctx, game, pal);

  // --- 5. film pass over the whole window
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.finish(ctx, w, h, speed, odI);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
