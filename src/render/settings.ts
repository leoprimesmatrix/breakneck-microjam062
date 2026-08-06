import { COL, rgba } from '../config';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { IS_TOUCH, drawUI, drawVec, fitVec } from './text';

/**
 * The settings panel, and the gear that opens it.
 *
 * Drawn in immediate mode: every frame this clears `game.uiHits` and re-pushes
 * a rectangle for each thing that can be clicked, and `Game.stepUi` hit-tests
 * the cursor against that list. The alternative — a retained widget tree that
 * has to be rebuilt whenever the viewport changes — is a great deal of
 * machinery for four controls that are laid out from `view` anyway.
 *
 * The one consequence worth knowing: the step runs *before* the render, so the
 * hit list a click is tested against is one frame old. At 120Hz that is eight
 * milliseconds of staleness on a panel that does not move, which is why it is
 * an acceptable trade rather than a bug waiting to happen.
 */

/** Slider tracks are hit-tested with vertical slop: they are thin, fingers are not. */
export const SLIDER_GRAB = 18;

const scale = () => Math.max(0.6, Math.min(1.5, view.h / 860));

/** Panel geometry, computed the same way by the renderer and the hit-tester. */
export function panelRect() {
  const S = scale();
  const w = Math.min(430 * S, view.w * 0.9);
  const h = 268 * S;
  return { S, w, h, x: (view.w - w) * 0.5, y: (view.h - h) * 0.5 };
}

/** Where a row's slider track sits inside the panel. */
export function trackRect(row: number) {
  const p = panelRect();
  const padX = 28 * p.S;
  const x = p.x + padX + 74 * p.S;
  const w = p.w - padX * 2 - 74 * p.S - 52 * p.S;
  return { x, w, y: p.y + 96 * p.S + row * 46 * p.S, S: p.S };
}

/**
 * Bottom right, not top right.
 *
 * The pause screen draws the HUD underneath it, and the score group lives in
 * the top right corner — a gear there sits directly on top of the number the
 * player paused to look at. The bottom right is the one corner that is empty on
 * both screens the gear appears on.
 */
export function gearRect() {
  const S = scale();
  const d = 42 * S;
  return { x: view.w - d - 20 * S, y: view.h - d - 20 * S, w: d, h: d, S };
}

// ------------------------------------------------------------------- drawing
/**
 * The gear. Drawn rather than typeset, because the game ships no icon font and
 * a "⚙" from the system emoji set would be the one thing on screen that came
 * from somewhere else.
 */
function gear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number) {
  const teeth = 8;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = spin + (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    // Alternating radius around the circle: out for a tooth, in for the gap.
    for (const [t, rad] of [
      [0.0, 1.0], [0.16, 1.0], [0.26, 0.74], [0.74, 0.74], [0.84, 1.0],
    ] as const) {
      const a = a0 + step * t;
      const rr = r * rad;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0 && t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawGear(ctx: CanvasRenderingContext2D, game: Game) {
  const g = gearRect();
  const cx = g.x + g.w * 0.5;
  const cy = g.y + g.h * 0.5;
  const hot = hovering(game, g) || game.settingsOpen;

  ctx.save();
  ctx.lineWidth = 1.7 * g.S;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(hot ? COL.strike : COL.dim, hot ? 0.95 : 0.5);
  // Turns only under the cursor. A gear spinning forever in the corner of a
  // title screen pulls the eye away from the thing the title is selling.
  gear(ctx, cx, cy, g.w * 0.42, hot ? game.clock * 0.9 : 0);
  ctx.restore();

  game.uiHits.push({ id: 'gear', ...g });
}

function hovering(game: Game, r: { x: number; y: number; w: number; h: number }) {
  if (!game.input.pointerActive) return false;
  const x = game.input.cursorScreenX();
  const y = game.input.cursorScreenY();
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function slider(
  ctx: CanvasRenderingContext2D,
  game: Game,
  row: number,
  id: string,
  label: string,
  value: number,
  dimmed: boolean,
) {
  const t = trackRect(row);
  const S = t.S;
  const cy = t.y;
  const a = dimmed ? 0.35 : 1;

  drawUI(ctx, label, t.x - 16 * S, cy + 4 * S, {
    size: 11 * S,
    weight: 700,
    tracking: 2.6 * S,
    align: 'right',
    color: rgba(COL.dim, 0.85 * a),
  });

  // Track.
  ctx.fillStyle = rgba(COL.dim, 0.16 * a);
  ctx.fillRect(t.x, cy - 2 * S, t.w, 4 * S);

  // Filled portion, and the handle.
  const hot = game.uiDrag === id || hovering(game, { x: t.x, y: cy - SLIDER_GRAB * 0.5, w: t.w, h: SLIDER_GRAB });
  ctx.fillStyle = rgba(COL.strike, (hot ? 0.95 : 0.7) * a);
  ctx.fillRect(t.x, cy - 2 * S, t.w * value, 4 * S);

  const hx = t.x + t.w * value;
  ctx.beginPath();
  ctx.arc(hx, cy, (hot ? 8 : 6.5) * S, 0, Math.PI * 2);
  ctx.fillStyle = rgba(COL.playerCore, 0.95 * a);
  ctx.fill();

  drawUI(ctx, `${Math.round(value * 100)}`, t.x + t.w + 40 * S, cy + 4 * S, {
    size: 11 * S,
    weight: 700,
    align: 'right',
    color: rgba(COL.ink, 0.7 * a),
  });

  game.uiHits.push({ id, x: t.x, y: cy - SLIDER_GRAB * 0.5, w: t.w, h: SLIDER_GRAB });
}

export function drawSettings(ctx: CanvasRenderingContext2D, game: Game) {
  const p = panelRect();
  const S = p.S;

  // Its own scrim. The panel opens over the title and over the pause screen,
  // and both of those are already dimmed by different amounts — dimming again
  // from here is what makes it look like one panel in both places.
  ctx.fillStyle = rgba(COL.void, 0.66);
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.fillStyle = rgba(COL.void, 0.985);
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeStyle = rgba(COL.strike, 0.28);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

  drawVec(ctx, 'SETTINGS', p.x + p.w * 0.5, p.y + 40 * S, {
    size: fitVec('SETTINGS', p.w * 0.7, 26 * S, 0.26),
    weight: 0.12,
    tracking: 0.26,
    align: 'center',
    baseline: 'mid',
    color: rgba(COL.ink, 1),
    glow: 1.1,
    glowColor: rgba(COL.strike, 1),
  });

  const muted = game.audio.isMuted;
  slider(ctx, game, 0, 'music', 'MUSIC', game.audio.musicVolume, muted);
  slider(ctx, game, 1, 'sfx', 'SFX', game.audio.sfxVolume, muted);

  // Mute, as a row rather than a slider: it is a different kind of decision and
  // giving it a track would invite someone to drag it.
  const t = trackRect(2);
  const bx = t.x - 16 * S - 58 * S;
  const box = { id: 'mute', x: bx, y: t.y - 13 * S, w: 58 * S, h: 26 * S };
  const on = muted;
  ctx.fillStyle = rgba(on ? COL.strike : COL.dim, on ? 0.28 : 0.12);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = rgba(on ? COL.strike : COL.dim, on ? 0.8 : 0.35);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  drawUI(ctx, on ? 'ON' : 'OFF', box.x + box.w * 0.5, box.y + box.h * 0.5 + 4 * S, {
    size: 10 * S,
    weight: 700,
    tracking: 1.6 * S,
    align: 'center',
    color: rgba(on ? COL.strike : COL.dim, 0.95),
  });
  drawUI(ctx, 'MUTE ALL', box.x + box.w + 14 * S, t.y + 4 * S, {
    size: 11 * S,
    weight: 700,
    tracking: 2.6 * S,
    color: rgba(COL.dim, 0.85),
  });
  game.uiHits.push(box);

  const close = {
    id: 'close',
    x: p.x + p.w * 0.5 - 62 * S,
    y: p.y + p.h - 52 * S,
    w: 124 * S,
    h: 32 * S,
  };
  const hot = hovering(game, close);
  ctx.fillStyle = rgba(COL.strike, hot ? 0.22 : 0.1);
  ctx.fillRect(close.x, close.y, close.w, close.h);
  ctx.strokeStyle = rgba(COL.strike, hot ? 0.9 : 0.45);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(close.x + 0.5, close.y + 0.5, close.w - 1, close.h - 1);
  drawUI(ctx, IS_TOUCH ? 'DONE' : 'DONE  ·  ESC', close.x + close.w * 0.5, close.y + 21 * S, {
    size: 10 * S,
    weight: 700,
    tracking: 1.8 * S,
    align: 'center',
    color: rgba(COL.ink, 0.85),
  });
  game.uiHits.push(close);
}
