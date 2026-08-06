import { rgba, type RGB } from '../config';
import { camera } from '../engine/camera';
import type { Game } from '../game/game';
import { theme } from '../sectors';
import { view } from '../viewport';
import { drawRadial, glowSprite } from './glow';
import { quality } from './quality';

/**
 * The place the arena is standing in.
 *
 * Before this module the game had six rooms that differed by five RGB triples
 * and a handful of booleans; measured, the widest pair of sectors differed by
 * 12% of one channel, and swapping the entire backdrop system changed under 1%
 * of the pixels on screen. The cause was structural rather than artistic: the
 * old surround texture drew ~24 hairlines at 4% alpha into a letterbox border,
 * and the floor was painted opaque over everything else.
 *
 * So this file draws in three places instead of one:
 *
 *   `drawFar`    full-bleed, behind the arena, in the surround. The horizon.
 *   `drawUnder`  inside the arena, *beneath* the deck — seen through apertures.
 *   `drawOver`   inside the arena, in front of the deck, behind the actors.
 *
 * `drawUnder` is the one that matters. A background confined to the surround is
 * a picture frame; putting the room's identity under the player's feet is what
 * makes the middle of the screen belong to a sector. It is legible because the
 * apertures read as **light from below** rather than as holes — terrain is the
 * thing with a lit top cap and a `theme.wall` outline, and nothing here has
 * either.
 *
 * Every layer takes its parallax from `camera`, which never moves the
 * playfield. Nothing in this file is collidable, solvable, or visible to
 * `solveStrike`; it is scenery, and if it all stopped drawing the game would
 * play identically.
 */

export type SceneId = 'hall' | 'outage' | 'furnace' | 'scaffold' | 'breach' | 'storm';
/** Which holes the deck has. `none` skips the under-layer entirely. */
export type Aperture = 'none' | 'slots' | 'grate' | 'tiles' | 'tears';

/** Layer depths. 1 is the playfield, so it never moves; see `engine/camera`. */
const FAR = 0.12;
const MID = 0.38;
const OVER = 1.32;

/** Deterministic value noise. Same frame twice is the same picture, always. */
const hash = (i: number, j: number, s = 0) => {
  const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// --------------------------------------------------------------------- flashes
/**
 * The two rooms that light themselves.
 *
 * Both are pure functions of the clock rather than events pushed from the
 * simulation. Rendering must not be able to change what happens — and as a
 * bonus a replayed frame flashes identically, which is what makes the
 * screenshot tests in `tools/harness` mean anything.
 */
function strobe(clock: number, period: number, seedOff: number) {
  const n = Math.floor(clock / period);
  const t = clock - n * period;
  // Which cycles fire at all, and how hard, both come out of the same hash so
  // the pattern is irregular instead of metronomic.
  const roll = hash(n, seedOff, 3.1);
  if (roll > 0.62) return 0;
  const dur = 0.16 + roll * 0.22;
  if (t > dur) return 0;
  const k = 1 - t / dur;
  // Two quick strikes rather than one, which is what actually reads as arcing.
  const stutter = t < dur * 0.22 ? 1 : t < dur * 0.3 ? 0.35 : 1;
  return k * k * stutter * (0.5 + roll);
}

// ------------------------------------------------------------------- far layer
/** Full-bleed, behind the arena. Drawn in the surround's coordinate space. */
export function drawFar(ctx: CanvasRenderingContext2D, game: Game) {
  const deco = quality.current.deco;
  if (deco < 1) return;

  ctx.save();
  camera.applyLayer(ctx, FAR);
  switch (theme.scene) {
    case 'hall':
      farHall(ctx, game);
      break;
    case 'outage':
      farOutage(ctx, game);
      break;
    case 'furnace':
      farFurnace(ctx, game);
      break;
    case 'scaffold':
      farScaffold(ctx, game);
      break;
    case 'breach':
      farBreach(ctx, game);
      break;
    case 'storm':
      farStorm(ctx, game);
      break;
  }
  ctx.restore();

  if (deco < 2) return;
  ctx.save();
  camera.applyLayer(ctx, MID);
  switch (theme.scene) {
    case 'hall':
      midHall(ctx, game);
      break;
    case 'outage':
      midOutage(ctx, game);
      break;
    case 'furnace':
      midFurnace(ctx, game);
      break;
    case 'scaffold':
      midScaffold(ctx, game);
      break;
    case 'breach':
      midBreach(ctx, game);
      break;
    case 'storm':
      midStorm(ctx, game);
      break;
  }
  ctx.restore();
}

/** The full-bleed rect, grown by a layer's maximum travel so no edge shows. */
function bleed(depth: number) {
  const s = camera.slack(depth);
  return {
    x: -view.padX - s,
    y: -view.padY - s,
    w: view.fullW + s * 2,
    h: view.fullH + s * 2,
  };
}

// THE RANGE — a calibration hall. Steel ribs receding to a lit service horizon.
function farHall(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  const horizon = b.y + b.h * 0.36;

  const gr = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  gr.addColorStop(0, rgba(theme.void, 0));
  gr.addColorStop(0.3, rgba(mix(theme.void, theme.grid, 0.5), 0.5));
  gr.addColorStop(0.38, rgba(theme.gridHot, 0.16));
  gr.addColorStop(0.46, rgba(mix(theme.void, theme.grid, 0.3), 0.35));
  gr.addColorStop(1, rgba(theme.void, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // A far wall of service bays: a skyline of dark blocks against that band.
  ctx.fillStyle = rgba(theme.void, 0.92);
  const step = 96;
  for (let x = b.x, i = 0; x < b.x + b.w; x += step, i++) {
    const h = 34 + hash(i, 2, 1.7) * 120;
    ctx.fillRect(x, horizon - h, step - 7, h);
  }
  // Lamp strip along the top of the bays, the one warm-ish accent in the room.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let x = b.x, i = 0; x < b.x + b.w; x += step, i++) {
    if (hash(i, 5, 2.3) > 0.55) continue;
    const h = 34 + hash(i, 2, 1.7) * 120;
    drawRadial(ctx, glowSprite(theme.gridHot, 0.5), x + step * 0.5, horizon - h, 54, 0.2);
  }
  ctx.restore();
}

function midHall(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(MID);
  // Gantry ribs marching across the bleed, drifting slowly. Two families at two
  // scales gives the surround a sense of how big the room is.
  ctx.save();
  ctx.strokeStyle = rgba(theme.wall, 0.1);
  ctx.lineWidth = 7;
  const pitch = 300;
  const off = (game.clock * 5) % pitch;
  ctx.beginPath();
  for (let x = b.x + off - pitch; x < b.x + b.w + pitch; x += pitch) {
    ctx.moveTo(x, b.y);
    ctx.lineTo(x, b.y + b.h);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(theme.wall, 0.055);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = b.x + off - pitch; x < b.x + b.w + pitch; x += pitch) {
    ctx.moveTo(x + 26, b.y);
    ctx.lineTo(x + 26, b.y + b.h);
  }
  ctx.stroke();
  ctx.restore();
}

// BLACKOUT — the grid has failed. One beacon still turns, and the room arcs.
function farOutage(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  // Dead cable runs, barely there. The dark has to have something in it or the
  // sector reads as an unfinished room rather than an unlit one.
  ctx.save();
  ctx.strokeStyle = rgba(theme.grid, 0.3);
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const y = b.y + b.h * (0.14 + i * 0.18) + hash(i, 9, 4.4) * 40;
    const sag = 40 + hash(i, 3, 1.1) * 90;
    ctx.beginPath();
    ctx.moveTo(b.x, y);
    ctx.quadraticCurveTo(b.x + b.w * 0.5, y + sag, b.x + b.w, y + hash(i, 7, 2.2) * 30);
    ctx.stroke();
  }
  ctx.restore();

  // Arc flash: for a fraction of a second the whole room is visible.
  const arc = strobe(game.clock, 3.4, 11);
  if (arc > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba([150, 190, 255], 0.16 * arc);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

function midOutage(ctx: CanvasRenderingContext2D, game: Game) {
  // The emergency beacon. A wedge of amber sweeping the surround is the single
  // most legible way to say "the power is out and something is still running".
  const cx = -view.padX + view.fullW * 0.5;
  const cy = -view.padY + view.fullH * 0.5;
  const a = game.clock * 0.7;
  const R = Math.max(view.fullW, view.fullH) * 0.9;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const ang = a + i * Math.PI;
    const g2 = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    g2.addColorStop(0, rgba([255, 176, 74], 0.11));
    g2.addColorStop(1, rgba([255, 176, 74], 0));
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang - 0.16, ang + 0.16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// THE FOUNDRY — a working pit. The heat is below you, the machines are behind.
function farFurnace(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  const horizon = b.y + b.h * 0.44;

  const gr = ctx.createLinearGradient(0, b.y, 0, horizon + 120);
  gr.addColorStop(0, rgba(theme.void, 0));
  gr.addColorStop(0.72, rgba([70, 20, 8], 0.55));
  gr.addColorStop(1, rgba([190, 62, 16], 0.3));
  ctx.fillStyle = gr;
  ctx.fillRect(b.x, b.y, b.w, b.h * 0.62);

  // Stacks and cranes, dead black against the glow.
  ctx.fillStyle = rgba([8, 4, 3], 0.95);
  for (let i = 0; i < 9; i++) {
    const x = b.x + ((i + hash(i, 1, 5.5) * 0.6) / 9) * b.w;
    const w = 30 + hash(i, 4, 2.9) * 66;
    const h = 90 + hash(i, 6, 3.3) * 210;
    ctx.fillRect(x, horizon - h, w, h);
    // A gantry arm off the taller ones.
    if (h > 210) ctx.fillRect(x - 44, horizon - h + 22, w + 88, 13);
  }
  // The pour line: a hot horizontal seam the stacks stand on.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const seam = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 34);
  seam.addColorStop(0, rgba([255, 120, 40], 0));
  seam.addColorStop(0.45, rgba([255, 150, 60], 0.4));
  seam.addColorStop(1, rgba([255, 90, 24], 0));
  ctx.fillStyle = seam;
  ctx.fillRect(b.x, horizon - 26, b.w, 60);
  ctx.restore();
}

function midFurnace(ctx: CanvasRenderingContext2D, game: Game) {
  // Smoke columns rising off the pour line.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const t = game.clock * (0.05 + i * 0.014) + i * 2.1;
    const x = -view.padX + view.fullW * (0.5 + Math.cos(t * 0.6 + i) * 0.42);
    const y = -view.padY + view.fullH * (0.42 - ((t * 0.06) % 1) * 0.4);
    drawRadial(ctx, glowSprite([120, 46, 20], 0.35), x, y, 300 + i * 90, 0.1);
  }
  ctx.restore();
}

// THE LATTICE — orthogonal scaffold receding to a point. The only room with a
// real vanishing point, which is most of why it feels unlike the other five.
function farScaffold(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  const cx = -view.padX + view.fullW * 0.5;
  const cy = -view.padY + view.fullH * 0.5;

  const gr = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(b.w, b.h) * 0.6);
  gr.addColorStop(0, rgba([26, 54, 120], 0.55));
  gr.addColorStop(1, rgba(theme.void, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // Concentric rectangles scaled toward the centre: a corridor of frames. The
  // scale sequence drifts, so the whole thing reads as travelling inward.
  ctx.save();
  ctx.strokeStyle = rgba(theme.gridHot, 0.2);
  const RINGS = 9;
  const drift = (game.clock * 0.06) % 1;
  for (let i = 0; i < RINGS; i++) {
    const k = Math.pow(0.72, i + drift);
    ctx.globalAlpha = 0.26 * k + 0.03;
    ctx.lineWidth = 1 + k * 2.4;
    ctx.strokeRect(cx - b.w * 0.5 * k, cy - b.h * 0.5 * k, b.w * k, b.h * k);
  }
  ctx.restore();
}

function midScaffold(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(MID);
  const cx = -view.padX + view.fullW * 0.5;
  const cy = -view.padY + view.fullH * 0.5;
  // Four beams running to the vanishing point, tying the frames together.
  ctx.save();
  ctx.strokeStyle = rgba(theme.gridHot, 0.11);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [sx, sy] of [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ]) {
    ctx.moveTo(sx, sy);
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Data running the beams, outward. Small, bright, and the only moving light.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const t = ((game.clock * 0.22 + hash(i, 3, 6.1)) % 1) ** 2.2;
    const corner = i % 4;
    const sx = corner === 0 || corner === 2 ? b.x : b.x + b.w;
    const sy = corner < 2 ? b.y : b.y + b.h;
    const x = cx + (sx - cx) * t;
    const y = cy + (sy - cy) * t;
    drawRadial(ctx, glowSprite([160, 200, 255], 0.7), x, y, 10 + t * 26, 0.5 * t);
  }
  ctx.restore();
}

// THE DERELICT — the hull is open and the sky is cold.
function farBreach(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  // Starfield. Dead simple, deterministic, and the only genuinely cold light in
  // the six rooms — which is exactly why this sector reads as abandoned.
  ctx.save();
  for (let i = 0; i < 150; i++) {
    const x = b.x + hash(i, 1, 8.2) * b.w;
    const y = b.y + hash(i, 2, 9.4) * b.h;
    const m = hash(i, 3, 1.5);
    const tw = 0.55 + 0.45 * Math.sin(game.clock * (0.6 + m) + i);
    ctx.fillStyle = rgba([200, 214, 240], (0.12 + m * 0.5) * tw);
    const s = m > 0.93 ? 2.4 : 1.3;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();

  // The torn hull, framing them. Everything below the tear is ship.
  ctx.fillStyle = rgba([9, 10, 13], 0.97);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y + b.h);
  ctx.lineTo(b.x, b.y + b.h * 0.42);
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const y = b.y + b.h * (0.42 + Math.sin(t * 7.1) * 0.05 + hash(i, 4, 3.9) * 0.09);
    ctx.lineTo(b.x + b.w * t, y);
  }
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.closePath();
  ctx.fill();
}

function midBreach(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(MID);
  // Cables hanging from the tear, swinging on a long slow period.
  ctx.save();
  ctx.strokeStyle = rgba([46, 50, 58], 0.85);
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const x = b.x + (0.06 + hash(i, 5, 7.7) * 0.9) * b.w;
    const top = b.y + b.h * (0.3 + hash(i, 6, 2.4) * 0.12);
    const len = 90 + hash(i, 7, 5.2) * 210;
    const sway = Math.sin(game.clock * (0.25 + hash(i, 8, 1.9) * 0.2) + i) * 22;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + sway * 0.5, top + len * 0.6, x + sway, top + len);
    ctx.stroke();
  }
  ctx.restore();

  // One strip light left alive, stuttering.
  const f = strobe(game.clock, 2.1, 21);
  if (f > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const x = -view.padX + view.fullW * 0.22;
    const y = -view.padY + view.fullH * 0.3;
    drawRadial(ctx, glowSprite([216, 200, 150], 0.5), x, y, 260, 0.24 * f);
    ctx.restore();
  }
}

// THE CRUCIBLE — weather the walls are keeping out, and not entirely.
function farStorm(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(FAR);
  const gr = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  gr.addColorStop(0, rgba([56, 8, 12], 0.75));
  gr.addColorStop(0.55, rgba([24, 5, 8], 0.5));
  gr.addColorStop(1, rgba([70, 12, 10], 0.6));
  ctx.fillStyle = gr;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // Cloud masses. Big, soft, slow — weather, not architecture.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const t = game.clock * (0.016 + i * 0.007) + i * 1.9;
    const x = -view.padX + view.fullW * (0.5 + Math.cos(t) * 0.56);
    const y = -view.padY + view.fullH * (0.34 + Math.sin(t * 0.77 + i) * 0.3);
    drawRadial(ctx, glowSprite([180, 44, 30], 0.34), x, y, 340 + i * 110, 0.11);
  }
  ctx.restore();

  // Lightning, behind the cloud, lighting it from within.
  const lit = strobe(game.clock, 4.1, 31);
  if (lit > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const n = Math.floor(game.clock / 4.1);
    const x = -view.padX + view.fullW * (0.15 + hash(n, 2, 6.6) * 0.7);
    const y = -view.padY + view.fullH * 0.24;
    drawRadial(ctx, glowSprite([255, 214, 190], 0.75), x, y, 460, 0.4 * lit);
    ctx.fillStyle = rgba([255, 190, 160], 0.07 * lit);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.restore();
  }
}

function midStorm(ctx: CanvasRenderingContext2D, game: Game) {
  const b = bleed(MID);
  // Rain-shadow streaks, steeply angled and very faint.
  ctx.save();
  ctx.strokeStyle = rgba([255, 130, 110], 0.05);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const pitch = 150;
  const off = (game.clock * 190) % pitch;
  for (let x = b.x - b.h; x < b.x + b.w + pitch; x += pitch) {
    ctx.moveTo(x + off, b.y);
    ctx.lineTo(x + off - b.h * 0.42, b.y + b.h);
  }
  ctx.stroke();
  ctx.restore();
}

// ----------------------------------------------------------------- under layer
/**
 * What is below the deck, drawn in arena space immediately before the floor
 * that will cover most of it. Only the apertures let it through.
 */
export function drawUnder(ctx: CanvasRenderingContext2D, game: Game) {
  if (theme.aperture === 'none') return;
  const { arenaW, arenaH } = view;

  // Every under-layer starts near-black on purpose.
  //
  // The first version of this pass filled each hole with a flat bright colour,
  // and the result was not depth: the crucible grew a scatter of glowing red
  // diamonds the same hue as a hostile, and the lattice's glass panels became
  // indistinguishable from its terrain pillars. A hole is not a bright shape.
  // A hole is a dark recess with light a long way down it — so the base is
  // almost black, the light is a narrow feature inside it, and `apertureRim`
  // below puts a shadow on the lip.
  switch (theme.scene) {
    case 'furnace': {
      ctx.fillStyle = rgba([14, 5, 3], 1);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const y = arenaH * (0.24 + i * 0.26) + Math.sin(game.clock * 0.21 + i) * 26;
        const g2 = ctx.createLinearGradient(0, y - 34, 0, y + 34);
        g2.addColorStop(0, rgba([200, 60, 14], 0));
        g2.addColorStop(0.5, rgba([255, 132, 44], 0.62));
        g2.addColorStop(1, rgba([200, 60, 14], 0));
        ctx.fillStyle = g2;
        ctx.fillRect(0, y - 34, arenaW, 68);
      }
      ctx.restore();
      break;
    }
    case 'scaffold': {
      ctx.fillStyle = rgba([4, 7, 17], 1);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cx = arenaW * 0.5;
      const cy = arenaH * 0.5;
      const g2 = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(arenaW, arenaH) * 0.55);
      g2.addColorStop(0, rgba([34, 74, 180], 0.3));
      g2.addColorStop(1, rgba([8, 16, 48], 0));
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.restore();
      break;
    }
    case 'breach': {
      // Nothing under a derelict but vacuum and one failing circuit.
      ctx.fillStyle = rgba([3, 4, 6], 1);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const f = 0.3 + 0.7 * strobe(game.clock, 1.7, 41);
      ctx.fillStyle = rgba([54, 74, 104], 0.12 * f);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.restore();
      break;
    }
    case 'storm': {
      ctx.fillStyle = rgba([15, 3, 4], 1);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.5 + 0.5 * Math.sin(game.clock * 0.8);
      ctx.fillStyle = rgba([190, 44, 30], 0.1 + pulse * 0.12);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.restore();
      break;
    }
    default: {
      // The range: cold service lighting down in the inspection trenches.
      ctx.fillStyle = rgba([7, 10, 18], 1);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(theme.gridHot, 0.16);
      ctx.fillRect(0, 0, arenaW, arenaH);
      ctx.restore();
      break;
    }
  }
}

/**
 * Darken the lip of every hole.
 *
 * This is what turns a shape into an opening. Stroked centred on the aperture
 * path, so half the width falls inside the hole and half on the deck around it,
 * which is exactly the soft occlusion a real recess has. Without it the fill
 * reads as a decal lying on the floor — and in the lattice, as another pillar.
 */
export function apertureRim(ctx: CanvasRenderingContext2D, holes: Path2D) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.62)';
  ctx.lineWidth = 7;
  ctx.stroke(holes);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2.5;
  ctx.stroke(holes);
  ctx.restore();
}

/**
 * The room's own light, falling on its own deck.
 *
 * This is the pass that actually separates the six rooms, and it exists because
 * the first attempt did not. With a horizon in the surround and light coming up
 * through apertures, the widest pair of sectors moved from 29.5 to 41.3 — but
 * the *closest* pair, the range and the derelict, only went 7.2 to 8.7. The
 * arena interior is three quarters of the screen, the apertures are a few
 * percent of it, and the surround is a border: none of them touch the part of
 * the picture the player is actually looking at.
 *
 * A lighting design does. A hard-edged slab of starlight through a hull tear,
 * a beacon sweeping the deck, heat coming off a grate — each covers a large
 * area, none of it is tint, and all of it says which room this is.
 *
 * Drawn over the floor and under the grid, so the survey lines still read
 * across it, and kept low-contrast so it never competes with a body.
 */
export function drawCast(ctx: CanvasRenderingContext2D, game: Game) {
  if (quality.current.deco < 1) return;
  const { arenaW, arenaH } = view;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  switch (theme.scene) {
    case 'hall': {
      // Overhead service lamps in a row, pooling on the deck.
      // The range is the one room that is *supposed* to be well lit — it is a
      // calibration hall, not a ruin — and leaning into that is what separates
      // it from the derelict without either of them changing hue.
      for (let i = 0; i < 4; i++) {
        const x = arenaW * (0.16 + i * 0.226);
        const y = arenaH * (i % 2 ? 0.34 : 0.66);
        drawRadial(ctx, glowSprite(theme.gridHot, 0.34), x, y, 300, 0.2);
      }
      break;
    }
    case 'outage': {
      // The beacon, on the floor. The room is black, so a moving wedge of amber
      // crossing the deck is the only architecture the sector has — and it is
      // the same beacon the surround is showing, at the same angle.
      const a = game.clock * 0.7;
      const cx = arenaW * 0.5;
      const cy = arenaH * 0.5;
      const R = Math.hypot(arenaW, arenaH);
      for (let i = 0; i < 2; i++) {
        const ang = a + i * Math.PI;
        const gr = ctx.createRadialGradient(cx, cy, 10, cx, cy, R);
        gr.addColorStop(0, rgba([255, 168, 70], 0.1));
        gr.addColorStop(1, rgba([255, 150, 60], 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, ang - 0.13, ang + 0.13);
        ctx.closePath();
        ctx.fill();
      }
      const arc = strobe(game.clock, 3.4, 11);
      if (arc > 0) {
        ctx.fillStyle = rgba([150, 190, 255], 0.13 * arc);
        ctx.fillRect(0, 0, arenaW, arenaH);
      }
      break;
    }
    case 'furnace': {
      // Heat coming off the channels, broad and low.
      for (let i = 0; i < 3; i++) {
        const y = arenaH * (0.24 + i * 0.26) + Math.sin(game.clock * 0.21 + i) * 26;
        const gr = ctx.createLinearGradient(0, y - 130, 0, y + 130);
        gr.addColorStop(0, rgba([255, 96, 26], 0));
        gr.addColorStop(0.5, rgba([255, 112, 34], 0.065));
        gr.addColorStop(1, rgba([255, 96, 26], 0));
        ctx.fillStyle = gr;
        ctx.fillRect(0, y - 130, arenaW, 260);
      }
      break;
    }
    case 'scaffold': {
      // Light down the gaps between beams: hard vertical bands, cold.
      const P = 124;
      for (let i = 1; i * P < arenaW; i++) {
        if (hash(i, 0, 30.1 + theme.plateSeed) > 0.34) continue;
        const x = i * P;
        const gr = ctx.createLinearGradient(x - 46, 0, x + 46, 0);
        gr.addColorStop(0, rgba([70, 130, 255], 0));
        gr.addColorStop(0.5, rgba([84, 148, 255], 0.1));
        gr.addColorStop(1, rgba([70, 130, 255], 0));
        ctx.fillStyle = gr;
        ctx.fillRect(x - 46, 0, 92, arenaH);
      }
      break;
    }
    case 'breach': {
      // Starlight through the tear: one hard-edged slab lying across the deck,
      // drifting as the wreck turns. The most distinctive shape in the game.
      const skew = arenaH * 0.5;
      const w = arenaW * 0.3;
      const x = arenaW * (0.5 + Math.sin(game.clock * 0.045) * 0.24);
      const gr = ctx.createLinearGradient(x - w * 0.5, 0, x + w * 0.5, 0);
      gr.addColorStop(0, rgba([120, 150, 205], 0));
      gr.addColorStop(0.5, rgba([140, 170, 225], 0.13));
      gr.addColorStop(1, rgba([120, 150, 205], 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, 0);
      ctx.lineTo(x + w * 0.5, 0);
      ctx.lineTo(x + w * 0.5 + skew, arenaH);
      ctx.lineTo(x - w * 0.5 + skew, arenaH);
      ctx.closePath();
      ctx.fill();

      // The one strip light that still works, stuttering over the deck.
      const f = strobe(game.clock, 2.1, 21);
      if (f > 0) {
        drawRadial(
          ctx,
          glowSprite([216, 200, 150], 0.4),
          arenaW * 0.22,
          arenaH * 0.3,
          320,
          0.16 * f,
        );
      }
      break;
    }
    case 'storm': {
      const pulse = 0.5 + 0.5 * Math.sin(game.clock * 0.8);
      ctx.fillStyle = rgba([190, 44, 30], 0.022 + pulse * 0.022);
      ctx.fillRect(0, 0, arenaW, arenaH);
      // Lightning reaches the floor, on the same schedule as the sky.
      const lit = strobe(game.clock, 4.1, 31);
      if (lit > 0) {
        ctx.fillStyle = rgba([255, 200, 175], 0.085 * lit);
        ctx.fillRect(0, 0, arenaW, arenaH);
      }
      break;
    }
  }

  ctx.restore();
}

/**
 * The deck's holes, as a path the caller both fills and rims.
 *
 * Returned rather than added to the current path so one construction serves
 * three jobs: the `evenodd` fill that cuts them out of the deck, the rim stroke
 * that gives them a lip, and nothing else — they are never collided against.
 *
 * Coverage is kept deliberately small. Every hole is somewhere a body might
 * later stand, and light under a body is the one thing the palette rule will
 * not survive.
 */
export function aperturePath(game: Game): Path2D | null {
  if (theme.aperture === 'none') return null;
  const { arenaW, arenaH } = view;
  // Rooms can share a recipe, and an unseeded hash would give them identical
  // rips in identical places — the precise failure this stage exists to undo.
  const seed = theme.plateSeed;
  const p = new Path2D();

  switch (theme.aperture) {
    case 'grate': {
      // Slots over the molten channels. Two bands of five, not three of
      // thirteen: the first pass lit most of the foundry floor and the room
      // came out a single blown-out orange with the actors lost inside it.
      for (let i = 0; i < 3; i++) {
        const y = arenaH * (0.24 + i * 0.26) + Math.sin(game.clock * 0.21 + i) * 26;
        for (let k = -2; k <= 2; k++) {
          const sy = y + k * 15;
          if (sy < 6 || sy > arenaH - 6) continue;
          p.rect(arenaW * 0.1, sy, arenaW * 0.8, 4);
        }
      }
      break;
    }
    case 'tiles': {
      // Sparse glass panels, inset well within their cell so they never square
      // up with a pillar's footprint.
      const P = 124;
      for (let i = 1; i * P < arenaW - P * 0.5; i++) {
        for (let j = 1; j * P < arenaH - P * 0.5; j++) {
          if (hash(i, j, 12.5 + seed) > 0.14) continue;
          p.rect(i * P + 20, j * P + 20, P - 40, P - 40);
        }
      }
      break;
    }
    case 'tears': {
      // Irregular rips following no grid at all — which is what makes a floor
      // read as damaged rather than designed.
      for (let i = 0; i < 7; i++) {
        const x = 70 + hash(i, 1, 15.1 + seed) * (arenaW - 140);
        const y = 70 + hash(i, 2, 16.3 + seed) * (arenaH - 140);
        const w = 20 + hash(i, 3, 17.7 + seed) * 58;
        const h = 11 + hash(i, 4, 18.9 + seed) * 26;
        p.moveTo(x, y);
        p.lineTo(x + w * 0.6, y - h * 0.4);
        p.lineTo(x + w, y + h * 0.2);
        p.lineTo(x + w * 0.45, y + h);
        p.closePath();
      }
      break;
    }
    default: {
      // Narrow inspection trenches, on the arena's long axis.
      const n = 4;
      for (let i = 0; i < n; i++) {
        const y = arenaH * ((i + 1) / (n + 1));
        p.rect(arenaW * 0.12, y - 3, arenaW * 0.76, 6);
      }
      break;
    }
  }
  return p;
}

// ------------------------------------------------------------------ over layer
/**
 * In front of the deck, behind the actors.
 *
 * Behind the actors is a deliberate ceiling on this layer: foreground drifting
 * over an enemy would be atmosphere bought with legibility, and the one rule
 * the palette has is that nothing in the environment competes with a body.
 */
export function drawOver(ctx: CanvasRenderingContext2D, game: Game) {
  if (quality.current.deco < 2) return;
  const { arenaW, arenaH } = view;

  ctx.save();
  camera.applyLayer(ctx, OVER);
  ctx.globalCompositeOperation = 'lighter';

  if (theme.scene === 'furnace') {
    // Embers, rising and dying.
    for (let i = 0; i < 26; i++) {
      const life = (game.clock * 0.16 + hash(i, 1, 21.3)) % 1;
      const x = hash(i, 2, 22.7) * arenaW + Math.sin(game.clock * 0.6 + i) * 22;
      const y = arenaH * (1.05 - life * 1.15);
      const a = Math.sin(life * Math.PI) * 0.5;
      drawRadial(ctx, glowSprite([255, 150, 66], 0.8), x, y, 5 + life * 9, a);
    }
  } else if (theme.scene === 'storm') {
    // Ash, falling and drifting.
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 34; i++) {
      const life = (game.clock * 0.1 + hash(i, 1, 23.9)) % 1;
      const x = hash(i, 2, 24.1) * arenaW + Math.sin(game.clock * 0.3 + i * 2) * 40;
      const y = life * arenaH;
      ctx.fillStyle = rgba([90, 60, 58], 0.3 * Math.sin(life * Math.PI));
      const s = 1.4 + hash(i, 3, 25.5) * 2.6;
      ctx.fillRect(x, y, s, s * 1.6);
    }
  } else if (theme.scene === 'breach') {
    // Debris, tumbling in vacuum: no gravity, so it drifts sideways.
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 16; i++) {
      const life = (game.clock * 0.045 + hash(i, 1, 26.2)) % 1;
      const x = life * (arenaW + 200) - 100;
      const y = hash(i, 2, 27.4) * arenaH + Math.sin(game.clock * 0.2 + i) * 26;
      ctx.fillStyle = rgba([120, 128, 142], 0.22 * Math.sin(life * Math.PI));
      const s = 2 + hash(i, 3, 28.6) * 4;
      ctx.fillRect(x, y, s, s);
    }
  }

  ctx.restore();
}
