import { COL, PLAYER_R, rgba } from '../config';
import { TAU, clamp01 } from '../engine/math';
import type { Game } from '../game/game';
import { drawRadial, flareSprite, glowSprite } from './glow';

/**
 * The player's ship.
 *
 * The old one was a single six-point chevron: one path, one fill, one stroke.
 * It was legible and it was nothing — a cursor with a nose on it. What follows
 * is a real airframe, and the thing that makes it read as one is not the vertex
 * count but that it is built from *separate parts that overlap*: wings behind,
 * nacelles behind those, fuselage on top, canopy on top of that. Four silhouettes
 * stacked at four brightnesses is what an eye reads as thickness, and no amount
 * of detail drawn inside one flat outline achieves the same thing.
 *
 * The lighting rule from the rest of the game still holds — the player is the
 * only cold light in a warm room — but it applies *outward*: the hull is dark
 * cold steel, and the light in the room comes from this ship's own canopy,
 * leading edges and engines. It is the lamp, not the thing being lit.
 *
 * Everything below is authored in units of `PLAYER_R` with the nose at +X, and
 * the context is scaled once, so the numbers stay readable as proportions.
 */

/** The centreline of each engine nacelle, in hull units. */
const NAC_Y = 0.58;
/** Drawn size relative to the collision radius. See `drawPlayer`. */
const VIS = 1.16;

/**
 * Proportions are set by the smallest thing that has to survive, and that is
 * brutal here: at the scale a laptop renders this arena, one hull unit is about
 * six screen pixels. The first draft of this ship was a needle — a fuselage four
 * pixels across — and every piece of interior detail, the canopy included,
 * landed inside the same four pixels the two hot leading edges were already
 * lighting up. It rendered as a white spike with a smudge in it.
 *
 * So the airframe below is deliberately *broad*: a stubby wide-body interceptor
 * rather than a dart. Every dimension is chosen so that the part inside it is
 * still several pixels wide after the bloom has had its say.
 */

/**
 * Swept delta with raked tips. Drawn first and darkest: wings are the part of an
 * aircraft that is *below* everything else, and the eye will accept that reading
 * for free if the value is right.
 */
const WING: [number, number][] = [
  [0.5, 0], [0.2, -0.42], [-0.34, -1.42], [-0.78, -1.48],
  [-0.94, -1.14], [-0.46, -0.44], [-0.46, 0.44], [-0.94, 1.14],
  [-0.78, 1.48], [-0.34, 1.42], [0.2, 0.42],
];

/** One engine pod, drawn twice about ±NAC_Y. Tapers toward the intake. */
const NACELLE: [number, number][] = [
  [0.16, -0.24], [-0.5, -0.3], [-1.14, -0.26],
  [-1.18, 0.2], [-0.5, 0.26], [0.12, 0.22],
];

/** The spine of the thing: a broad tapered body with a chisel for a nose. */
const FUSE: [number, number][] = [
  [1.55, 0], [1.05, -0.22], [0.5, -0.4], [-0.28, -0.44],
  [-0.9, -0.3], [-1.02, 0], [-0.9, 0.3], [-0.28, 0.44],
  [0.5, 0.4], [1.05, 0.22],
];

/**
 * The canopy, parked between the wing roots rather than out on the nose. That
 * is where the hull is widest and darkest, and it is the only part of the ship
 * far enough back that the converging nose highlights do not sit on top of it.
 */
const CANOPY: [number, number][] = [
  [0.9, 0], [0.66, -0.2], [0.14, -0.26], [-0.1, 0],
  [0.14, 0.26], [0.66, 0.2],
];

/**
 * The edges that face the airflow, as open runs rather than a closed outline.
 * Stroking these a second time, brighter and whiter, is the whole trick: a
 * uniform outline says "icon", and an outline that is hot along the front and
 * cold along the back says "this is moving, and that is the direction".
 *
 * They stop short of the nose point on purpose. Two runs converging on one
 * vertex stack their weight there, and a stroke as wide as the hull is no longer
 * an edge. The tip is left to the hull's own thinner outline.
 */
const LEADING: [number, number][][] = [
  [[1.3, -0.11], [1.05, -0.22], [0.5, -0.4]],
  [[1.3, 0.11], [1.05, 0.22], [0.5, 0.4]],
  [[0.2, -0.42], [-0.34, -1.42]],
  [[0.2, 0.42], [-0.34, 1.42]],
];

const HULL_WING = 'rgba(11,15,23,1)';
const HULL_NAC = 'rgba(16,22,33,1)';
const HULL_FUSE = 'rgba(22,31,45,1)';

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], oy = 0) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1] + oy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1] + oy);
  ctx.closePath();
}

function part(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  fill: string,
  stroke: string,
  lw: number,
  oy = 0,
) {
  poly(ctx, pts, oy);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function run(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/**
 * Everything the airframe needs to know about itself. Deliberately not the
 * `Player` — the title screen flies one of these across the wordmark and parks
 * it in the rule as the maker's mark, and the emblem being the *actual ship*
 * rather than a drawing of one is worth the small indirection.
 */
export interface ShipState {
  /** 0..1 engine heat: plume length, shock diamonds, intake glow. */
  thrust: number;
  /** -1..1 roll. */
  bank: number;
  /** 0..1 elongation into the lance. */
  stretch: number;
  /** 0..1 aim charge: canopy and intakes brighten. */
  charge: number;
  alpha: number;
  /** Free-running seconds, for exhaust flicker and the nav-light beat. */
  clock: number;
}

const IDLE: ShipState = { thrust: 0, bank: 0, stretch: 0, charge: 0, alpha: 1, clock: 0 };

/** The airframe alone, at any size, anywhere — no aura, no trail, no beam. */
export function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  r: number,
  state: Partial<ShipState> = {},
) {
  const s = { ...IDLE, ...state };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(r, r);
  drawExhaust(ctx, s);
  drawHull(ctx, s);
  ctx.restore();
}

export function drawPlayer(ctx: CanvasRenderingContext2D, game: Game) {
  const p = game.player;
  drawTrail(ctx, game);
  if (p.striking && p.plan) drawBeam(ctx, game);

  const blink = p.iframe > 0 && Math.floor(game.clock * 22) % 2 === 0;
  const alpha = p.iframe > 0 ? (blink ? 0.35 : 0.95) : 1;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  drawAura(ctx, game, alpha);
  ctx.restore();

  // Drawn slightly larger than the collision radius. `PLAYER_R` is a hitbox and
  // has a balance meaning; how big the airframe *looks* is a separate question,
  // and an interceptor with this much structure in it needs the extra sixth to
  // resolve at the scale a laptop actually renders the arena at.
  drawShip(ctx, p.x, p.y, p.angle, PLAYER_R * VIS, {
    thrust: Math.min(1, p.speed / 760),
    bank: p.bank,
    stretch: p.stretch,
    charge: p.charge,
    alpha,
    clock: game.clock,
  });
}

// ---------------------------------------------------------------- afterimages
/**
 * The trail is a spindle per sample rather than a rectangle: a bar has two hard
 * ends, and the one thing an afterimage must not have is an end. Cheap enough to
 * keep the whole hundred-sample history — four line segments each.
 */
function drawTrail(ctx: CanvasRenderingContext2D, game: Game) {
  const p = game.player;
  if (!p.trail.length) return;
  const striking = p.striking;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const t of p.trail) {
    const a = t.life / t.max;
    const len = PLAYER_R * (striking ? 4.8 : 2.1) * a;
    const wid = PLAYER_R * (striking ? 0.34 : 0.46) * a;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.a);
    ctx.fillStyle = rgba(COL.strike, a * a * 0.4);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.35, -wid);
    ctx.lineTo(-len, 0);
    ctx.lineTo(-len * 0.35, wid);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** The strike itself: a hard bar from where it began to wherever the ship is. */
function drawBeam(ctx: CanvasRenderingContext2D, game: Game) {
  const p = game.player;
  const plan = p.plan!;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [w, col, a] of [
    [2.4, COL.strike, 0.2],
    [0.9, COL.strike, 0.55],
    [0.34, COL.playerCore, 0.95],
  ] as const) {
    ctx.strokeStyle = rgba(col, a);
    ctx.lineWidth = PLAYER_R * w;
    ctx.beginPath();
    ctx.moveTo(plan.x0, plan.y0);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------- light
function drawAura(ctx: CanvasRenderingContext2D, game: Game, alpha: number) {
  const p = game.player;
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(
    ctx, glowSprite(COL.player, 0.34), 0, 0,
    PLAYER_R * (3 + p.charge * 2.4 + p.stretch * 2), alpha,
  );

  /**
   * The aiming reticle, carried by the ship rather than by the cursor: a ring
   * that tightens as the hold builds, with three arcs spinning up inside it and
   * four ticks that snap to the cardinals. It is the only part of the ship that
   * is a *readout* — it says the weapon is live — so it is allowed to look like
   * an instrument instead of like hardware.
   */
  if (p.charge > 0.02) {
    const cr = PLAYER_R * (3.4 - p.charge * 1.5);
    ctx.strokeStyle = rgba(COL.focus, 0.45 * p.charge * alpha);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = rgba(COL.playerCore, 0.8 * p.charge * alpha);
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = game.clock * 3.4 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, cr, a, a + 0.42);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(COL.strike, 0.7 * p.charge * alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = -p.angle + (i / 4) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(c * (cr + 3), s * (cr + 3));
      ctx.lineTo(c * (cr + 9), s * (cr + 9));
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Twin plumes off the nacelles, plus the shock diamonds that stand in a real
 * exhaust when it is over-expanded. The diamonds are three dots and they are the
 * single most convincing detail on the ship: nothing decorative would ever put
 * *evenly spaced bright spots inside a flame*, so an eye reads them as physics.
 */
function drawExhaust(ctx: CanvasRenderingContext2D, s: ShipState) {
  const heat = Math.max(s.thrust, s.stretch);
  if (heat < 0.02) return;
  const flick = 0.88 + 0.12 * Math.sin(s.clock * 41);
  const len = (0.55 + heat * 3.4) * flick;
  const a = s.alpha * (0.4 + heat * 0.6);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const oy of [-NAC_Y, NAC_Y]) {
    // Mantle, then core: two triangles of the same shape at different widths is
    // a flame with an inside, and it costs one more fill than a flame without.
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
        const s = 0.09 * (1 - i * 0.22);
        ctx.beginPath();
        ctx.arc(-d, oy, s, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// ----------------------------------------------------------------------- hull
function drawHull(ctx: CanvasRenderingContext2D, p: ShipState) {
  const alpha = p.alpha;

  // Stretch into the lance, and roll into the drift. The Y squash reads as bank
  // on its own; the *sign* of it comes from the offsets below, which slide the
  // spine and the canopy toward the raised side.
  const sx = 1 + p.stretch * 2.3;
  const sy = 1 - p.stretch * 0.42;
  const bank = p.bank;
  const lean = bank * 0.16;
  ctx.scale(sx, sy * Math.cos(bank * 0.9));

  // Line weights are in hull units, divided back out of the stretch — otherwise
  // a striking ship ends up outlined in a hairline along its long axis.
  const lw = (v: number) => v / Math.max(sx, 1);
  const detail = alpha * (1 - p.stretch * 0.85);

  // The airframe sheds as the strike takes over. Stretching every part equally
  // dragged the wings out into four long dark bars — a comb, not a lance. The
  // fuselage carries the shape on its own at speed, which is also the honest
  // reading: the ship stops being a ship and becomes the line.
  const frame = alpha * (1 - p.stretch * 0.8);

  // The underside of the descending wing, showing as the ship rolls.
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

  // Intakes: a dark mouth with a lit lip. Brightens as the hold builds, so the
  // ship visibly spools up before it goes.
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

  // Hot leading edges. Drawn over the closed outlines, wider and whiter — but
  // only just. At the nose the two runs converge on a single point, so any extra
  // weight here stops being an edge and becomes a solid white wedge that eats
  // the whole forward fuselage; this is as heavy as they can go.
  ctx.strokeStyle = rgba(COL.playerCore, 0.8 * alpha);
  ctx.lineWidth = lw(0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const r of LEADING) run(ctx, r);
  ctx.stroke();

  // Panel lines: a spine, two shoulder creases, a wing rib each side. Interior
  // structure is what separates a vehicle from a glyph, and it is five strokes.
  if (detail > 0.04) {
    ctx.strokeStyle = rgba(COL.player, 0.42 * detail);
    ctx.lineWidth = lw(0.06);
    ctx.beginPath();
    ctx.moveTo(1.3, lean * 0.35);
    ctx.lineTo(-0.82, lean * 0.35);
    for (const s of [-1, 1] as const) {
      ctx.moveTo(1.02, s * 0.18 + lean * 0.35);
      ctx.lineTo(0.14, s * 0.38 + lean * 0.35);
      ctx.lineTo(-0.5, s * 0.37 + lean * 0.35);
      ctx.moveTo(-0.24, s * 0.78);
      ctx.lineTo(-0.66, s * 1.04);
    }
    ctx.stroke();
  }

  // Canopy. Cold glass over a lit cockpit: a bright fill, a white sliver along
  // the front where the light would catch, and a halo that leaks into the room.
  //
  // The bezel underneath it is the load-bearing part. The canopy sits exactly
  // where the two leading edges converge, so an additive fill there is light on
  // top of light and disappears. Punching a hole in the white first — a hard
  // dark frame, drawn opaque — is what gives it something to be bright against,
  // and it is the difference between a ship with a cockpit and a ship with a
  // smudge where the cockpit should be.
  // Filled *and* stroked with the same dark: a stroke inflates a shape evenly in
  // every direction, where scaling a copy up would push the pointed ends much
  // further than the sides and leave a dark spike sticking into the nose.
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
  // The catchlight along the front of the glass.
  ctx.fillStyle = rgba(COL.playerCore, 0.95 * alpha);
  ctx.beginPath();
  ctx.moveTo(0.88, lean);
  ctx.lineTo(0.62, -0.15 + lean);
  ctx.lineTo(0.34, -0.11 + lean);
  ctx.lineTo(0.64, lean);
  ctx.closePath();
  ctx.fill();
  // Tight, and deliberately dimmer than it wants to be. Spread this glow and it
  // reaches the nose highlights, and the forward fuselage stops existing.
  drawRadial(ctx, glowSprite(COL.player, 0.34), 0.42, lean, 0.5, alpha * 0.8);

  // Nose sensor, and the navigation lights on the tips. The tips blink out of
  // phase with each other because that is what they do, and the asymmetry is
  // free character — a symmetric ship with a symmetric blink is a diagram.
  drawRadial(ctx, flareSprite(COL.playerCore, 1), 1.48, lean * 0.2, 0.17, alpha);
  const beat = (p.clock * 1.5) % 1;
  for (const [s, phase] of [[-1, 0], [1, 0.5]] as const) {
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
