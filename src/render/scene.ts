import { COL, PLAYER_R, SPAWN_TELEGRAPH, rgba, type RGB } from '../config';
import { TAU, clamp, clamp01, easeOutCubic, easeOutQuint } from '../engine/math';
import { ENEMY_COL, type Game } from '../game/game';
import { ORB_R, WARD_ARC, silhouette, type Enemy, type EnemyKind } from '../game/enemies';
import type { StrikePlan } from '../game/strike';
import { view } from '../viewport';
import { drawRadial, radialSprite } from './glow';
import { drawVec, vecWidth } from './text';

/**
 * Everything inside the arena, drawn in arena units.
 *
 * Layering is deliberate and worth stating once: the floor and its light pool
 * sit under everything; the aim preview sits *over* the enemies it is about to
 * kill, because it is a promise about them; the player sits over the preview,
 * because the player is the promise being kept.
 */

const GRID = 62;

/**
 * The soft light in this game is all the same shape: a radial falloff, at some
 * size, in some colour. Baking each one into a sprite once turns a per-frame
 * gradient build plus a shaded fill into a single scaled blit — and there is
 * one of these behind every enemy, every orb, and the ship.
 */
const haloSprite = (col: RGB) =>
  radialSprite(`halo${col}`, [
    [0, rgba(col, 0.24)],
    [0.5, rgba(col, 0.07)],
    [1, rgba(col, 0)],
  ]);

const glowSprite = (col: RGB, inner: number) =>
  radialSprite(`glow${col}:${inner}`, [
    [0, rgba(col, inner)],
    [1, rgba(col, 0)],
  ]);

/** Soft dark stain for scorch marks — the one sprite here that darkens. */
const scorchSprite = () =>
  radialSprite('scorch', [
    [0, 'rgba(0,0,0,0.85)'],
    [0.55, 'rgba(0,0,0,0.42)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

/**
 * Unit-radius body outlines, shared with the death effect via `silhouette` —
 * built once so the per-frame path never allocates. Bodies are drawn by scaling
 * the context, with the line width compensated back to screen weight.
 */
const UNIT: Record<EnemyKind, [number, number][]> = {
  mote: silhouette('mote', 1),
  seeder: silhouette('seeder', 1),
  ward: silhouette('ward', 1),
  lancer: silhouette('lancer', 1),
  spine: silhouette('spine', 1),
};

/**
 * A body's own colour pulled down to hull-plate dark. Enemies are *objects* —
 * they occlude the grid — and it is precisely this opacity that makes them read
 * as things standing in the player's light rather than icons printed on it.
 */
const darkBody = (col: RGB) =>
  `rgba(${(col[0] * 0.14 + 11) | 0},${(col[1] * 0.14 + 11) | 0},${(col[2] * 0.14 + 14) | 0},1)`;

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

export function drawScene(ctx: CanvasRenderingContext2D, game: Game) {
  drawBackdrop(ctx, game);

  // Everything that belongs to the playfield is clipped to it. Without this a
  // lancer's charge line, an enemy's halo and a kill's debris all spill into the
  // surround, and the arena stops reading as a bounded space you are trapped in.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.arenaW, view.arenaH);
  ctx.clip();

  drawFloor(ctx, game);
  drawDust(ctx, game);
  drawLancerMarks(ctx, game);
  drawSpawns(ctx, game);
  drawEnemies(ctx, game);
  drawOrbs(ctx, game);
  if (game.aim && game.state === 'play') drawAim(ctx, game, game.aim);
  game.particles.draw(ctx);
  drawPlayer(ctx, game);
  ctx.restore();

  drawFrame(ctx, game);
  drawPopups(ctx, game);
}

// ------------------------------------------------------------------ backdrop
let spill: CanvasGradient | null = null;
let spillKey = '';

function drawBackdrop(ctx: CanvasRenderingContext2D, game: Game) {
  const { padX, padY, arenaW, arenaH, fullW, fullH } = view;
  ctx.fillStyle = rgba(COL.void, 1);
  ctx.fillRect(-padX, -padY, fullW, fullH);

  // A very soft bloom of the arena's own light spilling into the surround.
  // Fixed in arena units, so it only has to be rebuilt when the arena resizes.
  const key = `${arenaW.toFixed(1)}x${arenaH.toFixed(1)}`;
  if (spillKey !== key || !spill) {
    const cx = arenaW * 0.5;
    const cy = arenaH * 0.5;
    const r = Math.max(arenaW, arenaH) * 0.86;
    const gr = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    gr.addColorStop(0, rgba(COL.grid, 0.2));
    gr.addColorStop(0.55, rgba(COL.grid, 0.06));
    gr.addColorStop(1, rgba(COL.void, 0));
    spill = gr;
    spillKey = key;
  }
  ctx.fillStyle = spill;
  ctx.fillRect(-padX, -padY, fullW, fullH);

  // Surround texture: long faint diagonals, drifting. Gives the void a sense of
  // scale without competing with the playfield for attention.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = rgba(COL.gridHot, 1);
  ctx.lineWidth = 1;
  const off = (game.clock * 9) % 160;
  ctx.beginPath();
  for (let d = -fullH; d < fullW + fullH; d += 160) {
    ctx.moveTo(-padX + d + off, -padY);
    ctx.lineTo(-padX + d + off - fullH, -padY + fullH);
  }
  ctx.stroke();
  ctx.restore();
}

// --------------------------------------------------------------------- floor
/** One path for the whole grid; drawn twice (base + inside the light pool). */
function gridPath(ctx: CanvasRenderingContext2D, step: number) {
  const { arenaW, arenaH } = view;
  ctx.beginPath();
  for (let x = step; x < arenaW; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arenaH);
  }
  for (let y = step; y < arenaH; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(arenaW, y);
  }
}

/**
 * Markings painted on the floor, like a court or a test range: a centre circle,
 * registration crosses, an arena ID. Pure set dressing — but it is exactly this
 * kind of purposeless-looking purpose that makes a space feel surveyed and
 * built rather than generated. Drawn once per frame, five cheap strokes.
 */
function drawEtchings(ctx: CanvasRenderingContext2D) {
  const { arenaW, arenaH } = view;
  const cx = arenaW * 0.5;
  const cy = arenaH * 0.5;

  ctx.save();
  ctx.strokeStyle = rgba(COL.wall, 0.1);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 104, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  // Quadrant ticks just outside the circle, and a small centre cross.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ctx.moveTo(cx + Math.cos(a) * 104, cy + Math.sin(a) * 104);
    ctx.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118);
  }
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 8);
  // Registration crosses inset at the corners.
  for (const [rx, ry] of [
    [120, 120], [arenaW - 120, 120], [arenaW - 120, arenaH - 120], [120, arenaH - 120],
  ] as const) {
    ctx.moveTo(rx - 7, ry);
    ctx.lineTo(rx + 7, ry);
    ctx.moveTo(rx, ry - 7);
    ctx.lineTo(rx, ry + 7);
  }
  ctx.stroke();

  drawVec(ctx, 'ARENA 062', arenaW - 20, arenaH - 16, {
    size: 11,
    weight: 0.14,
    tracking: 0.3,
    align: 'right',
    color: rgba(COL.wall, 0.2),
  });
  drawVec(ctx, 'AFB RECORDER LIVE', 20, arenaH - 16, {
    size: 11,
    weight: 0.14,
    tracking: 0.3,
    color: rgba(COL.wall, 0.13),
  });
  ctx.restore();
}

/** Scorch stains where things died, with a brief dying ember at their heart. */
function drawBurns(ctx: CanvasRenderingContext2D, game: Game) {
  if (!game.burns.length) return;
  const scorch = scorchSprite();
  for (const b of game.burns) {
    const t = b.life / b.max;
    // The stain holds most of its life, then lets go.
    drawRadial(ctx, scorch, b.x, b.y, b.r, 0.55 * Math.min(1, t * 2.2));
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of game.burns) {
    const age = 1 - b.life / b.max;
    const ember = clamp01(1 - age / 0.16);
    if (ember <= 0.01) continue;
    drawRadial(ctx, glowSprite(b.col, 0.45), b.x, b.y, b.r * 0.7, ember * ember);
  }
  ctx.restore();
}

/** The lines of recent strikes, burned into the floor and cooling. */
function drawScars(ctx: CanvasRenderingContext2D, game: Game) {
  if (!game.scars.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const s of game.scars) {
    const t = s.life / s.max;
    ctx.strokeStyle = rgba(COL.strike, 0.1 * t * t);
    ctx.lineWidth = 7;
    line(ctx, s.x0, s.y0, s.x1, s.y1);
    ctx.strokeStyle = rgba(COL.playerCore, 0.2 * t * t * t);
    ctx.lineWidth = 1.6;
    line(ctx, s.x0, s.y0, s.x1, s.y1);
  }
  ctx.restore();
}

function drawFloor(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  const p = game.player;

  ctx.save();
  ctx.fillStyle = rgba(COL.floor, 1);
  ctx.fillRect(0, 0, arenaW, arenaH);

  // Base grid, minor and major. The 4-cell major rhythm is most of what stops
  // the floor reading as procedurally tiled wallpaper.
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(COL.grid, 0.22);
  gridPath(ctx, GRID);
  ctx.stroke();
  ctx.strokeStyle = rgba(COL.grid, 0.42);
  gridPath(ctx, GRID * 4);
  ctx.stroke();

  drawEtchings(ctx);
  drawBurns(ctx, game);

  // The player carries a light. Re-drawing the grid clipped to a disc around the
  // ship is far cheaper than a per-line gradient and reads as a real pool.
  const lightR = 210 + game.player.speedNorm * 190 + game.aimBlend * 70;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, lightR, 0, TAU);
  ctx.clip();
  drawRadial(ctx, glowSprite(COL.gridHot, 0.16), p.x, p.y, lightR);
  ctx.strokeStyle = rgba(COL.gridHot, 0.3);
  ctx.lineWidth = 1;
  gridPath(ctx, GRID);
  ctx.stroke();
  ctx.restore();

  drawScars(ctx, game);

  // Aim mode dims the floor so the strike line is the brightest thing on it.
  if (game.aimBlend > 0.01) {
    ctx.fillStyle = rgba(COL.void, game.aimBlend * 0.42);
    ctx.fillRect(0, 0, arenaW, arenaH);
  }

  ctx.restore();
}

/** A slow parallax field of motes; deterministic, so it never pops on resize. */
function drawDust(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const seed = i * 12.9898;
    const fx = frac(Math.sin(seed) * 43758.5453);
    const fy = frac(Math.sin(seed * 1.7) * 21451.19);
    const spd = 6 + fx * 16;
    const x = fx * arenaW;
    const y = (fy * arenaH + game.clock * spd) % arenaH;
    const a = 0.06 + fy * 0.14;
    ctx.fillStyle = rgba(COL.gridHot, a);
    const s = 1 + fx * 1.6;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

const frac = (v: number) => v - Math.floor(v);

// ------------------------------------------------------------------ hazards
function drawLancerMarks(ctx: CanvasRenderingContext2D, game: Game) {
  const len = Math.hypot(view.arenaW, view.arenaH);
  ctx.save();
  for (const e of game.swarm.list) {
    if (!e.alive || e.spawn > 0 || e.kind !== 'lancer' || e.state !== 1) continue;
    const t = 1 - clamp01(e.timer / 1.05);
    const x2 = e.x + e.markX * len;
    const y2 = e.y + e.markY * len;

    ctx.globalCompositeOperation = 'lighter';
    // A wide dim band that narrows and brightens as the shot resolves: the
    // threat reads as "charging" without needing a number.
    ctx.strokeStyle = rgba(COL.lancer, 0.06 + t * 0.1);
    ctx.lineWidth = 40 * (1 - t * 0.62);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = -game.clock * 190;
    ctx.strokeStyle = rgba(COL.lancer, 0.35 + t * 0.5);
    ctx.lineWidth = 1.5 + t * 2.5;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawSpawns(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of game.swarm.list) {
    if (!e.alive || e.spawn <= 0) continue;
    const t = clamp01(1 - e.spawn / SPAWN_TELEGRAPH);
    const col = ENEMY_COL[e.kind];
    const r = e.r * (4.2 - 3.2 * easeOutCubic(t));

    ctx.strokeStyle = rgba(col, 0.16 + t * 0.5);
    ctx.lineWidth = 1 + t * 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.stroke();

    // A sweeping arc that completes exactly as the enemy becomes solid.
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 1.7, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();

    ctx.globalAlpha = t * 0.5;
    drawEnemyBody(ctx, e, game, t * 0.5);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------------------------------------------------------------------ enemies
function drawEnemies(ctx: CanvasRenderingContext2D, game: Game) {
  for (const e of game.swarm.list) {
    if (!e.alive || e.spawn > 0) continue;
    drawEnemyBody(ctx, e, game, 1);
  }
}

/**
 * A small white glint offset toward the player: every species catches the one
 * cold light in the room. The cheapest possible way to make a shape read as a
 * *creature aware of you* rather than a marker — and because the light source
 * is the player, it is diegetic rather than decoration.
 */
function glint(ctx: CanvasRenderingContext2D, toP: number, off: number, alpha: number) {
  ctx.fillStyle = rgba(COL.playerCore, 0.88 * alpha);
  ctx.beginPath();
  ctx.arc(Math.cos(toP) * off, Math.sin(toP) * off, 2.6, 0, TAU);
  ctx.fill();
}

function drawEnemyBody(ctx: CanvasRenderingContext2D, e: Enemy, game: Game, alpha: number) {
  const col = ENEMY_COL[e.kind];
  const flash = clamp01(e.flash);
  const breathe = 1 + Math.sin(game.clock * 3 + e.seed) * 0.05;
  const toP = Math.atan2(game.player.y - e.y, game.player.x - e.x);
  const body = darkBody(col);

  ctx.save();
  ctx.translate(e.x, e.y);

  // Every enemy gets a soft additive halo so the swarm reads as light sources
  // in a dark room rather than as decals lying on the floor.
  ctx.globalCompositeOperation = 'lighter';
  drawRadial(ctx, haloSprite(col), 0, 0, e.r * 2.5, alpha);
  ctx.globalCompositeOperation = 'source-over';

  switch (e.kind) {
    case 'mote': {
      // An ember: it flickers, because embers are never steady.
      const fl = 0.8 + 0.2 * Math.sin(game.clock * 11 + e.seed * 5.3);
      ctx.save();
      ctx.rotate(e.rot);
      const s = e.r * breathe;
      unitPoly(ctx, UNIT.mote, s, body, rgba(col, alpha * fl), 2.2);
      // A hot seam down the long axis, like a coal about to split.
      ctx.strokeStyle = rgba(col, 0.85 * alpha * fl);
      ctx.lineWidth = 1.2;
      line(ctx, 0, -s * 0.5, 0, s * 0.5);
      ctx.restore();
      glint(ctx, toP, e.r * 0.32, alpha);
      break;
    }

    case 'seeder': {
      ctx.save();
      ctx.rotate(e.rot * 0.4);
      const s = e.r * breathe;
      unitPoly(ctx, UNIT.seeder, s, body, rgba(col, 0.95 * alpha), 2.2);
      // The womb: an inner chamber counter-rotating against the hull.
      ctx.rotate(-e.rot * 2);
      unitPoly(ctx, UNIT.seeder, s * 0.5, null, rgba(col, 0.55 * alpha), 1.5);
      ctx.restore();
      // Three orbiting pips — the three motes it is about to become. The enemy
      // states its own death rule on its body, in the motes' own ember colour.
      ctx.fillStyle = rgba(COL.mote, 0.95 * alpha);
      for (let i = 0; i < 3; i++) {
        const a = e.age * 2 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * e.r * 1.5, Math.sin(a) * e.r * 1.5, 2.6, 0, TAU);
        ctx.fill();
      }
      glint(ctx, toP, e.r * 0.4, alpha);
      break;
    }

    case 'ward': {
      const r = e.r * breathe;
      ctx.save();
      ctx.rotate(e.rot);
      unitPoly(ctx, UNIT.ward, r, body, rgba(col, 0.95 * alpha), 2.2);
      // Facet seams, so the hex reads as an armoured lantern rather than a tile.
      ctx.strokeStyle = rgba(col, 0.3 * alpha);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(-Math.cos(a) * r, -Math.sin(a) * r);
      }
      ctx.stroke();
      ctx.restore();

      // The shield. Deliberately the brightest thing on the enemy: it is the
      // only piece of information the player needs from it.
      ctx.globalCompositeOperation = 'lighter';
      const sr = r * 1.62;
      ctx.strokeStyle = rgba(col, (0.5 + flash * 0.5) * alpha);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, sr, e.shield - WARD_ARC, e.shield + WARD_ARC);
      ctx.stroke();
      ctx.strokeStyle = rgba(COL.playerCore, (0.5 + flash * 0.5) * alpha);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, sr, e.shield - WARD_ARC, e.shield + WARD_ARC);
      ctx.stroke();
      // Ribs, so the arc's extent is unmistakable at a glance.
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = rgba(col, 0.75 * alpha);
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        const a = e.shield + (i / 2) * WARD_ARC;
        ctx.moveTo(Math.cos(a) * r * 1.16, Math.sin(a) * r * 1.16);
        ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      glint(ctx, toP, r * 0.34, alpha);
      break;
    }

    case 'lancer': {
      ctx.rotate(e.rot);
      const r = e.r * breathe;
      const charging = e.state === 2;
      if (charging) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(col, 0.3 * alpha);
        ctx.beginPath();
        ctx.moveTo(-r * 5.5, 0);
        ctx.lineTo(0, -r * 0.8);
        ctx.lineTo(0, r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      // While marking, the whole body strobes — a weapon spinning up.
      const arm = e.state === 1 ? 0.75 + 0.25 * Math.sin(game.clock * 22) : 1;
      unitPoly(ctx, UNIT.lancer, r, body, rgba(col, arm * alpha), 2.2);
      // Engine ember at the tail; flares hard in the charge.
      ctx.globalCompositeOperation = 'lighter';
      drawRadial(
        ctx, glowSprite(col, 0.55), -r * 0.75, 0,
        r * (charging ? 1.15 : 0.5 + 0.1 * Math.sin(game.clock * 9 + e.seed)),
        alpha,
      );
      ctx.globalCompositeOperation = 'source-over';
      // The headlight sits on its nose: a lancer looks where it will charge,
      // which is the one thing worth knowing about it.
      ctx.fillStyle = rgba(COL.playerCore, 0.92 * alpha);
      ctx.beginPath();
      ctx.arc(r * 0.55, 0, 2.6, 0, TAU);
      ctx.fill();
      break;
    }

    case 'spine': {
      const r = e.r * breathe;
      ctx.save();
      ctx.rotate(e.rot);
      unitPoly(ctx, UNIT.spine, r, body, rgba(col, 0.95 * alpha), 2.2);
      ctx.restore();
      // The barrel tracks you. Muzzle glint doubles as the eye.
      ctx.strokeStyle = rgba(col, 0.9 * alpha);
      ctx.lineWidth = 3;
      line(ctx, Math.cos(toP) * r * 0.3, Math.sin(toP) * r * 0.3, Math.cos(toP) * r * 1.28, Math.sin(toP) * r * 1.28);
      ctx.fillStyle = rgba(COL.playerCore, 0.92 * alpha);
      ctx.beginPath();
      ctx.arc(Math.cos(toP) * r * 1.28, Math.sin(toP) * r * 1.28, 2.4, 0, TAU);
      ctx.fill();
      // Charge ring: how close the next orb is.
      const t = 1 - clamp01(e.timer / 2.3);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(col, 0.75 * alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * t);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
  }

  ctx.restore();
}

function poly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  close: boolean,
  fill: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  if (fill) ctx.fill();
  ctx.stroke();
}

function drawOrbs(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  for (const o of game.swarm.orbs) {
    if (!o.alive) continue;
    const pulse = 1 + Math.sin(o.age * 9) * 0.12;
    ctx.globalCompositeOperation = 'lighter';
    // Tracer tail along the velocity: a shot, not a floating decoration.
    ctx.strokeStyle = rgba(COL.spine, 0.3);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    line(ctx, o.x - o.vx * 0.055, o.y - o.vy * 0.055, o.x, o.y);
    drawRadial(ctx, glowSprite(COL.spine, 0.42), o.x, o.y, ORB_R * 3);
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = rgba(COL.spine, 0.95);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(o.x, o.y, ORB_R * pulse, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba(COL.playerCore, 0.85);
    ctx.beginPath();
    ctx.arc(o.x, o.y, ORB_R * 0.34, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- aim preview
/**
 * The single most important thing drawn on screen: a promise about what the
 * next 150 milliseconds will contain. Everything it shows — the reach, the kill
 * order, the block — comes from the same solver that will execute the strike.
 */
function drawAim(ctx: CanvasRenderingContext2D, game: Game, plan: StrikePlan) {
  const p = game.player;
  if (p.striking) return;

  const focusA = 0.28 + game.aimBlend * 0.72;
  const ex = plan.x0 + plan.dx * plan.dist;
  const ey = plan.y0 + plan.dy * plan.dist;
  const t = game.clock;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // Ghost of the full potential reach, behind the live line.
  if (!plan.blocked) {
    const gx = plan.x0 + plan.dx * plan.reach;
    const gy = plan.y0 + plan.dy * plan.reach;
    ctx.strokeStyle = rgba(COL.strike, 0.07 * focusA);
    ctx.lineWidth = PLAYER_R * 2.2;
    line(ctx, plan.x0, plan.y0, gx, gy);
  }

  // Body of the line.
  ctx.strokeStyle = rgba(COL.strike, 0.14 * focusA);
  ctx.lineWidth = PLAYER_R * 1.9;
  line(ctx, plan.x0, plan.y0, ex, ey);

  ctx.strokeStyle = rgba(COL.strike, 0.5 * focusA);
  ctx.lineWidth = 2.4;
  line(ctx, plan.x0, plan.y0, ex, ey);

  // Graduations. The line is an instrument reading, and instruments are ruled.
  const gx = -plan.dy;
  const gy = plan.dx;
  ctx.strokeStyle = rgba(COL.strike, 0.32 * focusA);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let d = 80; d < plan.dist - 24; d += 80) {
    const tx = plan.x0 + plan.dx * d;
    const ty = plan.y0 + plan.dy * d;
    ctx.moveTo(tx - gx * 6, ty - gy * 6);
    ctx.lineTo(tx + gx * 6, ty + gy * 6);
  }
  ctx.stroke();

  // Flowing dashes: the line should look like it is already moving.
  ctx.setLineDash([26, 20]);
  ctx.lineDashOffset = -t * 620;
  ctx.strokeStyle = rgba(COL.playerCore, 0.7 * focusA);
  ctx.lineWidth = 3.4;
  line(ctx, plan.x0, plan.y0, ex, ey);
  ctx.setLineDash([]);

  // Blocked tail — where the strike would have gone, and cannot.
  if (plan.blocked) {
    const bx = plan.x0 + plan.dx * (plan.dist + 210);
    const by = plan.y0 + plan.dy * (plan.dist + 210);
    ctx.setLineDash([9, 13]);
    ctx.strokeStyle = rgba(COL.danger, 0.5 * focusA);
    ctx.lineWidth = 2.4;
    line(ctx, ex, ey, bx, by);
    ctx.setLineDash([]);

    const s = 15 + Math.sin(t * 12) * 2;
    ctx.strokeStyle = rgba(COL.danger, 0.95 * focusA);
    ctx.lineWidth = 4;
    line(ctx, ex - s, ey - s, ex + s, ey + s);
    line(ctx, ex + s, ey - s, ex - s, ey + s);

    // Naming the failure is worth more than any number of red pixels: the
    // player has to connect "this line stops" to "that arc is a shield".
    if (game.aimBlend > 0.05) {
      ctx.globalCompositeOperation = 'source-over';
      drawVec(ctx, 'SHIELDED', ex, ey - 40, {
        size: 17,
        weight: 0.15,
        tracking: 0.18,
        align: 'center',
        baseline: 'mid',
        color: rgba(COL.danger, focusA),
        glow: 1,
        glowColor: rgba(COL.danger, focusA),
      });
      ctx.globalCompositeOperation = 'lighter';
    }
  } else {
    // Impact bracket at the far end.
    const nx = -plan.dy;
    const ny = plan.dx;
    const s = 16;
    ctx.strokeStyle = rgba(COL.playerCore, 0.85 * focusA);
    ctx.lineWidth = 3;
    line(ctx, ex + nx * s, ey + ny * s, ex + nx * s * 0.4 + plan.dx * s * 0.7, ey + ny * s * 0.4 + plan.dy * s * 0.7);
    line(ctx, ex - nx * s, ey - ny * s, ex - nx * s * 0.4 + plan.dx * s * 0.7, ey - ny * s * 0.4 + plan.dy * s * 0.7);
  }

  // Per-target markers, numbered in the order they will die.
  let idx = 0;
  for (const h of plan.hits) {
    const target = h.enemy;
    const cx = target ? target.x : h.orb ? h.orb.x : h.x;
    const cy = target ? target.y : h.orb ? h.orb.y : h.y;
    const r = (target ? target.r : ORB_R) + 13;

    if (h.blocked) {
      ctx.strokeStyle = rgba(COL.danger, 0.9 * focusA);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      continue;
    }

    idx++;
    const wob = Math.sin(t * 9 + idx) * 1.5;
    ctx.strokeStyle = rgba(COL.playerCore, 0.9 * focusA);
    ctx.lineWidth = 2.6;
    bracket(ctx, cx, cy, r + wob);

    if (plan.hits.length > 1) {
      drawVec(ctx, String(idx), cx + r + 12, cy - r - 4, {
        size: 15,
        weight: 0.16,
        tracking: 0.04,
        color: rgba(COL.playerCore, 0.9 * focusA),
        align: 'left',
      });
    }
  }

  // Kill count, parked just past the end of the line. Only from two upward —
  // for a single target the bracket already says everything.
  if (plan.kills > 1 && game.aimBlend > 0.05) {
    const lx = clamp(ex + plan.dx * 34 - plan.dy * 30, 46, view.arenaW - 46);
    const ly = clamp(ey + plan.dy * 34 + plan.dx * 30, 34, view.arenaH - 34);
    ctx.globalCompositeOperation = 'source-over';
    drawVec(ctx, `×${plan.kills}`, lx, ly, {
      size: 26 + plan.kills * 1.5,
      weight: 0.15,
      tracking: 0.03,
      align: 'center',
      baseline: 'mid',
      color: rgba(COL.playerCore, focusA),
      glow: 1,
      glowColor: rgba(COL.strike, focusA),
    });
  }

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Four corner ticks — reads as a targeting reticle far better than a circle. */
function bracket(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const a = r * 0.55;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    ctx.moveTo(x + sx * r, y + sy * r - sy * a);
    ctx.lineTo(x + sx * r, y + sy * r);
    ctx.lineTo(x + sx * r - sx * a, y + sy * r);
  }
  ctx.stroke();
}

// -------------------------------------------------------------------- player
function drawPlayer(ctx: CanvasRenderingContext2D, game: Game) {
  const p = game.player;
  const striking = p.striking;

  // Afterimages, oldest first.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const t of p.trail) {
    const a = t.life / t.max;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.a);
    ctx.fillStyle = rgba(COL.strike, a * a * 0.42);
    const len = PLAYER_R * (striking ? 4.6 : 1.9) * a;
    ctx.fillRect(-len, -PLAYER_R * 0.36 * a, len * 2, PLAYER_R * 0.72 * a);
    ctx.restore();
  }
  ctx.restore();

  // The strike beam itself: a hard bar from where the strike began to here.
  if (striking && p.plan) {
    const sx = p.plan.x0;
    const sy = p.plan.y0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(COL.strike, 0.2);
    ctx.lineWidth = PLAYER_R * 2.4;
    line(ctx, sx, sy, p.x, p.y);
    ctx.strokeStyle = rgba(COL.strike, 0.55);
    ctx.lineWidth = PLAYER_R * 0.9;
    line(ctx, sx, sy, p.x, p.y);
    ctx.strokeStyle = rgba(COL.playerCore, 0.95);
    ctx.lineWidth = PLAYER_R * 0.34;
    line(ctx, sx, sy, p.x, p.y);
    ctx.restore();
  }

  const blink = p.iframe > 0 && Math.floor(game.clock * 22) % 2 === 0;
  const alpha = p.iframe > 0 ? (blink ? 0.35 : 0.95) : 1;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

  // Aura.
  ctx.globalCompositeOperation = 'lighter';
  const auraR = PLAYER_R * (3 + p.charge * 2.4 + p.stretch * 2);
  drawRadial(ctx, glowSprite(COL.player, 0.36), 0, 0, auraR, alpha);

  // Charge ring while aiming: a tightening circle, plus ticks that spin up.
  if (p.charge > 0.02) {
    const cr = PLAYER_R * (3.4 - p.charge * 1.5);
    ctx.strokeStyle = rgba(COL.focus, 0.5 * p.charge * alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, cr, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(COL.playerCore, 0.75 * p.charge * alpha);
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const a = game.clock * 3.4 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, cr, a, a + 0.42);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // Engine light trailing off the stern, flaring with real speed. The ship
  // must never look parked: even a drift is a machine under thrust.
  const thrust = Math.min(1, p.speed / 760);
  if (!striking && thrust > 0.03) {
    ctx.globalCompositeOperation = 'lighter';
    drawRadial(ctx, glowSprite(COL.strike, 0.5), -PLAYER_R * 1.05, 0, PLAYER_R * (0.7 + thrust * 1.5), alpha * (0.35 + thrust * 0.65));
    ctx.fillStyle = rgba(COL.playerCore, (0.3 + thrust * 0.6) * alpha);
    ctx.fillRect(-PLAYER_R * (1.1 + thrust * 0.9), -1.1, PLAYER_R * 0.7, 2.2);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Hull: a chevron that stretches into a lance while striking.
  const sx = 1 + p.stretch * 2.3;
  const sy = 1 - p.stretch * 0.42;
  ctx.scale(sx, sy);
  const r = PLAYER_R;
  ctx.fillStyle = rgba(COL.player, 0.26 * alpha);
  ctx.strokeStyle = rgba(COL.player, alpha);
  ctx.lineWidth = 2.6 / Math.max(sx, 1) + 0.6;
  poly(ctx, [[r * 1.5, 0], [-r * 0.9, -r], [-r * 0.45, 0], [-r * 0.9, r]], true, true);

  // Cockpit vee echoing the hull line — one stroke of interior detail is the
  // difference between a glyph and a vehicle.
  ctx.strokeStyle = rgba(COL.playerCore, 0.55 * alpha);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, -r * 0.5);
  ctx.lineTo(r * 0.7, 0);
  ctx.lineTo(-r * 0.2, r * 0.5);
  ctx.stroke();

  ctx.fillStyle = rgba(COL.playerCore, alpha);
  ctx.beginPath();
  ctx.arc(r * 0.12, 0, r * 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// --------------------------------------------------------------------- frame
/**
 * The arena's bezel, drawn like the housing of an instrument rather than a
 * border: a hairline pair for depth, a graduation of tick marks aligned to the
 * floor grid, and heavier corner hardware. The tick rhythm is doing the real
 * work — a plain rectangle says "canvas element", a ruled one says "machine
 * that was built to measure what happens inside it".
 */
function drawFrame(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  const pulse = game.alarm;
  const base = pulse > 0 ? mix(COL.wall, COL.danger, 0.35 + pulse * 0.5) : COL.wall;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Depth: soft bloom, crisp inner line, faint offset outer line.
  ctx.lineWidth = 10;
  ctx.strokeStyle = rgba(base, 0.04 * (1 + pulse * 0.9));
  ctx.strokeRect(0, 0, arenaW, arenaH);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rgba(base, 0.5 * (1 + pulse * 0.5));
  ctx.strokeRect(0, 0, arenaW, arenaH);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(base, 0.16);
  ctx.strokeRect(-6, -6, arenaW + 12, arenaH + 12);

  // Graduations, aligned to the grid; every fourth is a major.
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(base, 0.38);
  ctx.beginPath();
  for (let x = GRID; x < arenaW; x += GRID) {
    const len = (x / GRID) % 4 === 0 ? 9 : 4;
    ctx.moveTo(x, -3);
    ctx.lineTo(x, -3 - len);
    ctx.moveTo(x, arenaH + 3);
    ctx.lineTo(x, arenaH + 3 + len);
  }
  for (let y = GRID; y < arenaH; y += GRID) {
    const len = (y / GRID) % 4 === 0 ? 9 : 4;
    ctx.moveTo(-3, y);
    ctx.lineTo(-3 - len, y);
    ctx.moveTo(arenaW + 3, y);
    ctx.lineTo(arenaW + 3 + len, y);
  }
  ctx.stroke();

  // Corner hardware: bracket plus a filled stud.
  const L = 46;
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = rgba(base, 0.8);
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [0, 0, 1, 1], [arenaW, 0, -1, 1], [arenaW, arenaH, -1, -1], [0, arenaH, 1, -1],
  ] as const) {
    ctx.moveTo(cx + dx * L, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * L);
  }
  ctx.stroke();
  ctx.fillStyle = rgba(base, 0.9);
  for (const [cx, cy] of [
    [0, 0], [arenaW, 0], [arenaW, arenaH], [0, arenaH],
  ] as const) {
    ctx.fillRect(cx - 2.4, cy - 2.4, 4.8, 4.8);
  }
  ctx.restore();
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as const;
}

// -------------------------------------------------------------------- popups
function drawPopups(ctx: CanvasRenderingContext2D, game: Game) {
  for (const q of game.popups) {
    const t = 1 - q.life / q.max;
    const inT = easeOutQuint(clamp(t * 5, 0, 1));
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    const scale = q.scale * (0.6 + inT * 0.4);

    ctx.save();
    ctx.globalAlpha = fade;
    const size = (q.kind === 'multi' ? 40 : q.kind === 'wave' ? 34 : 26) * scale;
    // Clamp against the run's own measured width. The spawn-time clamp works in
    // arena units and cannot know that "ANNIHILATION" at 40px is 400 units wide,
    // so a chain that ends against a wall would print its reward off-screen.
    const track = q.kind === 'multi' ? 0.16 : 0.1;
    const half = vecWidth(q.text, { size, tracking: track }) * 0.5 + 14;
    const px = clamp(q.x, half, Math.max(half, view.arenaW - half));
    // Score pops are white-cored with a coloured halo rather than solid colour:
    // a cyan "+200" over a cyan strike beam is invisible at exactly the moment
    // it is meant to be read.
    const white = q.kind === 'score';
    drawVec(ctx, q.text, px, q.y, {
      size,
      weight: 0.15,
      tracking: track,
      align: 'center',
      baseline: 'mid',
      color: white ? rgba(COL.playerCore, 1) : rgba(q.col, 1),
      glow: q.kind === 'multi' ? 2 : 1.4,
      glowColor: rgba(q.col, 1),
      slant: q.kind === 'multi' ? 0.1 : 0.05,
    });
    if (q.sub) {
      drawVec(ctx, q.sub, px, q.y + size * 0.86, {
        size: size * 0.44,
        weight: 0.15,
        tracking: 0.14,
        align: 'center',
        baseline: 'mid',
        color: rgba(COL.ink, 0.85),
      });
    }
    ctx.restore();
  }
}
