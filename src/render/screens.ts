import { VIEW_H, VIEW_W, ZONE_DEPTH } from '../config';
import { clamp, lerp } from '../engine/math';
import { brighten, darken, type Palette, rgba } from '../game/biomes';
import type { Game } from '../game/game';
import { body, drawTracked, fitSize, heavy, mono, trackedWidth } from './type';

/**
 * Front-of-house: the title lockup and the results screen.
 *
 * These two screens do most of the work of deciding whether a jam judge plays a
 * second run, so they get the same effort as the gameplay. The title has to
 * explain the entire mechanic without a paragraph of text, and the results
 * screen has to make the player want the number to be bigger.
 */

const OD_GOLD = [255, 214, 96] as const;

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

// ------------------------------------------------------------------ title
export function drawTitle(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const t = game.od.pulse; // free-running clock, safe on every screen

  // Scrim. This has to be genuinely heavy: the attract shaft is streaming blocks
  // at full contrast behind the lockup, and at anything under ~0.9 the numbers
  // punch through the copy and the whole screen reads as noise. It stays a
  // gradient rather than a flat fill so the shaft is still legibly *there*.
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, rgba(darken(pal.bg, 0.3), 0.97));
  g.addColorStop(0.3, rgba(pal.bg, 0.88));
  g.addColorStop(0.75, rgba(pal.bg, 0.93));
  g.addColorStop(1, rgba(darken(pal.bg, 0.35), 0.98));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawEyebrow(ctx, pal);
  drawWordmark(ctx, pal, t);
  drawRuleDiagram(ctx, pal, t);

  // The goal, on the front door. The diagram teaches the rule; this one line
  // says what the rule is *for*.
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.55);
  drawTracked(
    ctx,
    `GO DEEP — A NEW ZONE EVERY ${ZONE_DEPTH}M · DIE, GET RANKED, RUN AGAIN`,
    VIEW_W * 0.5,
    VIEW_H * 0.375 + 202,
    1.8,
  );

  drawControls(ctx, pal);
  drawPrompt(ctx, game, pal, t);
}

function drawEyebrow(ctx: CanvasRenderingContext2D, pal: Palette) {
  const y = VIEW_H * 0.115;
  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.75);
  drawTracked(ctx, 'MICRO JAM 062', VIEW_W * 0.5, y, 5);

  const w = trackedWidth(ctx, 'MICRO JAM 062', 5);
  ctx.fillStyle = rgba(pal.glow, 0.35);
  ctx.fillRect(VIEW_W * 0.5 - w * 0.5 - 34, y - 1, 24, 1.5);
  ctx.fillRect(VIEW_W * 0.5 + w * 0.5 + 10, y - 1, 24, 1.5);
}

/**
 * The wordmark.
 *
 * Previously this was a condensed face scaled to fit, which squeezed the glyphs
 * horizontally — the single most visible "unfinished" signal on the whole
 * screen. Now the size is chosen so the natural letterforms fit, and the drama
 * comes from a chromatic split, an emissive gradient and a speed slash rather
 * than from distortion.
 */
function drawWordmark(ctx: CanvasRenderingContext2D, pal: Palette, t: number) {
  const cx = VIEW_W * 0.5;
  const y = VIEW_H * 0.235;
  const track = 2;
  const size = fitSize(ctx, 'BREAKNECK', VIEW_W - 56, 62, track);
  const w = trackedWidth(ctx, 'BREAKNECK', track * (size / 62));
  const tr = track * (size / 62);

  // Speed slash: a bar sweeping behind the type, keyed to the same clock as the
  // shimmer so the lockup reads as one moving object.
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

  // Chromatic split. Two offset ghosts under the solid face; the offset breathes
  // so the mark never sits perfectly still.
  const split = 2.4 + Math.sin(t * 1.7) * 1.2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.font = heavy(size);
  ctx.fillStyle = 'rgba(255,40,70,0.55)';
  drawTracked(ctx, 'BREAKNECK', cx - split, y, tr);
  ctx.fillStyle = 'rgba(40,220,255,0.55)';
  drawTracked(ctx, 'BREAKNECK', cx + split, y, tr);
  ctx.restore();

  // Solid face with a vertical gradient — metal catching light from above.
  const fg = ctx.createLinearGradient(0, y - size * 0.55, 0, y + size * 0.55);
  fg.addColorStop(0, rgba(brighten(pal.fg, 0.5), 1));
  fg.addColorStop(0.52, rgba(pal.fg, 1));
  fg.addColorStop(0.54, rgba(darken(pal.fg, 0.28), 1));
  fg.addColorStop(1, rgba(darken(pal.fg, 0.05), 1));
  ctx.font = heavy(size);
  ctx.fillStyle = fg;
  drawTracked(ctx, 'BREAKNECK', cx, y, tr);

  // Underline rule with end caps.
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
 * The rule, drawn instead of written.
 *
 * The old title spent five lines of prose explaining the mechanic and judges
 * still had to infer it in play. Two example blocks with a speed readout beside
 * them teaches it in about a second: this number beats that number, so it
 * breaks; that one doesn't, so it doesn't.
 */
function drawRuleDiagram(ctx: CanvasRenderingContext2D, pal: Palette, t: number) {
  const cx = VIEW_W * 0.5;
  const top = VIEW_H * 0.375;
  const h = 186;
  const w = VIEW_W - 76;

  // A framed panel. Without it the diagram floats on top of the attract shaft
  // and the two read as one confused layer; with it, this is obviously an inset
  // explaining something.
  roundRect(ctx, cx - w * 0.5, top, w, h, 4);
  ctx.fillStyle = rgba(darken(pal.bg, 0.45), 0.85);
  ctx.fill();
  ctx.strokeStyle = rgba(pal.glow, 0.28);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.8);
  drawTracked(ctx, 'YOUR SPEED IS YOUR DAMAGE', cx, top + 20, 3.4);

  // Live readout that counts, so the relationship is animated rather than
  // static: the same number that decides collisions is the one on the HUD.
  const kmh = Math.round(300 + Math.sin(t * 0.9) * 180);
  const tier = clamp(Math.floor(kmh / 60), 1, 9);
  const numY = top + 50;

  // Number and unit laid out as one centred group — the unit was previously
  // pinned at a fixed offset and collided with any three-digit speed.
  ctx.font = heavy(40);
  const numW = ctx.measureText(String(kmh)).width;
  ctx.font = mono(10);
  const labW = trackedWidth(ctx, 'KM/H', 2);
  const startX = cx - (numW + 8 + labW) * 0.5;

  ctx.textAlign = 'left';
  ctx.font = heavy(40);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.35), 1);
  ctx.fillText(String(kmh), startX, numY);
  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.fg, 0.5);
  drawTracked(ctx, 'KM/H', startX + numW + 8, numY + 8, 2, 'left');
  ctx.textAlign = 'center';

  // The conversion, spelled out. km/h alone leaves the mapping to block
  // numbers as homework; "= POWER 7" is the whole bridge in one line.
  ctx.font = mono(11);
  ctx.fillStyle = rgba(pal.glow, 0.95);
  drawTracked(ctx, `=  POWER ${tier}`, cx, numY + 22, 3);

  // Two sample blocks: one under the live tier, one over it.
  const bw = 58;
  const bh = 46;
  const gap = 74;
  const by = top + 92;
  sample(ctx, cx - gap - bw * 0.5, by, bw, bh, Math.max(1, tier - 2), true, pal);
  sample(ctx, cx + gap - bw * 0.5, by, bw, bh, Math.min(9, tier + 3), false, pal);

  // The comparison, spelled out between them.
  ctx.font = mono(13);
  ctx.fillStyle = rgba(pal.fg, 0.35);
  ctx.fillText('vs', cx, by + bh * 0.5);

  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.9);
  drawTracked(ctx, 'SMASH', cx - gap, by + bh + 18, 2.5);
  ctx.fillStyle = rgba(pal.hot, 1);
  drawTracked(ctx, 'WRECKED', cx + gap, by + bh + 18, 2.5);
}

function sample(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  breakable: boolean,
  pal: Palette,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (breakable) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(brighten(pal.fg, 0.3), 1));
    g.addColorStop(1, rgba(darken(pal.fg, 0.3), 1));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(darken(pal.bg, 0.2), 1);
  } else {
    ctx.fillStyle = rgba(darken(pal.bg, 0.3), 0.9);
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = rgba(pal.hot, 0.25);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -h; i < w + h; i += 11) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgba(pal.hot, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = rgba(brighten(pal.hot, 0.4), 1);
  }
  ctx.font = heavy(26);
  ctx.fillText(String(n), x + w * 0.5, y + h * 0.5 + 1);
}

function keycap(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  pal: Palette,
) {
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
  const y = VIEW_H * 0.685;
  const rows: [string, string][] = [
    ['W', 'TUCK — dive faster'],
    ['A D', 'STEER — harder the faster you go'],
    ['S', 'BRAKE — buy back control'],
  ];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rows.forEach(([keys, desc], i) => {
    const ry = y + i * 34;
    const parts = keys.split(' ');
    // Lay the caps and the description out as one centred unit.
    ctx.font = heavy(13);
    let capsW = 0;
    for (const p of parts) capsW += Math.max(26, ctx.measureText(p).width + 16) + 6;
    capsW -= 6;
    ctx.font = body(13);
    const descW = ctx.measureText(desc).width;
    const total = capsW + 14 + descW;
    let x = VIEW_W * 0.5 - total * 0.5;

    for (const p of parts) {
      ctx.font = heavy(13);
      const w = keycap(ctx, p, x + Math.max(26, ctx.measureText(p).width + 16) * 0.5, ry, pal);
      x += w + 6;
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
  drawTracked(ctx, 'TOUCH: SIDES STEER · MIDDLE TUCKS · BOTTOM BRAKES', VIEW_W * 0.5, y + 100, 1.6);
}

function drawPrompt(ctx: CanvasRenderingContext2D, game: Game, pal: Palette, t: number) {
  const y = VIEW_H * 0.875;
  const a = 0.55 + Math.sin(t * 4.2) * 0.45;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = heavy(19);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.3), 1);
  drawTracked(ctx, 'PRESS ANY KEY', VIEW_W * 0.5, y, 4);
  ctx.restore();

  if (game.best > 0) {
    ctx.font = mono(11);
    ctx.fillStyle = rgba(OD_GOLD, 0.85);
    drawTracked(ctx, `BEST  ${game.best}`, VIEW_W * 0.5, y + 30, 3);
  }
}

// ---------------------------------------------------------------- results
export function drawDead(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  // Reveal staggers over the first second so the screen assembles rather than
  // appearing — the difference between a game-over and a results *sequence*.
  const t = game.runTime;
  const step = (d: number) => clamp((t - d) / 0.22, 0, 1);

  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, rgba(darken(pal.bg, 0.35), 0.95));
  g.addColorStop(1, rgba(darken(pal.bg, 0.15), 0.97));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // --- WRECKED
  ctx.save();
  ctx.globalAlpha = step(0);
  const wy = VIEW_H * 0.155;
  ctx.font = heavy(fitSize(ctx, 'WRECKED', VIEW_W - 90, 50, 6));
  ctx.fillStyle = rgba(pal.hot, 1);
  drawTracked(ctx, 'WRECKED', VIEW_W * 0.5, wy, 6);
  ctx.restore();

  // --- rank badge
  const ra = step(0.18);
  if (ra > 0) {
    ctx.save();
    ctx.globalAlpha = ra;
    const cy = VIEW_H * 0.315;
    const r = lerp(78, 54, ra); // settles inward as it fades up
    ctx.strokeStyle = rgba(OD_GOLD, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI * 0.5;
      const px = VIEW_W * 0.5 + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(OD_GOLD, 0.07);
    ctx.fill();

    ctx.font = heavy(56);
    ctx.fillStyle = rgba(OD_GOLD, 1);
    ctx.fillText(game.rank, VIEW_W * 0.5, cy + 3);
    ctx.font = mono(9);
    ctx.fillStyle = rgba(pal.fg, 0.5);
    drawTracked(ctx, 'RANK', VIEW_W * 0.5, cy + 72, 3);
    ctx.restore();
  }

  // --- score
  ctx.save();
  ctx.globalAlpha = step(0.34);
  const sy = VIEW_H * 0.47;
  ctx.font = heavy(58);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.25), 1);
  drawTracked(ctx, String(game.score), VIEW_W * 0.5, sy, 1);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  drawTracked(ctx, 'SCORE', VIEW_W * 0.5, sy + 26, 4);
  ctx.restore();

  // --- stat grid
  ctx.save();
  ctx.globalAlpha = step(0.5);
  const stats: [string, string][] = [
    ['DEPTH', `${Math.floor(game.depth)}m`],
    ['ZONE', game.zoneCardName],
    ['BEST CHAIN', `×${game.bestChain}`],
    ['TOP SPEED', `${Math.round(game.topKmh)}`],
    ['BROKEN', String(game.breaks)],
    ['OVERDRIVES', String(game.odTriggers)],
  ];
  const gy = VIEW_H * 0.585;
  const colW = (VIEW_W - 80) / 2;
  stats.forEach(([k, v], i) => {
    const col = i % 2;
    const row = (i / 2) | 0;
    const x = 40 + col * colW;
    const y = gy + row * 36;
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

  // --- best / new best
  ctx.save();
  ctx.globalAlpha = step(0.66);
  const by = VIEW_H * 0.765;
  if (game.isNewBest) {
    const pulse = 0.7 + Math.sin(game.od.pulse * 7) * 0.3;
    ctx.font = heavy(22);
    ctx.fillStyle = rgba(OD_GOLD, pulse);
    drawTracked(ctx, 'NEW BEST', VIEW_W * 0.5, by, 5);
  } else {
    ctx.font = mono(11);
    ctx.fillStyle = rgba(pal.fg, 0.5);
    drawTracked(ctx, `BEST  ${game.best}`, VIEW_W * 0.5, by, 3);
  }
  ctx.restore();

  // --- next target: hand the next run its goal before the restart prompt.
  ctx.save();
  ctx.globalAlpha = step(0.74);
  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.75);
  drawTracked(
    ctx,
    `NEXT TARGET — ZONE ${game.zone + 2} AT ${(game.zone + 1) * ZONE_DEPTH}m`,
    VIEW_W * 0.5,
    VIEW_H * 0.815,
    2.5,
  );
  ctx.restore();

  // --- restart
  const pa = step(0.82);
  if (pa > 0 && Math.floor(game.od.pulse * 2.2) % 2 === 0) {
    ctx.save();
    ctx.globalAlpha = pa;
    ctx.font = heavy(18);
    ctx.fillStyle = rgba(brighten(pal.fg, 0.3), 1);
    drawTracked(ctx, 'SPACE — RUN IT AGAIN', VIEW_W * 0.5, VIEW_H * 0.875, 3);
    ctx.restore();
  }
}
