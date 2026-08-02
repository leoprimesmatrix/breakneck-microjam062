import {
  CHAIN_TIMEOUT,
  INTRO_TIME,
  MAX_TIER,
  VIEW_H,
  VIEW_W,
  ZONE_CARD_TIME,
  ZONE_DEPTH,
} from '../config';
import { clamp, lerp, smoothstep } from '../engine/math';
import { brighten, darken, type Palette, rgba } from '../game/biomes';
import type { Game } from '../game/game';
import { body, drawTracked, heavy, mono, trackedWidth } from './type';

/**
 * Heads-up display, drawn on the visible canvas *after* the scene composite, so
 * it stays crisp instead of being smeared by the bloom pass it would otherwise
 * be part of.
 *
 * On a wide window most telemetry lives out in the flanks (see `surround.ts`)
 * and this stays deliberately sparse. When there is no room for flanks — phones,
 * the itch.io embed — the essentials fold back in here.
 */

const OD_GOLD = [255, 214, 96] as const;

export function drawHud(
  ctx: CanvasRenderingContext2D,
  game: Game,
  pal: Palette,
  compact: boolean,
) {
  // Play only. The results screen carries its own numbers, and leaving the live
  // readout underneath means the score is on screen twice at different sizes.
  if (game.state !== 'play') return;
  const od = game.od;

  // Top scrim so streaming blocks never collide with the readout.
  const band = ctx.createLinearGradient(0, 0, 0, 116);
  band.addColorStop(0, rgba(darken(pal.bg, 0.3), 0.92));
  band.addColorStop(0.65, rgba(darken(pal.bg, 0.3), 0.6));
  band.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, VIEW_W, 116);

  drawHealth(ctx, game, pal);
  drawScore(ctx, game, pal);
  drawDepth(ctx, game, pal);
  if (compact) drawCompactSpeed(ctx, game, pal);
  drawChain(ctx, game, pal);
  if (od.active) drawOverdriveBanner(ctx, game);
  else if (od.charge > 0.62) drawChargeHint(ctx, game);
  drawGateWarning(ctx, game, pal);
  drawZoneCard(ctx, game, pal);
  drawIntro(ctx, game, pal);
  if (game.isFirstRun) drawTutorial(ctx, game, pal);
}

// ------------------------------------------------------------------- intro
/**
 * The goal, stated at the moment the player can act on it. "What am I supposed
 * to be doing?" was the game's most common failure, and the answer — go deep,
 * the next zone is the target — was only ever implied. Runs open slowly enough
 * now (V_START + calibration stretch) that there is time to read this.
 */
function drawIntro(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.introT <= 0) return;
  const t = game.introT / INTRO_TIME; // 1 -> 0
  const a = clamp(Math.min((1 - t) / 0.12, t / 0.22), 0, 1);
  // Below the camera anchor: the ship (and its new POWER badge) sit at ~0.36,
  // and the first draft parked the goal text directly on top of both.
  const y = VIEW_H * 0.52;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = mono(10);
  ctx.fillStyle = rgba(pal.glow, 0.85);
  drawTracked(ctx, `ZONE 1 — ${game.zoneCardName}`, VIEW_W * 0.5, y - 40, 3);

  ctx.font = heavy(30);
  ctx.fillStyle = rgba(brighten(pal.fg, 0.25), 1);
  drawTracked(ctx, 'GO DEEP', VIEW_W * 0.5, y - 6, 5);

  ctx.font = body(14);
  ctx.fillStyle = rgba(pal.fg, 0.75);
  ctx.fillText(`reach ZONE 2 at ${ZONE_DEPTH}m — smash what you outrun`, VIEW_W * 0.5, y + 24);

  if (game.isFirstRun) {
    const pulse = 0.6 + Math.sin(game.od.pulse * 6) * 0.4;
    ctx.globalAlpha = a * pulse;
    ctx.font = heavy(15);
    ctx.fillStyle = rgba(pal.glow, 1);
    drawTracked(ctx, 'HOLD  W  TO DIVE', VIEW_W * 0.5, y + 54, 3);
  }
  ctx.restore();
}

// ------------------------------------------------------------ gate warning
/**
 * Gates are full-width walls with no gap — fair as a skill check, unfair as an
 * ambush. Call the wall and its number before it arrives, coloured by whether
 * the player currently clears it, and the check becomes a decision (tuck now,
 * or brake and eat the chain loss) instead of a surprise.
 */
function drawGateWarning(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.gateDist <= 0 || game.gateDist > 55) return;
  const p = game.player;
  const ok = game.od.active || p.tier >= game.gateHard;
  // A failing readout blinks; a passing one holds steady.
  if (!ok && Math.floor(game.od.pulse * 7) % 3 === 0) return;

  const y = VIEW_H * 0.29;
  const col = ok ? pal.glow : pal.hot;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = mono(10);
  ctx.fillStyle = rgba(col, 0.8);
  drawTracked(ctx, `GATE  ${Math.round(game.gateDist)}m`, VIEW_W * 0.5, y - 16, 3);

  ctx.font = heavy(19);
  ctx.fillStyle = rgba(brighten(col, 0.25), 1);
  drawTracked(
    ctx,
    ok ? `POWER ${p.tier} — CLEARS ${game.gateHard}` : `NEED POWER ${game.gateHard}`,
    VIEW_W * 0.5,
    y + 6,
    2.5,
  );
  ctx.restore();
}

// ------------------------------------------------------------------ pieces
function drawHealth(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const p = game.player;
  for (let i = 0; i < 3; i++) {
    const x = 24 + i * 22;
    const y = 30;
    const on = i < p.health;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI * 0.25);
    if (on) {
      ctx.fillStyle = rgba(brighten(pal.fg, 0.2), 1);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.fillStyle = rgba(pal.glow, 0.55);
      ctx.fillRect(-3, -3, 6, 6);
    } else {
      ctx.strokeStyle = rgba(pal.hot, 0.75);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-6, -6, 12, 12);
    }
    ctx.restore();
  }
  ctx.font = mono(9);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = rgba(pal.fg, 0.4);
  ctx.fillText('HULL', 17, 44);
}

function drawScore(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = heavy(40);
  ctx.fillStyle = rgba(pal.fg, 1);
  drawTracked(ctx, String(game.score), VIEW_W * 0.5, 42, 1);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  drawTracked(ctx, 'SCORE', VIEW_W * 0.5, 56, 2.4);
}

function drawDepth(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = heavy(24);
  ctx.fillStyle = rgba(pal.fg, 0.95);
  ctx.fillText(`${Math.floor(game.depth)}m`, VIEW_W - 18, 34);
  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.glow, 0.85);
  ctx.fillText(game.zoneCardName, VIEW_W - 18, 48);

  // The standing goal, always in the corner: how far to the next chapter.
  const toNext = Math.max(0, (game.zone + 1) * ZONE_DEPTH - Math.floor(game.depth));
  ctx.fillStyle = rgba(pal.fg, 0.45);
  ctx.fillText(`ZONE ${game.zone + 2} IN ${toNext}m`, VIEW_W - 18, 62);
}

/** Folded back in when the window is too narrow for flank telemetry. */
function drawCompactSpeed(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const p = game.player;
  const kmh = String(Math.round(p.kmh));

  // Number and unit measured and laid out as one centred group. Pinning the
  // unit at a fixed offset put it on top of any three-digit speed.
  ctx.font = heavy(30);
  const numW = ctx.measureText(kmh).width;
  ctx.font = mono(8);
  const labW = trackedWidth(ctx, 'KM/H', 1.5);
  const x0 = VIEW_W * 0.5 - (numW + 7 + labW) * 0.5;

  ctx.textAlign = 'left';
  ctx.font = heavy(30);
  ctx.fillStyle = rgba(pal.fg, 1);
  ctx.fillText(kmh, x0, 88);
  ctx.font = mono(8);
  ctx.fillStyle = rgba(pal.fg, 0.45);
  drawTracked(ctx, 'KM/H', x0 + numW + 7, 88, 1.5, 'left');
  ctx.textAlign = 'center';

  const segW = 22;
  const gap = 4;
  const total = MAX_TIER * segW + (MAX_TIER - 1) * gap;
  let sx = (VIEW_W - total) * 0.5;
  for (let i = 1; i <= MAX_TIER; i++) {
    const on = i <= p.tier;
    ctx.fillStyle = on ? rgba(pal.fg, 0.95) : rgba(pal.hot, 0.28);
    ctx.fillRect(sx, 96, segW, 6);
    sx += segW + gap;
  }

  // Name the ladder. Unlabelled segments read as decoration; "POWER 6" ties
  // them to the badge on the ship and the numbers on the blocks.
  ctx.font = mono(9);
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(pal.fg, 0.55);
  drawTracked(ctx, `POWER ${p.tier}`, VIEW_W * 0.5, 112, 2);
}

function drawChain(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.chain < 2) return;
  const y = VIEW_H - 40;
  const t = clamp(game.chainTimer / CHAIN_TIMEOUT, 0, 1);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Scale bumps on each increment then settles — the number should feel struck.
  const pop = 1 + clamp(t - 0.82, 0, 1) * 1.4;
  ctx.save();
  ctx.translate(22, y);
  ctx.scale(pop, pop);
  ctx.font = heavy(38);
  ctx.fillStyle = rgba(brighten(pal.glow, 0.35), 1);
  ctx.fillText(`×${game.chain}`, 0, 0);
  ctx.restore();

  ctx.font = mono(9);
  ctx.fillStyle = rgba(pal.fg, 0.4);
  ctx.fillText('CHAIN', 24, y + 14);

  // Drain bar: the chain's remaining life, so lapsing is never a surprise.
  ctx.fillStyle = rgba(pal.fg, 0.12);
  ctx.fillRect(22, y + 20, 96, 3);
  ctx.fillStyle = rgba(t < 0.3 ? pal.hot : pal.glow, 0.95);
  ctx.fillRect(22, y + 20, 96 * t, 3);
}

function drawOverdriveBanner(ctx: CanvasRenderingContext2D, game: Game) {
  const od = game.od;
  const pulse = 0.72 + Math.sin(od.pulse * 18) * 0.28;
  const y = VIEW_H * 0.195;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Time remaining reads as a draining bar under the word.
  ctx.font = heavy(34);
  ctx.fillStyle = rgba(OD_GOLD, pulse);
  drawTracked(ctx, 'OVERDRIVE', VIEW_W * 0.5, y, 6);

  const w = 220;
  ctx.fillStyle = rgba(OD_GOLD, 0.2);
  ctx.fillRect((VIEW_W - w) * 0.5, y + 22, w, 4);
  ctx.fillStyle = rgba(OD_GOLD, 0.95);
  ctx.fillRect((VIEW_W - w) * 0.5, y + 22, w * od.t, 4);
  ctx.restore();
}

/** Builds anticipation before the meter fills — the reward has to be seen coming. */
function drawChargeHint(ctx: CanvasRenderingContext2D, game: Game) {
  const c = game.od.charge;
  const a = smoothstep((c - 0.62) / 0.38);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = mono(11);
  ctx.globalAlpha = a * (0.5 + Math.sin(game.od.pulse * 9) * 0.5);
  ctx.fillStyle = rgba(OD_GOLD, 1);
  drawTracked(ctx, c >= 0.999 ? 'OVERDRIVE READY' : 'OVERDRIVE CHARGING', VIEW_W * 0.5, VIEW_H * 0.195, 3);
  ctx.restore();
}

// -------------------------------------------------------------- zone card
/**
 * Chapter title. Wipes in from the centre, holds, wipes out — the run gets
 * punctuation, and the player learns the shaft has named places in it.
 */
function drawZoneCard(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  if (game.zoneCard <= 0) return;
  const t = game.zoneCard / ZONE_CARD_TIME;
  // In over the first 18%, out over the last 25%.
  const a = clamp(Math.min((1 - t) / 0.18, t / 0.25), 0, 1);
  const wipe = smoothstep(clamp((1 - t) / 0.18, 0, 1));
  // Below the player, not on top of it. At the camera anchor the card was
  // landing directly over the hull at the exact moment the shaft changes
  // character — the one moment the player most needs to see where they are.
  const y = VIEW_H * 0.62;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = lerp(0, VIEW_W * 0.86, wipe);
  ctx.fillStyle = rgba(darken(pal.bg, 0.55), 0.95);
  ctx.fillRect((VIEW_W - w) * 0.5, y - 46, w, 92);
  ctx.fillStyle = rgba(pal.glow, 0.9);
  ctx.fillRect((VIEW_W - w) * 0.5, y - 46, w, 2);
  ctx.fillRect((VIEW_W - w) * 0.5, y + 44, w, 2);

  if (wipe > 0.55) {
    const ta = smoothstep((wipe - 0.55) / 0.45);
    ctx.globalAlpha = a * ta;
    ctx.font = mono(11);
    ctx.fillStyle = rgba(pal.glow, 1);
    drawTracked(ctx, `ZONE ${game.zone + 1}`, VIEW_W * 0.5, y - 24, 4);

    ctx.font = heavy(34);
    ctx.fillStyle = rgba(brighten(pal.fg, 0.2), 1);
    drawTracked(ctx, game.zoneCardName, VIEW_W * 0.5, y + 4, 2);

    ctx.font = mono(10);
    ctx.fillStyle = rgba(pal.fg, 0.55);
    drawTracked(ctx, game.zoneCardSub, VIEW_W * 0.5, y + 30, 2);
  }
  ctx.restore();
}

// --------------------------------------------------------------- tutorial
/**
 * First run only. Four beats, each anchored to the depth at which it first
 * matters, teaching the read rather than describing the controls. Ranges are
 * timed to the slow opening: the first beat lands as the intro card fades, the
 * POWER beat lands inside the calibration stretch while everything is still
 * soft, and the danger beat lands right as the first real formations arrive.
 */
const BEATS: { from: number; to: number; text: string }[] = [
  // The intro card already says HOLD W, so the beats start after it has faded
  // (~200m) — never two instructions on screen at once.
  { from: 230, to: 350, text: 'YOUR SHIP’S NUMBER IS YOUR POWER — IT SMASHES BLOCKS IT BEATS' },
  { from: 360, to: 480, text: 'RED BLOCKS BEAT YOUR POWER — STEER  A / D  OR GET FASTER' },
  { from: 540, to: 660, text: 'S BRAKES — SAFER, BUT IT KILLS YOUR CHAIN' },
];

function drawTutorial(ctx: CanvasRenderingContext2D, game: Game, pal: Palette) {
  const d = game.depth;
  const beat = BEATS.find((b) => d >= b.from && d < b.to);
  if (!beat) return;
  const span = beat.to - beat.from;
  const local = (d - beat.from) / span;
  const a = clamp(Math.min(local / 0.12, (1 - local) / 0.2), 0, 1);

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = VIEW_H * 0.76;

  ctx.font = body(14);
  const w = ctx.measureText(beat.text).width + 44;
  ctx.fillStyle = rgba(darken(pal.bg, 0.5), 0.8);
  ctx.fillRect((VIEW_W - w) * 0.5, y - 17, w, 34);
  ctx.fillStyle = rgba(pal.glow, 0.7);
  ctx.fillRect((VIEW_W - w) * 0.5, y - 17, 3, 34);

  ctx.fillStyle = rgba(brighten(pal.fg, 0.1), 1);
  ctx.fillText(beat.text, VIEW_W * 0.5, y);
  ctx.restore();
}
