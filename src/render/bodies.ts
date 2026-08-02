import { COL, rgba, type RGB } from '../config';
import { TAU, clamp01 } from '../engine/math';
import {
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
 * The first pass at this gave every species interior detail and left them all
 * the same size and the same rough shape, and the verdict was fair: they read as
 * five small objects, not as five things. Detail inside an outline is invisible
 * at nine pixels of radius. What is *not* invisible is the outline itself and
 * anything sticking out of it.
 *
 * So three rules govern everything below.
 *
 *  1. **Draw bigger.** The strike tests against `e.r + PLAYER_R * 0.72`, which is
 *     a third to three quarters larger than the body was being drawn. That slack
 *     was pure waste: `VIS` spends most of it, and the aim bracket still sits
 *     outside every body, so nothing about what a player can hit has changed.
 *  2. **Hang fittings off the hull.** Clamp arms, holder struts, splayed legs, a
 *     gun barrel. A convex lump is a lump; a lump with an arm is a machine. These
 *     live here rather than in `silhouette()` because a death should shatter the
 *     *body* and leave the fittings out of it.
 *  3. **Two values inside the body, never one.** A dark fill with a lit rim is a
 *     glowing wireframe. A dark fill plus a lighter inner deck plate is a solid
 *     with a top surface, and that single extra fill does more for "this is an
 *     object" than any number of panel lines.
 */

/** Unit-radius outlines, shared with the shatter so a death breaks the right shape. */
const UNIT: Record<EnemyKind, [number, number][]> = {
  mote: silhouette('mote', 1),
  seeder: silhouette('seeder', 1),
  ward: silhouette('ward', 1),
  lancer: silhouette('lancer', 1),
  spine: silhouette('spine', 1),
};

/**
 * Drawn size relative to the collision radius, per species.
 *
 * Every one of these keeps the *bulk* of the body inside `Swarm.hitR`, so the
 * error is always in the player's favour: things die slightly before the line
 * looks like it touched them, never slightly after. The lancer gets the least
 * because its needle nose already reaches past the hitbox, and a spike reads as
 * a spike — nobody expects to kill a wasp by clipping its sting.
 */
const VIS: Record<EnemyKind, number> = {
  mote: 1.3,
  seeder: 1.24,
  ward: 1.26,
  lancer: 1.2,
  spine: 1.24,
};

/** A body's own colour pulled down to hull-plate dark. */
const darkBody = (col: RGB) =>
  `rgba(${(col[0] * 0.13 + 9) | 0},${(col[1] * 0.13 + 9) | 0},${(col[2] * 0.13 + 12) | 0},1)`;

/** The same colour at deck-plate value: lighter than the hull, still not bright. */
const plateBody = (col: RGB) =>
  `rgba(${(col[0] * 0.27 + 18) | 0},${(col[1] * 0.27 + 18) | 0},${(col[2] * 0.27 + 24) | 0},1)`;

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** An open arc, safe to chain — see the note in `glow`-adjacent code about paths. */
function arcRun(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a0: number,
  a1: number,
) {
  ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  ctx.arc(x, y, r, a0, a1);
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
    ctx.lineWidth = (pass === 1 ? lw * 1.4 : lw * 0.7) / s;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Hull, deck plate, rim — the standard three-layer body.
 *
 * The deck plate is offset *toward* the player rather than centred, so the lit
 * rim and the top surface agree about where the light is coming from. Getting
 * that wrong is the difference between a solid and a sticker.
 */
function shell(
  ctx: CanvasRenderingContext2D,
  kind: EnemyKind,
  s: number,
  col: RGB,
  lightLocal: number,
  alpha: number,
  deck = 0.6,
) {
  rimPoly(
    ctx, UNIT[kind], s, darkBody(col),
    rgba(col, 0.4 * alpha), rgba(col, 0.98 * alpha), 2.6, lightLocal,
  );
  if (deck <= 0) return;
  ctx.save();
  ctx.translate(Math.cos(lightLocal) * s * 0.1, Math.sin(lightLocal) * s * 0.1);
  unitPoly(ctx, UNIT[kind], s * deck, plateBody(col), rgba(col, 0.34 * alpha), 1.2);
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
  ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
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
  ctx.strokeStyle = rgba(col, 0.75 * a);
  ctx.lineWidth = 1.1;
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
  const r = e.r * VIS[e.kind] * breathe;

  ctx.save();
  ctx.translate(e.x, e.y);

  // Lifted off the floor before anything else touches it.
  castShadow(
    ctx, UNIT[e.kind], r,
    e.kind === 'seeder' ? e.rot * 0.4 : e.kind === 'spine' ? 0 : e.rot,
    toP, e.r, alpha,
  );

  // Every enemy gets a soft additive halo so the swarm reads as light sources in
  // a dark room rather than as decals lying on the floor.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, haloSprite(col), 0, 0, e.r * 2.5, alpha);
  ctx.globalCompositeOperation = 'source-over';

  switch (e.kind) {
    case 'mote': drawMote(ctx, e, game, col, toP, r, alpha); break;
    case 'seeder': drawSeeder(ctx, e, game, col, toP, r, alpha); break;
    case 'ward': drawWard(ctx, e, col, toP, r, flash, alpha); break;
    case 'lancer': drawLancer(ctx, e, game, col, toP, r, alpha); break;
    case 'spine': drawSpine(ctx, e, col, toP, r, alpha); break;
  }

  ctx.restore();
}

// ------------------------------------------------------------------------ mote
/**
 * Shrapnel that is still burning.
 *
 * The five uneven spikes do all the identification work — it is the only concave
 * outline on the field — and the light comes from *inside* the shell, through
 * cracks that run from an off-centre fracture point out to the spike tips. The
 * embers it sheds along its drift are the only thing here not on the body, and
 * they are what turn a drifting rock into something being consumed.
 */
function drawMote(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  toP: number,
  r: number,
  alpha: number,
) {
  const fl = 0.72 + 0.28 * Math.sin(game.clock * 11 + e.seed * 5.3);

  // Embers, shed backwards along the drift. Drawn before the body so the body
  // occludes the freshest one, which is what puts them *behind* it.
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > 12) {
    const bx = -e.vx / sp;
    const by = -e.vy / sp;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= 3; i++) {
      const d = r * (0.8 + i * 0.62);
      const wob = Math.sin(game.clock * 7 + e.seed + i * 2.1) * r * 0.22;
      drawRadial(
        ctx, flareSprite(col, 0.8), bx * d - by * wob, by * d + bx * wob,
        r * (0.3 - i * 0.06), alpha * fl * (0.48 - i * 0.11),
      );
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.rotate(e.rot);
  // No deck plate: a spiked star has no flat top, and an inset copy of a star is
  // a smaller star, which reads as a second object rather than as a surface.
  shell(ctx, 'mote', r, col, toP - e.rot, alpha, 0);

  // The cracks, additive and heavy — they have to survive being sat on by the
  // core glow, and a hairline at this size is simply not there. They radiate
  // from one off-centre point, because a fracture starts where the thing was hit.
  const ox = r * 0.08;
  const oy = -r * 0.1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(col, alpha * fl);
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const i of [0, 2, 4, 6, 8] as const) {
    const v = UNIT.mote[i];
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + (v[0] * r - ox) * 0.82, oy + (v[1] * r - oy) * 0.82);
  }
  ctx.stroke();

  // Smaller than the body on purpose: a core wide enough to reach the rim erases
  // everything between, and what is between is the cracks.
  drawRadial(ctx, flareSprite(col, 0.85), ox, oy, r * 0.36, alpha * fl);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  glint(ctx, toP, r * 0.3, alpha);
}

// ---------------------------------------------------------------------- seeder
/**
 * An egg in a cradle.
 *
 * Two heavy clamp arms hold the pod from either side and reach well past its
 * hull — they are the whole silhouette tell, and they turn a smooth ovoid into a
 * thing that is being *carried* somewhere. The equator seam between them is
 * bright and breathing, and it is exactly where the pod splits; a player who has
 * watched one die once knows what the seam is for. The brood rides inside, in
 * the motes' own ember colour, so the body states its death rule without text.
 */
function drawSeeder(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  toP: number,
  r: number,
  alpha: number,
) {
  const rot = e.rot * 0.4;
  const swell = 0.5 + 0.5 * Math.sin(game.clock * 2.2 + e.seed);

  ctx.save();
  ctx.rotate(rot);
  shell(ctx, 'seeder', r, col, toP - rot, alpha, 0.66);

  // The womb, behind a counter-rotating cage.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, glowSprite(COL.mote, 0.3 + swell * 0.2), 0, 0, r * 0.8, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.rotate(-e.rot * 2);
  unitPoly(ctx, UNIT.seeder, r * 0.44, null, rgba(col, 0.5 * alpha), 1.4);
  ctx.restore();

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const a = e.age * 2 + (i / 3) * TAU;
    drawRadial(
      ctx, flareSprite(COL.mote, 0.95),
      Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, r * 0.19, alpha,
    );
  }
  ctx.globalCompositeOperation = 'source-over';

  // The seam it will come apart along, and the bolts holding it shut.
  ctx.strokeStyle = rgba(col, (0.5 + swell * 0.45) * alpha);
  ctx.lineWidth = 1.4 + swell * 1.8;
  line(ctx, -r * 0.7, 0, r * 0.7, 0);
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) bolt(ctx, sx * r * 0.4, sy * r * 0.58, r * 0.1, col, alpha);
  }

  // The cradle. Two thick C-arms gripping the pod, with fingers at each end that
  // fold over the shell — drawn last so they sit on top of it.
  ctx.strokeStyle = rgba(col, 0.85 * alpha);
  ctx.lineWidth = r * 0.17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  arcRun(ctx, 0, 0, r * 1.16, -1.02, 1.02);
  arcRun(ctx, 0, 0, r * 1.16, Math.PI - 1.02, Math.PI + 1.02);
  ctx.stroke();
  ctx.strokeStyle = rgba(col, 0.95 * alpha);
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    for (const a of [-1.02, 1.02] as const) {
      const c = Math.cos(a) * s;
      const sn = Math.sin(a);
      ctx.moveTo(c * r * 1.16, sn * r * 1.16);
      ctx.lineTo(c * r * 0.82, sn * r * 1.02);
    }
  }
  ctx.stroke();
  ctx.restore();
  glint(ctx, toP, r * 0.36, alpha);
}

// ------------------------------------------------------------------------ ward
/**
 * A small thing hiding behind a very large wall.
 *
 * Everything about this one is proportion. The body is the most compact
 * silhouette on the field and the shield is nearly twice its radius, thick, and
 * plated — so the shape a player sees is a *slab with something behind it*, and
 * the correct instinct (go around) is the one the picture suggests. Two struts
 * carry the slab and two emitter pods sit at its ends, because an arc that just
 * exists is a UI element and an arc with visible hardware making it is a machine.
 */
function drawWard(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  col: RGB,
  toP: number,
  r: number,
  flash: number,
  alpha: number,
) {
  ctx.save();
  ctx.rotate(e.rot);
  shell(ctx, 'ward', r * 0.8, col, toP - e.rot, alpha, 0.58);
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, flareSprite(col, 0.7), 0, 0, r * 0.36, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // The slab sits where the strike will actually stop. `Swarm.hitR` is
  // `e.r + PLAYER_R * 0.72`, and a shield drawn further out than that gets
  // *visibly penetrated* by the beam it just blocked — the one thing this enemy
  // must never appear to do. The body shrinks instead, which keeps the
  // shield-to-body ratio near 1.8 and the read intact.
  const sr = r * 1.46;
  const lit = (0.55 + flash * 0.45) * alpha;
  ctx.globalCompositeOperation = 'lighter';

  // The field between hull and slab, faintly energised.
  ctx.fillStyle = rgba(col, (0.06 + flash * 0.22) * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, sr, e.shield - WARD_ARC, e.shield + WARD_ARC);
  ctx.arc(0, 0, r * 0.86, e.shield + WARD_ARC, e.shield - WARD_ARC, true);
  ctx.closePath();
  ctx.fill();

  // Two struts carrying it, and the slab itself in five countable plates.
  ctx.strokeStyle = rgba(col, 0.85 * alpha);
  ctx.lineWidth = r * 0.13;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    const a = e.shield + s * WARD_ARC * 0.82;
    ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
    ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
  }
  ctx.stroke();

  const PLATES = 5;
  const span = (WARD_ARC * 2) / PLATES;
  for (let i = 0; i < PLATES; i++) {
    const a0 = e.shield - WARD_ARC + i * span + span * 0.08;
    const a1 = a0 + span * 0.84;
    ctx.strokeStyle = rgba(col, lit);
    ctx.lineWidth = r * 0.34;
    ctx.beginPath();
    arcRun(ctx, 0, 0, sr, a0, a1);
    ctx.stroke();
    // A hot leading edge on the outside face — the side a strike arrives at.
    ctx.strokeStyle = rgba(COL.playerCore, lit * 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    arcRun(ctx, 0, 0, sr + r * 0.19, a0, a1);
    ctx.stroke();
  }

  for (const s of [-1, 1] as const) {
    const a = e.shield + s * WARD_ARC;
    drawRadial(ctx, flareSprite(col, 0.95), Math.cos(a) * sr, Math.sin(a) * sr, r * 0.34, alpha);
  }
  ctx.globalCompositeOperation = 'source-over';
  glint(ctx, toP, r * 0.3, alpha);
}

// ---------------------------------------------------------------------- lancer
/**
 * The hostile answer to the player's ship, and meant to be read that way — same
 * interceptor language, opposite temperature, three times as long as it is wide.
 * Its whole life is one telegraph, so the body carries the state: intakes glow
 * while it hunts, the hull runs hot while it marks, and it grows a bow shock the
 * instant it commits. You should never need the floor line to know what it is
 * about to do.
 */
function drawLancer(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  game: Game,
  col: RGB,
  toP: number,
  r: number,
  alpha: number,
) {
  const charging = e.state === 2;
  const marking = e.state === 1;
  ctx.rotate(e.rot);

  if (charging) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.26 * alpha);
    ctx.beginPath();
    ctx.moveTo(-r * 5.5, 0);
    ctx.lineTo(0, -r * 0.7);
    ctx.lineTo(0, r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(COL.playerCore, 0.5 * alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    arcRun(ctx, r * 0.95, 0, r * 1.5, -1.05, 1.05);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // While marking the whole body strobes: a weapon spinning up.
  const arm = marking ? 0.75 + 0.25 * Math.sin(game.clock * 22) : 1;
  ctx.save();
  ctx.globalAlpha = arm;
  // A generous deck: this body is long and narrow, so an inset copy at the usual
  // fraction comes out as a sliver and the whole thing reads as a dark scribble.
  shell(ctx, 'lancer', r, col, toP - e.rot, alpha, 0.62);
  ctx.restore();

  // Intake slots, out on the flanks and clear of the deck plate's edge.
  ctx.strokeStyle = rgba(col, (charging ? 1 : 0.62) * alpha);
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    ctx.moveTo(-r * 0.44, s * r * 0.3);
    ctx.lineTo(-r * 0.76, s * r * 0.25);
  }
  ctx.stroke();
  // The hot spine only appears while it is marking. Drawn all the time it just
  // crossed the deck plate and added a line nobody could read.
  if (marking) {
    ctx.strokeStyle = rgba(COL.warn, 0.9 * alpha);
    ctx.lineWidth = 1.8;
    line(ctx, r * 1.4, 0, -r * 0.9, 0);
  }

  // Engine ember at the tail; flares hard in the charge.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, flareSprite(col, 0.8), -r * 1.16, 0,
    r * (charging ? 1 : 0.4 + 0.07 * Math.sin(game.clock * 9 + e.seed)), alpha,
  );
  if (charging) {
    ctx.fillStyle = rgba(COL.playerCore, 0.7 * alpha);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(-r * (1.3 + i * 0.5), 0, r * (0.09 - i * 0.018), 0, TAU);
      ctx.fill();
    }
  }
  // The eye on the nose. A lancer looks where it will charge.
  drawRadial(ctx, flareSprite(marking ? COL.warn : col, 0.9), r * 1.5, 0, r * (marking ? 0.5 : 0.3), alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = rgba(COL.playerCore, 0.95 * alpha);
  ctx.beginPath();
  ctx.arc(r * 1.5, 0, 2.4, 0, TAU);
  ctx.fill();
}

// ----------------------------------------------------------------------- spine
/**
 * A gun bolted to the floor.
 *
 * Drawn in four pieces that move at four different rates, and that is the whole
 * idea: the legs never move, the drum never turns, the housing idles round, and
 * the barrel tracks you. One sprite spinning as a unit reads as debris; splayed
 * legs under a fixed drum under a turning mount reads as something *installed
 * here on purpose* that cannot follow you when you leave. The barrel is long and
 * has a muzzle brake because at this size "gun" has to be legible from the
 * silhouette alone.
 */
function drawSpine(
  ctx: CanvasRenderingContext2D,
  e: Enemy,
  col: RGB,
  toP: number,
  r: number,
  alpha: number,
) {
  const charge = 1 - clamp01(e.timer / SPINE_PERIOD);
  // Time since the last shot, so the barrel can kick and settle.
  const recoil = clamp01(1 - (SPINE_PERIOD - e.timer) / 0.24);

  // Legs. World-aligned, under everything, and reaching well outside the drum —
  // they do not turn, because it did not walk here.
  ctx.strokeStyle = rgba(col, 0.5 * alpha);
  ctx.lineWidth = r * 0.13;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * r * 0.5, s * r * 0.5);
    ctx.lineTo(c * r * 1.26, s * r * 1.26);
  }
  ctx.stroke();
  // Feet: a short cross bar at the end of each leg, so they terminate in
  // something planted rather than trailing off to a point.
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * r * 1.26 - s * r * 0.18, s * r * 1.26 + c * r * 0.18);
    ctx.lineTo(c * r * 1.26 + s * r * 0.18, s * r * 1.26 - c * r * 0.18);
  }
  ctx.stroke();

  shell(ctx, 'spine', r, col, toP, alpha, 0.62);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i / 4) * TAU;
    bolt(ctx, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.1, col, alpha);
  }

  // Charge, as a status band inlaid in the drum's deck rather than a ring
  // hovering outside it. Floating rings were stacking with the legs and the
  // halo into three concentric circles that said nothing; a band *on* the
  // machine reads as a gauge the machine has.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(col, 0.22 * alpha);
  ctx.lineWidth = r * 0.13;
  ctx.beginPath();
  arcRun(ctx, 0, 0, r * 0.82, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(col, 0.95 * alpha);
  ctx.beginPath();
  arcRun(ctx, 0, 0, r * 0.82, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // The housing, idling round on top of the fixed drum. Filled at deck value,
  // not black: a near-black cap on a dark drum is a hole, and a turret with a
  // hole in the middle of it is not a turret.
  ctx.save();
  ctx.rotate(e.rot);
  unitPoly(ctx, UNIT.spine, r * 0.52, plateBody(col), rgba(col, 0.7 * alpha), 1.8);
  ctx.restore();

  // The barrel, tracking. Two rails, a muzzle brake, and a charge that visibly
  // travels up it — so the ring below is confirmation, not the only tell.
  ctx.save();
  ctx.rotate(toP);
  ctx.translate(-recoil * r * 0.3, 0);
  // A breech block at the root, then the rails. The block is what makes the
  // barrel look bolted to something rather than balanced on it.
  ctx.fillStyle = plateBody(col);
  ctx.strokeStyle = rgba(col, 0.85 * alpha);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(r * 0.1, -r * 0.34, r * 0.55, r * 0.68);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = rgba(col, 0.95 * alpha);
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    ctx.moveTo(r * 0.2, s * r * 0.17);
    ctx.lineTo(r * 1.95, s * r * 0.11);
  }
  ctx.stroke();
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  for (const d of [1.42, 1.64, 1.86] as const) {
    ctx.moveTo(r * d, -r * 0.22);
    ctx.lineTo(r * d, r * 0.22);
  }
  ctx.stroke();

  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, flareSprite(col, 0.9), r * (0.25 + charge * 1.7), 0,
    r * (0.16 + charge * 0.28), alpha * (0.35 + charge * 0.65),
  );
  if (recoil > 0.02) drawRadial(ctx, flareSprite(COL.playerCore, 1), r * 2.05, 0, r * recoil * 0.9, alpha * recoil);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}
