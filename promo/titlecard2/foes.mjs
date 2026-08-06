/**
 * The hostiles, hand-ported for the trailer from `src/render/bodies.ts` and
 * `src/game/enemies.ts` — the same silhouettes, the same hull ramp, the same
 * three-marks-maximum discipline, so what the trailer teases is the game and
 * not an impression of it. Data is verbatim; the `Enemy`/`Game` plumbing is
 * replaced by a plain pose object the trailer authors directly.
 *
 * Only four of the five species are here. The SPINE is deliberately absent:
 * the trailer does not show it, and neither does this file.
 */
import { COL, rgba, TAU, drawRadial, flareSprite, glowSprite, haloSprite } from './lib.mjs';

export const WARD_ARC = 1.16;

export const ENEMY_COL = {
  mote: COL.mote,
  seeder: COL.seeder,
  ward: COL.ward,
  lancer: COL.lancer,
};

// ------------------------------------------------------------- silhouettes
/** Body outlines, unrotated, unit radius — from `silhouette()` in enemies.ts. */
function silhouette(kind, r) {
  switch (kind) {
    case 'mote': {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        pts.push([Math.cos(a - 0.17) * r * 0.62, Math.sin(a - 0.17) * r * 0.62]);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        pts.push([Math.cos(a + 0.17) * r * 0.62, Math.sin(a + 0.17) * r * 0.62]);
        pts.push([Math.cos(a + 0.52) * r * 0.67, Math.sin(a + 0.52) * r * 0.67]);
      }
      return pts;
    }
    case 'seeder':
      return [
        [0, -r * 1.12], [r * 0.52, -r * 0.86], [r * 0.72, -r * 0.24], [r * 0.66, r * 0.42],
        [r * 0.34, r * 0.98], [0, r * 1.16], [-r * 0.34, r * 0.98], [-r * 0.66, r * 0.42],
        [-r * 0.72, -r * 0.24], [-r * 0.52, -r * 0.86],
      ];
    case 'ward':
      return [
        [r * 0.84, -r * 0.26], [r * 0.5, -r * 0.72], [-r * 0.14, -r * 0.86],
        [-r * 0.72, -r * 0.5], [-r * 0.86, r * 0.12], [-r * 0.5, r * 0.7],
        [r * 0.14, r * 0.84], [r * 0.72, r * 0.44],
      ];
    case 'lancer':
      return [
        [r * 1.75, 0], [r * 0.7, -r * 0.28], [r * 0.05, -r * 0.36],
        [-r * 0.7, -r * 1.06], [-r * 1.08, -r * 0.92], [-r * 0.58, -r * 0.34],
        [-r * 1.1, -r * 0.24], [-r * 1.1, r * 0.24], [-r * 0.58, r * 0.34],
        [-r * 1.08, r * 0.92], [-r * 0.7, r * 1.06], [r * 0.05, r * 0.36],
        [r * 0.7, r * 0.28],
      ];
  }
  return [];
}

export const UNIT = {
  mote: silhouette('mote', 1),
  seeder: silhouette('seeder', 1),
  ward: silhouette('ward', 1),
  lancer: silhouette('lancer', 1),
};

/** Drawn size relative to the collision radius, per species. */
export const VIS = { mote: 1.42, seeder: 1.24, ward: 1.26, lancer: 1.2 };

// ------------------------------------------------------------ hull and kit
const hull = (c, k, base) =>
  `rgba(${(c[0] * k + base) | 0},${(c[1] * k + base * 0.96) | 0},${(c[2] * k + base * 1.22) | 0},1)`;
const hullDark = (c) => hull(c, 0.07, 7);
const hullMid = (c) => hull(c, 0.14, 14);
const hullLit = (c) => hull(c, 0.27, 28);
const VOID = 'rgba(4,5,9,1)';

function trace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function arcRun(ctx, x, y, r, a0, a1) {
  ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  ctx.arc(x, y, r, a0, a1);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function fillPoly(ctx, pts, fill) {
  trace(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The form gradient: shadow, hull, lit — built in unit space. */
function form(ctx, col, light) {
  const lx = Math.cos(light);
  const ly = Math.sin(light);
  const g = ctx.createLinearGradient(-lx * 1.1, -ly * 1.1, lx * 1.1, ly * 1.1);
  g.addColorStop(0, hullDark(col));
  g.addColorStop(0.52, hullMid(col));
  g.addColorStop(1, hullLit(col));
  return g;
}

/** A solid, lit body: mass, then rim toward the light, contact hairline away. */
function body(ctx, pts, s, col, light, alpha, rimW = 2.4) {
  const lx = Math.cos(light);
  const ly = Math.sin(light);
  ctx.save();
  ctx.scale(s, s);
  trace(ctx, pts);
  ctx.fillStyle = form(ctx, col, light);
  ctx.fill();
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      if (((nx * lx + ny * ly) > 0) !== (pass === 1)) continue;
      any = true;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    if (!any) continue;
    ctx.strokeStyle = pass === 1 ? rgba(col, 0.95 * alpha) : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = (pass === 1 ? rimW : rimW * 0.55) / s;
    ctx.stroke();
  }
  ctx.restore();
}

/** A lens: near-black bezel, hot core. Every eye and fuze on the field. */
function lens(ctx, x, y, r, col, alpha, heat = 1) {
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(col, 0.5 * alpha);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, flareSprite(col, 0.95), x, y, r * 1.15 * heat, alpha);
  ctx.globalCompositeOperation = 'source-over';
}

/** A dark stud with a lit crown. */
function bolt(ctx, x, y, r, col, a) {
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(col, 0.6 * a);
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

// ------------------------------------------------------------------- bodies
/**
 * Pose fields (all optional beyond col/r): rot, toP (direction of the light
 * i.e. the player), clock, seed, alpha, state (lancer 0/1/2), shield + flash
 * (ward), driftX/driftY (mote), age, hitR (ward slab radius).
 */
const DEF = {
  rot: 0, toP: 0, clock: 0, seed: 1.7, alpha: 1, state: 0,
  shield: 0, flash: 0, driftX: 0, driftY: 0, age: 0, hitR: 0,
};

export function drawMote(ctx, pose) {
  const p = { ...DEF, ...pose };
  const r = p.r;
  const fl = 0.74 + 0.26 * Math.sin(p.clock * 5 + p.seed * 5.3);

  if (p.driftX || p.driftY) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 3; i++) {
      const d = r * (0.7 + i * 0.55);
      const wob = Math.sin(p.clock * 7 + p.seed + i * 2.1) * r * 0.2;
      drawRadial(
        ctx, flareSprite(p.col, 0.8),
        -p.driftX * d - p.driftY * wob, -p.driftY * d + p.driftX * wob,
        r * (0.26 - i * 0.05), p.alpha * fl * (0.4 - i * 0.09),
      );
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.mote, r, p.col, p.toP - p.rot, p.alpha, 2.2);
  ctx.fillStyle = rgba(p.col, (0.55 + fl * 0.45) * p.alpha);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const hx = Math.cos(a) * r * 0.92;
    const hy = Math.sin(a) * r * 0.92;
    ctx.moveTo(hx + r * 0.09, hy);
    ctx.arc(hx, hy, r * 0.09, 0, TAU);
  }
  ctx.fill();
  ctx.restore();

  lens(ctx, 0, 0, r * 0.24, p.col, p.alpha, 1 + fl * 0.2);
}

const CAVITY = 0.4;

export function drawSeeder(ctx, pose) {
  const p = { ...DEF, ...pose };
  const r = p.r;
  const swell = pose.swell !== undefined
    ? pose.swell
    : 0.5 + 0.5 * Math.sin(p.clock * 2.2 + p.seed);

  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.seeder, r, p.col, p.toP - p.rot, p.alpha, 2.6);

  ctx.save();
  ctx.scale(r * 0.64, r * 0.64);
  trace(ctx, UNIT.seeder);
  ctx.fillStyle = `rgba(${(COL.mote[0] * 0.46) | 0},${(COL.mote[1] * 0.3) | 0},${(COL.mote[2] * 0.22) | 0},1)`;
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, glowSprite(COL.mote, CAVITY), 0, 0, r * 0.72, (p.alpha * (0.24 + swell * 0.16)) / CAVITY);
  ctx.globalCompositeOperation = 'source-over';

  // The brood: three eggs in silhouette against the cavity, turning over.
  for (let i = 0; i < 3; i++) {
    const a = p.age * 1.3 + (i / 3) * TAU;
    const bx = Math.cos(a) * r * 0.32;
    const by = Math.sin(a) * r * 0.36;
    ctx.fillStyle = 'rgba(20,7,4,0.96)';
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(COL.mote, 0.75 * p.alpha);
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  // The seam it will come apart along.
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 2.8;
  line(ctx, -r * 0.52, r * 0.04, r * 0.52, r * 0.04);
  ctx.strokeStyle = rgba(p.col, (0.5 + swell * 0.4) * p.alpha);
  ctx.lineWidth = 1.2 + swell * 1.3;
  line(ctx, -r * 0.52, -r * 0.03, r * 0.52, -r * 0.03);

  for (const s of [-1, 1]) {
    fillPoly(ctx, [
      [s * r * 0.6, -r * 0.72], [s * r * 0.94, -r * 0.5], [s * r * 0.98, 0],
      [s * r * 0.94, r * 0.5], [s * r * 0.6, r * 0.72], [s * r * 0.66, r * 0.34],
      [s * r * 0.7, 0], [s * r * 0.66, -r * 0.34],
    ], hullMid(p.col));
    ctx.strokeStyle = rgba(p.col, 0.6 * p.alpha);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    bolt(ctx, s * r * 0.8, -r * 0.36, r * 0.09, p.col, p.alpha);
    bolt(ctx, s * r * 0.8, r * 0.36, r * 0.09, p.col, p.alpha);
  }
  ctx.restore();
}

export function drawWard(ctx, pose) {
  const p = { ...DEF, ...pose };
  const r = p.r;
  const thick = r * 0.28;
  const sr = (p.hitR || r * 1.7) * 0.96 - thick * 0.5;
  const lit = (0.6 + p.flash * 0.4) * p.alpha;

  ctx.strokeStyle = hullDark(p.col);
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const a = p.shield + s * WARD_ARC * 0.86;
    ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
    ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
  }
  ctx.stroke();

  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.ward, r * 0.54, p.col, p.toP - p.rot, p.alpha, 2.4);
  ctx.restore();
  lens(ctx, 0, 0, r * 0.25, p.col, p.alpha, 1.15);

  const PLATES = 3;
  const span = (WARD_ARC * 2) / PLATES;
  for (let i = 0; i < PLATES; i++) {
    const a0 = p.shield - WARD_ARC + i * span + span * 0.06;
    const a1 = a0 + span * 0.88;
    const am = (a0 + a1) * 0.5;
    const ri = sr - thick * 0.5;
    const ro = sr + thick * 0.5;
    const pts = [
      [Math.cos(a0) * ri, Math.sin(a0) * ri],
      [Math.cos(a0) * ro, Math.sin(a0) * ro],
      [Math.cos(am) * (ro + thick * 0.16), Math.sin(am) * (ro + thick * 0.16)],
      [Math.cos(a1) * ro, Math.sin(a1) * ro],
      [Math.cos(a1) * ri, Math.sin(a1) * ri],
      [Math.cos(am) * (ri + thick * 0.1), Math.sin(am) * (ri + thick * 0.1)],
    ];
    fillPoly(ctx, pts, hullMid(p.col));
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = rgba(p.col, lit);
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    arcRun(ctx, 0, 0, ro, a0, a1);
    ctx.stroke();
    if (p.flash > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(COL.playerCore, p.flash * p.alpha);
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      arcRun(ctx, 0, 0, ro, a0, a1);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  for (const s of [-1, 1]) {
    const a = p.shield + s * WARD_ARC;
    const ex = Math.cos(a) * sr;
    const ey = Math.sin(a) * sr;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(a);
    fillPoly(ctx, [
      [-thick * 0.62, -thick * 0.34], [thick * 0.72, -thick * 0.5],
      [thick * 0.72, thick * 0.5], [-thick * 0.62, thick * 0.34],
    ], hullLit(p.col));
    ctx.strokeStyle = rgba(p.col, 0.8 * p.alpha);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
  }
}

export function drawLancer(ctx, pose) {
  const p = { ...DEF, ...pose };
  const r = p.r;
  const charging = p.state === 2;
  const marking = p.state === 1;
  ctx.save();
  ctx.rotate(p.rot);

  if (charging) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(p.col, 0.26 * p.alpha);
    ctx.beginPath();
    ctx.moveTo(-r * 5.5, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(COL.playerCore, 0.5 * p.alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    arcRun(ctx, r * 0.95, 0, r * 1.5, -1.05, 1.05);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.globalAlpha = marking ? 0.72 + 0.28 * Math.sin(p.clock * 22) : 1;
  body(ctx, UNIT.lancer, r, p.col, p.toP - p.rot, p.alpha, 2.4);
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(r * 0.02, s * r * 0.3);
    ctx.lineTo(-r * 0.62, s * r * 0.3);
  }
  ctx.stroke();

  fillPoly(ctx, [
    [-r * 1.06, -r * 0.2], [-r * 1.22, -r * 0.15], [-r * 1.22, r * 0.15], [-r * 1.06, r * 0.2],
  ], VOID);
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, flareSprite(p.col, 0.85), -r * 1.24, 0,
    r * (charging ? 1.05 : 0.38 + 0.06 * Math.sin(p.clock * 9 + p.seed)), p.alpha,
  );
  if (charging) {
    ctx.fillStyle = rgba(COL.playerCore, 0.7 * p.alpha);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(-r * (1.35 + i * 0.5), 0, r * (0.09 - i * 0.018), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  lens(ctx, r * 1.12, 0, r * 0.19, marking ? COL.warn : p.col, p.alpha, marking ? 1.7 : 1);
  ctx.restore();
}

const DRAW = { mote: drawMote, seeder: drawSeeder, ward: drawWard, lancer: drawLancer };

/**
 * One hostile at (x, y): the soft halo that makes it a light source standing
 * in a dark room, then the body. `pose.r` here is the *collision* radius;
 * the species' VIS factor is applied the way the game applies it.
 */
export function drawFoe(ctx, kind, x, y, pose) {
  ctx.save();
  ctx.translate(x, y);
  const breathe = 1 + Math.sin((pose.clock || 0) * 3 + (pose.seed || 0)) * 0.04;
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, haloSprite(ENEMY_COL[kind]), 0, 0, pose.r * 1.9, (pose.alpha ?? 1) * 0.8);
  ctx.globalCompositeOperation = 'source-over';
  DRAW[kind](ctx, { ...pose, col: ENEMY_COL[kind], r: pose.r * VIS[kind] * breathe });
  ctx.restore();
}

/**
 * A species dying: its own silhouette breaking apart edge by edge — segments
 * of the outline flying out, a flare at the heart, embers. `age` runs 0→~0.6.
 */
export function burstFoe(ctx, kind, x, y, r, age, alpha = 1) {
  if (age < 0) return;
  const col = ENEMY_COL[kind];
  const pts = UNIT[kind];
  const life = 0.62;
  const p = Math.min(1, age / life);
  const fade = (1 - p) ** 1.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'lighter';

  const rr = r * VIS[kind];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) * 0.5;
    const my = (a[1] + b[1]) * 0.5;
    const d = Math.hypot(mx, my) || 1;
    const h = Math.sin(i * 12.9898) * 43758.5453;
    const j = h - Math.floor(h);
    const fly = age * (150 + j * 260);
    const rot = age * (j - 0.5) * 9;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const ox = (mx / d) * fly;
    const oy = (my / d) * fly;
    const ax = (a[0] - mx) * cs - (a[1] - my) * sn;
    const ay = (a[0] - mx) * sn + (a[1] - my) * cs;
    const bx = (b[0] - mx) * cs - (b[1] - my) * sn;
    const by = (b[0] - mx) * sn + (b[1] - my) * cs;
    ctx.globalAlpha = alpha * fade * (0.5 + j * 0.5);
    ctx.strokeStyle = rgba(col, 1);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo((mx + ax) * rr + ox * 1.4, (my + ay) * rr + oy);
    ctx.lineTo((mx + bx) * rr + ox * 1.4, (my + by) * rr + oy);
    ctx.stroke();
  }

  drawRadial(ctx, flareSprite(col, 1), 0, 0, r * (1.6 + p * 3.2), alpha * Math.exp(-age * 6) * 1.1);
  drawRadial(ctx, flareSprite(COL.playerCore, 1), 0, 0, r * (0.9 + p * 1.6), alpha * Math.exp(-age * 9));

  for (let i = 0; i < 9; i++) {
    const h = Math.sin((i + 7) * 78.233) * 43758.5453;
    const j = h - Math.floor(h);
    const a = j * TAU;
    const spd = 130 + j * 320;
    ctx.globalAlpha = alpha * fade * (0.4 + j * 0.5);
    ctx.fillStyle = rgba(j < 0.5 ? col : COL.playerCore, 1);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * spd * age, Math.sin(a) * spd * age + 40 * age * age, 1.6 + j * 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
