import {
  CHAIN_TIMEOUT,
  CORE,
  GLASS,
  GRATE,
  HEAT_REDLINE,
  INTRO_TIME,
  MAX_HEALTH,
  MELT_AT,
  PLATE,
  ZONE_CARD_TIME,
  ZONE_DEPTH,
  type Material,
} from '../config';
import { clamp, lerp, smoothstep } from '../engine/math';
import { brighten, darken, MOLTEN, mixRGB, type Palette, rgba } from '../game/biomes';
import type { Game } from '../game/game';
import { view } from '../viewport';
import { body, drawTracked, heavy, mono } from './type';

/**
 * Heads-up display, drawn on the visible canvas *after* the scene composite, so
 * it stays crisp instead of being smeared by the bloom pass it would otherwise
 * be part of.
 *
 * It is built around a single widget. The version this replaces showed the same
 * tier number on four surfaces — a badge on the ship, a ladder in the flank, a
 * segment bar, and a label — because the mechanic was a number and numbers have
 * to be printed. Heat is a physical state, so one gauge says everything.
 */

export function drawHud(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.state !== 'play') return;

  drawTopBar(ctx, game, pal);
  drawHeatGauge(ctx, game, pal);
  drawChain(ctx, game, pal);
  if (game.heat.melting) drawMeltdownBanner(ctx, game);
  else if (game.burning) drawBurnWarning(ctx, game, pal);
  drawZoneCard(ctx, game, pal);
  drawIntro(ctx, game, pal);
  if (game.isFirstRun) drawTutorial(ctx, game, pal);
}

// ----------------------------------------------------------------- top bar
function drawTopBar(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const W = view.logicalW;

  const band = ctx.createLinearGradient(0, 0, 0, 104);
  band.addColorStop(0, rgba(darken(pal.bg, 0.3), 0.9));
  band.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, 104);

  drawHull(ctx, game, pal);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = heavy(40);
  ctx.fillStyle = rgba(pal.fg, 1);
  drawTracked(ctx, String(game.score), W * 0.5, 44, 1);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  drawTracked(ctx, 'SCORE', W * 0.5, 58, 2.4);

  ctx.textAlign = 'right';
  ctx.font = heavy(24);
  ctx.fillStyle = rgba(pal.fg, 0.95);
  ctx.fillText(`${Math.floor(game.depth)}m`, W - 20, 36);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.glow, 0.85);
  ctx.fillText(game.zoneCardName, W - 20, 50);
  const toNext = Math.max(0, (game.zone + 1) * ZONE_DEPTH - Math.floor(game.depth));
  ctx.fillStyle = rgba(pal.fg, 0.4);
  ctx.fillText(`ZONE ${game.zone + 2} IN ${toNext}m`, W - 20, 64);
}

function drawHull(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const p = game.player;
  const burning = game.burning;
  // Health is fractional now — the redline bleeds it continuously — so the pip
  // count comes off the ceiling and the partial pip shows the burn eating it.
  const whole = Math.floor(Math.max(0, p.health));
  const frac = Math.max(0, p.health) - whole;

  // MAX_HEALTH, not a hard-coded 3. The previous build looped to 3 while the
  // ship had 4 hull, so the fourth pip was simply never drawn.
  for (let i = 0; i < MAX_HEALTH; i++) {
    const x = 26 + i * 22;
    const y = 30;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI * 0.25);
    if (i < whole) {
      const hot = burning && i === whole;
      ctx.fillStyle = rgba(hot ? pal.hot : brighten(pal.fg, 0.2), 1);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.fillStyle = rgba(pal.glow, 0.55);
      ctx.fillRect(-3, -3, 6, 6);
    } else if (i === whole && frac > 0.02) {
      // The pip currently burning away.
      ctx.strokeStyle = rgba(pal.hot, 0.8);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-6, -6, 12, 12);
      ctx.fillStyle = rgba(pal.hot, 0.85);
      ctx.fillRect(-6, -6, 12 * frac, 12);
    } else {
      ctx.strokeStyle = rgba(pal.hot, 0.55);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-6, -6, 12, 12);
    }
    ctx.restore();
  }

  ctx.font = mono(9);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = rgba(burning ? pal.hot : pal.fg, burning ? 0.9 : 0.4);
  ctx.fillText(burning ? 'HULL BURNING' : 'HULL', 19, 44);
}

// -------------------------------------------------------------- heat gauge
/**
 * The one gauge.
 *
 * The material icons sit ON the bar at the heat that unlocks them, so the bar is
 * also the legend: fill past the grate icon and grates are now meltable. Nothing
 * has to be explained, remembered, or compared — the relationship is spatial.
 */
function drawHeatGauge(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const W = view.logicalW;
  const H = view.logicalH;
  const heat = game.heat;

  // Centred and wide. This is the one thing the player must read at a glance,
  // and tucked small in a corner it lost to the barriers streaming past it.
  const bw = clamp(W * 0.42, 300, 560);
  const bh = 22;
  const x = (W - bw) * 0.5;
  const y = H - 58;

  // Scrim: barriers stream right through this band, and without it the gauge —
  // the one thing that must always be readable — competes with the playfield.
  const sg = ctx.createLinearGradient(0, y - 46, 0, H);
  sg.addColorStop(0, 'rgba(0,0,0,0)');
  sg.addColorStop(0.45, rgba(darken(pal.bg, 0.5), 0.82));
  sg.addColorStop(1, rgba(darken(pal.bg, 0.5), 0.92));
  ctx.fillStyle = sg;
  ctx.fillRect(0, y - 46, W, H - y + 46);

  // Track.
  ctx.fillStyle = rgba(darken(pal.bg, 0.4), 0.85);
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = rgba(pal.fg, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);

  // Redline zone, marked before you ever reach it.
  const rx = x + HEAT_REDLINE * bw;
  ctx.fillStyle = rgba(pal.hot, 0.16);
  ctx.fillRect(rx, y, bw - HEAT_REDLINE * bw, bh);
  ctx.fillStyle = rgba(pal.hot, 0.9);
  ctx.fillRect(rx - 1, y - 3, 2, bh + 6);

  // Fill, coloured by temperature.
  const v = heat.melting ? 1 : heat.value;
  const col = heat.melting
    ? MOLTEN
    : v < 0.33
      ? mixRGB([120, 132, 156], [255, 120, 40], v / 0.33)
      : mixRGB([255, 120, 40], [255, 250, 232], (v - 0.33) / 0.67);
  const pulse = game.burning ? 0.78 + Math.sin(heat.pulse * 24) * 0.22 : 1;
  const g = ctx.createLinearGradient(x, 0, x + bw, 0);
  g.addColorStop(0, rgba(darken(col, 0.35), pulse));
  g.addColorStop(1, rgba(brighten(col, 0.25), pulse));
  ctx.fillStyle = g;
  ctx.fillRect(x + 1, y + 1, Math.max(0, v * bw - 2), bh - 2);

  // Material icons sit ON the bar at the heat that unlocks them, each in the
  // middle of the span where it is the newest thing you can melt — so the bar
  // reads as a legend, not as a value with a separate key to memorise.
  const spans: [Material, number, number][] = [
    [GLASS, MELT_AT[GLASS], MELT_AT[GRATE]],
    [GRATE, MELT_AT[GRATE], MELT_AT[PLATE]],
    [PLATE, MELT_AT[PLATE], 1],
  ];
  for (const [m, lo, hi] of spans) {
    const on = heat.canMelt(m);
    materialIcon(ctx, x + ((lo + hi) * 0.5) * bw, y - 17, m, on, pal);
    if (lo > 0) {
      ctx.fillStyle = rgba(pal.fg, on ? 0.5 : 0.22);
      ctx.fillRect(x + lo * bw - 0.5, y, 1, bh);
    }
  }
  // CORE sits past the end: it is not a heat threshold, it is the meltdown
  // reward, so it lives where the bar runs out.
  materialIcon(ctx, x + bw + 20, y - 17, CORE, heat.melting, pal);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = heavy(17);
  ctx.fillStyle = rgba(heat.melting ? MOLTEN : game.burning ? pal.hot : col, 1);
  drawTracked(
    ctx,
    heat.melting ? 'MELTDOWN' : game.burning ? 'REDLINE — VENT WITH S' : heat.bandName,
    W * 0.5,
    y + bh + 9,
    3,
  );
}

/**
 * Miniature of each material, drawn with the same visual language as the
 * barriers themselves so the mapping is immediate.
 */
function materialIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  m: Material,
  on: boolean,
  pal: Palette,
) {
  const w = 16;
  const h = 11;
  const x = cx - w * 0.5;
  const y = cy - h * 0.5;
  const c = on ? brighten(pal.fg, 0.2) : darken(pal.fg, 0.55);
  const a = on ? 1 : 0.4;

  ctx.save();
  if (m === GLASS) {
    ctx.fillStyle = rgba(c, a * 0.45);
    ctx.fillRect(x, y + 3, w, h - 6);
    ctx.strokeStyle = rgba(c, a);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 3.5, w - 1, h - 7);
  } else if (m === GRATE) {
    ctx.strokeStyle = rgba(c, a);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 1.5, w - 1, h - 3);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo(x + (i / 4) * w, y + 2);
      ctx.lineTo(x + (i / 4) * w, y + h - 2);
    }
    ctx.stroke();
  } else if (m === PLATE) {
    ctx.fillStyle = rgba(c, a);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.fillStyle = rgba(darken(pal.bg, 0.3), a * 0.8);
    for (const [dx, dy] of [
      [3, 3.5],
      [w - 3, 3.5],
      [3, h - 3.5],
      [w - 3, h - 3.5],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = rgba(on ? MOLTEN : darken(pal.fg, 0.6), on ? 1 : 0.4);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(darken(pal.bg, 0.4), 0.85);
    ctx.fillRect(x, y + h * 0.36, w, 1.4);
    ctx.fillRect(x, y + h * 0.68, w, 1.4);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ chain
function drawChain(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.chain < 2) return;
  const H = view.logicalH;
  // Bottom LEFT. The heat gauge is centred and grows to 560 units wide, so a
  // right-anchored chain landed on top of it on a portrait window.
  const x = 26;
  const y = H - 34;
  const t = clamp(game.chainTimer / CHAIN_TIMEOUT, 0, 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const pop = 1 + clamp(t - 0.82, 0, 1) * 1.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pop, pop);
  ctx.font = heavy(32);
  ctx.fillStyle = rgba(brighten(pal.glow, 0.35), 1);
  ctx.fillText(`×${game.chain}`, 0, 0);
  ctx.restore();

  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.4);
  ctx.fillText('CHAIN', x + 2, y + 13);

  ctx.fillStyle = rgba(pal.fg, 0.12);
  ctx.fillRect(x, y + 19, 84, 3);
  ctx.fillStyle = rgba(t < 0.3 ? pal.hot : pal.glow, 0.95);
  ctx.fillRect(x, y + 19, 84 * t, 3);
}

// --------------------------------------------------------------- banners
function drawMeltdownBanner(ctx: CanvasRenderingContext2D, game: Game) {
  const W = view.logicalW;
  const H = view.logicalH;
  const heat = game.heat;
  const pulse = 0.72 + Math.sin(heat.pulse * 18) * 0.28;
  const y = H * 0.17;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = heavy(34);
  ctx.fillStyle = rgba(MOLTEN, pulse);
  drawTracked(ctx, 'MELTDOWN', W * 0.5, y, 6);

  const bw = 220;
  ctx.fillStyle = rgba(MOLTEN, 0.2);
  ctx.fillRect((W - bw) * 0.5, y + 22, bw, 4);
  ctx.fillStyle = rgba(MOLTEN, 0.95);
  ctx.fillRect((W - bw) * 0.5, y + 22, bw * heat.meltT, 4);
  ctx.restore();
}

/** The redline is a slow bleed, so it needs a loud, unmissable state. */
function drawBurnWarning(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const W = view.logicalW;
  const H = view.logicalH;
  const blink = Math.floor(game.heat.pulse * 6) % 2 === 0;
  if (!blink) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = heavy(20);
  ctx.fillStyle = rgba(pal.hot, 1);
  drawTracked(ctx, 'HULL BURNING — VENT WITH  S', W * 0.5, H * 0.17, 3);
  ctx.restore();
}

// -------------------------------------------------------------- zone card
function drawZoneCard(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.zoneCard <= 0) return;
  const W = view.logicalW;
  const H = view.logicalH;
  const t = game.zoneCard / ZONE_CARD_TIME;
  const a = clamp(Math.min((1 - t) / 0.18, t / 0.25), 0, 1);
  const wipe = smoothstep(clamp((1 - t) / 0.18, 0, 1));
  const y = H * 0.62;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = lerp(0, Math.min(W * 0.86, 620), wipe);
  ctx.fillStyle = rgba(darken(pal.bg, 0.55), 0.95);
  ctx.fillRect((W - w) * 0.5, y - 46, w, 92);
  ctx.fillStyle = rgba(pal.glow, 0.9);
  ctx.fillRect((W - w) * 0.5, y - 46, w, 2);
  ctx.fillRect((W - w) * 0.5, y + 44, w, 2);

  if (wipe > 0.55) {
    const ta = smoothstep((wipe - 0.55) / 0.45);
    ctx.globalAlpha = a * ta;
    ctx.font = mono(11);
    ctx.fillStyle = rgba(pal.glow, 1);
    drawTracked(ctx, `ZONE ${game.zone + 1}`, W * 0.5, y - 24, 4);
    ctx.font = heavy(34);
    ctx.fillStyle = rgba(brighten(pal.fg, 0.2), 1);
    drawTracked(ctx, game.zoneCardName, W * 0.5, y + 4, 2);
    ctx.font = mono(10);
    ctx.fillStyle = rgba(pal.fg, 0.55);
    drawTracked(ctx, game.zoneCardSub, W * 0.5, y + 30, 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ intro
function drawIntro(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.introT <= 0) return;
  const W = view.logicalW;
  const H = view.logicalH;
  const t = game.introT / INTRO_TIME;
  const a = clamp(Math.min((1 - t) / 0.12, t / 0.22), 0, 1);
  const y = H * 0.52;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.85);
  drawTracked(ctx, `ZONE 1 — ${game.zoneCardName}`, W * 0.5, y - 40, 3);

  ctx.font = heavy(30);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.25), 1);
  drawTracked(ctx, 'GO DEEP', W * 0.5, y - 6, 5);

  ctx.font = body(14);
  ctx.fillStyle = rgba(pal.fg, 0.75);
  ctx.fillText(`reach ZONE 2 at ${ZONE_DEPTH}m — burn through what you can`, W * 0.5, y + 24);

  if (game.isFirstRun) {
    const pulse = 0.6 + Math.sin(game.clock * 6) * 0.4;
    ctx.globalAlpha = a * pulse;
    ctx.font = heavy(15);
    ctx.fillStyle = rgba(pal.glow, 1);
    drawTracked(ctx, 'HOLD  W  TO DIVE AND BUILD HEAT', W * 0.5, y + 54, 3);
  }
  ctx.restore();
}

// --------------------------------------------------------------- tutorial
/**
 * First run only, and deliberately short. The mechanic is now self-evident —
 * the ship glows, barriers glow when you can melt them — so these beats
 * reinforce rather than explain. The old build needed four dense lines because
 * the rule was invisible arithmetic.
 */
const BEATS: { from: number; to: number; text: string }[] = [
  { from: 230, to: 360, text: 'DIVING BUILDS HEAT — HEAT MELTS WHAT IT CAN REACH' },
  { from: 380, to: 510, text: 'COLD BARRIERS WILL WRECK YOU — STEER  A / D  OR GET HOTTER' },
  { from: 560, to: 700, text: 'PAST THE REDLINE YOUR HULL BURNS —  S  VENTS THE HEAT' },
];

function drawTutorial(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const d = game.depth;
  const beat = BEATS.find((b) => d >= b.from && d < b.to);
  if (!beat) return;
  const W = view.logicalW;
  const H = view.logicalH;
  const local = (d - beat.from) / (beat.to - beat.from);
  const a = clamp(Math.min(local / 0.12, (1 - local) / 0.2), 0, 1);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = H * 0.78;

  ctx.font = body(14);
  const w = ctx.measureText(beat.text).width + 44;
  ctx.fillStyle = rgba(darken(pal.bg, 0.5), 0.82);
  ctx.fillRect((W - w) * 0.5, y - 17, w, 34);
  ctx.fillStyle = rgba(pal.glow, 0.7);
  ctx.fillRect((W - w) * 0.5, y - 17, 3, 34);

  ctx.fillStyle = rgba(brighten(pal.fg, 0.1), 1);
  ctx.fillText(beat.text, W * 0.5, y);
  ctx.restore();
}
