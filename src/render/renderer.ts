import type { Game } from '../game/game';
import { view } from '../viewport';
import { drawHud } from './hud';
import { PostFX } from './postfx';
import { drawScene, effectivePalette } from './scene';
import { drawDead, drawTitle } from './screens';

/**
 * Frame orchestration.
 *
 * Four passes, in this order, because each depends on the last:
 *
 *   1. scene      — the playfield, into an offscreen buffer at viewport aspect
 *   2. composite  — that buffer blitted back with bloom and chromatic split
 *   3. hud        — drawn straight onto the canvas so it stays sharp
 *   4. finish     — grain and scanlines over everything
 *
 * There is no longer a surround pass: the playfield fills the window, so the
 * exterior it used to draw has nowhere to be. Its parallax motifs now live in
 * the scene's background layers.
 */

const fx = new PostFX();

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  const melt = game.heat.meltIntensity;
  const pal = effectivePalette(game.palette, melt);
  const speed = game.state === 'title' ? 0.42 : game.player.speedNorm;
  const burn = game.state === 'play' && game.burning ? game.heat.overload : 0;

  // --- 1. playfield, offscreen
  drawScene(fx.begin(), game, pal);

  // --- 2. composite with post, filling the canvas
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  fx.composite(ctx, { w: view.w, h: view.h, speed, melt, burn });

  // --- 3. hud and overlays, in logical units
  const s = view.scale * view.dpr;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  drawHud(ctx, game, pal);
  if (game.state === 'title') drawTitle(ctx, game, pal);
  else if (game.state === 'dead') drawDead(ctx, game, pal);

  // --- 4. film pass over the whole window
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  fx.finish(ctx, view.w, view.h, speed, melt);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
