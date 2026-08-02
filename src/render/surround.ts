import { MAX_TIER, PX_PER_M, ZONE_DEPTH } from '../config';
import { clamp, lerp } from '../engine/math';
import { type Palette, rgba, zoneIndexAt } from '../game/biomes';
import type { Game } from '../game/game';
import { heavy, mono } from './type';

/**
 * Everything outside the shaft.
 *
 * The shaft is authored at a fixed 540x760 because the gameplay depends on it —
 * nine columns, a known reaction window. But letterboxing that into a desktop
 * window left ~480px of dead black on either side, and the game read as a narrow
 * strip squashed into the middle of the screen.
 *
 * So the canvas now fills the window and this module owns the leftover space:
 * a parallax industrial exterior, a scrolling depth ruler, and live telemetry.
 * The shaft stops being a letterbox and becomes the thing you are falling
 * through — the widescreen is the point rather than the problem.
 */

export interface View {
  /** Canvas size in CSS pixels. */
  w: number;
  h: number;
  /** Shaft rect in CSS pixels. */
  ox: number;
  oy: number;
  ow: number;
  oh: number;
  scale: number;
  /** Width of one flank; drives whether telemetry is drawn at all. */
  flank: number;
}

const TELEMETRY_MIN = 132;

export function drawSurround(ctx: CanvasRenderingContext2D, v: View, game: Game, pal: Palette) {
  const camY = game.camY;
  const speed = game.state === 'title' ? 0.45 : game.player.speedNorm;

  drawBackdrop(ctx, v, pal, speed);
  drawMotif(ctx, v, pal, camY, speed);
  drawShaftBezel(ctx, v, pal, speed, game.od.active ? game.od.t : 0);

  if (v.flank >= TELEMETRY_MIN) {
    drawDepthRuler(ctx, v, game, pal);
    drawTelemetry(ctx, v, game, pal);
  }
}

// ---------------------------------------------------------------- backdrop
function drawBackdrop(ctx: CanvasRenderingContext2D, v: View, pal: Palette, speed: number) {
  // Vertical gradient: the light you are falling away from is above you.
  const g = ctx.createLinearGradient(0, 0, 0, v.h);
  g.addColorStop(0, rgba(pal.bgFar, 0.55));
  g.addColorStop(0.35, rgba(pal.bg, 1));
  g.addColorStop(1, rgba(pal.bg, 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.w, v.h);

  // Zone glow pooling behind the shaft. Cheap, and it makes the biome colour
  // read even in the frames where no coloured geometry is on screen.
  const cx = v.ox + v.ow * 0.5;
  const rg = ctx.createRadialGradient(cx, v.h * 0.42, 0, cx, v.h * 0.42, Math.max(v.w, v.h) * 0.62);
  rg.addColorStop(0, rgba(pal.glow, 0.14 + speed * 0.1));
  rg.addColorStop(0.55, rgba(pal.glow, 0.03));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, v.w, v.h);
}

// ------------------------------------------------------------------ motif
/**
 * Parallax exterior. Two depth layers at different scroll rates plus the zone's
 * signature element; the rate difference is what sells vertical travel when the
 * shaft interior is streaming past at 1800px/s.
 */
function drawMotif(
  ctx: CanvasRenderingContext2D,
  v: View,
  pal: Palette,
  camY: number,
  speed: number,
) {
  const bands: { motif: Palette['motif']; a: number }[] = [
    { motif: pal.motif, a: 1 - pal.motifBlend },
    { motif: pal.nextMotif, a: pal.motifBlend },
  ];

  for (const band of bands) {
    if (band.a < 0.01) continue;
    ctx.save();
    ctx.globalAlpha = band.a;
    switch (band.motif) {
      case 'struts':
        motifStruts(ctx, v, pal, camY, speed);
        break;
      case 'embers':
        motifEmbers(ctx, v, pal, camY, speed);
        break;
      case 'crystal':
        motifCrystal(ctx, v, pal, camY, speed);
        break;
      case 'coils':
        motifCoils(ctx, v, pal, camY, speed);
        break;
      case 'stars':
        motifStars(ctx, v, pal, camY, speed);
        break;
    }
    ctx.restore();
  }
}

/** Deterministic scatter — no allocation, no per-frame RNG, stable across frames. */
const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function motifStruts(ctx: CanvasRenderingContext2D, v: View, pal: Palette, camY: number, sp: number) {
  // Far girders.
  for (const [rate, alpha, wdt] of [
    [0.22, 0.1, 26],
    [0.46, 0.16, 14],
  ] as const) {
    ctx.fillStyle = rgba(pal.glow, alpha);
    const pitch = 210;
    const off = ((camY * rate) % pitch + pitch) % pitch;
    for (let y = -off - pitch; y < v.h + pitch; y += pitch) {
      ctx.fillRect(0, y, v.ox - 8, 3);
      ctx.fillRect(v.ox + v.ow + 8, y, v.w, 3);
    }
    ctx.fillStyle = rgba(pal.fg, alpha * 0.5);
    for (let i = 0; i < 5; i++) {
      const x = v.ox * (0.18 + i * 0.19);
      ctx.fillRect(x, 0, wdt * 0.14, v.h);
      ctx.fillRect(v.w - x - wdt * 0.14, 0, wdt * 0.14, v.h);
    }
  }
  // Hazard chevrons drifting past, the fastest layer.
  ctx.fillStyle = rgba(pal.glow, 0.09 + sp * 0.06);
  const pitch = 150;
  const off = ((camY * 0.8) % pitch + pitch) % pitch;
  for (let y = -off - pitch; y < v.h + pitch; y += pitch) {
    chevron(ctx, v.ox * 0.5, y, 34, 16);
    chevron(ctx, v.ox + v.ow + v.flank * 0.5, y, 34, 16);
  }
}

function chevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, cy);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx + w * 0.5, cy);
  ctx.lineTo(cx, cy + h * 0.45);
  ctx.closePath();
  ctx.fill();
}

function motifEmbers(ctx: CanvasRenderingContext2D, v: View, pal: Palette, camY: number, sp: number) {
  // Embers rise while you fall, so relative motion is doubled — the cheapest
  // possible way to make a zone feel faster than the one before it.
  const n = 46;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0;
    const fx = hash(i);
    const x = side ? fx * (v.ox - 10) + 5 : v.ox + v.ow + 5 + fx * (v.flank - 10);
    const rate = 0.5 + hash(i + 90) * 0.9;
    const span = v.h + 160;
    const y = (((i * 71 + camY * rate) % span) + span) % span - 80;
    const r = 1 + hash(i + 40) * 2.6;
    ctx.fillStyle = rgba(pal.glow, 0.22 + hash(i + 7) * 0.4);
    ctx.beginPath();
    ctx.arc(x, v.h - y, r * (1 + sp * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  // Heat haze band low in the frame.
  const g = ctx.createLinearGradient(0, v.h, 0, v.h * 0.55);
  g.addColorStop(0, rgba(pal.glow, 0.16));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, v.h * 0.55, v.w, v.h * 0.45);
}

function motifCrystal(ctx: CanvasRenderingContext2D, v: View, pal: Palette, camY: number, sp: number) {
  const n = 26;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0;
    const fx = hash(i * 3);
    const x = side ? fx * (v.ox - 20) + 10 : v.ox + v.ow + 10 + fx * (v.flank - 20);
    const rate = 0.3 + hash(i + 12) * 0.5;
    const span = v.h + 320;
    const y = (((i * 137 + camY * rate) % span) + span) % span - 160;
    const s = 18 + hash(i + 55) * 54;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hash(i + 3) * Math.PI);
    ctx.strokeStyle = rgba(pal.glow, 0.14 + sp * 0.1);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.36, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.36, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(pal.glow, 0.05);
    ctx.fill();
    ctx.restore();
  }
}

function motifCoils(ctx: CanvasRenderingContext2D, v: View, pal: Palette, camY: number, sp: number) {
  const pitch = 96;
  const off = ((camY * 0.55) % pitch + pitch) % pitch;
  for (let y = -off - pitch; y < v.h + pitch; y += pitch) {
    const pulse = 0.5 + 0.5 * Math.sin(y * 0.03 + camY * 0.004);
    ctx.strokeStyle = rgba(pal.glow, 0.08 + pulse * 0.16 + sp * 0.05);
    ctx.lineWidth = 2 + pulse * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(v.ox - 6, y + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(v.ox + v.ow + 6, y + 10);
    ctx.lineTo(v.w, y);
    ctx.stroke();
  }
  // Vertical bus bars.
  ctx.fillStyle = rgba(pal.fg, 0.06);
  ctx.fillRect(v.ox * 0.34, 0, 5, v.h);
  ctx.fillRect(v.w - v.ox * 0.34 - 5, 0, 5, v.h);
}

function motifStars(ctx: CanvasRenderingContext2D, v: View, pal: Palette, camY: number, sp: number) {
  const n = 90;
  for (let i = 0; i < n; i++) {
    const fx = hash(i);
    const side = i % 2 === 0;
    const x = side ? fx * v.ox : v.ox + v.ow + fx * v.flank;
    const rate = 0.08 + hash(i + 31) * 0.7;
    const span = v.h + 60;
    const y = (((i * 53 + camY * rate) % span) + span) % span - 30;
    const a = 0.15 + hash(i + 5) * 0.5;
    const r = 0.6 + hash(i + 17) * 1.7;
    ctx.fillStyle = rgba(i % 7 === 0 ? pal.hot : pal.glow, a);
    // Streak the near layer at speed; distant stars stay points.
    const len = rate > 0.5 ? sp * rate * 46 : 0;
    if (len > 1) ctx.fillRect(x, y, r, len);
    else ctx.fillRect(x, y, r, r);
  }
}

// ------------------------------------------------------------------ bezel
/** The frame the shaft sits in: a hard edge, an inner falloff, and a rim light. */
function drawShaftBezel(
  ctx: CanvasRenderingContext2D,
  v: View,
  pal: Palette,
  speed: number,
  od: number,
) {
  const x0 = v.ox;
  const x1 = v.ox + v.ow;

  // Outer falloff so the exterior never touches the play area cleanly.
  const fadeW = Math.min(70, v.flank);
  if (fadeW > 2) {
    const lg = ctx.createLinearGradient(x0 - fadeW, 0, x0, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = lg;
    ctx.fillRect(x0 - fadeW, 0, fadeW, v.h);

    const rg = ctx.createLinearGradient(x1 + fadeW, 0, x1, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = rg;
    ctx.fillRect(x1, 0, fadeW, v.h);
  }

  // Rim light. Brightens with speed and goes gold in overdrive, so the frame
  // itself participates in the feedback instead of being static furniture.
  const rimA = 0.25 + speed * 0.4 + od * 0.5;
  const rim = od > 0.01 ? [255, 210, 110] as const : pal.glow;
  ctx.fillStyle = rgba(rim, rimA);
  ctx.fillRect(x0 - 2, 0, 2, v.h);
  ctx.fillRect(x1, 0, 2, v.h);

  ctx.fillStyle = rgba(rim, rimA * 0.22);
  ctx.fillRect(x0 - 9, 0, 7, v.h);
  ctx.fillRect(x1 + 2, 0, 7, v.h);
}

// ------------------------------------------------------------- depth ruler
/**
 * A physical tape measure running down the left flank. Depth was a bare number
 * in the corner; as a scrolling ruler with the zone boundaries marked on it, the
 * player can see how far the next zone is without reading anything.
 */
function drawDepthRuler(ctx: CanvasRenderingContext2D, v: View, game: Game, pal: Palette) {
  const x = v.ox - 34;
  const camM = game.camY / PX_PER_M;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';

  // 10m minor ticks, 50m major, numbers every 100m.
  const startM = Math.floor((camM - 40) / 10) * 10;
  const endM = camM + v.h / v.scale / PX_PER_M + 40;

  for (let m = startM; m < endM; m += 10) {
    if (m < 0) continue;
    const y = (m - camM) * PX_PER_M * v.scale + v.oy;
    if (y < -20 || y > v.h + 20) continue;

    const major = m % 50 === 0;
    const labeled = m % 100 === 0;
    ctx.fillStyle = rgba(pal.fg, major ? 0.4 : 0.16);
    ctx.fillRect(x, y, major ? 16 : 8, 1);

    if (labeled) {
      ctx.fillStyle = rgba(pal.fg, 0.5);
      ctx.font = mono(10);
      ctx.fillText(String(m), x - 5, y);
    }
  }

  // Zone boundaries: the next chapter, visible before you reach it.
  const z0 = zoneIndexAt(Math.max(0, camM));
  for (let z = z0; z <= z0 + 2; z++) {
    const m = z * ZONE_DEPTH;
    const y = (m - camM) * PX_PER_M * v.scale + v.oy;
    if (y < -30 || y > v.h + 30) continue;
    ctx.fillStyle = rgba(pal.glow, 0.85);
    ctx.fillRect(x - 2, y - 1, 24, 3);
    ctx.fillStyle = rgba(pal.glow, 0.9);
    ctx.font = heavy(10);
    ctx.textAlign = 'right';
    ctx.fillText(`Z${z + 1}`, x - 5, y - 9);
  }

  ctx.restore();
}

// -------------------------------------------------------------- telemetry
/**
 * Right flank: a vertical velocity column and the tier ladder beside it, so the
 * two numbers that decide every collision are readable without ever crossing
 * the play area.
 */
function drawTelemetry(ctx: CanvasRenderingContext2D, v: View, game: Game, pal: Palette) {
  if (game.state !== 'play') return;
  const p = game.player;
  const x = v.ox + v.ow + 26;
  const top = v.oy + v.oh * 0.16;
  const h = v.oh * 0.56;
  const w = 12;

  ctx.save();

  // Label the ladder so it reads as the POWER scale, not abstract decoration.
  ctx.font = mono(9);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = rgba(pal.fg, 0.5);
  ctx.fillText('POWER', x - 2, top - 10);

  // Track.
  ctx.fillStyle = rgba(pal.fg, 0.08);
  ctx.fillRect(x, top, w, h);

  // Fill, from the bottom.
  const fill = clamp(p.speedNorm, 0, 1) * h;
  const g = ctx.createLinearGradient(0, top + h, 0, top);
  g.addColorStop(0, rgba(pal.glow, 0.85));
  g.addColorStop(1, rgba(pal.fg, 0.95));
  ctx.fillStyle = g;
  ctx.fillRect(x, top + h - fill, w, fill);

  // Tier gradations along the column: where each hardness threshold sits.
  for (let t = 1; t <= MAX_TIER; t++) {
    const frac = clamp((t * 60) / (1850 / 3), 0, 1);
    const y = top + h - frac * h;
    const on = p.tier >= t;
    ctx.fillStyle = rgba(on ? pal.fg : pal.hot, on ? 0.9 : 0.35);
    ctx.fillRect(x + w + 4, y - 1, on ? 11 : 6, 2);
    if (t % 2 === 1) {
      ctx.font = mono(9);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(on ? pal.fg : pal.hot, on ? 0.75 : 0.3);
      ctx.fillText(String(t), x + w + 19, y);
    }
  }

  // Live readout under the column.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = rgba(pal.fg, 0.9);
  ctx.font = heavy(22);
  ctx.fillText(String(Math.round(p.kmh)), x - 2, top + h + 14);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  ctx.fillText('KM/H', x - 1, top + h + 38);

  // Overdrive charge, mirroring the velocity column.
  const odTop = top + h + 62;
  const odH = Math.max(40, v.oh * 0.14);
  ctx.fillStyle = rgba(pal.fg, 0.08);
  ctx.fillRect(x, odTop, w, odH);
  const odFill = clamp(game.od.active ? game.od.t : game.od.charge, 0, 1) * odH;
  ctx.fillStyle = game.od.active
    ? `rgba(255,226,122,${(0.7 + Math.sin(game.od.pulse * 22) * 0.3).toFixed(3)})`
    : rgba(pal.glow, 0.7);
  ctx.fillRect(x, odTop + odH - odFill, w, odFill);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  ctx.fillText('O/D', x - 1, odTop + odH + 6);

  ctx.restore();
}

/** Shared with the renderer for consistent flank measurement. */
export function measure(w: number, h: number): View {
  const scale = Math.min(w / 540, h / 760);
  const ow = 540 * scale;
  const oh = 760 * scale;
  const ox = (w - ow) * 0.5;
  const oy = (h - oh) * 0.5;
  return { w, h, ox, oy, ow, oh, scale, flank: ox };
}

export { lerp };
