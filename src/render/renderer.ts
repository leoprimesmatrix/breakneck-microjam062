import { CAM_ANCHOR, COL, MAX_TIER, PLAYER_R, VIEW_H, VIEW_W } from '../config';
import { clamp, lerp } from '../engine/math';
import type { Game } from '../game/game';

const heavy = (px: number) =>
  `800 ${px}px "Arial Narrow", "Helvetica Neue", system-ui, -apple-system, sans-serif`;

/**
 * Draw centred text shrunk to fit `maxWidth`. The font stack falls back to
 * whatever the machine has, and wider faces overflowed the canvas — so size is
 * measured rather than assumed.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  px: number,
) {
  ctx.font = heavy(px);
  const w = ctx.measureText(text).width;
  if (w > maxWidth) ctx.font = heavy(Math.max(8, Math.floor((px * maxWidth) / w)));
  ctx.fillText(text, cx, y);
}

export function render(ctx: CanvasRenderingContext2D, game: Game) {
  const p = game.player;
  const camY = game.camY;

  // Clear generously so the shake offset never exposes an unpainted edge.
  ctx.fillStyle = COL.bg;
  ctx.fillRect(-40, -40, VIEW_W + 80, VIEW_H + 80);

  ctx.save();
  ctx.translate(game.juice.offsetX(), game.juice.offsetY());

  // Camera pulls back as you accelerate. Reads as speed, and it hands you the
  // extra lookahead exactly when steering authority is lowest — the moment you
  // most need to see what's coming and least able to react to it.
  const zoom = lerp(1, 0.88, p.speedNorm);
  if (zoom !== 1) {
    const ax = VIEW_W * 0.5;
    const ay = VIEW_H * CAM_ANCHOR;
    ctx.translate(ax, ay);
    ctx.scale(zoom, zoom);
    ctx.translate(-ax, -ay);
  }

  drawSpeedLines(ctx, camY, p.speedNorm);
  drawWalls(ctx, camY, p.speedNorm);
  drawBlocks(ctx, game, camY);
  game.particles.draw(ctx, camY);
  drawTrail(ctx, game, camY);
  drawPlayer(ctx, game, camY);
  drawPopups(ctx, game, camY);

  ctx.restore();

  drawVignette(ctx, p.speedNorm);
  drawHud(ctx, game);

  if (game.state === 'title') drawTitle(ctx, game);
  else if (game.state === 'dead') drawDead(ctx, game);

  if (game.juice.flash > 0) {
    ctx.globalAlpha = clamp(game.juice.flash, 0, 1);
    ctx.fillStyle = COL.fg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- background
function drawSpeedLines(ctx: CanvasRenderingContext2D, camY: number, speedNorm: number) {
  const n = 26;
  const len = 18 + speedNorm * 210;
  ctx.strokeStyle = COL.fg;
  ctx.globalAlpha = 0.05 + speedNorm * 0.16;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    // Deterministic scatter; parallax makes the field read as depth, not noise.
    const x = ((i * 97) % VIEW_W) + ((i * 31) % 17);
    const span = VIEW_H + len + 200;
    const y = (((i * 211 + camY * 1.45) % span) + span) % span - len - 100;
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The shaft walls. The player already bounced off these boundaries but nothing
 * drew them, so the collision read as invisible. The scrolling rungs also give
 * the eye a fixed reference to measure speed against.
 */
function drawWalls(ctx: CanvasRenderingContext2D, camY: number, speedNorm: number) {
  // Mask off everything outside the shaft, so the camera pull-back reveals
  // solid wall rather than empty void where the world simply stops.
  ctx.fillStyle = COL.bg;
  ctx.fillRect(-260, -260, 260, VIEW_H + 520);
  ctx.fillRect(VIEW_W, -260, 260, VIEW_H + 520);

  ctx.fillStyle = COL.fg;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(0, -260, 3, VIEW_H + 520);
  ctx.fillRect(VIEW_W - 3, -260, 3, VIEW_H + 520);

  // Rungs every 60px of world space.
  const spacing = 60;
  const off = ((camY % spacing) + spacing) % spacing;
  ctx.globalAlpha = 0.13 + speedNorm * 0.12;
  for (let y = -off; y < VIEW_H + 60; y += spacing) {
    ctx.fillRect(3, y, 11, 2);
    ctx.fillRect(VIEW_W - 14, y, 11, 2);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- world
function drawBlocks(ctx: CanvasRenderingContext2D, game: Game, camY: number) {
  // On the title screen there is no player, so pick a mid tier: the attract
  // shaft then shows both colours and demonstrates the core read at a glance.
  const tier = game.state === 'title' ? 4 : game.player.tier;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const b of game.world.blocks) {
    if (b.dead) continue;
    const sy = b.y - camY;
    // Margins are generous because the camera pull-back widens the visible band.
    if (sy > VIEW_H + 160 || sy + b.h < -120) continue;

    // The whole world recolours as you accelerate: red is what still stops you,
    // white is what you can already destroy. Readable at a glance, at speed.
    const breakable = tier >= b.hardness;

    if (breakable) {
      ctx.fillStyle = COL.fg;
      ctx.fillRect(b.x, sy, b.w - 2, b.h - 2);
      ctx.fillStyle = COL.bg;
    } else {
      ctx.fillStyle = COL.bg;
      ctx.fillRect(b.x, sy, b.w - 2, b.h - 2);
      ctx.strokeStyle = COL.hot;
      ctx.lineWidth = b.gate ? 3 : 2;
      ctx.strokeRect(b.x + 1, sy + 1, b.w - 4, b.h - 4);
      ctx.fillStyle = COL.hot;
    }

    ctx.font = heavy(b.gate ? 26 : 22);
    ctx.fillText(String(b.hardness), b.x + b.w * 0.5 - 1, sy + b.h * 0.5);
  }
}

// ---------------------------------------------------------------- player
function drawTrail(ctx: CanvasRenderingContext2D, game: Game, camY: number) {
  const t = game.trail;
  for (let i = 0; i < t.length; i++) {
    const a = (i / t.length) ** 2 * 0.5;
    if (a < 0.02) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.fg;
    diamond(ctx, t[i].x, t[i].y - camY, PLAYER_R * (0.35 + (i / t.length) * 0.6));
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx: CanvasRenderingContext2D, game: Game, camY: number) {
  const p = game.player;
  if (game.state === 'dead') return;
  // Flicker through invulnerability so the state is unmistakable.
  if (p.iframe > 0 && Math.floor(p.iframe * 22) % 2 === 0) return;

  // Knockout halo: the player is white and so are all breakable blocks, so on a
  // dense row it vanished into the wall it was cutting through. A background-
  // coloured diamond behind it separates it from anything, on either colour.
  ctx.fillStyle = COL.bg;
  diamond(ctx, p.x, p.y - camY, PLAYER_R + 5);
  ctx.fillStyle = COL.fg;
  diamond(ctx, p.x, p.y - camY, PLAYER_R);
}

function drawPopups(ctx: CanvasRenderingContext2D, game: Game, camY: number) {
  if (game.popups.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pu of game.popups) {
    const t = pu.life / pu.max;
    ctx.globalAlpha = Math.min(1, t * 2.2); // hold, then fade out fast
    ctx.fillStyle = pu.hot ? COL.hot : COL.fg;
    ctx.font = heavy(pu.big ? 27 : 18);
    // Keep the label fully on screen even when it spawns against a wall.
    const half = ctx.measureText(pu.text).width * 0.5 + 8;
    const x = clamp(pu.x, half, VIEW_W - half);
    ctx.fillText(pu.text, x, pu.y - camY);
  }
  ctx.globalAlpha = 1;
}

/** Cheap radial darkening that tightens with speed; one draw, big atmosphere. */
function drawVignette(ctx: CanvasRenderingContext2D, speedNorm: number) {
  if (speedNorm < 0.05) return;
  const cx = VIEW_W * 0.5;
  const cy = VIEW_H * CAM_ANCHOR;
  const inner = lerp(430, 150, speedNorm);
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, 660);
  g.addColorStop(0, 'rgba(11,11,15,0)');
  g.addColorStop(1, `rgba(11,11,15,${(0.35 + speedNorm * 0.5).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.72, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.72, y);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------- hud
function drawHud(ctx: CanvasRenderingContext2D, game: Game) {
  if (game.state === 'title') return;
  const p = game.player;

  // Backdrop band: blocks stream right through this area and were colliding
  // with the readout. Fades out so it doesn't read as a hard letterbox.
  const band = ctx.createLinearGradient(0, 0, 0, 104);
  band.addColorStop(0, 'rgba(11,11,15,0.94)');
  band.addColorStop(0.72, 'rgba(11,11,15,0.82)');
  band.addColorStop(1, 'rgba(11,11,15,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, VIEW_W, 104);

  // --- speed: the biggest number on screen, because it is the damage number
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COL.fg;
  ctx.font = heavy(54);
  ctx.fillText(String(Math.round(p.kmh)), VIEW_W * 0.5, 52);
  ctx.font = heavy(13);
  ctx.globalAlpha = 0.55;
  ctx.fillText('KM/H', VIEW_W * 0.5, 68);
  ctx.globalAlpha = 1;

  // --- tier segments: how much of the world you can currently destroy
  const segW = 24;
  const segGap = 5;
  const segH = 9;
  const totalW = MAX_TIER * segW + (MAX_TIER - 1) * segGap;
  let sx = (VIEW_W - totalW) * 0.5;
  for (let i = 1; i <= MAX_TIER; i++) {
    if (i <= p.tier) {
      ctx.fillStyle = COL.fg;
      ctx.fillRect(sx, 76, segW, segH);
    } else {
      ctx.strokeStyle = COL.hot;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.strokeRect(sx + 0.5, 76.5, segW - 1, segH - 1);
      ctx.globalAlpha = 1;
    }
    sx += segW + segGap;
  }

  // --- depth
  ctx.textAlign = 'right';
  ctx.fillStyle = COL.fg;
  ctx.font = heavy(26);
  ctx.fillText(`${Math.floor(game.depth)}`, VIEW_W - 16, 38);
  ctx.font = heavy(12);
  ctx.globalAlpha = 0.55;
  ctx.fillText('METRES', VIEW_W - 16, 53);
  ctx.globalAlpha = 1;

  // --- health pips
  for (let i = 0; i < 3; i++) {
    const x = 22 + i * 20;
    ctx.fillStyle = i < p.health ? COL.fg : COL.bg;
    diamond(ctx, x, 34, 7);
    if (i >= p.health) {
      ctx.strokeStyle = COL.hot;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 34 - 7);
      ctx.lineTo(x + 5, 34);
      ctx.lineTo(x, 34 + 7);
      ctx.lineTo(x - 5, 34);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // --- chain
  if (game.chain >= 2) {
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.hot;
    ctx.font = heavy(40);
    ctx.fillText(`x${game.chain}`, 18, VIEW_H - 28);
  }
}

// ---------------------------------------------------------------- overlays
function drawTitle(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.textAlign = 'center';
  // Lighter than a blackout: the attract shaft has to stay visible behind it.
  ctx.fillStyle = COL.bg;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;

  // Solid plate behind the wordmark so it never fights a passing block.
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, VIEW_H * 0.34 - 62, VIEW_W, 108);

  // Fit the wordmark to the canvas: "Arial Narrow" is not on every machine, and
  // on the fallback face a fixed 78px overflowed and clipped the B and the K.
  ctx.fillStyle = COL.fg;
  fitText(ctx, 'BREAKNECK', VIEW_W * 0.5, VIEW_H * 0.34, VIEW_W - 34, 78);

  ctx.fillStyle = COL.hot;
  ctx.font = heavy(17);
  ctx.fillText('SPEED IS THE ONLY THING THAT CUTS', VIEW_W * 0.5, VIEW_H * 0.34 + 30);

  const lines = [
    'OUTRUN A BLOCK’S NUMBER TO SMASH THROUGH IT',
    'TOO SLOW, AND IT SMASHES YOU',
    '',
    'A / D   STEER — harder the faster you go',
    'W   TUCK, dive faster        S   BRAKE, buy back control',
  ];
  const boxTop = VIEW_H * 0.53;
  ctx.fillStyle = COL.bg;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(0, boxTop - 22, VIEW_W, lines.length * 24 + 26);
  ctx.globalAlpha = 1;

  lines.forEach((l, i) => {
    const isRule = i < 2;
    ctx.fillStyle = isRule ? COL.fg : COL.fg;
    ctx.globalAlpha = isRule ? 0.95 : 0.62;
    ctx.font = heavy(isRule ? 16 : 14);
    ctx.fillText(l, VIEW_W * 0.5, boxTop + i * 24);
  });
  ctx.globalAlpha = 1;

  if (Math.floor(performance.now() / 500) % 2 === 0) {
    ctx.fillStyle = COL.fg;
    ctx.font = heavy(20);
    ctx.fillText('PRESS ANY KEY', VIEW_W * 0.5, VIEW_H * 0.84);
  }

  if (game.best > 0) {
    ctx.fillStyle = COL.fg;
    ctx.globalAlpha = 0.5;
    ctx.font = heavy(14);
    ctx.fillText(`BEST  ${game.best}`, VIEW_W * 0.5, VIEW_H * 0.9);
    ctx.globalAlpha = 1;
  }
}

function drawDead(ctx: CanvasRenderingContext2D, game: Game) {
  ctx.textAlign = 'center';
  ctx.fillStyle = COL.bg;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.globalAlpha = 1;

  ctx.fillStyle = COL.hot;
  ctx.font = heavy(56);
  ctx.fillText('WRECKED', VIEW_W * 0.5, VIEW_H * 0.3);

  ctx.fillStyle = COL.fg;
  ctx.font = heavy(64);
  ctx.fillText(String(game.score), VIEW_W * 0.5, VIEW_H * 0.45);
  ctx.font = heavy(13);
  ctx.globalAlpha = 0.55;
  ctx.fillText('SCORE', VIEW_W * 0.5, VIEW_H * 0.45 + 20);
  ctx.globalAlpha = 1;

  ctx.font = heavy(16);
  ctx.fillText(
    `${Math.floor(game.depth)} M      BEST CHAIN x${game.bestChain}`,
    VIEW_W * 0.5,
    VIEW_H * 0.56,
  );

  if (game.isNewBest) {
    ctx.fillStyle = COL.gold;
    ctx.font = heavy(22);
    ctx.fillText('NEW BEST', VIEW_W * 0.5, VIEW_H * 0.63);
  } else {
    ctx.globalAlpha = 0.5;
    ctx.fillText(`BEST  ${game.best}`, VIEW_W * 0.5, VIEW_H * 0.63);
    ctx.globalAlpha = 1;
  }

  if (Math.floor(performance.now() / 450) % 2 === 0) {
    ctx.fillStyle = COL.fg;
    ctx.font = heavy(20);
    ctx.fillText('SPACE  —  AGAIN', VIEW_W * 0.5, VIEW_H * 0.78);
  }
}
