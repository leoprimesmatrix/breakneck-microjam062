import {
  CAM_ANCHOR,
  CORE,
  GLASS,
  GRATE,
  MELT_AT,
  PLATE,
  type Material,
} from '../config';
import { clamp, lerp } from '../engine/math';
import {
  brighten,
  darken,
  MOLTEN,
  mixRGB,
  type Palette,
  rgba,
  type RGB,
} from '../game/biomes';
import type { Game } from '../game/game';
import type { Heat } from '../game/heat';
import { view } from '../viewport';

/**
 * The playfield — which is now the entire canvas.
 *
 * Drawn into the post-processing scene buffer rather than the visible canvas, so
 * anything emissive here feeds the bloom pass automatically. That is the trick
 * behind the look: draw bright things on a near-black field and let the
 * composite turn them into light.
 */

/** Palette with meltdown folded in, so no draw call has to special-case it. */
export function effectivePalette(pal: Palette, melt: number): Palette {
  if (melt <= 0.001) return pal;
  return {
    ...pal,
    fg: mixRGB(pal.fg, [255, 246, 214], melt),
    hot: mixRGB(pal.hot, MOLTEN, melt * 0.85),
    glow: mixRGB(pal.glow, MOLTEN, melt),
  };
}

export function drawScene(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const p = game.player;
  const camY = game.camY;
  const W = view.logicalW;
  const H = view.logicalH;
  const speed = game.state === 'title' ? 0.42 : p.speedNorm;
  const melt = game.heat.meltIntensity;

  ctx.fillStyle = rgba(pal.bg, 1);
  ctx.fillRect(0, 0, W, H);

  drawBackdrop(ctx, camY, pal, speed);
  drawMotif(ctx, camY, pal, speed);
  drawLaneGuides(ctx, pal);

  ctx.save();
  ctx.translate(game.juice.offsetX(), game.juice.offsetY());

  // Camera pulls back as you accelerate. Reads as speed, and hands you extra
  // lookahead exactly when steering authority is lowest.
  const zoom = lerp(1, 0.88, speed) * (1 + game.juice.punch);
  if (zoom !== 1) {
    const ax = W * 0.5;
    const ay = H * CAM_ANCHOR;
    ctx.translate(ax, ay);
    ctx.scale(zoom, zoom);
    ctx.translate(-ax, -ay);
  }

  drawSpeedLines(ctx, camY, speed, pal, melt);
  drawWalls(ctx, camY, speed, pal, melt);
  drawBlocks(ctx, game, camY, pal);
  game.particles.draw(ctx, camY, pal);
  drawTrail(ctx, game, camY, pal);
  drawPlayer(ctx, game, camY, pal);
  drawPopups(ctx, game, camY, pal);

  ctx.restore();

  drawVignette(ctx, speed, pal, melt, game.burning ? game.heat.overload : 0);

  if (game.juice.flash > 0) {
    ctx.globalAlpha = clamp(game.juice.flash, 0, 1);
    ctx.fillStyle = melt > 0.2 ? rgba(MOLTEN, 1) : rgba(brighten(pal.fg, 0.4), 1);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// --------------------------------------------------------------- backdrop
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  camY: number,
  pal: Palette,
  speed: number,
) {
  const W = view.logicalW;
  const H = view.logicalH;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, rgba(mixRGB(pal.bg, pal.bgFar, 0.6), 1));
  g.addColorStop(0.42, rgba(pal.bg, 1));
  g.addColorStop(1, rgba(darken(pal.bg, 0.4), 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Slow strata bands, far parallax — gives the eye something to measure motion
  // against when no barriers happen to be on screen.
  const pitch = 340;
  const off = ((camY * 0.32) % pitch + pitch) % pitch;
  for (let y = -off - pitch; y < H + pitch; y += pitch) {
    const bg = ctx.createLinearGradient(0, y, 0, y + pitch * 0.5);
    bg.addColorStop(0, rgba(pal.glow, 0.055 + speed * 0.02));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, y, W, pitch * 0.5);
  }
}

/** Faint lane rules, so the grid the world is built on is legible. */
function drawLaneGuides(ctx: CanvasRenderingContext2D, pal: Palette) {
  ctx.fillStyle = rgba(pal.fg, 0.03);
  for (let c = 1; c < view.cols; c++) {
    ctx.fillRect(c * view.cellW - 0.5, 0, 1, view.logicalH);
  }
}

// ------------------------------------------------------------------ motif
/**
 * The zone's signature background, ported in from the old flank surround.
 *
 * These used to live in the dead space beside a letterboxed shaft. With the
 * playfield filling the window that space no longer exists, so the motifs move
 * behind the play area — dimmer, and at a slower parallax rate than the barriers
 * so they read as distance rather than as obstacles.
 */
function drawMotif(
  ctx: CanvasRenderingContext2D,
  camY: number,
  pal: Palette,
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
        motifStruts(ctx, camY, pal, speed);
        break;
      case 'embers':
        motifEmbers(ctx, camY, pal, speed);
        break;
      case 'crystal':
        motifCrystal(ctx, camY, pal, speed);
        break;
      case 'coils':
        motifCoils(ctx, camY, pal, speed);
        break;
      case 'stars':
        motifStars(ctx, camY, pal, speed);
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

function motifStruts(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, sp: number) {
  const W = view.logicalW;
  const H = view.logicalH;
  for (const [rate, alpha] of [
    [0.22, 0.055],
    [0.46, 0.075],
  ] as const) {
    ctx.fillStyle = rgba(pal.glow, alpha);
    const pitch = 210;
    const off = ((camY * rate) % pitch + pitch) % pitch;
    for (let y = -off - pitch; y < H + pitch; y += pitch) {
      ctx.fillRect(0, y, W, 3);
    }
  }
  // Hazard chevrons drifting past, the fastest layer.
  ctx.fillStyle = rgba(pal.glow, 0.05 + sp * 0.03);
  const pitch = 150;
  const off = ((camY * 0.8) % pitch + pitch) % pitch;
  const n = Math.max(2, Math.round(view.cols / 4));
  for (let y = -off - pitch; y < H + pitch; y += pitch) {
    for (let i = 0; i < n; i++) {
      chevron(ctx, ((i + 0.5) / n) * W, y, 34, 16);
    }
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

function motifEmbers(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, sp: number) {
  const W = view.logicalW;
  const H = view.logicalH;
  // Embers rise while you fall, so relative motion is doubled — the cheapest
  // possible way to make a zone feel faster than the one before it.
  const n = Math.round(34 + view.cols * 2.4);
  for (let i = 0; i < n; i++) {
    const x = hash(i) * W;
    const rate = 0.5 + hash(i + 90) * 0.9;
    const span = H + 160;
    const y = (((i * 71 + camY * rate) % span) + span) % span - 80;
    const r = 1 + hash(i + 40) * 2.6;
    ctx.fillStyle = rgba(pal.glow, 0.12 + hash(i + 7) * 0.22);
    ctx.beginPath();
    ctx.arc(x, H - y, r * (1 + sp * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, H, 0, H * 0.55);
  g.addColorStop(0, rgba(pal.glow, 0.1));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
}

function motifCrystal(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, sp: number) {
  const W = view.logicalW;
  const H = view.logicalH;
  const n = Math.round(14 + view.cols * 1.1);
  for (let i = 0; i < n; i++) {
    const x = hash(i * 3) * W;
    const rate = 0.3 + hash(i + 12) * 0.5;
    const span = H + 320;
    const y = (((i * 137 + camY * rate) % span) + span) % span - 160;
    const s = 18 + hash(i + 55) * 54;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hash(i + 3) * Math.PI);
    ctx.strokeStyle = rgba(pal.glow, 0.07 + sp * 0.05);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.36, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.36, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

function motifCoils(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, sp: number) {
  const W = view.logicalW;
  const H = view.logicalH;
  const pitch = 96;
  const off = ((camY * 0.55) % pitch + pitch) % pitch;
  for (let y = -off - pitch; y < H + pitch; y += pitch) {
    const pulse = 0.5 + 0.5 * Math.sin(y * 0.03 + camY * 0.004);
    ctx.strokeStyle = rgba(pal.glow, 0.04 + pulse * 0.07 + sp * 0.03);
    ctx.lineWidth = 2 + pulse * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + 14);
    ctx.stroke();
  }
}

function motifStars(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, sp: number) {
  const W = view.logicalW;
  const H = view.logicalH;
  const n = Math.round(60 + view.cols * 4);
  for (let i = 0; i < n; i++) {
    const x = hash(i) * W;
    const rate = 0.08 + hash(i + 31) * 0.7;
    const span = H + 60;
    const y = (((i * 53 + camY * rate) % span) + span) % span - 30;
    const a = 0.1 + hash(i + 5) * 0.32;
    const r = 0.6 + hash(i + 17) * 1.7;
    ctx.fillStyle = rgba(i % 7 === 0 ? pal.hot : pal.glow, a);
    const len = rate > 0.5 ? sp * rate * 46 : 0;
    if (len > 1) ctx.fillRect(x, y, r, len);
    else ctx.fillRect(x, y, r, r);
  }
}

// ------------------------------------------------------------- speed lines
function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  camY: number,
  speedNorm: number,
  pal: Palette,
  melt: number,
) {
  const W = view.logicalW;
  const H = view.logicalH;
  const n = Math.round(20 + view.cols * 2.2);
  const len = 22 + speedNorm * 300 + melt * 70;
  ctx.strokeStyle = rgba(melt > 0.2 ? MOLTEN : pal.fg, 0.05 + speedNorm * 0.18 + melt * 0.1);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = hash(i * 7.3) * W;
    const span = H + len + 200;
    const y = (((i * 211 + camY * 1.45) % span) + span) % span - len - 100;
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
  }
  ctx.stroke();
}

/** Shaft edges. The player bounces off these, so they must look solid. */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  camY: number,
  speedNorm: number,
  pal: Palette,
  melt: number,
) {
  const W = view.logicalW;
  const H = view.logicalH;

  // Mask beyond the edges so the camera pull-back reveals wall, not void.
  ctx.fillStyle = rgba(darken(pal.bg, 0.55), 1);
  ctx.fillRect(-300, -300, 300, H + 600);
  ctx.fillRect(W, -300, 300, H + 600);

  const rim = melt > 0.2 ? MOLTEN : pal.glow;
  ctx.fillStyle = rgba(rim, 0.4 + speedNorm * 0.35 + melt * 0.4);
  ctx.fillRect(0, -300, 2.5, H + 600);
  ctx.fillRect(W - 2.5, -300, 2.5, H + 600);

  const inner = 26;
  const lg = ctx.createLinearGradient(0, 0, inner, 0);
  lg.addColorStop(0, rgba(rim, 0.18));
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, inner, H);
  const rg = ctx.createLinearGradient(W, 0, W - inner, 0);
  rg.addColorStop(0, rgba(rim, 0.18));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(W - inner, 0, inner, H);

  const spacing = 60;
  const off = ((camY % spacing) + spacing) % spacing;
  ctx.fillStyle = rgba(pal.fg, 0.16 + speedNorm * 0.14);
  for (let y = -off; y < H + 60; y += spacing) {
    ctx.fillRect(3, y, 13, 2);
    ctx.fillRect(W - 16, y, 13, 2);
  }
}

// ------------------------------------------------------------------ blocks
/**
 * Barriers, drawn as MATERIAL.
 *
 * The version this replaces stamped a hardness digit on every block and asked
 * the player to compare it against a speed tier — arithmetic, at 600 km/h, in
 * peripheral vision. It was unreadable in practice, so it was ignored, and the
 * game collapsed into holding one key.
 *
 * Here the answer to "can I go through that?" is carried entirely by how the
 * thing looks. Glass is thin and translucent, grate is a see-through lattice,
 * plate is solid and riveted, core is banded and massive. Anything your current
 * heat can melt glows and softens; anything it cannot is cold, hard-edged and
 * hazard-striped. No reading, no comparing — just looking.
 */
function drawBlocks(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
) {
  const H = view.logicalH;
  const heat = game.heat;
  // On the title screen there is no run, so pick a mid heat: the attract shaft
  // then shows both states and demonstrates the core read at a glance.
  const attract = game.state === 'title';

  for (const b of game.world.blocks) {
    if (b.dead) continue;
    const sy = b.y - camY;
    if (sy > H + 200 || sy + b.h < -160) continue;

    const meltable = attract ? b.material <= GRATE : heat.canMelt(b.material);
    // Telegraph: as heat closes on the next threshold, that material starts to
    // shimmer — so the player sees a capability arriving before it lands.
    const need = MELT_AT[b.material];
    const near =
      attract || meltable || !isFinite(need)
        ? 0
        : clamp(1 - (need - heat.value) / 0.12, 0, 1);

    drawBarrier(ctx, b.x, sy, b.w, b.h, b.material, meltable, near, b.chips, pal, heat);
  }
}

function drawBarrier(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  m: Material,
  meltable: boolean,
  near: number,
  chips: number,
  pal: Palette,
  heat: Heat,
) {
  // GLASS is physically thin; insetting it vertically is most of what makes the
  // material legible before any colour is applied.
  const inset = m === GLASS ? bh * 0.24 : m === GRATE ? bh * 0.12 : 0;
  // Lane gap is proportional. A fixed 3px looked right in a 60-unit lane and
  // vanished in a 90-unit one, letting neighbouring barriers fuse into a wall.
  const gapX = Math.max(3, bw * 0.05);
  const x = bx + gapX * 0.5;
  const y = by + 2 + inset;
  const w = bw - gapX;
  const h = bh - 4 - inset * 2;

  const molten = meltable ? mixRGB(pal.fg, MOLTEN, heat.melting ? 0.85 : 0.35) : pal.hot;

  ctx.save();

  if (meltable) {
    // Emissive: lit from within, brighter the hotter you are.
    const glow = clamp(0.45 + heat.value * 0.55, 0, 1);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(brighten(molten, 0.3 * glow), m === GLASS ? 0.55 : 1));
    g.addColorStop(0.55, rgba(molten, m === GLASS ? 0.42 : 1));
    g.addColorStop(1, rgba(darken(molten, 0.3), m === GLASS ? 0.5 : 1));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = rgba(brighten(molten, 0.65), 0.9);
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = rgba(darken(molten, 0.6), 0.7);
    ctx.fillRect(x, y + h - 2, w, 2);
  } else {
    // Cold: dark body, hard edge, hazard hatching. The hatching is what makes
    // "do not touch" legible in peripheral vision at speed.
    ctx.fillStyle = rgba(darken(pal.bg, 0.25), 0.94);
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = rgba(pal.hot, 0.2 + near * 0.3);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -h; i < w + h; i += 11) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = rgba(near > 0 ? mixRGB(pal.hot, MOLTEN, near) : pal.hot, 0.9);
    ctx.lineWidth = m === CORE ? 3 : 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  // --- material signature, drawn over either state
  const ink = meltable ? rgba(darken(pal.bg, 0.35), 0.75) : rgba(pal.hot, 0.75);

  if (m === GRATE) {
    // Lattice: you can see through it, and that reads as "lighter than plate".
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const bars = Math.max(3, Math.round(w / 13));
    for (let i = 1; i < bars; i++) {
      const gx = x + (i / bars) * w;
      ctx.moveTo(gx, y + 2);
      ctx.lineTo(gx, y + h - 2);
    }
    ctx.moveTo(x + 2, y + h * 0.5);
    ctx.lineTo(x + w - 2, y + h * 0.5);
    ctx.stroke();
  } else if (m === PLATE) {
    // Rivets. Four dots is all it takes to say "heavy engineered slab".
    ctx.fillStyle = ink;
    const r = 1.7;
    for (const [rx, ry] of [
      [x + 6, y + 6],
      [x + w - 6, y + 6],
      [x + 6, y + h - 6],
      [x + w - 6, y + h - 6],
    ] as const) {
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (m === CORE) {
    // Horizontal bands with glowing seams — massive, layered, obviously final.
    const bands = 3;
    for (let i = 1; i < bands; i++) {
      const gy = y + (i / bands) * h;
      ctx.fillStyle = meltable
        ? rgba(brighten(molten, 0.7), 0.85)
        : rgba(mixRGB(pal.hot, MOLTEN, 0.35), 0.5 + near * 0.4);
      ctx.fillRect(x + 2, gy - 1, w - 4, 2);
    }
    ctx.strokeStyle = meltable ? rgba(brighten(molten, 0.5), 0.9) : rgba(pal.hot, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  } else {
    // GLASS: a couple of hairline fractures so it reads as brittle, not as a
    // faint rectangle.
    ctx.strokeStyle = meltable
      ? rgba(brighten(molten, 0.8), 0.5)
      : rgba(pal.hot, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y);
    ctx.lineTo(x + w * 0.38, y + h);
    ctx.moveTo(x + w * 0.72, y);
    ctx.lineTo(x + w * 0.6, y + h);
    ctx.stroke();
  }

  // Chips from failed impacts: a promise the wall is getting weaker.
  if (chips > 0) {
    ctx.strokeStyle = rgba(brighten(pal.hot, 0.5), 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < chips; i++) {
      const cy = y + h * (0.3 + i * 0.24);
      ctx.moveTo(x + 3, cy);
      ctx.lineTo(x + w * 0.45, cy + 4);
      ctx.lineTo(x + w - 4, cy - 3);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// ------------------------------------------------------------------ player
function drawTrail(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
) {
  const t = game.trail;
  if (t.length < 2) return;
  const R = view.playerR;

  const h = game.heat.value;
  const col = mixRGB(pal.glow, MOLTEN, clamp(h * 1.2, 0, 1));
  ctx.globalCompositeOperation = 'lighter';

  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.moveTo(t[0].x, t[0].y - camY);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y - camY);
    ctx.strokeStyle = rgba(col, pass === 0 ? 0.1 + h * 0.24 : 0.3 + h * 0.45);
    ctx.lineWidth = pass === 0 ? R * 2.1 : R * 0.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * The ship IS the heat gauge.
 *
 * There used to be a numeric POWER badge tethered beside the hull, because the
 * mechanic was a number and a number had to be displayed. Heat is a physical
 * state, so it can be shown physically: the hull runs dark when cold, ember at
 * the edges when warm, orange through, and white-hot with visible haze at the
 * redline. The player reads their own capability off their own ship without
 * ever moving their eyes to a meter.
 */
function drawPlayer(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
) {
  const p = game.player;
  if (game.state === 'dead' || game.state === 'title') return;
  if (p.iframe > 0 && Math.floor(p.iframe * 22) % 2 === 0) return;

  const heat = game.heat;
  const h = heat.value;
  const melt = heat.meltIntensity;
  const x = p.x;
  const y = p.y - camY;
  const bank = p.bank;
  const R = view.playerR;

  // Hull colour is a straight temperature ramp: dark steel -> ember -> orange
  // -> white. This is the readout.
  const core: RGB =
    h < 0.33
      ? mixRGB([120, 132, 156], [255, 120, 40], h / 0.33)
      : mixRGB([255, 120, 40], [255, 250, 232], (h - 0.33) / 0.67);

  // Thrust plume, behind the hull, additive so it blooms.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const plume = 24 + p.speedNorm * 70 + h * 40 + melt * 60;
  const pg = ctx.createLinearGradient(0, y - R, 0, y - R - plume);
  pg.addColorStop(0, rgba(brighten(core, 0.3), 0.55 + h * 0.4));
  pg.addColorStop(0.4, rgba(mixRGB(pal.glow, MOLTEN, h), 0.26));
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(x - R * 0.62, y - R * 0.2);
  ctx.lineTo(x - bank * 8, y - R - plume);
  ctx.lineTo(x + R * 0.62, y - R * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Heat corona. Grows with temperature, and in the redline it pulses — the
  // ship visibly straining is the warning, before any HUD element is involved.
  const aura = h * 0.7 + melt * 0.6;
  if (aura > 0.02) {
    const pulse = game.burning ? 0.75 + Math.sin(heat.pulse * 26) * 0.25 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = R * (2.2 + aura * 3);
    const ag = ctx.createRadialGradient(x, y, 0, x, y, r);
    ag.addColorStop(0, rgba(melt > 0.1 ? MOLTEN : core, 0.5 * aura * pulse));
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  // Hull: a dart that banks into its turn.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(bank * 0.42);

  ctx.fillStyle = rgba(darken(pal.bg, 0.5), 1);
  hull(ctx, R + 4.5);
  ctx.fill();

  const hg = ctx.createLinearGradient(0, -R, 0, R);
  hg.addColorStop(0, rgba(brighten(core, 0.55), 1));
  hg.addColorStop(1, rgba(core, 1));
  ctx.fillStyle = hg;
  hull(ctx, R);
  ctx.fill();

  // Canopy notch: gives the shape a front, so the bank is readable.
  ctx.fillStyle = rgba(darken(pal.bg, 0.3), 0.8);
  ctx.beginPath();
  ctx.moveTo(0, R * 0.42);
  ctx.lineTo(R * 0.26, -R * 0.1);
  ctx.lineTo(-R * 0.26, -R * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Downward-pointing dart. Nose is +y because the player falls. */
function hull(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, r * 1.25);
  ctx.lineTo(r * 0.78, -r * 0.5);
  ctx.lineTo(r * 0.34, -r * 0.85);
  ctx.lineTo(-r * 0.34, -r * 0.85);
  ctx.lineTo(-r * 0.78, -r * 0.5);
  ctx.closePath();
}

// ------------------------------------------------------------------ popups
function drawPopups(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
) {
  if (game.popups.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pu of game.popups) {
    const t = pu.life / pu.max;
    const rise = (1 - t) * 6;
    ctx.globalAlpha = Math.min(1, t * 2.2);
    const col =
      pu.kind === 'fail' || pu.kind === 'burn'
        ? pal.hot
        : pu.kind === 'melt'
          ? MOLTEN
          : pu.kind === 'heal'
            ? pal.glow
            : pal.fg;
    ctx.font = `900 ${pu.big ? 26 : 17}px "Arial Black", Helvetica, sans-serif`;
    const half = ctx.measureText(pu.text).width * 0.5 + 8;
    const x = clamp(pu.x, half, view.logicalW - half);
    const y = pu.y - camY - rise;
    ctx.fillStyle = rgba(darken(pal.bg, 0.6), 0.75);
    ctx.fillText(pu.text, x + 2, y + 2);
    ctx.fillStyle = rgba(col, 1);
    ctx.fillText(pu.text, x, y);
  }
  ctx.globalAlpha = 1;
}

/** Radial darkening that tightens with speed; one draw, big atmosphere. */
function drawVignette(
  ctx: CanvasRenderingContext2D,
  speedNorm: number,
  pal: Palette,
  melt: number,
  burn: number,
) {
  const W = view.logicalW;
  const H = view.logicalH;
  const cx = W * 0.5;
  const cy = H * CAM_ANCHOR;
  // Radii scale with the field so the framing is the same at 7 lanes and 26.
  const far = Math.max(W, H) * 0.86;
  const inner = lerp(far * 0.62, far * 0.19, speedNorm);
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, far);
  const edge = darken(pal.bg, 0.5);
  g.addColorStop(0, rgba(edge, 0));
  g.addColorStop(1, rgba(edge, 0.4 + speedNorm * 0.5));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  if (melt > 0.02) {
    const og = ctx.createRadialGradient(cx, cy, far * 0.3, cx, cy, far);
    og.addColorStop(0, 'rgba(0,0,0,0)');
    og.addColorStop(1, rgba(MOLTEN, 0.3 * melt));
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, W, H);
  }
  // Burning rims the frame in danger red — the same channel as meltdown gold,
  // so the two states are impossible to confuse.
  if (burn > 0) {
    const bg = ctx.createRadialGradient(cx, cy, far * 0.25, cx, cy, far);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, rgba(pal.hot, 0.28 + burn * 0.3));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}
