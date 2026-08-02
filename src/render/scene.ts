import { CAM_ANCHOR, CELL_W, COLS, PLAYER_R, VIEW_H, VIEW_W } from '../config';
import { clamp, lerp } from '../engine/math';
import { brighten, darken, mixRGB, type Palette, rgba, type RGB } from '../game/biomes';
import type { Game } from '../game/game';
import { heavy } from './type';

/**
 * The shaft interior — everything inside the 540x760 play area.
 *
 * Drawn into the post-processing scene buffer rather than the visible canvas,
 * so anything emissive here feeds the bloom pass automatically. That is the
 * whole trick behind the look: draw bright things on a near-black field and let
 * the composite turn them into light.
 */

const OD_GOLD: RGB = [255, 214, 96];

/** Palette with overdrive folded in, so no draw call has to special-case it. */
export function effectivePalette(pal: Palette, od: number): Palette {
  if (od <= 0.001) return pal;
  return {
    ...pal,
    fg: mixRGB(pal.fg, [255, 246, 214], od),
    hot: mixRGB(pal.hot, OD_GOLD, od * 0.85),
    glow: mixRGB(pal.glow, OD_GOLD, od),
  };
}

export function drawScene(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const p = game.player;
  const camY = game.camY;
  const speed = game.state === 'title' ? 0.42 : p.speedNorm;
  const od = game.od.intensity;

  ctx.fillStyle = rgba(pal.bg, 1);
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawInterior(ctx, camY, pal, speed);

  ctx.save();
  ctx.translate(game.juice.offsetX(), game.juice.offsetY());

  // Camera pulls back as you accelerate. Reads as speed, and it hands you the
  // extra lookahead exactly when steering authority is lowest — the moment you
  // most need to see what's coming and least able to react to it. The punch term
  // is the per-impact lens kick.
  const zoom = lerp(1, 0.86, speed) * (1 + game.juice.punch);
  if (zoom !== 1) {
    const ax = VIEW_W * 0.5;
    const ay = VIEW_H * CAM_ANCHOR;
    ctx.translate(ax, ay);
    ctx.scale(zoom, zoom);
    ctx.translate(-ax, -ay);
  }

  drawSpeedLines(ctx, camY, speed, pal, od);
  drawWalls(ctx, camY, speed, pal, od);
  drawBlocks(ctx, game, camY, pal, od);
  game.particles.draw(ctx, camY, pal);
  drawTrail(ctx, game, camY, pal, od);
  drawPlayer(ctx, game, camY, pal, od);
  drawPopups(ctx, game, camY, pal);

  ctx.restore();

  drawVignette(ctx, speed, pal, od);

  if (game.juice.flash > 0) {
    ctx.globalAlpha = clamp(game.juice.flash, 0, 1);
    ctx.fillStyle = od > 0.2 ? rgba(OD_GOLD, 1) : rgba(brighten(pal.fg, 0.4), 1);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- interior
/**
 * Depth strata behind the play field. The old build drew flat black here, which
 * gave the eye nothing to measure motion against except the blocks themselves —
 * so at speed the shaft read as static and the blocks read as teleporting.
 */
function drawInterior(ctx: CanvasRenderingContext2D, camY: number, pal: Palette, speed: number) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, rgba(mixRGB(pal.bg, pal.bgFar, 0.55), 1));
  g.addColorStop(0.42, rgba(pal.bg, 1));
  g.addColorStop(1, rgba(darken(pal.bg, 0.4), 1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Column guides: nine faint lanes, so the grid the world is built on is
  // legible and the player can read which lane they are actually in.
  ctx.fillStyle = rgba(pal.fg, 0.035);
  for (let c = 1; c < COLS; c++) ctx.fillRect(c * CELL_W - 0.5, 0, 1, VIEW_H);

  // Slow strata bands, far parallax.
  const pitch = 340;
  const off = ((camY * 0.32) % pitch + pitch) % pitch;
  for (let y = -off - pitch; y < VIEW_H + pitch; y += pitch) {
    const bg = ctx.createLinearGradient(0, y, 0, y + pitch * 0.5);
    bg.addColorStop(0, rgba(pal.glow, 0.055 + speed * 0.02));
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, y, VIEW_W, pitch * 0.5);
  }
}

function drawSpeedLines(
  ctx: CanvasRenderingContext2D,
  camY: number,
  speedNorm: number,
  pal: Palette,
  od: number,
) {
  const n = 34;
  const len = 22 + speedNorm * 300 + od * 70;
  ctx.strokeStyle = rgba(od > 0.2 ? OD_GOLD : pal.fg, 0.05 + speedNorm * 0.18 + od * 0.1);
  ctx.lineWidth = 1.4;
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
}

/**
 * The shaft walls. The player bounces off these boundaries, so they have to be
 * visibly solid; the scrolling rungs also give the eye a fixed reference to
 * measure speed against.
 */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  camY: number,
  speedNorm: number,
  pal: Palette,
  od: number,
) {
  // Mask off everything outside the shaft, so the camera pull-back reveals
  // solid wall rather than empty void where the world simply stops.
  ctx.fillStyle = rgba(darken(pal.bg, 0.55), 1);
  ctx.fillRect(-300, -300, 300, VIEW_H + 600);
  ctx.fillRect(VIEW_W, -300, 300, VIEW_H + 600);

  const rim = od > 0.2 ? OD_GOLD : pal.glow;
  ctx.fillStyle = rgba(rim, 0.4 + speedNorm * 0.35 + od * 0.4);
  ctx.fillRect(0, -300, 2.5, VIEW_H + 600);
  ctx.fillRect(VIEW_W - 2.5, -300, 2.5, VIEW_H + 600);

  // Inner falloff so the wall has thickness rather than being a drawn line.
  const lg = ctx.createLinearGradient(0, 0, 26, 0);
  lg.addColorStop(0, rgba(rim, 0.18));
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 26, VIEW_H);
  const rg = ctx.createLinearGradient(VIEW_W, 0, VIEW_W - 26, 0);
  rg.addColorStop(0, rgba(rim, 0.18));
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(VIEW_W - 26, 0, 26, VIEW_H);

  // Rungs every 60px of world space.
  const spacing = 60;
  const off = ((camY % spacing) + spacing) % spacing;
  ctx.fillStyle = rgba(pal.fg, 0.16 + speedNorm * 0.14);
  for (let y = -off; y < VIEW_H + 60; y += spacing) {
    ctx.fillRect(3, y, 13, 2);
    ctx.fillRect(VIEW_W - 16, y, 13, 2);
  }
}

// ------------------------------------------------------------------ blocks
function drawBlocks(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
  od: number,
) {
  // On the title screen there is no player, so pick a mid tier: the attract
  // shaft then shows both colours and demonstrates the core read at a glance.
  const tier = game.state === 'title' ? 4 : game.player.tier;
  const px = game.state === 'title' ? -999 : game.player.x;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const b of game.world.blocks) {
    if (b.dead) continue;
    const sy = b.y - camY;
    // Margins are generous because the camera pull-back widens the visible band.
    if (sy > VIEW_H + 200 || sy + b.h < -160) continue;

    // The whole world recolours as you accelerate: hot is what still stops you,
    // bright is what you can already destroy. Readable at a glance, at speed.
    const breakable = od > 0.2 || tier >= b.hardness;
    // The lane you are actually in gets a stronger edge — at speed the player
    // needs to find *their* next obstacle, not read the whole row.
    const inLane = Math.abs(px - (b.x + b.w * 0.5)) < b.w * 0.5 + PLAYER_R;

    const x = b.x + 1;
    const y = sy + 1;
    const w = b.w - 3;
    const h = b.h - 3;

    if (breakable) {
      // Emissive face: bright top, falling to a dimmer base. Reads as a lit
      // solid instead of a flat swatch, and drives the bloom.
      const base = od > 0.2 ? mixRGB(pal.fg, OD_GOLD, od) : pal.fg;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgba(brighten(base, 0.25), 1));
      g.addColorStop(0.55, rgba(base, 1));
      g.addColorStop(1, rgba(darken(base, 0.32), 1));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);

      // Bevel: a bright top edge and a dark bottom one.
      ctx.fillStyle = rgba(brighten(base, 0.6), 0.9);
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = rgba(darken(base, 0.6), 0.7);
      ctx.fillRect(x, y + h - 2, w, 2);

      if (inLane) {
        ctx.strokeStyle = rgba(brighten(pal.glow, 0.4), 0.9);
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      }

      ctx.fillStyle = rgba(darken(pal.bg, 0.2), 1);
    } else {
      // Hostile: dark body, hot frame, hazard hatching. The hatching is what
      // makes "do not touch" legible in peripheral vision at 500 km/h.
      ctx.fillStyle = rgba(darken(pal.bg, 0.25), 0.92);
      ctx.fillRect(x, y, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = rgba(pal.hot, 0.2);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = -h; i < w + h; i += 11) {
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
      }
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = rgba(pal.hot, inLane ? 1 : 0.82);
      ctx.lineWidth = b.gate ? 3 : 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Chips taken out of it show as cracks; a chipped block is a promise that
      // the wall in front of you is getting weaker, not an unwinnable dead end.
      const chips = b.maxHardness - b.hardness;
      if (chips > 0) {
        ctx.strokeStyle = rgba(brighten(pal.hot, 0.5), 0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < chips; i++) {
          const cy = y + h * (0.28 + i * 0.22);
          ctx.moveTo(x + 3, cy);
          ctx.lineTo(x + w * 0.45, cy + 4);
          ctx.lineTo(x + w - 4, cy - 3);
        }
        ctx.stroke();
      }

      ctx.fillStyle = rgba(brighten(pal.hot, 0.35), 1);
    }

    // Gates get corner brackets — a full-width wall needs to announce itself as
    // an event rather than reading as an unusually unlucky row.
    if (b.gate) {
      ctx.save();
      ctx.strokeStyle = breakable ? rgba(darken(pal.bg, 0.2), 0.8) : rgba(pal.hot, 1);
      ctx.lineWidth = 2;
      const c = 7;
      for (const [cx, cy, dx, dy] of [
        [x + 2, y + 2, 1, 1],
        [x + w - 2, y + 2, -1, 1],
        [x + 2, y + h - 2, 1, -1],
        [x + w - 2, y + h - 2, -1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * c, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * c);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.font = heavy(b.gate ? 25 : 21);
    ctx.fillText(String(b.hardness), b.x + b.w * 0.5 - 1, sy + b.h * 0.5 + 1);
  }
}

// ------------------------------------------------------------------ player
function drawTrail(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
  od: number,
) {
  const t = game.trail;
  if (t.length < 2) return;

  const col = od > 0.2 ? mixRGB(pal.fg, OD_GOLD, od) : pal.glow;
  ctx.globalCompositeOperation = 'lighter';

  // A tapering ribbon rather than a queue of diamonds: one path, and it actually
  // follows the line the player steered instead of stuttering behind them.
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.moveTo(t[0].x, t[0].y - camY);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y - camY);
    ctx.strokeStyle = rgba(col, pass === 0 ? 0.14 + od * 0.2 : 0.4 + od * 0.4);
    ctx.lineWidth = pass === 0 ? PLAYER_R * 2.1 : PLAYER_R * 0.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  game: Game,
  camY: number,
  pal: Palette,
  od: number,
) {
  const p = game.player;
  if (game.state === 'dead' || game.state === 'title') return;
  // Flicker through invulnerability so the state is unmistakable.
  if (p.iframe > 0 && Math.floor(p.iframe * 22) % 2 === 0) return;

  const x = p.x;
  const y = p.y - camY;
  const bank = p.bank;
  const core = od > 0.2 ? mixRGB(pal.fg, OD_GOLD, od) : pal.fg;

  // Thrust plume, behind the hull, additive so it blooms.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const plume = 26 + p.speedNorm * 74 + od * 60;
  const pg = ctx.createLinearGradient(0, y - PLAYER_R, 0, y - PLAYER_R - plume);
  pg.addColorStop(0, rgba(brighten(core, 0.3), 0.7 + od * 0.3));
  pg.addColorStop(0.4, rgba(pal.glow, 0.28));
  pg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.moveTo(x - PLAYER_R * 0.62, y - PLAYER_R * 0.2);
  ctx.lineTo(x - bank * 8, y - PLAYER_R - plume);
  ctx.lineTo(x + PLAYER_R * 0.62, y - PLAYER_R * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Overdrive aura.
  if (od > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ag = ctx.createRadialGradient(x, y, 0, x, y, PLAYER_R * (3 + od * 2.5));
    ag.addColorStop(0, rgba(OD_GOLD, 0.5 * od));
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.fillRect(x - 90, y - 90, 180, 180);
    ctx.restore();
  }

  // Hull: a dart that banks into its turn. The separating dark outline keeps it
  // legible when it is cutting through a row of blocks its own colour.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(bank * 0.42);

  ctx.fillStyle = rgba(darken(pal.bg, 0.5), 1);
  hull(ctx, PLAYER_R + 4.5);
  ctx.fill();

  const hg = ctx.createLinearGradient(0, -PLAYER_R, 0, PLAYER_R);
  hg.addColorStop(0, rgba(brighten(core, 0.55), 1));
  hg.addColorStop(1, rgba(core, 1));
  ctx.fillStyle = hg;
  hull(ctx, PLAYER_R);
  ctx.fill();

  // Canopy notch: gives the shape a front, so the bank is readable.
  ctx.fillStyle = rgba(darken(pal.bg, 0.3), 0.85);
  ctx.beginPath();
  ctx.moveTo(0, PLAYER_R * 0.42);
  ctx.lineTo(PLAYER_R * 0.26, -PLAYER_R * 0.1);
  ctx.lineTo(-PLAYER_R * 0.26, -PLAYER_R * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.restore();

  drawPowerBadge(ctx, game, x, y, pal, od);
}

/**
 * The player's live tier, riding beside the hull styled like a block number.
 *
 * This is the game's whole rule made visible: every block carries its number,
 * but the player's own number only existed as arithmetic inside the collision
 * check. With both numbers on screen "mine beats theirs" stops being something
 * the title screen explained and becomes something you can *see* — which is
 * most of what was confusing about the game.
 */
function drawPowerBadge(
  ctx: CanvasRenderingContext2D,
  game: Game,
  x: number,
  y: number,
  pal: Palette,
  od: number,
) {
  const p = game.player;
  // Sit on whichever side has room, so the badge never leaves the shaft.
  const side = x > VIEW_W - 64 ? -1 : 1;
  const bx = x + side * 30;
  const pop = game.tierPop;
  const s = 1 + pop * 0.45;
  const r = 13 * s;

  const dropped = pop > 0 && game.tierPopDir < 0;
  const edge = od > 0.2 ? OD_GOLD : dropped ? pal.hot : pal.glow;

  ctx.save();
  ctx.translate(bx, y);
  ctx.rotate(Math.PI * 0.25);
  ctx.fillStyle = rgba(darken(pal.bg, 0.35), 0.92);
  ctx.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
  ctx.strokeStyle = rgba(edge, 0.5 + pop * 0.5);
  ctx.lineWidth = 1.5 + pop;
  ctx.strokeRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = heavy(Math.round(14 * s));
  ctx.fillStyle = rgba(brighten(od > 0.2 ? OD_GOLD : pal.fg, 0.2), 1);
  ctx.fillText(String(p.tier), bx, y + 1);

  // Tether so the badge reads as attached to the ship, not floating debris.
  ctx.strokeStyle = rgba(edge, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + side * PLAYER_R * 0.9, y);
  ctx.lineTo(bx - side * r * 0.95, y);
  ctx.stroke();
}

/** Downward-pointing dart. Nose is +y because the player falls. */
function hull(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, r * 1.25);
  ctx.lineTo(r * 0.78, -r * 0.5);
  ctx.lineTo(r * 0.34, -r * 0.85);
  ctx.lineTo(-r * 0.34, -r * 0.85);
  ctx.lineTo(-r * 0.78, -r * 0.5);
  ctx.closePath();
}

// ------------------------------------------------------------------ popups
function drawPopups(ctx: CanvasRenderingContext2D, game: Game, camY: number, pal: Palette) {
  if (game.popups.length === 0) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pu of game.popups) {
    const t = pu.life / pu.max;
    const rise = (1 - t) * 6;
    ctx.globalAlpha = Math.min(1, t * 2.2); // hold, then fade out fast
    const col =
      pu.kind === 'fail'
        ? pal.hot
        : pu.kind === 'od'
          ? OD_GOLD
          : pu.kind === 'heal'
            ? pal.glow
            : pal.fg;
    ctx.font = heavy(pu.big ? 26 : 17);
    // Keep the label fully on screen even when it spawns against a wall.
    const half = ctx.measureText(pu.text).width * 0.5 + 8;
    const x = clamp(pu.x, half, VIEW_W - half);
    const y = pu.y - camY - rise;
    ctx.fillStyle = rgba(darken(pal.bg, 0.6), 0.75);
    ctx.fillText(pu.text, x + 2, y + 2);
    ctx.fillStyle = rgba(col, 1);
    ctx.fillText(pu.text, x, y);
  }
  ctx.globalAlpha = 1;
}

/** Radial darkening that tightens with speed; one draw, big atmosphere. */
function drawVignette(ctx: CanvasRenderingContext2D, speedNorm: number, pal: Palette, od: number) {
  const cx = VIEW_W * 0.5;
  const cy = VIEW_H * CAM_ANCHOR;
  const inner = lerp(430, 130, speedNorm);
  const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, 680);
  const edge = darken(pal.bg, 0.5);
  g.addColorStop(0, rgba(edge, 0));
  g.addColorStop(1, rgba(edge, 0.4 + speedNorm * 0.5));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Overdrive rims the frame in gold from the outside in.
  if (od > 0.02) {
    const og = ctx.createRadialGradient(cx, cy, 200, cx, cy, 640);
    og.addColorStop(0, 'rgba(0,0,0,0)');
    og.addColorStop(1, rgba(OD_GOLD, 0.3 * od));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalCompositeOperation = 'source-over';
  }
}
