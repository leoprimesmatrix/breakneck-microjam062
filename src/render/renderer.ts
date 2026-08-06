import { COL, rgba } from '../config';
import { TAU, clamp } from '../engine/math';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { sceneGlow, setGlowTarget, uiGlow } from './glow';
import { drawHud } from './hud';
import { PostFX } from './postfx';
import { quality } from './quality';
import { drawScene } from './scene';
import { drawOverlay, drawScreens } from './screens';
import { drawUI, mono, uiWidth } from './text';

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

/**
 * Stage suppression, for attributing a frame's cost by difference. Timing a
 * stage in isolation lies badly for the blend-mode passes — run twenty of them
 * back to back with no opaque draw in between and every one has to read the
 * previous result back. The only honest measurement is a whole frame with one
 * stage removed. Folds away in a build.
 */
export const skip = new Set<string>();
const off = (s: string) => import.meta.env.DEV && skip.has(s);

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const lit = quality.current.textGlow;
  const dw = view.w * view.dpr;
  const dh = view.h * view.dpr;

  // World. Its halos land in the scene accumulator and are flushed before post,
  // so the bloom downstream picks them up like any other light in the room.
  const scene = fx.begin(game);
  sceneGlow.begin(fx.scene.width, fx.scene.height, lit);
  setGlowTarget(sceneGlow);
  if (!off('scene')) drawScene(scene, game);
  sceneGlow.flush(scene, fx.scene.width, fx.scene.height, 0.95);
  if (!off('post')) fx.post(game);

  if (!off('composite')) fx.composite(ctx);

  // Interface. Everything lit on the visible canvas — type, hull pips — shares
  // one accumulator and one blur, added over the top at the end of the pass.
  uiGlow.begin(dw, dh, lit);
  setGlowTarget(uiGlow);
  if (!off('hud') && (game.state === 'play' || game.state === 'paused')) drawHud(ctx, game);
  if (!off('screens')) drawScreens(ctx, game);
  uiGlow.flush(ctx, dw, dh, 0.78);
  if (!off('screens')) drawOverlay(ctx, game);

  if (!off('finish')) fx.finish(ctx);
  if (!off('cursor')) drawCursor(ctx, game);
  if (showStats) drawStats(ctx);
}

// ---------------------------------------------------------------- diagnostics
let showStats = false;

/** Bound to `F`. Off by default; nobody should have to look at this to play. */
export function toggleStats() {
  showStats = !showStats;
}

/**
 * Whether the browser will give this machine a GPU at all.
 *
 * Not a perfect proxy for canvas2d acceleration, but a decisive one in the case
 * that matters: when a browser has hardware acceleration switched off it fails
 * this too, and reports `GL_RENDERER = Disabled`. That single fact is the
 * difference between a game that is too heavy and a browser that has been told
 * not to use the graphics card — and without it, the two are indistinguishable
 * from the player's chair. Probed once, lazily, and never in a frame path.
 */
let gpuOk: boolean | null = null;
function hasGpu() {
  if (gpuOk === null) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      gpuOk = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      gpuOk = false;
    }
  }
  return gpuOk;
}

/**
 * Frame time and the tier the governor has settled on. Worth shipping rather
 * than keeping behind a dev flag: "it runs badly" is the one bug report that
 * cannot be acted on without knowing which of those two numbers is wrong.
 */
function drawStats(ctx: CanvasRenderingContext2D) {
  const ms = quality.smoothMs;
  const text =
    `${Math.round(1000 / Math.max(0.1, ms))} FPS   ${ms.toFixed(1)} MS   Q${quality.level + 1}/${quality.tiers}` +
    (hasGpu() ? '' : '   ⚠ GPU ACCEL OFF');
  const y = view.h - 12;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const w = uiWidth(ctx, text, { size: 11, font: mono, tracking: 1 });
  ctx.fillStyle = rgba(COL.void, 0.72);
  ctx.fillRect(8, y - 15, w + 16, 21);
  drawUI(ctx, text, 16, y, {
    size: 11,
    font: mono,
    tracking: 1,
    color: rgba(ms > 20 ? COL.warn : COL.focus, 0.95),
  });
  ctx.restore();
}

/**
 * Individually callable stages, for measuring where a frame actually goes.
 * `import.meta.env.DEV` is statically false in a build, so the whole object —
 * and the only reason `drawScene` and friends are reachable from outside this
 * module — disappears from the bundle.
 */
export const stages = import.meta.env.DEV
  ? {
      scene: (_ctx: CanvasRenderingContext2D, game: Game) => drawScene(fx.begin(game), game),
      post: (_ctx: CanvasRenderingContext2D, game: Game) => fx.post(game),
      composite: (ctx: CanvasRenderingContext2D) => fx.composite(ctx),
      hud: (ctx: CanvasRenderingContext2D, game: Game) => drawHud(ctx, game),
      screens: (ctx: CanvasRenderingContext2D, game: Game) => drawScreens(ctx, game),
      finish: (ctx: CanvasRenderingContext2D) => fx.finish(ctx),
      cursor: drawCursor,
    }
  : undefined;

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
