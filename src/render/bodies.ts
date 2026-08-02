import { COL, rgba, type RGB } from '../config';
import { TAU, clamp01 } from '../engine/math';
import {
  LANCER_MARK,
  SPINE_PERIOD,
  WARD_ARC,
  silhouette,
  type Enemy,
  type EnemyKind,
} from '../game/enemies';
import { ENEMY_COL, type Game } from '../game/game';
import { drawRadial, flareSprite, glowSprite, haloSprite } from './glow';

/**
 * The five hostiles, drawn.
 *
 * The rule they all obey: **an enemy is a machine with a job, and the job is
 * visible on the body.** A seeder carries what it will release; a ward carries
 * the emitters that make its shield; a spine is bolted to the floor it cannot
 * leave. None of that is decoration — a player who has died to a thing twice
 * should be able to look at it and say what it does, and the only place that
 * information can live is the silhouette and the parts hung off it.
 *
 * Colour still declares a side: every enemy sits in the warm family, the hulls
 * are dark so they occlude the grid, and the one white on any of them is a
 * glint of the *player's* light. See `config.ts` for why that matters.
 */

/** Unit-radius outlines, shared with the shatter so a death breaks the right shape. */
const UNIT: Record<EnemyKind, [number, number][]> = {
  mote: silhouette('mote', 1),
  seeder: silhouette('seeder', 1),
  ward: silhouette('ward', 1),
  lancer: silhouette('lancer', 1),
  spine: silhouette('spine', 1),
};

/** A body's own colour pulled down to hull-plate dark. */
const darkBody = (col: RGB) =>
  `rgba(${(col[0] * 0.14 + 11) | 0},${(col[1] * 0.14 + 11) | 0},${(col[2] * 0.14 + 14) | 0},1)`;

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function unitPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  s: number,
  fill: string | null,
  stroke: string | null,
  lw: number,
) {
  ctx.save();
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw / s;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Light the body from the one light in the room.
 *
 * Each edge is stroked bright or dim depending on whether its outward normal
 * faces the player. That is real shading logic rather than decoration, and it is
 * the single change that stops these reading as outlines and starts them reading
 * as solids: an outline has one uniform weight all the way round, and nothing in
 * a lit world does.
 */
function rimPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  s: number,
  fill: string,
  dim: string,
  lit: string,
  lw: number,
  lightLocal: number,
) {
  const lx = Math.cos(lightLocal);
  const ly = Math.sin(lightLocal);
  ctx.save();
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  // Two passes, so each is a single stroke call rather than one per edge.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      // Outward normal, disambiguated against the body centre rather than
      // assuming a winding order — the outlines are authored by eye and some of
      // them wind the other way.
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const facing = nx * lx + ny * ly > 0;
      if (facing !== (pass === 1)) continue;
      any = true;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    if (!any) continue;
    ctx.strokeStyle = pass === 1 ? lit : dim;
    ctx.lineWidth = (pass === 1 ? lw * 1.35 : lw * 0.75) / s;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The shadow a body throws away from the player's light. Small and constant — a
 * long raked shadow would fight the aim line for attention — but enough to lift
 * every enemy off the floor and turn the arena from a diagram into a room with
 * things standing in it.
 */
function castShadow(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  s: number,
  rot: number,
  toP: number,
  r: number,
  alpha: number,
) {
  const d = r * 0.24;
  ctx.save();
  ctx.translate(-Math.cos(toP) * d, -Math.sin(toP) * d);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${0.5 * alpha})`;
  ctx.fill();
  ctx.restore();
}

/** A small white glint offset toward the player: every species catches your light. */
function glint(ctx: CanvasRenderingContext2D, toP: number, off: number, alpha: number) {
  ctx.fillStyle = rgba(COL.playerCore, 0.88 * alpha);
  ctx.beginPath();
  ctx.arc(Math.cos(toP) * off, Math.sin(toP) * off, 2.6, 0, TAU);
  ctx.fill();
}

/** A dark stud with a lit crown — one bolt, four calls, reads as hardware. */
function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, a: number) {
  ctx.fillStyle = 'rgba(6,8,13,1)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(col, 0.7 * a);
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawEnemyBody(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  alpha: number,
) {
  const col = ENEMY_COL[e.kind];
  const flash = clamp01(e.flash);
  const breathe = 1 + Math.sin(game.clock * 3 + e.seed) * 0.05;
  const toP = Math.atan2(game.player.y - e.y, game.player.x - e.x);
  const body = darkBody(col);

  ctx.save();
  ctx.translate(e.x, e.y);

  // Lifted off the floor before anything else touches it.
  castShadow(
    ctx, UNIT[e.kind], e.r * breathe,
    e.kind === 'seeder' ? e.rot * 0.4 : e.kind === 'spine' ? 0 : e.rot,
    toP, e.r, alpha,
  );

  // Every enemy gets a soft additive halo so the swarm reads as light sources in
  // a dark room rather than as decals lying on the floor.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, haloSprite(col), 0, 0, e.r * 2.5, alpha);
  ctx.globalCompositeOperation = 'source-over';

  switch (e.kind) {
    case 'mote': drawMote(ctx, e, game, col, body, toP, breathe, alpha); break;
    case 'seeder': drawSeeder(ctx, e, game, col, body, toP, breathe, alpha); break;
    case 'ward': drawWard(ctx, e, col, body, toP, breathe, flash, alpha); break;
    case 'lancer': drawLancer(ctx, e, game, col, toP, breathe, alpha); break;
    case 'spine': drawSpine(ctx, e, col, body, toP, breathe, alpha); break;
  }

  ctx.restore();
}

// ------------------------------------------------------------------------ mote
/**
 * A piece of something that is still on fire. The shell is dark and cracked; the
 * light comes from *inside* it, through the cracks, and it flickers because
 * nothing burning is ever steady. The embers it sheds behind itself are the only
 * part that is not on the body, and they are what makes a drifting rock read as
 * a thing being consumed.
 */
function drawMote(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  body: string,
  toP: number,
  breathe: number,
  alpha: number,
) {
  const fl = 0.74 + 0.26 * Math.sin(game.clock * 11 + e.seed * 5.3);
  const s = e.r * breathe;

  // Embers, shed backwards along the drift. Drawn before the body so the body
  // occludes the freshest one, which is what puts them *behind* it.
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > 12) {
    const bx = -e.vx / sp;
    const by = -e.vy / sp;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 2; i++) {
      const d = e.r * (0.9 + i * 0.75);
      const wob = Math.sin(game.clock * 7 + e.seed + i * 2.1) * e.r * 0.22;
      drawRadial(
        ctx, flareSprite(col, 0.8), bx * d - by * wob, by * d + bx * wob,
        e.r * (0.3 - i * 0.07), alpha * fl * (0.5 - i * 0.14),
      );
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.rotate(e.rot);
  rimPoly(ctx, UNIT.mote, s, body, rgba(col, 0.5 * alpha * fl), rgba(col, alpha * fl), 2.4, toP - e.rot);

  // The cracks. They start from one off-centre point rather than the middle,
  // because a fracture radiates from where the thing was hit, and they run to
  // alternating vertices so the pattern never resolves into a star.
  const ox = s * 0.08;
  const oy = -s * 0.1;
  // Drawn additively and thick: these have to survive being sat on top of by the
  // core glow, and a hairline crack at this size is simply not there.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(col, alpha * fl);
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const i of [0, 2, 4, 5] as const) {
    const v = UNIT.mote[i];
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + (v[0] * s - ox) * 0.88, oy + (v[1] * s - oy) * 0.88);
  }
  ctx.stroke();

  // The core is deliberately smaller than the body. A flare wide enough to reach
  // the rim erases everything between, which is exactly what the cracks are.
  drawRadial(ctx, flareSprite(col, 0.8), ox, oy, s * 0.38, alpha * fl);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  glint(ctx, toP, e.r * 0.34, alpha);
}

// ---------------------------------------------------------------------- seeder
/**
 * An armoured pod carrying three passengers. The equator seam is the load-bearing
 * detail: it is bright, it breathes, and it is exactly where the thing splits —
 * so a player who has seen one die once knows what the seam is for. The brood
 * rides *inside* the shell rather than orbiting outside it, in the motes' own
 * ember colour, because a pod with its cargo visible states its death rule
 * without a word of text.
 */
function drawSeeder(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  body: string,
  toP: number,
  breathe: number,
  alpha: number,
) {
  const s = e.r * breathe;
  const rot = e.rot * 0.4;
  const swell = 0.5 + 0.5 * Math.sin(game.clock * 2.2 + e.seed);

  ctx.save();
  ctx.rotate(rot);
  rimPoly(ctx, UNIT.seeder, s, body, rgba(col, 0.45 * alpha), rgba(col, 0.95 * alpha), 2.4, toP - rot);

  // The womb: a dim glow behind a counter-rotating inner cage, so there is
  // something *in* the shell rather than an empty outline.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, glowSprite(COL.mote, 0.3 + swell * 0.18), 0, 0, s * 0.78, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.rotate(-e.rot * 2);
  unitPoly(ctx, UNIT.seeder, s * 0.5, null, rgba(col, 0.5 * alpha), 1.4);
  ctx.restore();

  // The brood, orbiting inside the cage.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const a = e.age * 2 + (i / 3) * TAU;
    drawRadial(
      ctx, flareSprite(COL.mote, 0.95),
      Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34, s * 0.2, alpha,
    );
  }
  ctx.globalCompositeOperation = 'source-over';

  // The seam, and the four clamps holding it shut.
  ctx.strokeStyle = rgba(col, (0.55 + swell * 0.4) * alpha);
  ctx.lineWidth = 1.4 + swell * 1.4;
  line(ctx, -s * 0.92, 0, s * 0.92, 0);
  ctx.strokeStyle = rgba(col, 0.34 * alpha);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      ctx.moveTo(sx * s * 0.66, sy * s * 0.18);
      ctx.lineTo(sx * s * 0.66, sy * s * 0.86);
    }
  }
  ctx.stroke();
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) bolt(ctx, sx * s * 0.66, sy * s * 0.7, s * 0.1, col, alpha);
  }
  ctx.restore();
  glint(ctx, toP, e.r * 0.42, alpha);
}

// ------------------------------------------------------------------------ ward
/**
 * A shield generator with a body attached.
 *
 * The shield is the only thing the player needs from this enemy, so it gets
 * every affordance: a field wedge you can see through, five armour plates with
 * gaps so its extent is countable rather than estimated, and two emitter pods on
 * struts at the ends. Those pods are the real upgrade — an arc that simply
 * *exists* is a UI element, and an arc with visible hardware producing it is a
 * machine you can imagine flanking.
 */
function drawWard(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  col: RGB,
  body: string,
  toP: number,
  breathe: number,
  flash: number,
  alpha: number,
) {
  const r = e.r * breathe;
  ctx.save();
  ctx.rotate(e.rot);
  rimPoly(ctx, UNIT.ward, r, body, rgba(col, 0.45 * alpha), rgba(col, 0.95 * alpha), 2.4, toP - e.rot);
  // A three-armed armature inside the shell, counter-turning. Something is
  // running in there.
  ctx.save();
  ctx.rotate(-e.rot * 2.4);
  ctx.strokeStyle = rgba(col, 0.34 * alpha);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
  }
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, flareSprite(col, 0.7), 0, 0, r * 0.5, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  const sr = r * 1.66;
  const lit = (0.5 + flash * 0.5) * alpha;
  ctx.globalCompositeOperation = 'lighter';

  // The field: everything between the hull and the plates, faintly energised.
  ctx.fillStyle = rgba(col, (0.07 + flash * 0.22) * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, sr, e.shield - WARD_ARC, e.shield + WARD_ARC);
  ctx.arc(0, 0, r * 1.05, e.shield + WARD_ARC, e.shield - WARD_ARC, true);
  ctx.closePath();
  ctx.fill();

  // Five plates with gaps between them.
  const PLATES = 5;
  const span = (WARD_ARC * 2) / PLATES;
  for (let i = 0; i < PLATES; i++) {
    const a0 = e.shield - WARD_ARC + i * span + span * 0.09;
    const a1 = a0 + span * 0.82;
    ctx.strokeStyle = rgba(col, lit);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, sr, a0, a1);
    ctx.stroke();
    ctx.strokeStyle = rgba(COL.playerCore, lit * 0.9);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, sr + 3.2, a0, a1);
    ctx.stroke();
  }

  // The emitters that make it, on struts.
  ctx.strokeStyle = rgba(col, 0.8 * alpha);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    const a = e.shield + s * WARD_ARC;
    ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
  }
  ctx.stroke();
  for (const s of [-1, 1] as const) {
    const a = e.shield + s * WARD_ARC;
    drawRadial(ctx, flareSprite(col, 0.95), Math.cos(a) * sr, Math.sin(a) * sr, 6.5, alpha);
  }
  ctx.globalCompositeOperation = 'source-over';
  glint(ctx, toP, r * 0.36, alpha);
}

// ---------------------------------------------------------------------- lancer
/**
 * The hostile answer to the player's ship, and it is meant to be read that way —
 * same interceptor language, opposite temperature. Its whole life is one
 * telegraph, so the body carries the state: the intakes glow while it hunts, the
 * hull runs hot lines while it marks, and it grows a bow shock the instant it
 * commits. You should never have to look at the floor line to know what it is
 * about to do.
 */
function drawLancer(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  toP: number,
  breathe: number,
  alpha: number,
) {
  const r = e.r * breathe;
  const charging = e.state === 2;
  const marking = e.state === 1;
  ctx.rotate(e.rot);

  if (charging) {
    // A wedge of compressed air ahead of the nose, and the shock itself.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.28 * alpha);
    ctx.beginPath();
    ctx.moveTo(-r * 5.5, 0);
    ctx.lineTo(0, -r * 0.8);
    ctx.lineTo(0, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(COL.playerCore, 0.5 * alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r * 0.7, 0, r * 1.5, -1.05, 1.05);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // While marking the whole body strobes: a weapon spinning up.
  const arm = marking ? 0.75 + 0.25 * Math.sin(game.clock * 22) : 1;
  // Its plating sits a shade above the other hulls. The deep intake notches cut
  // into this silhouette leave so little interior that at the standard hull
  // value it read as a wireframe arrow rather than as a solid — this is the one
  // body whose fill has to do work.
  rimPoly(ctx, UNIT.lancer, r, 'rgba(30,17,15,1)', rgba(col, 0.5 * arm * alpha), rgba(col, arm * alpha), 2.4, toP - e.rot);

  // A dorsal spine down the body, and the intake slots cut into the flanks.
  ctx.strokeStyle = rgba(col, 0.55 * alpha);
  ctx.lineWidth = 1.6;
  line(ctx, r * 1.2, 0, -r * 0.8, 0);
  ctx.strokeStyle = rgba(col, (charging ? 1 : 0.6) * alpha);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    ctx.moveTo(-r * 0.3, s * r * 0.26);
    ctx.lineTo(-r * 0.86, s * r * 0.16);
  }
  ctx.stroke();

  // Heat running back along the spine while it holds the mark.
  if (marking) {
    ctx.strokeStyle = rgba(COL.warn, (0.3 + 0.5 * (1 - clamp01(e.timer / LANCER_MARK))) * alpha);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const s of [-1, 1] as const) {
      ctx.moveTo(r * 0.5, s * r * 0.14);
      ctx.lineTo(-r * 0.6, s * r * 0.2);
    }
    ctx.stroke();
  }

  // Engine ember at the tail; flares hard in the charge.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, flareSprite(col, 0.8), -r * 0.95, 0,
    r * (charging ? 1.15 : 0.45 + 0.08 * Math.sin(game.clock * 9 + e.seed)), alpha,
  );
  if (charging) {
    ctx.fillStyle = rgba(COL.playerCore, 0.7 * alpha);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(-r * (1.1 + i * 0.5), 0, r * (0.1 - i * 0.02), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // The eye on the nose. A lancer looks where it will charge, which is the one
  // thing worth knowing about it.
  ctx.fillStyle = rgba(COL.playerCore, 0.95 * alpha);
  ctx.beginPath();
  ctx.arc(r * 1.2, 0, 2.4, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, flareSprite(marking ? COL.warn : col, 0.9), r * 1.2, 0, r * (marking ? 0.6 : 0.34), alpha);
  ctx.globalCompositeOperation = 'source-over';
}

// ----------------------------------------------------------------------- spine
/**
 * A gun bolted to the floor.
 *
 * Drawn in three pieces that move at three different rates, and that is the
 * whole idea: the base never turns, the housing above it idles round, and the
 * barrel tracks you. A single sprite spinning as one object reads as debris; a
 * fixed base under a turning mount reads as something installed here on purpose
 * that cannot follow you when you leave.
 */
function drawSpine(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  col: RGB,
  body: string,
  toP: number,
  breathe: number,
  alpha: number,
) {
  const r = e.r * breathe;
  const charge = 1 - clamp01(e.timer / SPINE_PERIOD);
  // Time since the last shot, so the barrel can kick and settle.
  const recoil = clamp01(1 - (SPINE_PERIOD - e.timer) / 0.24);

  // Anchor lugs, world-aligned and under everything: the feet it was bolted
  // down with. They do not turn, because it did not walk here.
  ctx.strokeStyle = rgba(col, 0.4 * alpha);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * r * 0.7, s * r * 0.7);
    ctx.lineTo(c * r * 1.3, s * r * 1.3);
  }
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    bolt(ctx, Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3, 3, col, alpha);
  }

  rimPoly(ctx, UNIT.spine, r, body, rgba(col, 0.45 * alpha), rgba(col, 0.95 * alpha), 2.4, toP);

  // The housing, idling round on top of the fixed base.
  ctx.save();
  ctx.rotate(e.rot);
  unitPoly(ctx, UNIT.spine, r * 0.6, 'rgba(9,12,19,1)', rgba(col, 0.55 * alpha), 1.6);
  ctx.restore();

  // The barrel, tracking. Two rails, a muzzle brake, and a charge that visibly
  // travels up it — so the ring below is confirmation, not the only tell.
  ctx.save();
  ctx.rotate(toP);
  ctx.translate(-recoil * r * 0.3, 0);
  ctx.strokeStyle = rgba(col, 0.9 * alpha);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    ctx.moveTo(r * 0.15, s * r * 0.14);
    ctx.lineTo(r * 1.4, s * r * 0.1);
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const d of [1.02, 1.2, 1.38] as const) {
    ctx.moveTo(r * d, -r * 0.2);
    ctx.lineTo(r * d, r * 0.2);
  }
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, flareSprite(col, 0.9), r * (0.2 + charge * 1.2), 0, r * (0.18 + charge * 0.3), alpha * (0.35 + charge * 0.65));
  if (recoil > 0.02) drawRadial(ctx, flareSprite(COL.playerCore, 1), r * 1.5, 0, r * recoil * 0.9, alpha * recoil);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // Charge ring: how close the next orb is.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(col, 0.75 * alpha);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}
