import { COL, rgba } from '../config';
import { TAU, clamp } from '../engine/math';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { drawHud } from './hud';
import { PostFX } from './postfx';
import { drawScene } from './scene';
import { drawScreens } from './screens';

/**
 * Frame assembly, in the order that matters:
 *
 *   world  -> offscreen buffer (gets bloom, fringe, shake, lens punch)
 *   HUD    -> real canvas      (crisp: never post-processed)
 *   screens-> real canvas
 *   grain  -> everything
 *   cursor -> above all of it
 */

const fx = new PostFX();

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

  const scene = fx.begin(game);
  drawScene(scene, game);

  fx.composite(ctx, game);
  if (game.state === 'play' || game.state === 'paused') drawHud(ctx, game);
  drawScreens(ctx, game);
  fx.finish(ctx, game);
  drawCursor(ctx, game);
}

/**
 * A custom reticle. The native arrow cursor is the single loudest reminder that
 * a canvas game is a web page, and hiding it costs nothing.
 */
function drawCursor(ctx: CanvasRenderingContext2D, game: Game) {
  if (!game.input.pointerActive) return;
  const x = game.input.cursorScreenX();
  const y = game.input.cursorScreenY();
  if (!isFinite(x) || !isFinite(y)) return;

  const S = clamp(view.h / 860, 0.7, 1.5);
  const held = game.input.holding;
  const spin = game.clock * (held ? 2.6 : 0.9);
  const r = (held ? 15 : 11) * S;

  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(held ? COL.playerCore : COL.strike, held ? 0.95 : 0.7);
  ctx.lineWidth = 1.8 * S;

  // Three arcs orbiting a dot: reads as a targeting device, and the spin rate
  // is a free second channel telling the player the aim is live.
  for (let i = 0; i < 3; i++) {
    const a = spin + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r, a, a + 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(COL.playerCore, 0.9);
  ctx.fillRect(-1.4 * S, -1.4 * S, 2.8 * S, 2.8 * S);

  if (held) {
    ctx.strokeStyle = rgba(COL.strike, 0.5);
    ctx.lineWidth = 1 * S;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}
