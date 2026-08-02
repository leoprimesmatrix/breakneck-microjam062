import { COL, PLAYER_R, SPAWN_TELEGRAPH, rgba, type RGB } from '../config';
import { TAU, clamp, clamp01, easeOutCubic, easeOutQuint } from '../engine/math';
import { ENEMY_COL, type Game } from '../game/game';
import { ORB_R } from '../game/enemies';
import type { StrikePlan } from '../game/strike';
import { view } from '../viewport';
import { drawEnemyBody } from './bodies';
import { drawRadial, flareSprite, glowSprite, radialSprite } from './glow';
import { quality } from './quality';
import { drawPlayer } from './ship';
import { drawVec, vecWidth } from './text';

/**
 * Everything inside the arena, drawn in arena units.
 *
 * Layering is deliberate and worth stating once: the floor and its light pool
 * sit under everything; the aim preview sits *over* the enemies it is about to
 * kill, because it is a promise about them; the player sits over the preview,
 * because the player is the promise being kept.
 *
 * The floor is not wallpaper. It is built in four passes — structural plates,
 * the survey grid, the marks the fight has left on it, and the pool of light the
 * ship carries — and the reason it is worth four passes is that a room with a
 * floor you could describe is a room you believe you are standing in. The bodies
 * live in `bodies.ts` and the ship in `ship.ts`; this file is the space.
 */

const GRID = 62;
/** Structural plates: four grid cells to a plate, so the rhythms agree. */
const PLATE = GRID * 4;

/** Soft dark stain for scorch marks — the one sprite here that darkens. */
const scorchSprite = () =>
  radialSprite('scorch', [
    [0, 'rgba(0,0,0,0.85)'],
    [0.55, 'rgba(0,0,0,0.42)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

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
  // The pit's shadow falls on the *room*, and stops there. Drawn over the actors
  // it dims an enemy pinned against an edge and an aim line ending at one, which
  // trades legibility for atmosphere at exactly the moments the player is
  // reading the board hardest. Everything below this line is lit by its own
  // light and keeps it.
  drawWalls(ctx);
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

  ctx.save();
  ctx.strokeStyle = rgba(COL.gridHot, 1);
  ctx.lineWidth = 1;

  // Surround texture: long faint diagonals, drifting. Gives the void a sense of
  // scale without competing with the playfield for attention.
  ctx.globalAlpha = 0.05;
  const off = (game.clock * 9) % 160;
  ctx.beginPath();
  for (let d = -fullH; d < fullW + fullH; d += 160) {
    ctx.moveTo(-padX + d + off, -padY);
    ctx.lineTo(-padX + d + off - fullH, -padY + fullH);
  }
  ctx.stroke();

  // Strata: a few horizontal rules crossing the whole bleed, drifting the other
  // way at a different rate. Two families of line moving at two speeds is the
  // cheapest parallax there is, and it is enough to stop the surround reading as
  // a flat mat the arena was pasted onto.
  ctx.globalAlpha = 0.045;
  const drift = (game.clock * 4) % 220;
  ctx.beginPath();
  for (let y = -padY - 220 + drift; y < -padY + fullH; y += 220) {
    ctx.moveTo(-padX, y);
    ctx.lineTo(-padX + fullW, y);
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

/** Deterministic 0..1 from a cell index — the plate layout must never flicker. */
const hash = (i: number, j: number) => {
  const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * The floor's substructure: big machined plates under the survey grid, with
 * chamfered corners, recessed panels and the occasional hatched service bay.
 *
 * This is the single change that does the most for the arena's depth, and the
 * reason is that it introduces a *second* scale. A grid alone has one rhythm and
 * reads as graph paper at any size; plates four cells across, with a handful of
 * them darker than their neighbours, say that the grid was painted onto
 * something that was built first. Fifteen cells on a typical arena — it costs
 * about as much as one enemy.
 */
function drawPlates(ctx: CanvasRenderingContext2D) {
  const { arenaW, arenaH } = view;
  const cols = Math.ceil(arenaW / PLATE);
  const rows = Math.ceil(arenaH / PLATE);
  const c = PLATE * 0.14;

  ctx.save();
  // Recessed panels first: a few plates sit lower than the rest.
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (hash(i, j) > 0.28) continue;
      const x = i * PLATE + 8;
      const y = j * PLATE + 8;
      ctx.fillRect(x, y, PLATE - 16, PLATE - 16);
    }
  }

  ctx.strokeStyle = rgba(COL.grid, 0.5);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * PLATE + 8;
      const y = j * PLATE + 8;
      const w = PLATE - 16;
      const h = PLATE - 16;
      // A chamfered rectangle. The cut corner is the whole tell — a plain rect
      // is a table cell, a chamfered one was machined.
      ctx.moveTo(x + c, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h - c);
      ctx.lineTo(x + w - c, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + c);
      ctx.closePath();
    }
  }
  ctx.stroke();

  // Service hatching in a minority of plates.
  ctx.strokeStyle = rgba(COL.grid, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (hash(i + 7, j + 13) > 0.16) continue;
      const x = i * PLATE + 22;
      const y = j * PLATE + 22;
      for (let k = 0; k < 5; k++) {
        ctx.moveTo(x + k * 13, y);
        ctx.lineTo(x, y + k * 13);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Registration nodes at the major intersections — a surveyed floor has marks. */
function drawNodes(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  const p = game.player;
  ctx.save();
  ctx.strokeStyle = rgba(COL.gridHot, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = PLATE; x < arenaW; x += PLATE) {
    for (let y = PLATE; y < arenaH; y += PLATE) {
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
    }
  }
  ctx.stroke();

  // The nodes nearest the ship wake up. Nothing in the fiction says they should
  // — but a floor that responds to where the player is standing is a floor the
  // player believes is powered, and it costs one distance test per node.
  ctx.globalCompositeOperation = 'lighter';
  for (let x = PLATE; x < arenaW; x += PLATE) {
    for (let y = PLATE; y < arenaH; y += PLATE) {
      const d = Math.hypot(x - p.x, y - p.y);
      const near = clamp01(1 - d / 260);
      if (near <= 0.02) continue;
      drawRadial(ctx, glowSprite(COL.gridHot, 0.55), x, y, 9, near * near);
    }
  }
  ctx.restore();
}

/**
 * The recorder sweep. A slow radar wedge turning about the arena centre, baked
 * once into a sprite and blitted rotated — one `drawImage` a frame for the whole
 * effect, which is the only way something this large earns its place.
 *
 * It is also the one piece of set dressing that is *diegetic*: the floor already
 * says AFB RECORDER LIVE, and this is the recorder.
 */
let sweepTile: HTMLCanvasElement | null = null;
function sweepSprite() {
  if (sweepTile) return sweepTile;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = S * 0.5;
  const N = 24;
  const SPAN = 1.25;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    g.beginPath();
    g.moveTo(r, r);
    g.arc(r, r, r, -t * SPAN - SPAN / N, -t * SPAN);
    g.closePath();
    g.fillStyle = rgba(COL.gridHot, (1 - t) * (1 - t) * 0.5);
    g.fill();
  }
  // Mask the hub and the rim: a sweep that reaches all the way to the centre
  // reads as a pie chart, and one with a hard outer edge reads as a wipe.
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.22, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.72, 'rgba(0,0,0,1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  sweepTile = c;
  return c;
}

function drawSweep(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  const R = Math.hypot(arenaW, arenaH) * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(arenaW * 0.5, arenaH * 0.5);
  ctx.rotate(game.clock * 0.5);
  ctx.globalAlpha = 0.085;
  ctx.drawImage(sweepSprite(), -R, -R, R * 2, R * 2);
  // The leading edge, as an actual line. Without it the wedge alone reads as a
  // lighting mistake — a soft gradient with one straight side and no cause. A
  // hairline at the front names it: that is a beam, and it is sweeping.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(COL.gridHot, 0.13);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(R * 0.2, 0);
  ctx.lineTo(R * 0.78, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * Markings painted on the floor, like a court or a test range: a centre circle,
 * registration crosses, hazard chevrons at the mouths, an arena ID. Pure set
 * dressing — but it is exactly this kind of purposeless-looking purpose that
 * makes a space feel surveyed and built rather than generated.
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
  // Two opposed brackets outside the circle. Opened with `moveTo` each, or the
  // path would run a chord straight across the arena between them.
  ctx.beginPath();
  for (const a of [-0.5, Math.PI - 0.5] as const) {
    ctx.moveTo(cx + Math.cos(a) * 132, cy + Math.sin(a) * 132);
    ctx.arc(cx, cy, 132, a, a + 1);
  }
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

  // Hazard chevrons at the mid-point of each long wall: keep-clear markings, the
  // universal sign that something dangerous passes through here.
  ctx.strokeStyle = rgba(COL.wall, 0.09);
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (const [ox, oy, dx, dy] of [
    [cx, 34, 1, 1], [cx, arenaH - 34, 1, -1],
  ] as const) {
    for (let i = -3; i <= 3; i++) {
      const x = ox + i * 26;
      ctx.moveTo(x - 11 * dx, oy - 11 * dy);
      ctx.lineTo(x, oy);
      ctx.lineTo(x + 11 * dx, oy - 11 * dy);
    }
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

/** Slow, enormous, nearly invisible blobs of light haze. Depth for four blits. */
function drawHaze(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const t = game.clock * (0.035 + i * 0.014) + i * 2.2;
    const x = arenaW * (0.5 + Math.cos(t) * 0.42);
    const y = arenaH * (0.5 + Math.sin(t * 1.37) * 0.4);
    drawRadial(ctx, glowSprite(COL.grid, 0.5), x, y, 300 + i * 90, 0.28);
  }
  ctx.restore();
}

function drawFloor(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  const p = game.player;
  const deco = quality.current.deco;

  ctx.save();
  ctx.fillStyle = rgba(COL.floor, 1);
  ctx.fillRect(0, 0, arenaW, arenaH);

  if (deco > 0) drawPlates(ctx);
  if (deco > 1) drawHaze(ctx, game);

  // Base grid, minor and major. The 4-cell major rhythm is most of what stops
  // the floor reading as procedurally tiled wallpaper.
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(COL.grid, 0.22);
  gridPath(ctx, GRID);
  ctx.stroke();
  ctx.strokeStyle = rgba(COL.grid, 0.42);
  gridPath(ctx, PLATE);
  ctx.stroke();

  if (deco > 1) drawSweep(ctx, game);
  drawEtchings(ctx);
  if (deco > 0) drawNodes(ctx, game);
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
  // Plate seams catch the light too, a shade brighter than the grid does —
  // the structure should be more reflective than the paint on top of it.
  ctx.strokeStyle = rgba(COL.gridHot, 0.42);
  ctx.lineWidth = 1.4;
  gridPath(ctx, PLATE);
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

/**
 * A shadow gradient inside each wall, drawn *over* the playfield.
 *
 * The arena used to be a lit rectangle with a line round it, which is a page
 * with a border. Four inward gradients turn it into a pit: the floor falls away
 * into darkness at the edges, the middle stays lit, and the frame outside stops
 * reading as decoration and starts reading as the lip you would fall over.
 */
let wallGrads: CanvasGradient[] | null = null;
let wallKey = '';

function drawWalls(ctx: CanvasRenderingContext2D) {
  const { arenaW, arenaH } = view;
  const D = 58;
  const key = `${arenaW.toFixed(1)}x${arenaH.toFixed(1)}`;
  if (wallKey !== key || !wallGrads) {
    const mk = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    };
    wallGrads = [
      mk(0, 0, 0, D),
      mk(0, arenaH, 0, arenaH - D),
      mk(0, 0, D, 0),
      mk(arenaW, 0, arenaW - D, 0),
    ];
    wallKey = key;
  }

  ctx.save();
  const [top, bottom, left, right] = wallGrads;
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, arenaW, D);
  ctx.fillStyle = bottom;
  ctx.fillRect(0, arenaH - D, arenaW, D);
  ctx.fillStyle = left;
  ctx.fillRect(0, 0, D, arenaH);
  ctx.fillStyle = right;
  ctx.fillRect(arenaW - D, 0, D, arenaH);
  ctx.restore();
}

/**
 * A slow parallax field of motes in three depth layers; deterministic, so it
 * never pops on resize. The layers differ in size, speed and brightness
 * together — vary only one and the field reads as noise at one distance.
 */
function drawDust(ctx: CanvasRenderingContext2D, game: Game) {
  const { arenaW, arenaH } = view;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 66; i++) {
    const seed = i * 12.9898;
    const fx = frac(Math.sin(seed) * 43758.5453);
    const fy = frac(Math.sin(seed * 1.7) * 21451.19);
    const layer = i % 3;
    const depth = 0.4 + layer * 0.3;
    const spd = (6 + fx * 16) * depth;
    const x = (fx * arenaW + Math.sin(game.clock * 0.3 * depth + fy * 9) * 14 * depth + arenaW) % arenaW;
    const y = (fy * arenaH + game.clock * spd) % arenaH;
    ctx.fillStyle = rgba(COL.gridHot, (0.05 + fy * 0.1) * depth);
    const s = (0.9 + fx * 1.4) * depth;
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

/**
 * Arrival. Three brackets closing on a point, a stencil painted on the floor
 * underneath, and the body fading up inside all of it — the sequence resolves
 * exactly as the thing becomes solid, so "it is now dangerous" is a visual event
 * rather than a rule the player has to have learned.
 */
function drawSpawns(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of game.swarm.list) {
    if (!e.alive || e.spawn <= 0) continue;
    const t = clamp01(1 - e.spawn / SPAWN_TELEGRAPH);
    const col = ENEMY_COL[e.kind];
    const ease = easeOutCubic(t);
    const r = e.r * (4.2 - 3.2 * ease);

    // Floor stencil: a dashed ring marking the ground it is claiming.
    ctx.setLineDash([9, 11]);
    ctx.lineDashOffset = -game.clock * 40;
    ctx.strokeStyle = rgba(col, 0.3 * (1 - t * 0.4));
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 2.9, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = rgba(col, 0.16 + t * 0.5);
    ctx.lineWidth = 1 + t * 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.stroke();

    // Three brackets rotating inward as they close. Each arc has to be opened
    // with a `moveTo`: consecutive `arc` calls in one path are joined by a
    // straight line from where the last one ended, which turns three separate
    // brackets into one closed rounded triangle.
    ctx.strokeStyle = rgba(col, 0.7);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (1 - t) * 2.4 + (i / 3) * TAU;
      const br = r * 1.16;
      ctx.moveTo(e.x + Math.cos(a) * br, e.y + Math.sin(a) * br);
      ctx.arc(e.x, e.y, br, a, a + 0.5);
    }
    ctx.stroke();

    // A sweeping arc that completes exactly as the enemy becomes solid.
    ctx.strokeStyle = rgba(col, 0.8);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 1.7, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();

    // The arrival flash, in the last fifth.
    const pop = clamp01((t - 0.82) / 0.18);
    if (pop > 0) drawRadial(ctx, flareSprite(col, 0.9), e.x, e.y, e.r * (1.4 + pop * 2), 1 - pop);

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
 * Orbs. A hot core inside a cage, with three ghosts strung out behind it along
 * its own velocity — a projectile has to look like it is *travelling*, and a
 * circle with a tail is the shortest way to say so.
 */
function drawOrbs(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.save();
  for (const o of game.swarm.orbs) {
    if (!o.alive) continue;
    const pulse = 1 + Math.sin(o.age * 9) * 0.12;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 3; i >= 1; i--) {
      const k = i * 0.022;
      drawRadial(
        ctx, glowSprite(COL.spine, 0.4), o.x - o.vx * k, o.y - o.vy * k,
        ORB_R * (2.2 - i * 0.35), 0.34 - i * 0.07,
      );
    }
    drawRadial(ctx, flareSprite(COL.spine, 0.85), o.x, o.y, ORB_R * 2.4);
    ctx.globalCompositeOperation = 'source-over';

    // The cage: two arcs with gaps, counter-spinning, so it reads as a shell
    // holding something in rather than as a bubble.
    ctx.strokeStyle = rgba(COL.spine, 0.95);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const a = o.age * 5 + i * Math.PI;
      const cr = ORB_R * pulse;
      ctx.moveTo(o.x + Math.cos(a) * cr, o.y + Math.sin(a) * cr);
      ctx.arc(o.x, o.y, cr, a, a + 2.2);
    }
    ctx.stroke();
    ctx.fillStyle = rgba(COL.playerCore, 0.9);
    ctx.beginPath();
    ctx.arc(o.x, o.y, ORB_R * 0.32, 0, TAU);
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

  // The line leaves from the *nose*, not from the middle of the ship. It used to
  // start at the player's centre, which was invisible when the player was a flat
  // chevron and is fatal now that there is an airframe there: a white 3px dash
  // running down the fuselage erases the entire front half of it. Starting ahead
  // of the hull is also simply more truthful — the strike begins where the ship
  // ends — and it costs two multiplications.
  const nose = Math.min(PLAYER_R * 3, plan.dist * 0.45);
  const x0 = plan.x0 + plan.dx * nose;
  const y0 = plan.y0 + plan.dy * nose;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // Ghost of the full potential reach, behind the live line.
  if (!plan.blocked) {
    const gx = plan.x0 + plan.dx * plan.reach;
    const gy = plan.y0 + plan.dy * plan.reach;
    ctx.strokeStyle = rgba(COL.strike, 0.07 * focusA);
    ctx.lineWidth = PLAYER_R * 2.2;
    line(ctx, x0, y0, gx, gy);
  }

  // Body of the line.
  ctx.strokeStyle = rgba(COL.strike, 0.14 * focusA);
  ctx.lineWidth = PLAYER_R * 1.9;
  line(ctx, x0, y0, ex, ey);

  ctx.strokeStyle = rgba(COL.strike, 0.5 * focusA);
  ctx.lineWidth = 2.4;
  line(ctx, x0, y0, ex, ey);

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
  line(ctx, x0, y0, ex, ey);
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
    // A second, shorter bracket inboard of the first: real hardware is layered.
    ctx.moveTo(cx + dx * (L * 0.42), cy + dy * 9);
    ctx.lineTo(cx + dx * 9, cy + dy * 9);
    ctx.lineTo(cx + dx * 9, cy + dy * (L * 0.42));
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
