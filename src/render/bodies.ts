import { COL, PLAYER_R, rgba, type RGB } from '../config';
import { TAU, clamp01 } from '../engine/math';
import {
  SPECS,
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
 * Third version, and the first two were wrong for the same reason in two
 * different disguises. Draft one gave every species interior detail; draft two
 * fixed the aspect ratios and hung fittings off the hulls. Both times the
 * verdict was that you cannot tell what any of them is, and both times the
 * verdict was right, because both drafts drew every enemy as a **bright outline
 * around a hole**. There was no mass anywhere. A dark fill at 13% of the body
 * colour is black against a black floor, so all that ever reached the eye was a
 * tangle of glowing lines — and a tangle of glowing lines is not an object, it
 * is a doodle. Adding more lines to a doodle makes a busier doodle.
 *
 * Three rules replace all of that.
 *
 *  1. **Mass first.** Every body is filled with a *gradient across the light
 *     axis* — shadow, hull, lit — so it reads as a solid with a curved surface
 *     before a single detail is drawn. This one change does more than every
 *     panel line, bolt and seam of the previous two drafts put together.
 *  2. **Rim light, not outline.** Only the edges facing the player get the
 *     saturated stroke. The far edges get a black hairline, which is contact
 *     shadow, not drawing. An object lit from one side has a bright edge and a
 *     dark edge; a thing with a uniform bright edge all the way round is a
 *     sticker.
 *  3. **Three marks, maximum.** At forty pixels there is room for a silhouette,
 *     a light, and one piece of hardware. Everything else is noise that bloom
 *     will smear into the silhouette and destroy it.
 *
 * And above those, the reason the shapes now read at all: each one depicts
 * something a person can *name*. See the note over `silhouette()`.
 */

/** Unit-radius outlines, shared with the shatter so a death breaks the right shape. */
const UNIT: Record<EnemyKind, [number, number][]> = {
  mote: silhouette('mote', 1),
  seeder: silhouette('seeder', 1),
  ward: silhouette('ward', 1),
  lancer: silhouette('lancer', 1),
  spine: silhouette('spine', 1),
  bulwark: silhouette('bulwark', 1),
  choir: silhouette('choir', 1),
};

/**
 * Drawn size relative to the collision radius, per species.
 *
 * Every one keeps the *bulk* of the body inside `Swarm.hitR`, so the error is
 * always in the player's favour: things die slightly before the line looks like
 * it touched them, never slightly after. The mote gets the most because its
 * outline is now a ball at 0.70 with horns out to 1.0 — the ball, not the horns,
 * is what has to match the hitbox.
 */
const VIS: Record<EnemyKind, number> = {
  mote: 1.42,
  seeder: 1.24,
  ward: 1.26,
  lancer: 1.2,
  spine: 1.2,
  // The bulwark's drawn radius *is* its armour radius: the wall has to sit
  // exactly where the strike stops, or the promise visibly lies.
  bulwark: 1.28,
  choir: 1.3,
};

/**
 * How much of `VIS` the *hull* actually occupies, for the contact shadow.
 *
 * Only the ward differs, and it differs a lot: its drawn radius sizes the shield,
 * not the body, so a shadow cast at full radius put a dark octagon twice the size
 * of the ward underneath it — which read as a hood, and was most of why that
 * enemy looked like a figure in a robe rather than a machine behind a barricade.
 */
const SHADOW: Record<EnemyKind, number> = {
  mote: 1, seeder: 1, ward: 0.54, lancer: 1, spine: 1, bulwark: 1, choir: 1,
};

/**
 * The hull ramp: one species colour, three values.
 *
 * The mix fraction is low and the constant is high on purpose — that pushes a
 * saturated enemy colour toward *tinted grey metal* rather than toward coloured
 * plastic, and grey metal is what stops five different hues reading as five
 * different materials. The slight blue lift keeps the shadow end from going
 * muddy brown when the species colour is orange.
 *
 * These numbers are authored roughly **30% below** the value they should appear
 * at, because the bloom pass measurably lifts a mid-tone by about 1.45x: a hull
 * mixed to (124,72,105) samples off the finished canvas at (192,114,165). The
 * first pass at this ramp was picked by eye in isolation and every body came out
 * looking like pale plastic. Any large flat area added to this game has to be
 * authored against what the post chain will do to it, not against what it looks
 * like on its own.
 */
const hull = (c: RGB, k: number, base: number) =>
  `rgba(${(c[0] * k + base) | 0},${(c[1] * k + base * 0.96) | 0},${(c[2] * k + base * 1.22) | 0},1)`;

const hullDark = (c: RGB) => hull(c, 0.07, 7);
const hullMid = (c: RGB) => hull(c, 0.14, 14);
const hullLit = (c: RGB) => hull(c, 0.27, 28);

/** Near-black, for bezels and bores — the dark a highlight needs to be bright against. */
const VOID = 'rgba(4,5,9,1)';

function trace(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** An open arc, safe to chain: consecutive `arc` calls are joined by a straight line. */
function arcRun(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number) {
  ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
  ctx.arc(x, y, r, a0, a1);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A filled convex patch from a point list, in the caller's current space. */
function fillPoly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  trace(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * The form gradient: dark on the far side, hull through the middle, lit where
 * the player is. Built in *unit* space, so one gradient fills any polygon that
 * is about to be drawn under a `scale(r, r)`.
 *
 * A gradient object per body per frame sounds like the kind of allocation this
 * codebase avoids, and for radial falloffs it is — that is what `radialSprite`
 * exists for. Two stops of a linear ramp is a different order of cost entirely
 * (no per-pixel evaluation happens until the fill, which was happening anyway),
 * and there is no way to bake it: the light direction changes per enemy, per
 * frame, and the result has to be clipped to a shape that also changes.
 */
function form(ctx: CanvasRenderingContext2D, col: RGB, light: number) {
  const lx = Math.cos(light);
  const ly = Math.sin(light);
  const g = ctx.createLinearGradient(-lx * 1.1, -ly * 1.1, lx * 1.1, ly * 1.1);
  g.addColorStop(0, hullDark(col));
  g.addColorStop(0.52, hullMid(col));
  g.addColorStop(1, hullLit(col));
  return g;
}

/**
 * A solid, lit body: mass, then rim.
 *
 * The rim pass strokes each edge only if its outward normal points at the light,
 * which is real shading logic rather than decoration. The far edges get a black
 * hairline instead of nothing at all — on the lit floor near the player a body
 * with no dark edge starts to dissolve into the grid, and the hairline reads as
 * the shadow under a lip rather than as an outline.
 */
function body(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  s: number,
  col: RGB,
  light: number,
  alpha: number,
  rimW = 2.4,
) {
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
      // Outward normal, disambiguated against the body centre rather than
      // assuming a winding order — these outlines are authored by eye.
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      if (nx * lx + ny * ly > 0 !== (pass === 1)) continue;
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

/**
 * A lens: a near-black bezel with a hot core in it.
 *
 * Used for every eye, fuze and sensor on the field, because an additive
 * highlight is only bright relative to what surrounds it, and what surrounds it
 * here is a mid-value hull. Without the bezel these all read as pale smudges.
 */
function lens(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGB,
  alpha: number,
  heat = 1,
) {
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
function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, a: number) {
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(col, 0.6 * a);
  ctx.lineWidth = 1.1;
  ctx.stroke();
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
  trace(ctx, pts);
  ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
  ctx.fill();
  ctx.restore();
}

// --------------------------------------------------------------------- poses
/**
 * Everything a body needs to draw itself, with no `Enemy` and no `Game` in it.
 *
 * The codex portraits used to be a second, hand-tidied drawing of each species
 * living in `hud.ts`, which is precisely the wrong thing for a card whose only
 * job is to be matched against something that just killed the player. With a
 * pose struct the card and the field run the same code, so they cannot drift.
 */
export interface Pose {
  col: RGB;
  /** Drawn radius — collision radius times `VIS`. */
  r: number;
  /**
   * Where a strike stops, in the same units as `r`. Only the ward uses it, and
   * it has to be *passed in* rather than derived from `PLAYER_R`: that constant
   * is absolute, so a portrait drawn at half size would grow a shield three
   * times the body instead of two. Carrying it in the pose keeps the arena and
   * the codex card in the same proportion at any scale.
   */
  hitR: number;
  rot: number;
  /** Direction of the player, in the parent space. */
  toP: number;
  clock: number;
  seed: number;
  alpha: number;
  /** LANCER: 0 resting, 1 marking, 2 charging. */
  state: number;
  /** WARD: shield facing (parent space) and block flash. */
  shield: number;
  flash: number;
  /** SPINE: fraction charged, and the kick just after a shot. */
  charge: number;
  recoil: number;
  /** MOTE: unit drift direction for the ember trail; zero omits it. */
  driftX: number;
  driftY: number;
  age: number;
}

const DRAW: Record<EnemyKind, (ctx: CanvasRenderingContext2D, p: Pose) => void> = {
  mote: drawMote,
  seeder: drawSeeder,
  ward: drawWard,
  lancer: drawLancer,
  spine: drawSpine,
  bulwark: drawBulwark,
  choir: drawChoir,
};

export function drawEnemyBody(ctx: CanvasRenderingContext2D, e: Enemy, game: Game, alpha: number) {
  const col = ENEMY_COL[e.kind];
  const breathe = 1 + Math.sin(game.clock * 3 + e.seed) * 0.04;
  const sp = Math.hypot(e.vx, e.vy);
  const pose: Pose = {
    col,
    r: e.r * VIS[e.kind] * breathe,
    hitR: e.r + PLAYER_R * 0.72,
    rot: e.kind === 'seeder' ? e.rot * 0.4 : e.kind === 'spine' ? 0 : e.rot,
    toP: Math.atan2(game.player.y - e.y, game.player.x - e.x),
    clock: game.clock,
    seed: e.seed,
    alpha,
    state: e.state,
    shield: e.shield,
    flash: clamp01(e.flash),
    charge: 1 - clamp01(e.timer / SPINE_PERIOD),
    recoil: clamp01(1 - (SPINE_PERIOD - e.timer) / 0.24),
    driftX: sp > 12 ? e.vx / sp : 0,
    driftY: sp > 12 ? e.vy / sp : 0,
    age: e.age,
  };

  ctx.save();
  ctx.translate(e.x, e.y);
  castShadow(ctx, UNIT[e.kind], pose.r * SHADOW[e.kind], pose.rot, pose.toP, e.r, alpha);
  // A soft additive halo so the swarm reads as light sources standing in a dark
  // room. Tighter and dimmer than it used to be: with real mass under it, a wide
  // halo stopped being what makes an enemy visible and started being fog that
  // softened every silhouette it was supposed to be selling.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, haloSprite(col), 0, 0, e.r * 1.9, alpha * 0.8);
  ctx.globalCompositeOperation = 'source-over';
  DRAW[e.kind](ctx, pose);
  ctx.restore();
}

/**
 * How far to shift a portrait so its *drawn* extent is centred in the cell.
 *
 * Three species carry their identifying hardware out along +X — the ward's slab,
 * the spine's barrel, the lancer's nose — and the card lights from the right, so
 * without this the body hugs the left edge of its cell while the barrel runs
 * into the name beside it.
 */
const PORTRAIT_OFF: Record<EnemyKind, number> = {
  mote: 0, seeder: 0, ward: -0.42, lancer: -0.24, spine: -0.5, bulwark: 0, choir: 0,
};

/**
 * A posed portrait for the rule cards and the pause codex, drawn by the same
 * five functions the arena uses. Lit from the right, where the reader's eye
 * already is.
 */
export function drawEnemyPortrait(
  ctx: CanvasRenderingContext2D,
  kind: EnemyKind,
  r: number,
  clock: number,
) {
  const spin =
    kind === 'mote' ? clock * 1.2
    : kind === 'seeder' ? clock * 0.5
    : kind === 'lancer' ? Math.sin(clock * 0.8) * 0.35
    : kind === 'spine' ? 0
    : kind === 'choir' ? Math.sin(clock * 1.2) * 0.3
    : clock * 0.25;
  ctx.save();
  ctx.translate(r * PORTRAIT_OFF[kind], 0);
  DRAW[kind](ctx, {
    col: ENEMY_COL[kind],
    r: r * VIS[kind],
    // Scaled off the species' real radius, so the card reproduces the arena's
    // proportions rather than the arena's absolute distances.
    hitR: r * (1 + (PLAYER_R * 0.72) / SPECS[kind].r),
    rot: spin,
    toP: 0,
    clock,
    seed: 1.7,
    alpha: 1,
    // Lancers pose mid-mark and spines pose part-charged: a card should show the
    // state the player is being warned about, not the idle one.
    state: 1,
    shield: Math.sin(clock * 0.7) * 0.5,
    flash: 0,
    charge: 0.5 + Math.sin(clock * 1.6) * 0.4,
    recoil: 0,
    driftX: 0,
    driftY: 0,
    age: clock,
  });
  ctx.restore();
}

// ------------------------------------------------------------------------ mote
/**
 * A naval mine.
 *
 * The most valuable thing about this shape is that nobody has to be taught it.
 * A ball with blunt horns drifting toward you means *do not touch* in every
 * culture that has ever had a coastline, and "do not touch, and it comes to you"
 * is the mote's entire behaviour. The previous draft was a five-pointed star
 * with light leaking out of it, which — accurately — read as a pickup.
 *
 * Three marks: the horn caps, the fuze eye, the rim. Nothing else fits.
 */
function drawMote(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;
  const fl = 0.74 + 0.26 * Math.sin(p.clock * 5 + p.seed * 5.3);

  // Embers shed backwards along the drift. Drawn first so the body occludes the
  // freshest one, which is what puts them behind it.
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

  // Horn caps: a hard dot right at each tip. These were soft flares first, and
  // the bloom immediately joined all six into one ring of haze — which is how a
  // mine turns back into a fuzzy ball. Small and hard keeps the horns countable,
  // and it is the count that carries the read.
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

  // The fuze, unrotated so it holds still while the shell tumbles around it. It
  // is the difference between a rock and a device.
  lens(ctx, 0, 0, r * 0.24, p.col, p.alpha, 1 + fl * 0.2);
}

// ---------------------------------------------------------------------- seeder
/**
 * A brood pod with the payload visible through the hatch.
 *
 * The rule this species teaches is "kill it and three more appear", and it is
 * the only rule in the game a player can be shown *before* it costs them
 * anything: three mines, plainly loaded inside, in the motes' own colour.
 *
 * They are drawn **dark against a lit cavity**, not as glowing blobs. That is
 * the whole reason they survive to the screen: bloom eats bright detail on dark
 * — it smears the highlights together until three dots are one dot — but it
 * cannot touch a dark shape sitting on a bright field, because there is nothing
 * there to bleed. Any small mark that has to read through a bloom pass should be
 * a hole in the light rather than a piece of it.
 */
/** Strength the seeder's cavity glow is baked at; the pulse is applied on top. */
const CAVITY = 0.4;

function drawSeeder(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;
  const swell = 0.5 + 0.5 * Math.sin(p.clock * 2.2 + p.seed);

  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.seeder, r, p.col, p.toP - p.rot, p.alpha, 2.6);

  // The cavity: an opaque lit window, not a glow. An additive haze here would
  // wash back over the shell and undo the mass the body fill just built.
  ctx.save();
  ctx.scale(r * 0.64, r * 0.64);
  trace(ctx, UNIT.seeder);
  ctx.fillStyle = `rgba(${(COL.mote[0] * 0.46) | 0},${(COL.mote[1] * 0.3) | 0},${(COL.mote[2] * 0.22) | 0},1)`;
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  // The pulse rides on alpha; the sprite is baked once at its brightest.
  //
  // Passing the animated value as the sprite's own strength put a continuously
  // varying float into its cache key, so every seeder minted a fresh 128px
  // canvas on every frame and none of them were ever released. Every stop in
  // the sprite scales linearly with `inner`, so modulating the whole blit
  // instead is the same image out of one cache entry. See `radialSprite`.
  drawRadial(ctx, glowSprite(COL.mote, CAVITY), 0, 0, r * 0.72, (p.alpha * (0.24 + swell * 0.16)) / CAVITY);
  ctx.globalCompositeOperation = 'source-over';

  // The brood: three of them, in silhouette against the cavity, turning over.
  //
  // Drawn as plain rimmed discs rather than as little copies of the mote. That
  // felt like a cheat and it is the opposite — at eight pixels a six-horned
  // outline has a ragged edge and nothing else, so the "correct" shape rendered
  // as an ink splat while a circle reads as an egg. Fidelity to the real body is
  // worth exactly as much as the pixels available to show it.
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

  // The seam it will come apart along, breathing. Two lines, not one: a bright
  // core with a dark bevel under it is a *joint between two shells*, where a
  // single bright line is just a line.
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 2.8;
  line(ctx, -r * 0.52, r * 0.04, r * 0.52, r * 0.04);
  ctx.strokeStyle = rgba(p.col, (0.5 + swell * 0.4) * p.alpha);
  ctx.lineWidth = 1.2 + swell * 1.3;
  line(ctx, -r * 0.52, -r * 0.03, r * 0.52, -r * 0.03);

  // The frame it is carried in: two clamps gripping the shell at the equator and
  // reaching past its outline, so the ovoid stops being a smooth blob. Narrow,
  // and filled at hull value rather than lit — the first draft made them the
  // brightest thing on the enemy and they took the pod's job away from it.
  for (const s of [-1, 1] as const) {
    fillPoly(ctx, [
      [s * r * 0.6, -r * 0.72], [s * r * 0.94, -r * 0.5], [s * r * 0.98, 0],
      [s * r * 0.94, r * 0.5], [s * r * 0.6, r * 0.72], [s * r * 0.66, r * 0.34],
      [s * r * 0.7, 0], [s * r * 0.66, -r * 0.34],
    ], hullMid(p.col));
    ctx.strokeStyle = rgba(p.col, 0.6 * p.alpha);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // Clear of the equator: a bolt at each clamp's waist lined up with the seam
    // and turned the pod into a barbell with a bar straight through it.
    bolt(ctx, s * r * 0.8, -r * 0.36, r * 0.09, p.col, p.alpha);
    bolt(ctx, s * r * 0.8, r * 0.36, r * 0.09, p.col, p.alpha);
  }
  ctx.restore();
}

// ------------------------------------------------------------------------ ward
/**
 * One eye behind a wall it is holding up.
 *
 * The previous draft failed in a very specific and instructive way: the shield
 * arc touched the body, an additive field filled the space between them, and the
 * two struts landed where shoulders go — so the whole thing read as a hooded
 * figure in a dress, and "go around the skirt" is not an instinct anyone has.
 * What fixes it is **daylight**. A clear dark gap between a small body and a
 * separate slab is the entire read, and it does more than any amount of plating.
 *
 * The slab's outer face is pinned to `Swarm.hitR`, because that is exactly where
 * a blocked strike stops. A plate drawn further out gets visibly speared by the
 * beam it just stopped; drawn nearer, the beam dies in mid-air short of it.
 */
function drawWard(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;
  // Outer face a hair inside where the strike stops, so a blocked beam dies
  // against the plate rather than a pixel past it.
  const thick = r * 0.28;
  const sr = p.hitR * 0.96 - thick * 0.5;
  const lit = (0.6 + p.flash * 0.4) * p.alpha;

  // Struts first and dark, so they carry the slab without competing with it.
  ctx.strokeStyle = hullDark(p.col);
  ctx.lineWidth = r * 0.16;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    const a = p.shield + s * WARD_ARC * 0.86;
    ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
    ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
  }
  ctx.stroke();

  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.ward, r * 0.54, p.col, p.toP - p.rot, p.alpha, 2.4);
  ctx.restore();
  // The eye. Big — nearly half the body — because one large lens is a face and
  // three small ones are speckle.
  lens(ctx, 0, 0, r * 0.25, p.col, p.alpha, 1.15);

  // The slab, in three countable plates. Filled quads, not stroked arcs: an arc
  // is a gauge, a quad with a lit outer face and a black inner face is armour.
  const PLATES = 3;
  const span = (WARD_ARC * 2) / PLATES;
  for (let i = 0; i < PLATES; i++) {
    const a0 = p.shield - WARD_ARC + i * span + span * 0.06;
    const a1 = a0 + span * 0.88;
    const am = (a0 + a1) * 0.5;
    const ri = sr - thick * 0.5;
    const ro = sr + thick * 0.5;
    // Bowed slightly at the middle so a flat plate still follows the arc.
    const pts: [number, number][] = [
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
    // The outer face: the side a strike arrives at, and the only hot edge here.
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

  // Emitter pods capping the slab, so it ends in hardware rather than trailing
  // off — and so the two angles that stop being blocked are marked.
  for (const s of [-1, 1] as const) {
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

// ---------------------------------------------------------------------- lancer
/**
 * A missile with an engine and a seeker head.
 *
 * The hostile answer to the player's ship, and meant to be read that way: same
 * language, opposite temperature. Its whole life is one telegraph, so the body
 * carries the state — the seeker goes hot while it marks, and it grows a bow
 * shock the instant it commits. You should never need the floor line to know
 * what it is about to do.
 */
function drawLancer(ctx: CanvasRenderingContext2D, p: Pose) {
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

  // While marking the whole airframe strobes: a weapon spinning up.
  ctx.save();
  ctx.globalAlpha = marking ? 0.72 + 0.28 * Math.sin(p.clock * 22) : 1;
  body(ctx, UNIT.lancer, r, p.col, p.toP - p.rot, p.alpha, 2.4);
  ctx.restore();

  // Two dark wing roots. Dark marks on a lit hull are the only interior detail
  // that survives here, and two of them are enough to separate wing from body.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  for (const s of [-1, 1] as const) {
    ctx.moveTo(r * 0.02, s * r * 0.3);
    ctx.lineTo(-r * 0.62, s * r * 0.3);
  }
  ctx.stroke();

  // Nozzle, then the flame out of it: an engine needs a hole to come out of.
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

  // The seeker head. A lancer looks where it is going to go.
  lens(ctx, r * 1.12, 0, r * 0.19, marking ? COL.warn : p.col, p.alpha, marking ? 1.7 : 1);
  ctx.restore();
}

// ----------------------------------------------------------------------- spine
/**
 * A gun bolted to the floor.
 *
 * Four pieces at four rates, and that is the whole idea: the flange never moves,
 * the drum never turns, the housing idles round, and the barrel tracks you. One
 * sprite spinning as a unit reads as debris; a fixed base under a turning mount
 * reads as something *installed here on purpose* that cannot follow you when you
 * leave.
 *
 * The previous draft put it on four splayed legs, which at 45° drew a large
 * bright X across the body — by far the loudest mark on the enemy, and it meant
 * nothing. A base flange with anchor bolts says "bolted down" without adding a
 * single line that crosses the silhouette.
 */
function drawSpine(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;

  // Four mounting pads poking out from under the drum, world-aligned. The first
  // attempt at "bolted down" was a full flange ring, which stacked with the drum
  // and the housing into three concentric octagons — three rings of the same
  // shape is mush, and the eye reads mush as one soft blob. Discrete pads at the
  // cardinals give the base a *direction* and leave the outline legible.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const i0 = r * 0.86;
    const o0 = r * 1.22;
    const w = r * 0.34;
    ctx.save();
    ctx.rotate(a);
    ctx.scale(1, 0.84);
    fillPoly(ctx, [[i0, -w], [o0, -w * 0.72], [o0, w * 0.72], [i0, w]], hullDark(p.col));
    ctx.strokeStyle = rgba(p.col, 0.34 * p.alpha);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
    bolt(ctx, c * r * 1.08, s * r * 1.08 * 0.84, r * 0.085, p.col, p.alpha);
  }

  body(ctx, UNIT.spine, r, p.col, p.toP, p.alpha, 2.6);

  // The turret ring: one dark circle the mount turns on. A circle, not another
  // octagon — a third copy of the drum's outline just made a set of concentric
  // rings, and the eye reads concentric rings as one soft blob rather than as
  // three parts. Different primitive, different part.
  ctx.fillStyle = hullDark(p.col);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(p.col, 0.4 * p.alpha);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Index marks on the ring, turning at their own rate: the only part that says
  // this thing is *live* while it waits for you.
  ctx.strokeStyle = rgba(p.col, 0.55 * p.alpha);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = p.rot + (i / 6) * TAU;
    ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
    ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
  }
  ctx.stroke();

  // The barrel, tracking. Long, narrow and filled, with a breech block at the
  // root and a flared muzzle at the end. Three drafts got this wrong in three
  // ways: two thin rails with cross-bars read as a ladder, a short fat tube read
  // as a mallet, and a wide breech read as a wrench. A gun is *length* — it has
  // to reach well past the body it sits on before the eye stops arguing.
  ctx.save();
  ctx.rotate(p.toP);
  ctx.translate(-p.recoil * r * 0.26, 0);

  // Breech and barrel are kept within about 1.5x of each other in width. A wide
  // block on a thin shaft is a *hammer*, whatever else is drawn on it, and that
  // silhouette beat two earlier attempts at making this look like a gun.
  fillPoly(ctx, [
    [-r * 0.32, -r * 0.21], [r * 0.42, -r * 0.18], [r * 0.42, r * 0.18], [-r * 0.32, r * 0.21],
  ], hullLit(p.col));
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  fillPoly(ctx, [
    [r * 0.34, -r * 0.155], [r * 1.94, -r * 0.115], [r * 1.94, r * 0.115], [r * 0.34, r * 0.155],
  ], hullMid(p.col));
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // A hot rail down one side of the barrel: one line, and it is what makes the
  // tube read as a tube rather than as a plank.
  ctx.strokeStyle = rgba(p.col, 0.75 * p.alpha);
  ctx.lineWidth = 1.5;
  line(ctx, r * 0.44, -r * 0.09, r * 1.9, -r * 0.06);

  fillPoly(ctx, [
    [r * 1.86, -r * 0.2], [r * 2.16, -r * 0.18], [r * 2.16, r * 0.18], [r * 1.86, r * 0.2],
  ], hullLit(p.col));
  ctx.strokeStyle = rgba(p.col, 0.85 * p.alpha);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The bore. Black, and the charge climbs into it — so the tell is *where the
  // light has got to*, which is a countdown you can read in one glance, instead
  // of a ring that has to be measured against itself.
  fillPoly(ctx, [
    [r * 1.96, -r * 0.085], [r * 2.18, -r * 0.075], [r * 2.18, r * 0.075], [r * 1.96, r * 0.085],
  ], VOID);

  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, flareSprite(p.col, 0.9), r * (0.3 + p.charge * 1.78), 0,
    r * (0.12 + p.charge * 0.16), p.alpha * (0.3 + p.charge * 0.7),
  );
  if (p.recoil > 0.02) {
    drawRadial(ctx, flareSprite(COL.playerCore, 1), r * 2.28, 0, r * p.recoil * 0.9, p.alpha * p.recoil);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// --------------------------------------------------------------------- bulwark
/**
 * A turning wall with a lamp inside it.
 *
 * The gap is the entire read, so everything here is built to make the gap loud:
 * the armour is the darkest hull in the game, the two cut faces where it ends
 * are the brightest edges, and the core shines *through* the opening as a beam.
 * A player who has never seen one knows where the door is before they know what
 * the thing is called — and knowing where the door is IS knowing what it is.
 *
 * `p.shield` is the gap's centre; the armour is drawn in that frame rather than
 * in `p.rot`'s, because the behaviour sets them equal and the promise lives in
 * `Swarm.blocks`, which reads `shield`. One source of truth, drawn.
 */
function drawBulwark(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;
  const gap = 0.62; // BULWARK_GAP — the solver's number, restated for the eye
  const inner = r * 0.6;

  ctx.save();
  ctx.rotate(p.shield);

  // The armour band: an annular sector from one gap edge round to the other.
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.04, gap, TAU - gap);
  ctx.arc(0, 0, inner, TAU - gap, gap, true);
  ctx.closePath();
  const lx = Math.cos(p.toP - p.shield);
  const ly = Math.sin(p.toP - p.shield);
  const g = ctx.createLinearGradient(-lx * r, -ly * r, lx * r, ly * r);
  g.addColorStop(0, hullDark(p.col));
  g.addColorStop(0.55, hullMid(p.col));
  g.addColorStop(1, hullLit(p.col));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Plate seams across the band, so it reads as segments of wall rather than
  // as one moulded ring — and, quietly, as the warden's lesson in advance.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    const a = gap + (i / 6) * (TAU - gap * 2);
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 1.04, Math.sin(a) * r * 1.04);
  }
  ctx.stroke();

  // The cut faces at the gap: the brightest thing on the body. These are the
  // door frame.
  ctx.strokeStyle = rgba(p.col, 0.95 * p.alpha);
  ctx.lineWidth = 2.2;
  for (const s of [1, -1] as const) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(gap * s) * inner, Math.sin(gap * s) * inner);
    ctx.lineTo(Math.cos(gap * s) * r * 1.04, Math.sin(gap * s) * r * 1.04);
    ctx.stroke();
  }

  // The core, and its light escaping through the opening.
  lens(ctx, 0, 0, r * 0.26, p.col, p.alpha, 1.15);
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, r * 1.55, -gap * 0.82, gap * 0.82);
  ctx.closePath();
  ctx.fillStyle = rgba(p.col, 0.12 * p.alpha);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

// ----------------------------------------------------------------------- choir
/**
 * One singer of a trio.
 *
 * Individually the simplest body in the game, deliberately: three of anything
 * detailed is visual noise at this size, and the species' identity lives in the
 * *formation*, not the body. What each one gets is a bell shape, a bright
 * throat, and a soft voice-glow that swells in phase with its orbit — so the
 * trio visibly sings in rounds, which is the only decoration the mechanic
 * needs.
 */
function drawChoir(ctx: CanvasRenderingContext2D, p: Pose) {
  const r = p.r;
  ctx.save();
  ctx.rotate(p.rot);
  body(ctx, UNIT.choir, r, p.col, p.toP - p.rot, p.alpha, 2);
  ctx.restore();

  // The throat: the mouth of the bell, facing its travel.
  lens(ctx, 0, 0, r * 0.3, p.col, p.alpha, 1);

  // The voice. Phase-locked to the orbit (`age` drives both), so the three
  // swell one after another — a round, sung in light.
  ctx.globalCompositeOperation = 'lighter';
  const sing = 0.5 + 0.5 * Math.sin(p.age * 4.35 + p.state * 2.09);
  drawRadial(ctx, glowSprite(p.col, 0.5), 0, 0, r * (1.6 + sing * 1.1), p.alpha * (0.25 + sing * 0.45));
  ctx.globalCompositeOperation = 'source-over';
}
