/**
 * The game modules the title sequence draws with, as plain JS.
 *
 * `titlecard.mjs` imports `/src/config.ts` and `/src/render/glyphs.ts` and lets
 * vite transpile them — which means it can only render on a machine with node
 * installed. This file is the same material with the types stripped by hand, so
 * the v2 sequence renders against `serve.ps1` on a machine with nothing on it.
 *
 * Fidelity rule: the DATA here — palette, glyph runs, airframe polygons — is
 * copied verbatim from src/ and must never drift from it. If the game's face or
 * ship changes, re-copy; don't redraw. The one deliberate omission is the parts
 * of ship.ts that need a live `Game` (trail, beam, aura): the sequence drives
 * the airframe itself.
 */

export const TAU = Math.PI * 2;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------- src/config.ts
export const COL = {
  void: [6, 7, 11],
  floor: [13, 15, 22],
  grid: [42, 52, 76],
  gridHot: [86, 118, 172],
  wall: [132, 158, 198],

  player: [126, 230, 255],
  playerCore: [244, 251, 255],
  strike: [156, 240, 255],

  focus: [96, 214, 250],
  hull: [122, 240, 198],
  danger: [255, 74, 92],
  warn: [255, 178, 74],

  mote: [255, 154, 92],
  seeder: [255, 108, 176],
  ward: [186, 126, 255],
  lancer: [255, 86, 64],
  spine: [255, 208, 96],

  ink: [232, 240, 250],
  dim: [124, 138, 164],
};

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ------------------------------------------------------ src/render/glyphs.ts
const W = 0.62;
const A = 0.62;

const g = (a, ...p) => ({ p, a });

export const GLYPHS = {
  ' ': g(0.34),

  A: g(A, [0, 1, 0.19, 0.14, 0.27, 0, 0.35, 0, 0.43, 0.14, W, 1], [0.12, 0.64, 0.5, 0.64]),
  B: g(
    A,
    [0, 1, 0, 0, 0.42, 0, W, 0.17, W, 0.3, 0.47, 0.46, 0, 0.46],
    [0.44, 0.46, W, 0.63, W, 0.83, 0.45, 1, 0, 1],
  ),
  C: g(A, [W, 0.15, 0.46, 0, 0.16, 0, 0, 0.17, 0, 0.83, 0.16, 1, 0.46, 1, W, 0.85]),
  D: g(A, [0, 1, 0, 0, 0.4, 0, W, 0.22, W, 0.78, 0.4, 1, 0, 1]),
  E: g(A, [W, 0, 0, 0, 0, 1, W, 1], [0, 0.47, 0.46, 0.47]),
  F: g(A, [W, 0, 0, 0, 0, 1], [0, 0.47, 0.44, 0.47]),
  G: g(
    A,
    [W, 0.15, 0.46, 0, 0.16, 0, 0, 0.17, 0, 0.83, 0.16, 1, 0.46, 1, W, 0.84, W, 0.55, 0.34, 0.55],
  ),
  H: g(A, [0, 0, 0, 1], [W, 0, W, 1], [0, 0.5, W, 0.5]),
  I: g(0.34, [0.17, 0, 0.17, 1]),
  J: g(A, [W, 0, W, 0.8, 0.45, 1, 0.17, 1, 0, 0.82, 0, 0.68]),
  K: g(A, [0, 0, 0, 1], [0.6, 0, 0.08, 0.53, W, 1]),
  L: g(A, [0, 0, 0, 1, 0.58, 1]),
  M: g(A, [0, 1, 0, 0, 0.31, 0.4, W, 0, W, 1]),
  N: g(A, [0, 1, 0, 0, W, 1, W, 0]),
  O: g(A, [0.16, 0, 0.46, 0, W, 0.17, W, 0.83, 0.46, 1, 0.16, 1, 0, 0.83, 0, 0.17, 0.16, 0]),
  P: g(A, [0, 1, 0, 0, 0.42, 0, W, 0.18, W, 0.34, 0.42, 0.52, 0, 0.52]),
  Q: g(
    A,
    [0.16, 0, 0.46, 0, W, 0.17, W, 0.83, 0.46, 1, 0.16, 1, 0, 0.83, 0, 0.17, 0.16, 0],
    [0.38, 0.72, 0.68, 1.04],
  ),
  R: g(A, [0, 1, 0, 0, 0.42, 0, W, 0.18, W, 0.34, 0.42, 0.52, 0, 0.52], [0.3, 0.52, W, 1]),
  S: g(
    A,
    [W, 0.15, 0.46, 0, 0.16, 0, 0, 0.16, 0, 0.31, 0.15, 0.46, 0.46, 0.46, W, 0.62, W, 0.84, 0.45, 1, 0.15, 1, 0, 0.85],
  ),
  T: g(A, [0, 0, W, 0], [0.31, 0, 0.31, 1]),
  U: g(A, [0, 0, 0, 0.8, 0.19, 1, 0.43, 1, W, 0.8, W, 0]),
  V: g(A, [0, 0, 0.26, 0.86, 0.36, 0.86, W, 0]),
  W: g(0.74, [0, 0, 0.16, 1, 0.37, 0.42, 0.58, 1, 0.74, 0]),
  X: g(A, [0, 0, W, 1], [W, 0, 0, 1]),
  Y: g(A, [0, 0, 0.31, 0.48, W, 0], [0.31, 0.48, 0.31, 1]),
  Z: g(A, [0, 0, W, 0, 0, 1, W, 1]),

  '0': g(
    A,
    [0.16, 0, 0.46, 0, W, 0.17, W, 0.83, 0.46, 1, 0.16, 1, 0, 0.83, 0, 0.17, 0.16, 0],
    [0.1, 0.78, 0.52, 0.22],
  ),
  '1': g(A, [0.06, 0.21, 0.31, 0, 0.31, 1]),
  '2': g(A, [0, 0.18, 0.17, 0, 0.45, 0, W, 0.17, W, 0.33, 0, 1, W, 1]),
  '3': g(
    A,
    [0, 0.16, 0.16, 0, 0.45, 0, W, 0.17, W, 0.31, 0.47, 0.46, 0.22, 0.46],
    [0.47, 0.46, W, 0.62, W, 0.84, 0.45, 1, 0.15, 1, 0, 0.84],
  ),
  '4': g(A, [0.45, 1, 0.45, 0, 0, 0.68, W, 0.68]),
  '5': g(A, [W, 0, 0, 0, 0, 0.42, 0.44, 0.42, W, 0.6, W, 0.82, 0.45, 1, 0.15, 1, 0, 0.84]),
  '6': g(
    A,
    [0.56, 0.12, 0.44, 0, 0.18, 0, 0, 0.2, 0, 0.83, 0.17, 1, 0.45, 1, W, 0.83, W, 0.63, 0.45, 0.46, 0.16, 0.46, 0, 0.62],
  ),
  '7': g(A, [0, 0, W, 0, 0.24, 1]),
  '8': g(
    A,
    [0.17, 0.46, 0, 0.31, 0, 0.16, 0.16, 0, 0.46, 0, W, 0.16, W, 0.31, 0.45, 0.46, 0.17, 0.46, 0, 0.62, 0, 0.84, 0.16, 1, 0.46, 1, W, 0.84, W, 0.62, 0.45, 0.46],
  ),
  '9': g(
    A,
    [0.06, 0.88, 0.18, 1, 0.44, 1, W, 0.8, W, 0.17, 0.46, 0, 0.16, 0, 0, 0.17, 0, 0.34, 0.17, 0.54, 0.46, 0.54, W, 0.38],
  ),

  '.': g(0.32, [0.13, 0.99, 0.19, 0.99]),
  ',': g(0.32, [0.17, 0.93, 0.08, 1.12]),
  ':': g(0.32, [0.13, 0.34, 0.19, 0.34], [0.13, 0.86, 0.19, 0.86]),
  '-': g(0.5, [0.06, 0.52, 0.44, 0.52]),
  '_': g(A, [0, 1.06, W, 1.06]),
  '!': g(0.32, [0.16, 0, 0.16, 0.66], [0.13, 0.97, 0.19, 0.97]),
  '?': g(
    A,
    [0.02, 0.2, 0.19, 0, 0.45, 0, W, 0.18, W, 0.33, 0.31, 0.55, 0.31, 0.68],
    [0.28, 0.97, 0.34, 0.97],
  ),
  '/': g(0.52, [0.46, 0, 0.06, 1]),
  '+': g(A, [0.31, 0.24, 0.31, 0.8], [0.03, 0.52, 0.59, 0.52]),
  '×': g(A, [0.08, 0.28, 0.54, 0.74], [0.54, 0.28, 0.08, 0.74]),
  '·': g(0.3, [0.12, 0.52, 0.18, 0.52]),
  '(': g(0.4, [0.36, 0, 0.14, 0.24, 0.14, 0.76, 0.36, 1]),
  ')': g(0.4, [0.06, 0, 0.28, 0.24, 0.28, 0.76, 0.06, 1]),
  '[': g(0.4, [0.36, 0, 0.12, 0, 0.12, 1, 0.36, 1]),
  ']': g(0.4, [0.06, 0, 0.3, 0, 0.3, 1, 0.06, 1]),
  "'": g(0.26, [0.13, 0, 0.13, 0.24]),
  '>': g(0.5, [0.1, 0.18, 0.42, 0.5, 0.1, 0.82]),
  '<': g(0.5, [0.42, 0.18, 0.1, 0.5, 0.42, 0.82]),
  '=': g(A, [0.05, 0.38, 0.57, 0.38], [0.05, 0.66, 0.57, 0.66]),
  '%': g(
    A,
    [0.54, 0.06, 0.08, 0.94],
    [0.04, 0.06, 0.2, 0.06, 0.2, 0.28, 0.04, 0.28, 0.04, 0.06],
    [0.42, 0.72, 0.58, 0.72, 0.58, 0.94, 0.42, 0.94, 0.42, 0.72],
  ),
};

export const MISSING = g(A, [0.06, 0.12, 0.56, 0.12, 0.56, 0.88, 0.06, 0.88, 0.06, 0.12]);

export function glyphFor(ch) {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? MISSING;
}

// -------------------------------------------------------- src/render/glow.ts
// Only the sprite half of glow.ts: the accumulator is a 60fps economy measure,
// and offline rendering pays for real Gaussians instead.
const sprites = new Map();
const MAX_SPRITES = 128;

export function radialSprite(key, stops, size = 128) {
  let c = sprites.get(key);
  if (c) return c;
  if (sprites.size >= MAX_SPRITES) sprites.clear();
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g2 = c.getContext('2d');
  const r = size / 2;
  const gr = g2.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g2.fillStyle = gr;
  g2.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}

export const haloSprite = (col) =>
  radialSprite(`halo${col}`, [
    [0, rgba(col, 0.24)],
    [0.5, rgba(col, 0.07)],
    [1, rgba(col, 0)],
  ]);

export const glowSprite = (col, inner) =>
  radialSprite(`glow${col}:${inner}`, [
    [0, rgba(col, inner)],
    [1, rgba(col, 0)],
  ]);

export const flareSprite = (col, inner = 1) =>
  radialSprite(`flare${col}:${inner}`, [
    [0, `rgba(255,255,255,${inner})`],
    [0.22, rgba(col, inner * 0.85)],
    [0.6, rgba(col, inner * 0.2)],
    [1, rgba(col, 0)],
  ]);

export function drawRadial(ctx, sprite, x, y, r, alpha = 1) {
  if (r <= 0 || alpha <= 0.002) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}

// -------------------------------------------------------- src/render/ship.ts
const NAC_Y = 0.58;

const WING = [
  [0.5, 0], [0.2, -0.42], [-0.34, -1.42], [-0.78, -1.48],
  [-0.94, -1.14], [-0.46, -0.44], [-0.46, 0.44], [-0.94, 1.14],
  [-0.78, 1.48], [-0.34, 1.42], [0.2, 0.42],
];

const NACELLE = [
  [0.16, -0.24], [-0.5, -0.3], [-1.14, -0.26],
  [-1.18, 0.2], [-0.5, 0.26], [0.12, 0.22],
];

const FUSE = [
  [1.55, 0], [1.05, -0.22], [0.5, -0.4], [-0.28, -0.44],
  [-0.9, -0.3], [-1.02, 0], [-0.9, 0.3], [-0.28, 0.44],
  [0.5, 0.4], [1.05, 0.22],
];

const CANOPY = [
  [0.9, 0], [0.66, -0.2], [0.14, -0.26], [-0.1, 0],
  [0.14, 0.26], [0.66, 0.2],
];

const LEADING = [
  [[1.3, -0.11], [1.05, -0.22], [0.5, -0.4]],
  [[1.3, 0.11], [1.05, 0.22], [0.5, 0.4]],
  [[0.2, -0.42], [-0.34, -1.42]],
  [[0.2, 0.42], [-0.34, 1.42]],
];

const HULL_WING = 'rgba(11,15,23,1)';
const HULL_NAC = 'rgba(16,22,33,1)';
const HULL_FUSE = 'rgba(22,31,45,1)';

function poly(ctx, pts, oy = 0) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1] + oy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1] + oy);
  ctx.closePath();
}

function part(ctx, pts, fill, stroke, lw, oy = 0) {
  poly(ctx, pts, oy);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function run(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

const IDLE = { thrust: 0, bank: 0, stretch: 0, charge: 0, alpha: 1, clock: 0 };

/** The airframe alone, at any size, anywhere — no aura, no trail, no beam. */
export function drawShip(ctx, x, y, angle, r, state = {}) {
  const s = { ...IDLE, ...state };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(r, r);
  drawExhaust(ctx, s);
  drawHull(ctx, s);
  ctx.restore();
}

function drawExhaust(ctx, s) {
  const heat = Math.max(s.thrust, s.stretch);
  if (heat < 0.02) return;
  const flick = 0.88 + 0.12 * Math.sin(s.clock * 41);
  const len = (0.55 + heat * 3.4) * flick;
  const a = s.alpha * (0.4 + heat * 0.6);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const oy of [-NAC_Y, NAC_Y]) {
    ctx.fillStyle = rgba(COL.strike, 0.3 * a);
    ctx.beginPath();
    ctx.moveTo(-1.14, oy - 0.23);
    ctx.lineTo(-1.14, oy + 0.23);
    ctx.lineTo(-1.14 - len, oy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba(COL.playerCore, 0.55 * a);
    ctx.beginPath();
    ctx.moveTo(-1.14, oy - 0.1);
    ctx.lineTo(-1.14, oy + 0.1);
    ctx.lineTo(-1.14 - len * 0.66, oy);
    ctx.closePath();
    ctx.fill();

    drawRadial(ctx, flareSprite(COL.strike, 0.9), -1.2, oy, 0.46 + heat * 0.5, a);

    if (heat > 0.35) {
      ctx.fillStyle = rgba(COL.playerCore, 0.7 * a * clamp01((heat - 0.35) / 0.4));
      for (let i = 1; i <= 3; i++) {
        const d = 1.14 + len * (i / 4);
        const sz = 0.09 * (1 - i * 0.22);
        ctx.beginPath();
        ctx.arc(-d, oy, sz, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawHull(ctx, p) {
  const alpha = p.alpha;

  const sx = 1 + p.stretch * 2.3;
  const sy = 1 - p.stretch * 0.42;
  const bank = p.bank;
  const lean = bank * 0.16;
  ctx.scale(sx, sy * Math.cos(bank * 0.9));

  const lw = (v) => v / Math.max(sx, 1);
  const detail = alpha * (1 - p.stretch * 0.85);
  const frame = alpha * (1 - p.stretch * 0.8);

  if (Math.abs(bank) > 0.08 && frame > 0.02) {
    ctx.globalAlpha = frame * Math.min(1, Math.abs(bank) * 1.6) * 0.9;
    part(ctx, WING, 'rgba(6,9,14,1)', rgba(COL.player, 0.18), lw(0.09), lean * 1.9);
  }

  if (frame > 0.02) {
    ctx.globalAlpha = frame;
    part(ctx, WING, HULL_WING, rgba(COL.player, 0.5), lw(0.105));
    part(ctx, NACELLE, HULL_NAC, rgba(COL.player, 0.66), lw(0.095), -NAC_Y + lean * 0.5);
    part(ctx, NACELLE, HULL_NAC, rgba(COL.player, 0.66), lw(0.095), NAC_Y + lean * 0.5);
  }
  ctx.globalAlpha = alpha;

  const spool = 0.35 + p.charge * 0.65;
  ctx.strokeStyle = rgba(COL.strike, 0.85 * spool * detail);
  ctx.lineWidth = lw(0.16);
  ctx.beginPath();
  for (const oy of [-NAC_Y, NAC_Y]) {
    ctx.moveTo(0.13, oy - 0.2 + lean * 0.5);
    ctx.lineTo(0.13, oy + 0.18 + lean * 0.5);
  }
  ctx.stroke();

  part(ctx, FUSE, HULL_FUSE, rgba(COL.player, 0.95), lw(0.13), lean * 0.35);

  ctx.strokeStyle = rgba(COL.playerCore, 0.8 * alpha);
  ctx.lineWidth = lw(0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const r of LEADING) run(ctx, r);
  ctx.stroke();

  if (detail > 0.04) {
    ctx.strokeStyle = rgba(COL.player, 0.42 * detail);
    ctx.lineWidth = lw(0.06);
    ctx.beginPath();
    ctx.moveTo(1.3, lean * 0.35);
    ctx.lineTo(-0.82, lean * 0.35);
    for (const s of [-1, 1]) {
      ctx.moveTo(1.02, s * 0.18 + lean * 0.35);
      ctx.lineTo(0.14, s * 0.38 + lean * 0.35);
      ctx.lineTo(-0.5, s * 0.37 + lean * 0.35);
      ctx.moveTo(-0.24, s * 0.78);
      ctx.lineTo(-0.66, s * 1.04);
    }
    ctx.stroke();
  }

  poly(ctx, CANOPY, lean);
  ctx.fillStyle = 'rgba(5,8,13,1)';
  ctx.strokeStyle = 'rgba(5,8,13,1)';
  ctx.lineWidth = lw(0.13);
  ctx.fill();
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  poly(ctx, CANOPY, lean);
  ctx.fillStyle = rgba(COL.player, (0.8 + p.charge * 0.2) * alpha);
  ctx.fill();
  ctx.strokeStyle = rgba(COL.playerCore, 0.7 * alpha);
  ctx.lineWidth = lw(0.045);
  ctx.stroke();
  ctx.fillStyle = rgba(COL.playerCore, 0.95 * alpha);
  ctx.beginPath();
  ctx.moveTo(0.88, lean);
  ctx.lineTo(0.62, -0.15 + lean);
  ctx.lineTo(0.34, -0.11 + lean);
  ctx.lineTo(0.64, lean);
  ctx.closePath();
  ctx.fill();
  drawRadial(ctx, glowSprite(COL.player, 0.34), 0.42, lean, 0.5, alpha * 0.8);

  drawRadial(ctx, flareSprite(COL.playerCore, 1), 1.48, lean * 0.2, 0.17, alpha);
  const beat = (p.clock * 1.5) % 1;
  for (const [s, phase] of [[-1, 0], [1, 0.5]]) {
    const on = clamp01(1 - ((beat + phase) % 1) / 0.16);
    if (on <= 0.02) continue;
    drawRadial(
      ctx, flareSprite(s < 0 ? COL.playerCore : COL.strike, 1),
      -0.56, s * 1.44, 0.2 + on * 0.16, alpha * on,
    );
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
