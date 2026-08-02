import {
  CORE,
  GLASS,
  GRATE,
  HEAT_REDLINE,
  MELT_AT,
  PLATE,
  ZONE_DEPTH,
  type Material,
} from '../config';
import { clamp, lerp } from '../engine/math';
import { brighten, darken, MOLTEN, mixRGB, type Palette, rgba } from '../game/biomes';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { body, drawTracked, fitSize, heavy, mono, trackedWidth } from './type';

/**
 * Front-of-house: the title lockup and the results screen.
 *
 * These decide whether a jam judge plays a second run, so they get the same
 * effort as the gameplay. The title has to teach the entire mechanic without a
 * paragraph, and the results screen has to make the number feel worth beating.
 */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Screen furniture is centred on a fixed column so it reads at any aspect. */
const panelW = () => Math.min(view.logicalW - 60, 560);

// ------------------------------------------------------------------ title
export function drawTitle(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const W = view.logicalW;
  const H = view.logicalH;
  const t = game.clock;

  // Heavy scrim. The attract shaft streams barriers at full contrast behind the
  // lockup; under ~0.9 they punch through the copy and the screen reads as noise.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(darken(pal.bg, 0.3), 0.97));
  g.addColorStop(0.3, rgba(pal.bg, 0.9));
  g.addColorStop(0.75, rgba(pal.bg, 0.94));
  g.addColorStop(1, rgba(darken(pal.bg, 0.35), 0.98));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawEyebrow(ctx, pal);
  drawWordmark(ctx, pal, t);
  drawHeatDiagram(ctx, pal, t);

  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.55);
  drawTracked(
    ctx,
    `GO DEEP — A NEW ZONE EVERY ${ZONE_DEPTH}M · DIE, GET RANKED, RUN AGAIN`,
    W * 0.5,
    H * 0.375 + 214,
    1.8,
  );

  drawControls(ctx, pal);
  drawPrompt(ctx, game, pal, t);
}

function drawEyebrow(ctx: CanvasRenderingContext2D, pal: Palette) {
  const W = view.logicalW;
  const y = view.logicalH * 0.115;
  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.75);
  drawTracked(ctx, 'MICRO JAM 062', W * 0.5, y, 5);

  const w = trackedWidth(ctx, 'MICRO JAM 062', 5);
  ctx.fillStyle = rgba(pal.glow, 0.35);
  ctx.fillRect(W * 0.5 - w * 0.5 - 34, y - 1, 24, 1.5);
  ctx.fillRect(W * 0.5 + w * 0.5 + 10, y - 1, 24, 1.5);
}

function drawWordmark(ctx: CanvasRenderingContext2D, pal: Palette, t: number) {
  const cx = view.logicalW * 0.5;
  const y = view.logicalH * 0.235;
  const track = 2;
  const size = fitSize(ctx, 'BREAKNECK', panelW(), 62, track);
  const w = trackedWidth(ctx, 'BREAKNECK', track * (size / 62));
  const tr = track * (size / 62);

  // Speed slash sweeping behind the type, on the same clock as the shimmer.
  const sweep = (t * 0.45) % 2.6;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sg = ctx.createLinearGradient(cx - w * 0.6, 0, cx + w * 0.6, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0)');
  sg.addColorStop(clamp(sweep / 2.6, 0.01, 0.99), rgba(pal.glow, 0.5));
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cx - w * 0.6, y - size * 0.1, w * 1.2, size * 0.2);
  ctx.restore();

  // Chromatic split under the solid face; the offset breathes so the mark never
  // sits perfectly still.
  const split = 2.4 + Math.sin(t * 1.7) * 1.2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.font = heavy(size);
  ctx.fillStyle = 'rgba(255,40,70,0.55)';
  drawTracked(ctx, 'BREAKNECK', cx - split, y, tr);
  ctx.fillStyle = 'rgba(40,220,255,0.55)';
  drawTracked(ctx, 'BREAKNECK', cx + split, y, tr);
  ctx.restore();

  const fg = ctx.createLinearGradient(0, y - size * 0.55, 0, y + size * 0.55);
  fg.addColorStop(0, rgba(brighten(pal.fg, 0.5), 1));
  fg.addColorStop(0.52, rgba(pal.fg, 1));
  fg.addColorStop(0.54, rgba(darken(pal.fg, 0.28), 1));
  fg.addColorStop(1, rgba(darken(pal.fg, 0.05), 1));
  ctx.font = heavy(size);
  ctx.fillStyle = fg;
  drawTracked(ctx, 'BREAKNECK', cx, y, tr);

  const uy = y + size * 0.62;
  ctx.fillStyle = rgba(pal.glow, 0.8);
  ctx.fillRect(cx - w * 0.5, uy, w, 2);
  ctx.fillStyle = rgba(pal.hot, 1);
  ctx.fillRect(cx - w * 0.5, uy - 3, 10, 8);
  ctx.fillRect(cx + w * 0.5 - 10, uy - 3, 10, 8);

  ctx.font = body(14);
  ctx.fillStyle = rgba(pal.hot, 1);
  drawTracked(ctx, 'SPEED IS THE ONLY THING THAT CUTS', cx, uy + 22, 1.6);
}

/**
 * The rule, demonstrated rather than described.
 *
 * A live heat bar sweeps up and down; the four material samples beside it light
 * up and go molten exactly as the bar passes their threshold, then go cold again
 * on the way back down. In about two seconds a player watching the title screen
 * has learned the entire game without reading a sentence — which is the whole
 * reason the hardness digits were removed.
 */
function drawHeatDiagram(ctx: CanvasRenderingContext2D, pal: Palette, t: number) {
  const cx = view.logicalW * 0.5;
  const top = view.logicalH * 0.375;
  const w = panelW();
  const h = 198;

  roundRect(ctx, cx - w * 0.5, top, w, h, 4);
  ctx.fillStyle = rgba(darken(pal.bg, 0.45), 0.88);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.glow, 0.28);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.85);
  drawTracked(ctx, 'HEAT IS YOUR WEAPON', cx, top + 20, 3.4);

  // Live heat sweep, easing at the ends so each state is held long enough to read.
  const raw = (Math.sin(t * 0.55) + 1) * 0.5;
  const heat = clamp(raw * 1.18 - 0.05, 0, 1);
  const melting = heat > 0.985;

  // --- the bar
  const bw = w - 96;
  const bx = cx - bw * 0.5;
  const by = top + 44;
  const bh = 16;

  ctx.fillStyle = rgba(darken(pal.bg, 0.5), 0.9);
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = rgba(pal.fg, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

  ctx.fillStyle = rgba(pal.hot, 0.16);
  ctx.fillRect(bx + HEAT_REDLINE * bw, by, bw * (1 - HEAT_REDLINE), bh);
  ctx.fillStyle = rgba(pal.hot, 0.9);
  ctx.fillRect(bx + HEAT_REDLINE * bw - 1, by - 3, 2, bh + 6);

  const col = tempColour(heat, melting);
  const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g.addColorStop(0, rgba(darken(col, 0.35), 1));
  g.addColorStop(1, rgba(brighten(col, 0.25), 1));
  ctx.fillStyle = g;
  ctx.fillRect(bx + 1, by + 1, Math.max(0, heat * bw - 2), bh - 2);

  ctx.font = mono(9);
  ctx.fillStyle = rgba(heat >= HEAT_REDLINE ? pal.hot : pal.fg, 0.6);
  drawTracked(
    ctx,
    melting ? 'MELTDOWN' : heat >= HEAT_REDLINE ? 'REDLINE — HULL BURNS' : 'HEAT',
    cx,
    by + bh + 12,
    2.5,
  );

  // --- four samples, lighting up as the bar passes each threshold
  const mats: Material[] = [GLASS, GRATE, PLATE, CORE];
  const sw = 62;
  const sh = 46;
  const gap = (bw - sw * 4) / 3;
  const sy = top + 106;

  for (let i = 0; i < 4; i++) {
    const m = mats[i];
    const on = melting || heat >= MELT_AT[m];
    const x = bx + i * (sw + gap);
    sample(ctx, x, sy, sw, sh, m, on, pal);

    ctx.font = mono(8);
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(on ? brighten(pal.fg, 0.2) : pal.hot, on ? 0.95 : 0.7);
    drawTracked(ctx, on ? 'MELTS' : 'WRECKS YOU', x + sw * 0.5, sy + sh + 14, 1.6);
    ctx.fillStyle = rgba(pal.fg, 0.35);
    drawTracked(
      ctx,
      ['GLASS', 'GRATE', 'PLATE', 'CORE'][i],
      x + sw * 0.5,
      sy + sh + 26,
      1.6,
    );
  }
}

function tempColour(heat: number, melting: boolean) {
  if (melting) return MOLTEN;
  return heat < 0.33
    ? mixRGB([120, 132, 156], [255, 120, 40], heat / 0.33)
    : mixRGB([255, 120, 40], [255, 250, 232], (heat - 0.33) / 0.67);
}

/** A single barrier, drawn in the same language as the real ones. */
function sample(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  m: Material,
  on: boolean,
  pal: Palette,
) {
  const inset = m === GLASS ? h * 0.22 : m === GRATE ? h * 0.1 : 0;
  const yy = y + inset;
  const hh = h - inset * 2;
  const molten = on ? mixRGB(pal.fg, MOLTEN, 0.4) : pal.hot;

  ctx.save();
  if (on) {
    const g = ctx.createLinearGradient(0, yy, 0, yy + hh);
    g.addColorStop(0, rgba(brighten(molten, 0.3), m === GLASS ? 0.55 : 1));
    g.addColorStop(1, rgba(darken(molten, 0.3), m === GLASS ? 0.5 : 1));
    ctx.fillStyle = g;
    ctx.fillRect(x, yy, w, hh);
  } else {
    ctx.fillStyle = rgba(darken(pal.bg, 0.3), 0.9);
    ctx.fillRect(x, yy, w, hh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, yy, w, hh);
    ctx.clip();
    ctx.strokeStyle = rgba(pal.hot, 0.25);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -hh; i < w + hh; i += 11) {
      ctx.moveTo(x + i, yy);
      ctx.lineTo(x + i + hh, yy + hh);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgba(pal.hot, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, yy + 1, w - 2, hh - 2);
  }

  const ink = on ? rgba(darken(pal.bg, 0.35), 0.75) : rgba(pal.hot, 0.7);
  if (m === GRATE) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      ctx.moveTo(x + (i / 5) * w, yy + 2);
      ctx.lineTo(x + (i / 5) * w, yy + hh - 2);
    }
    ctx.moveTo(x + 2, yy + hh * 0.5);
    ctx.lineTo(x + w - 2, yy + hh * 0.5);
    ctx.stroke();
  } else if (m === PLATE) {
    ctx.fillStyle = ink;
    for (const [dx, dy] of [
      [7, 7],
      [w - 7, 7],
      [7, hh - 7],
      [w - 7, hh - 7],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + dx, yy + dy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (m === CORE) {
    for (let i = 1; i < 3; i++) {
      ctx.fillStyle = on ? rgba(brighten(molten, 0.7), 0.9) : rgba(pal.hot, 0.55);
      ctx.fillRect(x + 2, yy + (i / 3) * hh - 1, w - 4, 2);
    }
    ctx.strokeStyle = on ? rgba(brighten(molten, 0.5), 0.9) : rgba(pal.hot, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, yy + 3, w - 6, hh - 6);
  } else {
    ctx.strokeStyle = on ? rgba(brighten(molten, 0.8), 0.5) : rgba(pal.hot, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, yy);
    ctx.lineTo(x + w * 0.38, yy + hh);
    ctx.moveTo(x + w * 0.72, yy);
    ctx.lineTo(x + w * 0.6, yy + hh);
    ctx.stroke();
  }
  ctx.restore();
}

function keycap(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, pal: Palette) {
  const w = Math.max(26, ctx.measureText(label).width + 16);
  const h = 26;
  roundRect(ctx, x - w * 0.5, y - h * 0.5, w, h, 5);
  ctx.fillStyle = rgba(brighten(pal.bg, 0.16), 0.95);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.fg, 0.4);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = rgba(pal.fg, 0.95);
  ctx.font = heavy(13);
  ctx.fillText(label, x, y + 1);
  return w;
}

function drawControls(ctx: CanvasRenderingContext2D, pal: Palette) {
  const W = view.logicalW;
  const y = view.logicalH * 0.7;
  const rows: [string, string][] = [
    ['W', 'DIVE — build heat'],
    ['A D', 'STEER — harder the faster you go'],
    ['S', 'VENT — dump heat before it burns you'],
  ];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rows.forEach(([keys, desc], i) => {
    const ry = y + i * 32;
    const parts = keys.split(' ');
    ctx.font = heavy(13);
    let capsW = 0;
    for (const p of parts) capsW += Math.max(26, ctx.measureText(p).width + 16) + 6;
    capsW -= 6;
    ctx.font = body(13);
    const descW = ctx.measureText(desc).width;
    let x = W * 0.5 - (capsW + 14 + descW) * 0.5;

    for (const p of parts) {
      ctx.font = heavy(13);
      const cw = keycap(ctx, p, x + Math.max(26, ctx.measureText(p).width + 16) * 0.5, ry, pal);
      x += cw + 6;
    }
    x += 8;
    ctx.font = body(13);
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(pal.fg, 0.6);
    ctx.fillText(desc, x, ry + 1);
    ctx.textAlign = 'center';
  });

  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.32);
  drawTracked(ctx, 'TOUCH: SIDES STEER · MIDDLE DIVES · BOTTOM VENTS', W * 0.5, y + 96, 1.6);
}

function drawPrompt(ctx: CanvasRenderingContext2D, game: Game, pal: Palette, t: number) {
  const W = view.logicalW;
  const y = view.logicalH * 0.88;
  const a = 0.55 + Math.sin(t * 4.2) * 0.45;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = heavy(19);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.3), 1);
  drawTracked(ctx, 'PRESS ANY KEY', W * 0.5, y, 4);
  ctx.restore();

  if (game.best > 0) {
    ctx.font = mono(11);
    ctx.fillStyle = rgba(MOLTEN, 0.85);
    drawTracked(ctx, `BEST  ${game.best}`, W * 0.5, y + 28, 3);
  }
}

// ---------------------------------------------------------------- results
export function drawDead(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const W = view.logicalW;
  const H = view.logicalH;
  // Reveal staggers so the screen assembles rather than appearing — the
  // difference between a game-over and a results sequence.
  const t = game.runTime;
  const step = (d: number) => clamp((t - d) / 0.22, 0, 1);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(darken(pal.bg, 0.35), 0.96));
  g.addColorStop(1, rgba(darken(pal.bg, 0.15), 0.97));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.save();
  ctx.globalAlpha = step(0);
  ctx.font = heavy(fitSize(ctx, 'WRECKED', panelW() - 40, 50, 6));
  ctx.fillStyle = rgba(pal.hot, 1);
  drawTracked(ctx, 'WRECKED', W * 0.5, H * 0.155, 6);
  ctx.restore();

  // --- rank badge
  const ra = step(0.18);
  if (ra > 0) {
    ctx.save();
    ctx.globalAlpha = ra;
    const cy = H * 0.315;
    const r = lerp(78, 54, ra);
    ctx.strokeStyle = rgba(MOLTEN, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI * 0.5;
      const px = W * 0.5 + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(MOLTEN, 0.07);
    ctx.fill();

    ctx.font = heavy(56);
    ctx.fillStyle = rgba(MOLTEN, 1);
    ctx.fillText(game.rank, W * 0.5, cy + 3);
    ctx.font = mono(9);
    ctx.fillStyle = rgba(pal.fg, 0.5);
    drawTracked(ctx, 'RANK', W * 0.5, cy + 72, 3);
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = step(0.34);
  const sy = H * 0.47;
  ctx.font = heavy(58);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.25), 1);
  drawTracked(ctx, String(game.score), W * 0.5, sy, 1);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  drawTracked(ctx, 'SCORE', W * 0.5, sy + 26, 4);
  ctx.restore();

  // --- stat grid, now reporting on the heat you actually rode
  ctx.save();
  ctx.globalAlpha = step(0.5);
  const stats: [string, string][] = [
    ['DEPTH', `${Math.floor(game.depth)}m`],
    ['ZONE', game.zoneCardName],
    ['PEAK HEAT', `${Math.round(game.peakHeat * 100)}%`],
    ['TIME IN REDLINE', `${game.redlineTime.toFixed(1)}s`],
    ['BEST CHAIN', `×${game.bestChain}`],
    ['MELTDOWNS', String(game.meltdowns)],
  ];
  const gy = H * 0.585;
  const pw = panelW();
  const left = W * 0.5 - pw * 0.5;
  const colW = pw / 2;
  stats.forEach(([k, v], i) => {
    const x = left + (i % 2) * colW;
    const y = gy + ((i / 2) | 0) * 36;
    ctx.textAlign = 'left';
    ctx.font = mono(9);
    ctx.fillStyle = rgba(pal.fg, 0.4);
    ctx.fillText(k, x, y);
    ctx.font = heavy(17);
    ctx.fillStyle = rgba(pal.fg, 0.95);
    ctx.fillText(v, x, y + 17);
  });
  ctx.textAlign = 'center';
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = step(0.66);
  const by = H * 0.765;
  if (game.isNewBest) {
    const pulse = 0.7 + Math.sin(game.clock * 7) * 0.3;
    ctx.font = heavy(22);
    ctx.fillStyle = rgba(MOLTEN, pulse);
    drawTracked(ctx, 'NEW BEST', W * 0.5, by, 5);
  } else {
    ctx.font = mono(11);
    ctx.fillStyle = rgba(pal.fg, 0.5);
    drawTracked(ctx, `BEST  ${game.best}`, W * 0.5, by, 3);
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = step(0.74);
  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.75);
  drawTracked(
    ctx,
    `NEXT TARGET — ZONE ${game.zone + 2} AT ${(game.zone + 1) * ZONE_DEPTH}m`,
    W * 0.5,
    H * 0.815,
    2.5,
  );
  ctx.restore();

  const pa = step(0.82);
  if (pa > 0 && Math.floor(game.clock * 2.2) % 2 === 0) {
    ctx.save();
    ctx.globalAlpha = pa;
    ctx.font = heavy(18);
    ctx.fillStyle = rgba(brighten(pal.fg, 0.3), 1);
    drawTracked(ctx, 'SPACE — RUN IT AGAIN', W * 0.5, H * 0.88, 3);
    ctx.restore();
  }
}
