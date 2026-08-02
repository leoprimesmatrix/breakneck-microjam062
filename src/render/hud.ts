import {
  COL,
  HINT_CARD_TIME,
  MAX_HULL,
  WAVE_CARD_TIME,
  rgba,
  type RGB,
} from '../config';
import { TAU, clamp, clamp01, damp, easeOutCubic, easeOutQuint } from '../engine/math';
import { SPECS } from '../game/enemies';
import { ENEMY_COL, pad, type Game } from '../game/game';
import { view } from '../viewport';
import { glowLayer } from './glow';
import { IS_TOUCH, drawUI, drawVec, uiWidth, vecWidth } from './text';

/**
 * The HUD is drawn in *screen* pixels, after post-processing, and it lives in
 * the gutter around the arena rather than on top of it. Two consequences worth
 * the trouble: the text stays razor sharp because no bloom or chromatic pass
 * ever touches it, and nothing the player needs to aim at can be hidden behind
 * a number.
 */

/** Score rolls up to its true value rather than snapping — cheap, huge payoff. */
let shownScore = 0;
let lastClock = 0;
let hullPop = [0, 0, 0];
let lastHull = MAX_HULL;

export function resetHud() {
  shownScore = 0;
  hullPop = [0, 0, 0];
  lastHull = MAX_HULL;
}

export function drawHud(ctx: CanvasRenderingContext2D, game: Game) {
  const dt = clamp(game.clock - lastClock, 0, 0.1);
  lastClock = game.clock;

  // HUD scale follows the *smaller* of the two axes' budgets. Scaling by height
  // alone looks right on a desktop and then runs the score straight off the
  // edge of a phone held upright, where height is plentiful and width is not.
  const S = clamp(Math.min(view.h / 860, view.w / 900), 0.6, 1.4);
  const L = view.originX;
  const R = view.originX + view.arenaW * view.scale;
  const T = view.originY;
  const B = view.originY + view.arenaH * view.scale;
  const cx = (L + R) * 0.5;

  shownScore = damp(shownScore, game.score, 13, dt);
  if (Math.abs(shownScore - game.score) < 1) shownScore = game.score;

  for (let i = 0; i < hullPop.length; i++) hullPop[i] = Math.max(0, hullPop[i] - dt * 2.4);
  if (game.player.hull < lastHull) {
    for (let i = game.player.hull; i < lastHull && i < hullPop.length; i++) hullPop[i] = 1;
  }
  lastHull = game.player.hull;

  // One shared vertical rhythm for the top row: small-caps labels on `labelY`,
  // the thing they label sitting on `baseY` just above the arena's edge.
  const labelY = T - 46 * S;
  const baseY = T - 13 * S;

  drawHull(ctx, game, L, labelY, baseY, S);
  drawWave(ctx, game, cx, labelY, baseY, S);
  drawScore(ctx, game, R, labelY, baseY, S);
  drawFocus(ctx, game, L, B, (R - L) * 0.34, S);
  drawCombo(ctx, game, R, B, S);

  drawTutorial(ctx, game, S);
  drawHints(ctx, game, cx, B, S);
  // Upper third, not dead centre: on wave one the player is standing in the
  // middle of the arena, and a card printed over the ship hides the one thing
  // the tutorial is pointing at.
  drawWaveCard(ctx, game, cx, T + (B - T) * 0.3, S);
  drawDangerEdge(ctx, game);
}

// ---------------------------------------------------------------------- hull
function drawHull(
  ctx: CanvasRenderingContext2D,
  game: Game,
  x: number,
  labelY: number,
  y: number,
  S: number,
) {
  drawUI(ctx, 'HULL', x, labelY, {
    size: 10 * S,
    weight: 700,
    tracking: 2.6 * S,
    color: rgba(COL.dim, 0.8),
  });

  const w = 28 * S;
  const h = 14 * S;
  const gap = 7 * S;
  for (let i = 0; i < MAX_HULL; i++) {
    const px = x + i * (w + gap);
    const filled = i < game.player.hull;
    const pop = hullPop[i] ?? 0;
    const danger = filled && game.player.hull === 1;
    const a = danger ? 0.55 + 0.45 * Math.sin(game.clock * 8) : 1;

    ctx.save();
    ctx.translate(px + w * 0.5, y - h * 0.5);
    if (pop > 0) ctx.scale(1 + pop * 0.5, 1 + pop * 0.5);

    // Parallelogram pips — the shear ties them to the italic display face.
    const sk = h * 0.42;
    const path = (c: CanvasRenderingContext2D) => {
      c.beginPath();
      c.moveTo(-w * 0.5 + sk, -h * 0.5);
      c.lineTo(w * 0.5, -h * 0.5);
      c.lineTo(w * 0.5 - sk, h * 0.5);
      c.lineTo(-w * 0.5, h * 0.5);
      c.closePath();
    };
    path(ctx);

    if (filled) {
      const col = danger ? COL.danger : COL.hull;
      ctx.fillStyle = rgba(col, a);
      ctx.fill();
      // The bloom around a lit pip, blurred in a buffer the size of the pip
      // rather than the size of the screen.
      const r = 4;
      glowLayer(ctx, -w, -h, w * 2, h * 2, r * 3, 0.28 * a, (g, k) => {
        g.filter = `blur(${Math.max(0.4, r * k).toFixed(2)}px)`;
        g.fillStyle = rgba(col, 1);
        path(g);
        g.fill();
      });
    } else {
      ctx.strokeStyle = rgba(COL.dim, 0.35 + pop * 0.65);
      ctx.lineWidth = 1.4 * S;
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------- wave
function drawWave(
  ctx: CanvasRenderingContext2D,
  game: Game,
  cx: number,
  labelY: number,
  y: number,
  S: number,
) {
  if (game.director.title) {
    drawUI(ctx, game.director.title, cx, labelY, {
      size: 9.5 * S,
      weight: 700,
      tracking: 3.4 * S,
      align: 'center',
      color: rgba(COL.dim, 0.72),
    });
  }

  drawVec(ctx, `WAVE ${pad(game.wave)}`, cx, y - 10 * S, {
    size: 20 * S,
    weight: 0.13,
    tracking: 0.16,
    align: 'center',
    color: rgba(COL.ink, 0.95),
    slant: 0.06,
  });

  const w = 200 * S;
  const h = 3 * S;
  const bx = cx - w * 0.5;
  const by = y - 4 * S;
  ctx.fillStyle = rgba(COL.dim, 0.22);
  ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = rgba(COL.wall, 0.9);
  ctx.fillRect(bx, by, w * game.waveProgress, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(COL.wall, 0.5);
  ctx.fillRect(bx, by - 1, w * game.waveProgress, h + 2);
  ctx.globalCompositeOperation = 'source-over';
}

// --------------------------------------------------------------------- score
function drawScore(
  ctx: CanvasRenderingContext2D,
  game: Game,
  x: number,
  labelY: number,
  y: number,
  S: number,
) {
  drawUI(ctx, 'SCORE', x, labelY, {
    size: 10 * S,
    weight: 700,
    tracking: 2.6 * S,
    align: 'right',
    color: rgba(COL.dim, 0.8),
  });

  const text = group(Math.round(shownScore));
  // A tiny kick every time the counter is behind: the number reacts to a kill
  // before the player has finished registering the kill itself.
  const chase = clamp01((game.score - shownScore) / 900);
  drawVec(ctx, text, x, y, {
    size: (28 + chase * 5) * S,
    weight: 0.125,
    tracking: 0.06,
    align: 'right',
    color: rgba(COL.ink, 1),
    glow: 0.7 + chase,
    glowColor: rgba(COL.strike, 1),
    slant: 0.06,
  });
}

// --------------------------------------------------------------------- focus
function drawFocus(
  ctx: CanvasRenderingContext2D,
  game: Game,
  x: number,
  y: number,
  w: number,
  S: number,
) {
  const frac = game.focusFrac;
  const dry = frac <= 0.001;
  const h = 10 * S;

  drawUI(ctx, dry ? 'FOCUS — EMPTY' : 'FOCUS', x, y + 22 * S, {
    size: 10 * S,
    weight: 700,
    tracking: 2.6 * S,
    color: dry ? rgba(COL.danger, 0.5 + 0.5 * Math.sin(game.clock * 9)) : rgba(COL.dim, 0.8),
  });

  const by = y + 30 * S;
  const segs = 10;
  const sw = (w - (segs - 1) * 3 * S) / segs;
  for (let i = 0; i < segs; i++) {
    const px = x + i * (sw + 3 * S);
    const lo = i / segs;
    const fill = clamp01((frac - lo) * segs);
    ctx.fillStyle = rgba(COL.dim, 0.16);
    ctx.fillRect(px, by, sw, h);
    if (fill > 0) {
      const col: RGB = frac > 0.28 ? COL.focus : COL.warn;
      ctx.fillStyle = rgba(col, 0.95);
      ctx.fillRect(px, by, sw * fill, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(col, 0.3);
      ctx.fillRect(px - 1, by - 1, sw * fill + 2, h + 2);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Reminder text only when there is genuinely room for it; on a phone the
  // focus bar already reaches most of the way across.
  const note = 'HOLD TO AIM · KILLS REFILL';
  const style = { size: 9.5 * S, weight: 600, tracking: 1.6 * S } as const;
  const nx = x + w + 14 * S;
  if (nx + uiWidth(ctx, note, style) < view.w - 12 * S) {
    drawUI(ctx, note, nx, by + h - 0.5 * S, { ...style, color: rgba(COL.dim, 0.45) });
  }
}

// --------------------------------------------------------------------- combo
function drawCombo(ctx: CanvasRenderingContext2D, game: Game, x: number, y: number, S: number) {
  if (game.combo <= 1) return;
  const t = game.comboFrac;
  const text = `×${game.combo}`;
  const size = (26 + Math.min(12, game.combo * 0.7)) * S;
  const w = Math.max(vecWidth(text, { size, tracking: 0.06 }), 46 * S);

  // The label sits clear of the numeral's cap line — at ×30 the numeral is tall
  // enough to grow up into a label placed by eye.
  drawUI(ctx, 'CHAIN', x, y + 18 * S, {
    size: 10 * S,
    weight: 700,
    tracking: 2.6 * S,
    align: 'right',
    color: rgba(COL.dim, 0.8),
  });

  drawVec(ctx, text, x, y + 56 * S, {
    size,
    weight: 0.14,
    tracking: 0.06,
    align: 'right',
    color: rgba(COL.warn, 1),
    glow: 1.2,
    glowColor: rgba(COL.warn, 1),
    slant: 0.08,
  });

  // Decay bar under the multiplier: how long you have left to keep it.
  ctx.fillStyle = rgba(COL.dim, 0.2);
  ctx.fillRect(x - w, y + 62 * S, w, 3 * S);
  ctx.fillStyle = rgba(COL.warn, 0.9);
  ctx.fillRect(x - w * t, y + 62 * S, w * t, 3 * S);
}

// ------------------------------------------------------------------- teaching
function drawTutorial(ctx: CanvasRenderingContext2D, game: Game, S: number) {
  if (game.state !== 'play') return;
  // The wave card owns the centre of the screen while it is up, and on wave one
  // the player is standing in the centre — so these two would print on top of
  // each other at exactly the moment a first-time player is reading.
  if (game.waveCard > 0) return;
  const p = game.player;
  // Clamped into the frame: a strike can end with the ship against a wall, and
  // a prompt half off the screen is worse than no prompt at all.
  const rawX = p.x * view.scale + view.originX;
  const sy = p.y * view.scale + view.originY;
  const sx = clamp(rawX, view.w * 0.22, view.w * 0.78);

  let text = '';
  let sub = '';
  if (!game.hasHeld) {
    text = 'HOLD TO AIM';
    sub = IS_TOUCH ? 'TOUCH AND HOLD ANYWHERE' : 'LEFT MOUSE  ·  OR SPACE';
  } else if (!game.hasStruck) {
    text = 'RELEASE TO STRIKE';
    sub = 'EVERYTHING ON THE LINE DIES';
  } else if (game.moveTaught > 0) {
    text = 'THAT IS ALSO HOW YOU MOVE';
    sub = 'THERE IS NO OTHER MOVEMENT';
  } else if (game.focusTaught > 0) {
    text = 'KILLS REFILL FOCUS';
    sub = 'FOCUS IS YOUR SLOW MOTION';
  } else {
    return;
  }

  const pulse = 0.72 + 0.28 * Math.sin(game.clock * 4);
  // The prompt keeps a legible size even when the HUD scale shrinks on a phone.
  const TS = Math.max(S, 0.78);
  // Above the ship by default, below it when the ship is high enough that the
  // prompt would otherwise print over the HULL and SCORE readouts.
  const below = sy - 78 * S < view.originY + 34 * S;
  const y = below ? sy + 74 * S : sy - 78 * S;
  ctx.save();
  ctx.globalAlpha = pulse;
  drawVec(ctx, text, sx, y, {
    size: 22 * TS,
    weight: 0.13,
    tracking: 0.14,
    align: 'center',
    color: rgba(COL.playerCore, 1),
    glow: 1.4,
    glowColor: rgba(COL.strike, 1),
  });
  drawUI(ctx, sub, sx, y + 20 * TS, {
    size: 10.5 * TS,
    weight: 700,
    tracking: 2.4 * S,
    align: 'center',
    color: rgba(COL.focus, 0.85),
    maxWidth: view.w * 0.9,
  });
  ctx.restore();

  // A leader that always terminates on the ship, wherever the ship is.
  ctx.save();
  ctx.globalAlpha = pulse * 0.7;
  ctx.strokeStyle = rgba(COL.strike, 1);
  ctx.lineWidth = 2 * S;
  const dir = below ? -1 : 1;
  const startY = below ? y - 30 * S : y + 30 * S;
  const tipX = rawX;
  const tipY = sy + 34 * S * dir;
  ctx.beginPath();
  ctx.moveTo(sx, startY);
  ctx.lineTo(sx, startY + 12 * S * dir);
  ctx.lineTo(tipX, tipY - 10 * S * dir);
  ctx.lineTo(tipX, tipY);
  ctx.moveTo(tipX - 5 * S, tipY - 8 * S * dir);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX + 5 * S, tipY - 8 * S * dir);
  ctx.stroke();
  ctx.restore();
}

function drawHints(ctx: CanvasRenderingContext2D, game: Game, cx: number, bottom: number, S: number) {
  const hint = game.hints[0];
  if (!hint) return;
  const spec = SPECS[hint.kind];
  const col = ENEMY_COL[hint.kind];

  const t = 1 - hint.life / HINT_CARD_TIME;
  const inA = easeOutQuint(clamp01(t * 6));
  const outA = t > 0.86 ? 1 - (t - 0.86) / 0.14 : 1;
  const a = inA * outA;

  const w = Math.min(400 * S, view.w * 0.92);
  const h = 68 * S;
  const x = cx - w * 0.5;
  const y = bottom - h - 26 * S + (1 - inA) * 22 * S;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = rgba(COL.void, 0.86);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(col, 0.55);
  ctx.lineWidth = 1.4 * S;
  ctx.strokeRect(x, y, w, h);
  // Accent bar keyed to the enemy's colour, so the card and the thing on screen
  // are obviously the same subject.
  ctx.fillStyle = rgba(col, 0.95);
  ctx.fillRect(x, y, 4 * S, h);

  drawUI(ctx, 'NEW CONTACT', x + 74 * S, y + 22 * S, {
    size: 9 * S,
    weight: 700,
    tracking: 2.6 * S,
    color: rgba(COL.dim, 0.75),
  });
  drawVec(ctx, spec.name, x + 74 * S, y + 42 * S, {
    size: 20 * S,
    weight: 0.13,
    tracking: 0.14,
    color: rgba(col, 1),
    glow: 1,
    glowColor: rgba(col, 1),
  });
  drawUI(ctx, spec.rule, x + 74 * S, y + 58 * S, {
    size: 11 * S,
    weight: 600,
    tracking: 0.4 * S,
    color: rgba(COL.ink, 0.82),
    maxWidth: w - 86 * S,
  });

  // A live thumbnail of the enemy, spinning in its own little cell.
  ctx.save();
  ctx.translate(x + 38 * S, y + h * 0.5);
  ctx.scale(S * 0.82, S * 0.82);
  drawEnemyIcon(ctx, hint.kind, game.clock);
  ctx.restore();
  ctx.restore();
}

/** Simplified enemy silhouettes for cards and the legend. */
export function drawEnemyIcon(ctx: CanvasRenderingContext2D, kind: string, clock: number) {
  const col = ENEMY_COL[kind as keyof typeof ENEMY_COL] ?? COL.ink;
  const r = 15;
  ctx.strokeStyle = rgba(col, 1);
  ctx.fillStyle = rgba(col, 0.18);
  ctx.lineWidth = 2.2;
  ctx.save();

  switch (kind) {
    case 'mote':
      ctx.rotate(clock * 1.2);
      shape(ctx, [[0, -r], [r * 0.62, 0], [0, r], [-r * 0.62, 0]]);
      break;
    case 'seeder':
      ctx.rotate(clock * 0.5);
      shape(ctx, [[-r, -r], [r, -r], [r, r], [-r, r]]);
      break;
    case 'ward': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        pts.push([Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8]);
      }
      shape(ctx, pts);
      ctx.strokeStyle = rgba(col, 1);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.25, -0.95 + Math.sin(clock) * 0.6, 0.95 + Math.sin(clock) * 0.6);
      ctx.stroke();
      break;
    }
    case 'lancer':
      ctx.rotate(Math.sin(clock * 0.8) * 0.5);
      shape(ctx, [[r * 1.3, 0], [-r * 0.75, -r * 0.9], [-r * 0.35, 0], [-r * 0.75, r * 0.9]]);
      break;
    case 'spine': {
      ctx.rotate(clock * 0.4);
      const pts: [number, number][] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const rr = i % 2 === 0 ? r : r * 0.55;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      shape(ctx, pts);
      break;
    }
  }
  ctx.restore();
}

function shape(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// ----------------------------------------------------------------- wave card
function drawWaveCard(ctx: CanvasRenderingContext2D, game: Game, cx: number, cy: number, S: number) {
  if (game.waveCard <= 0) return;
  const t = 1 - game.waveCard / WAVE_CARD_TIME;
  const inA = easeOutQuint(clamp01(t * 3.2));
  const outA = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
  const a = inA * outA;
  if (a <= 0.002) return;

  const y = cy - 40 * S;
  const slide = (1 - inA) * 60 * S;

  ctx.save();
  ctx.globalAlpha = a;

  // Two rules that sweep out from the centre — the card builds itself.
  const rw = 300 * S * easeOutCubic(clamp01(t * 4));
  ctx.fillStyle = rgba(COL.wall, 0.55);
  ctx.fillRect(cx - rw * 0.5, y - 34 * S, rw, 1.5 * S);
  ctx.fillRect(cx - rw * 0.5, y + 30 * S, rw, 1.5 * S);

  drawVec(ctx, `WAVE ${pad(game.wave)}`, cx + slide, y, {
    size: 52 * S,
    weight: 0.11,
    tracking: 0.2,
    align: 'center',
    baseline: 'mid',
    color: rgba(COL.ink, 1),
    glow: 1.5,
    glowColor: rgba(COL.strike, 1),
    slant: 0.08,
    progress: clamp01(t * 3.4),
  });

  if (game.director.title) {
    drawUI(ctx, game.director.title, cx - slide, y + 52 * S, {
      size: 13 * S,
      weight: 700,
      tracking: 6 * S,
      align: 'center',
      color: rgba(COL.focus, 0.9),
    });
  }
  ctx.restore();
}

// -------------------------------------------------------------------- danger
let edge: CanvasGradient | null = null;
let edgeH = 0;

function drawDangerEdge(ctx: CanvasRenderingContext2D, game: Game) {
  if (!game.inDanger) return;
  // Built at full strength once per window height and dimmed with globalAlpha;
  // the pulse is a constant scale on every stop, which is what globalAlpha is.
  if (!edge || edgeH !== view.h) {
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, rgba(COL.danger, 1));
    g.addColorStop(0.25, rgba(COL.danger, 0));
    g.addColorStop(0.75, rgba(COL.danger, 0));
    g.addColorStop(1, rgba(COL.danger, 1));
    edge = g;
    edgeH = view.h;
  }
  ctx.save();
  ctx.globalAlpha = 0.1 + 0.1 * Math.sin(game.clock * 7);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
}

// ------------------------------------------------------------------ utilities
/** 1234567 -> "1,234,567". Grouping makes a big number read as an achievement. */
export function group(n: number) {
  const s = String(Math.max(0, Math.floor(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}
