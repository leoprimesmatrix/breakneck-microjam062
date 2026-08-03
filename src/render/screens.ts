import { COL, rgba } from '../config';
import { angleDelta, clamp, clamp01, easeOutCubic, easeOutExpo, easeOutQuint } from '../engine/math';
import { ENEMY_COL, RANKS, pad, type Game } from '../game/game';
import { SPECS } from '../game/enemies';
import { view } from '../viewport';
import { drawRadial, flareSprite } from './glow';
import { drawEnemyIcon, group } from './hud';
import { drawShip } from './ship';
import { IS_TOUCH, drawUI, drawVec, fitVec, uiWidth, vecWidth } from './text';

/**
 * Front-of-house: title, pause, results.
 *
 * All three are staged — nothing appears at once. A results screen that lands
 * one line at a time gives the player a beat to read each number, and it turns
 * the two seconds after a death from an interruption into a curtain call.
 */

const stage = (t: number, start: number, dur: number) =>
  easeOutQuint(clamp01((t - start) / dur));

// ------------------------------------------------------------------- socials
/**
 * The developer's handles, drawn as one measured, centred unit with real vector
 * marks rather than pasted logos: a bare "@name" floats with no home, and a
 * bitmap logo would be the only non-vector thing in the game. Each mark is
 * simple enough to survive ten pixels — the X is two strokes, the camera is a
 * rounded square, a ring and a dot — and both are drawn in the game's own dim
 * ink so the plate reads as part of the colophon, not as an advert.
 */
function drawSocials(ctx: CanvasRenderingContext2D, cx: number, y: number, S: number, alpha: number) {
  if (alpha <= 0.002) return;
  const size = 10 * S;
  const st = { size, weight: 700, tracking: 1.9 * S } as const;
  const H1 = '@PRIMEDEVV';
  const H2 = 'OFFICIALPRIMEDEV';
  const icon = 11 * S;
  const gap = 6 * S;
  const sep = 26 * S;
  const w1 = uiWidth(ctx, H1, st);
  const w2 = uiWidth(ctx, H2, st);
  let total = icon + gap + w1 + sep + icon + gap + w2;
  const k = Math.min(1, (view.w * 0.94) / total);
  total *= k;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx - total * 0.5, y);
  ctx.scale(k, k);
  ctx.strokeStyle = rgba(COL.dim, 0.95);
  ctx.fillStyle = rgba(COL.dim, 0.95);
  ctx.lineCap = 'round';

  // X: two crossing strokes, the second broken to read as the wordmark and not
  // as a multiplication sign.
  ctx.lineWidth = 1.8 * S;
  const xr = icon * 0.36;
  ctx.beginPath();
  ctx.moveTo(-xr, -xr);
  ctx.lineTo(xr, xr);
  ctx.moveTo(xr, -xr);
  ctx.lineTo(xr * 0.18, -xr * 0.18);
  ctx.moveTo(-xr * 0.18, xr * 0.18);
  ctx.lineTo(-xr, xr);
  ctx.stroke();
  drawUI(ctx, H1, icon * 0.5 + gap, 0.5, { ...st, color: rgba(COL.dim, 1) });

  // Instagram: rounded square, lens ring, indicator dot.
  ctx.translate(icon + gap + w1 + sep, 0);
  const ir = icon * 0.46;
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  ctx.roundRect(-ir, -ir, ir * 2, ir * 2, ir * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, ir * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ir * 0.52, -ir * 0.52, 1.1 * S, 0, Math.PI * 2);
  ctx.fill();
  drawUI(ctx, H2, icon * 0.5 + gap, 0.5, { ...st, color: rgba(COL.dim, 1) });
  ctx.restore();
}

// -------------------------------------------------------------- now playing
/**
 * The soundtrack readout.
 *
 * It appears on the title and pause screens and nowhere else. During a run the
 * HUD already owns both gutters — hull and score along the top, focus and chain
 * along the bottom, hints through the middle of the lower edge — and a plate
 * that has to dodge the focus bar on one window shape and the chain counter on
 * another is a plate that lands on top of one of them eventually. The two
 * moments a player is actually reading the screen are the two it shows up on.
 *
 * The meter bars are the only moving part, and they stop when the game is
 * muted, so the readout never claims to be playing something you cannot hear.
 */
function drawNowPlaying(
  ctx: CanvasRenderingContext2D,
  game: Game,
  x: number,
  y: number,
  S: number,
  centred: boolean,
  alpha: number,
) {
  const name = game.audio.tracks.nowPlaying;
  if (!name || alpha <= 0.002) return;

  const st = { size: 9.5 * S, weight: 600, tracking: 2.4 * S } as const;
  const text = `NOW PLAYING  ·  ${name}`;
  const barW = 1.7 * S;
  const barGap = 1.6 * S;
  const meterW = barW * 3 + barGap * 2;
  const gap = 8 * S;
  const total = meterW + gap + uiWidth(ctx, text, st);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(centred ? x - total * 0.5 : x, y);

  // Three bars on offset phases. Held at a floor rather than allowed to reach
  // zero: a bar that vanishes reads as a gap in a dotted line, not as a meter.
  const live = !game.audio.isMuted;
  ctx.fillStyle = rgba(COL.focus, 0.7);
  const h = 9 * S;
  for (let i = 0; i < 3; i++) {
    const p = live ? 0.5 + 0.5 * Math.sin(game.clock * (5.1 + i * 1.7) + i * 2.1) : 0.35;
    const bh = h * (0.28 + 0.72 * p);
    ctx.fillRect(i * (barW + barGap), -bh, barW, bh);
  }

  drawUI(ctx, text, meterW + gap, 0, { ...st, color: rgba(COL.dim, 0.85) });
  ctx.restore();
}

// ----------------------------------------------------------------- standby
/**
 * Everything before the player's first gesture.
 *
 * The title's cold open is a flashbulb written to land on the soundtrack's
 * first beat, and a browser will not let a page make a sound until someone has
 * interacted with it — so the bang waits here rather than going off in silence
 * on load. See `Game.arm`.
 *
 * The screen earns its keep rather than merely stalling. It is the one place
 * in the game where "turn your sound on" can be said to somebody who has not
 * started playing yet, which for a jam entry is worth more than the second it
 * costs: most players never hear a browser game's audio at all. And it makes
 * the bang land harder — the room is held at almost black right up until the
 * frame it ignites.
 */
function drawStandby(ctx: CanvasRenderingContext2D, game: Game) {
  const S = clamp(view.h / 860, 0.6, 1.5);
  const cx = view.w * 0.5;
  const cy = view.h * 0.48;
  const t = game.standbyTime;

  // Held dark from the first frame rather than faded down into it. Watching the
  // room dim *before* being asked to click reads as something going wrong, and
  // the darker this screen sits the further the cold open has to travel when it
  // finally goes off.
  scrim(ctx, 0.94);

  // Everything fades up together, a beat after the room has gone dark, so the
  // screen does not arrive already fully formed on the first frame.
  ctx.save();
  ctx.globalAlpha = stage(t, 0.25, 0.7);

  drawUI(ctx, 'AFTERBURN', cx, cy - 42 * S, {
    size: 12 * S,
    weight: 700,
    tracking: 9 * S,
    align: 'center',
    color: rgba(COL.dim, 0.9),
    maxWidth: view.w * 0.9,
  });

  const rw = Math.min(200 * S, view.w * 0.5);
  ctx.fillStyle = rgba(COL.wall, 0.5);
  ctx.fillRect(cx - rw * 0.5, cy - 28 * S, rw, 1 * S);

  // The prompt breathes; while the first note is being waited on it holds
  // steady instead, so the screen visibly acknowledges the click even on the
  // rare occasion the wait is long enough to see.
  const waiting = game.arming;
  const pulse = waiting ? 0.85 : 0.6 + 0.4 * Math.sin(game.clock * 3.2);
  const prompt = waiting ? 'STAND BY' : IS_TOUCH ? 'TAP TO IGNITE' : 'CLICK TO IGNITE';
  ctx.save();
  ctx.globalAlpha *= pulse;
  drawVec(ctx, prompt, cx, cy + 14 * S, {
    size: fitVec(prompt, view.w * 0.8, 40 * S, 0.2),
    weight: 0.12,
    tracking: 0.2,
    align: 'center',
    baseline: 'mid',
    color: rgba(COL.ink, 1),
    glow: 1.2,
    glowColor: rgba(COL.strike, 1),
    slant: 0.08,
  });
  ctx.restore();

  // Clear of the prompt's glow, not just of its glyphs.
  drawUI(ctx, 'HEADPHONES ON  ·  THIS ONE HAS A SOUNDTRACK', cx, cy + 68 * S, {
    size: 10 * S,
    weight: 600,
    tracking: 3 * S,
    align: 'center',
    color: rgba(COL.focus, 0.7),
    maxWidth: view.w * 0.92,
  });

  ctx.restore();
}

export function drawScreens(ctx: CanvasRenderingContext2D, game: Game) {
  if (game.state === 'title') (game.armed ? drawTitle : drawStandby)(ctx, game);
  else if (game.state === 'paused') drawPause(ctx, game);
  else if (game.state === 'dead') drawResults(ctx, game);
}

function scrim(ctx: CanvasRenderingContext2D, a: number) {
  const g = ctx.createRadialGradient(
    view.w * 0.5, view.h * 0.5, 0,
    view.w * 0.5, view.h * 0.5, Math.max(view.w, view.h) * 0.72,
  );
  g.addColorStop(0, rgba(COL.void, a * 0.86));
  g.addColorStop(1, rgba(COL.void, Math.min(1, a * 1.06)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

// --------------------------------------------------------------------- title
/**
 * The cold open.
 *
 * A title screen that fades up is a title screen nobody watches. This one
 * *arrives*: the first frame the game ever shows is pure white, the shutter is
 * closed over it, and both get out of the way in under two thirds of a second
 * while the wordmark slams down to size through a chromatic split that converges
 * on it. Then a second, smaller pop at the moment it lands, and two shockwaves
 * off the mark.
 *
 * All of it is driven off `titleTime` and none of it touches the simulation, so
 * it costs one function and a handful of full-screen fills that are only ever
 * paid in the first second of the process's life.
 */
interface Intro {
  /** 0..1 white-out over the finished frame. */
  flash: number;
  /** 0..1 how closed the letterbox shutter still is. */
  bars: number;
  /** 0..1 how far the wordmark still has to fall. Drives scale and chroma. */
  punch: number;
}

function titleIntro(t: number): Intro {
  // Held for three frames at full, then a squared decay. A linear fade reads as
  // a dissolve; this reads as a flashbulb.
  //
  // Clamp *before* the exponent, not after: a negative base to a fractional
  // power is NaN in JS, and `Math.max(0, NaN)` is NaN rather than 0. It happened
  // to be harmless here because the draw is guarded by `> 0.002`, which NaN
  // fails — but a value that silently turns into NaN a third of a second into
  // every session is not something to leave lying around.
  const blast = t < 0.05 ? 1 : clamp01(1 - (t - 0.05) / 0.36) ** 2.2;
  // The landing pop, timed to the moment the mark stops moving. Short and low:
  // it is punctuation on the slam, and anything longer just leaves a grey wash
  // sitting over the first half of the ship's approach.
  const land = clamp01(1 - Math.abs(t - 0.36) / 0.09) ** 2;
  return {
    flash: Math.max(blast, land * 0.42),
    bars: 1 - easeOutQuint(clamp01(t / 0.66)),
    punch: 1 - easeOutQuint(clamp01((t - 0.06) / 0.56)),
  };
}

/** Full-width streaks tearing across the frame as the shutter opens. */
function introStreaks(ctx: CanvasRenderingContext2D, t: number) {
  const p = clamp01((t - 0.04) / 0.6);
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const seed = (i * 0.137) % 1;
    const y = view.h * (0.08 + seed * 0.84);
    const life = clamp01((p - seed * 0.32) / 0.42);
    if (life <= 0 || life >= 1) continue;
    const len = view.w * (0.3 + seed * 0.5);
    const x = -len + easeOutQuint(life) * (view.w + len * 2);
    const g = ctx.createLinearGradient(x, 0, x + len, 0);
    g.addColorStop(0, rgba(COL.strike, 0));
    g.addColorStop(0.8, rgba(COL.strike, (1 - life) * 0.5));
    g.addColorStop(1, rgba(COL.playerCore, (1 - life) * 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, len, 1 + seed * 2.4);
  }
  ctx.restore();
}

/** `titleTime` at which the ship enters frame, and at which it comes to rest. */
const SHIP_IN = 0.3;
const SHIP_LAND = 1.25;

const bez = (a: number, b: number, c: number, d: number, u: number) => {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
};
const bezD = (a: number, b: number, c: number, d: number, u: number) => {
  const v = 1 - u;
  return 3 * v * v * (b - a) + 6 * v * u * (c - b) + 3 * u * u * (d - c);
};

/**
 * The ship's arrival.
 *
 * It enters off the right at speed, sweeps left beneath the wordmark, banks
 * back through the bottom of the curve and settles into the break in the rule —
 * where it stays, as the mark's emblem. Everything after it keys off the
 * landing, so the title screen assembles itself *around the ship* rather than
 * the ship being one more thing that fades in.
 *
 * The emblem was previously a little hand-drawn chevron. Using the real
 * airframe costs nothing (`drawShip` already takes a position and a size) and
 * means the thing sitting in the maker's mark is the thing you are about to fly.
 *
 * The trail is spindles rather than ghost copies of the hull, and that is not a
 * shortcut: the hull's plates are opaque dark, so a fading ship leaves a *dark*
 * smear across the wordmark it is passing over. Light-only afterimages are both
 * correct and what the ship leaves in the arena anyway.
 */
function drawApproach(
  ctx: CanvasRenderingContext2D,
  game: Game,
  cx: number,
  ruleY: number,
  S: number,
) {
  const t = game.titleTime;
  if (t < SHIP_IN) return;

  const R = 10 * S;
  // Smoothstep, not an ease-out. An ease-out spends nine tenths of the flight in
  // the first fifth of the time — the swoop is over before the eye finds it, and
  // the rest is a crawl. Smoothstep accelerates in, holds a readable speed
  // across the middle, and comes to a stop at the break, which is the whole
  // brief: fly around, then get stuck there.
  const k0 = clamp01((t - SHIP_IN) / (SHIP_LAND - SHIP_IN));
  const u = k0 * k0 * (3 - 2 * k0);
  const landed = t >= SHIP_LAND;
  const restY = ruleY + 0.75 * S;

  // Controls that pull hard past the ends, so a single cubic bends into an S:
  // in from the right, all the way across to the left, down under the mark, then
  // back right and level into the break. The final control sits *left* of the
  // rest point on purpose — that is what makes it arrive nose-first pointing
  // right, which is the direction the emblem has to sit.
  const PX = [cx + view.w * 0.9, cx - view.w * 0.85, cx - view.w * 0.55, cx] as const;
  const PY = [
    ruleY - view.h * 0.3, ruleY - view.h * 0.3, ruleY + view.h * 0.28, restY,
  ] as const;
  const px = (k: number) => bez(PX[0], PX[1], PX[2], PX[3], k);
  const py = (k: number) => bez(PY[0], PY[1], PY[2], PY[3], k);
  const raw = (k: number) =>
    Math.atan2(bezD(PY[0], PY[1], PY[2], PY[3], k), bezD(PX[0], PX[1], PX[2], PX[3], k));
  // Level off into the landing: the tail of the curve still points slightly
  // nose-up, and an emblem sitting crooked reads as a mistake rather than a pose.
  const heading = (k: number) => raw(k) * (1 - clamp01((k - 0.72) / 0.28));

  // Afterimages along the path already flown.
  if (!landed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 10; i >= 1; i--) {
      const k = u - i * 0.022;
      if (k <= 0) continue;
      const gx = px(k);
      const gy = py(k);
      const fade = (1 - i / 11) ** 2 * 0.6 * (1 - u * 0.55);
      const len = R * (3.4 - u * 1.9) * (1 - i * 0.045);
      const wid = R * 0.5 * (1 - i * 0.06);
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(raw(k));
      ctx.fillStyle = rgba(COL.strike, fade);
      ctx.beginPath();
      ctx.moveTo(len, 0);
      ctx.lineTo(-len * 0.3, -wid);
      ctx.lineTo(-len * 1.1, 0);
      ctx.lineTo(-len * 0.3, wid);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Bank from the curvature of the path: how fast the heading is turning.
  const bank = landed
    ? 0
    : clamp(angleDelta(raw(Math.max(0, u - 0.03)), raw(Math.min(1, u + 0.03))) * 4, -1, 1);
  const bob = landed ? Math.sin(game.clock * 1.7) * 1.1 * S : 0;

  drawShip(ctx, px(u), py(u) + bob, heading(u), R * (2.3 - u * 1.3), {
    thrust: landed ? 0.16 + 0.05 * Math.sin(game.clock * 3.1) : 1,
    bank,
    clock: game.clock,
  });

  // Touchdown: a flare where it put down, and the rule sweeps out of it.
  const flare = clamp01(1 - (t - SHIP_LAND) / 0.45);
  if (landed && flare > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawRadial(ctx, flareSprite(COL.strike, 0.9), cx, restY, 34 * S * (1.3 - flare), flare * flare * 0.9);
    ctx.restore();
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, game: Game) {
  const S = clamp(view.h / 860, 0.6, 1.5);
  const t = game.titleTime;
  const cx = view.w * 0.5;
  const intro = titleIntro(t);

  scrim(ctx, 0.7 * stage(t, 0, 0.5) + 0.1);

  // --- wordmark
  const word = 'AFTERBURN';
  const maxW = Math.min(view.w * 0.8, view.arenaW * view.scale * 0.86);
  const size = fitVec(word, maxW, 104 * S, 0.2);
  const w = vecWidth(word, { size, tracking: 0.2 });

  // The whole lockup — mark, rule, tagline, control rows — is measured and then
  // centred as one block. Anchoring each piece to a fraction of the viewport
  // looks fine at one aspect and falls apart at every other.
  const blockH = size + 30 * S + 52 * S + 3 * 34 * S;
  const wy = Math.max(size * 0.7 + 56 * S, (view.h - blockH) * 0.42 + size * 0.5);

  // Speed rules behind the mark: three streaks that shoot in from the left and
  // settle. The logo should feel like it arrived at velocity.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const p = stage(t, 0.06 + i * 0.07, 0.7);
    if (p <= 0.001) continue;
    const yy = wy - size * 0.52 + i * size * 0.46;
    const x0 = cx - w * 0.62;
    const len = w * 1.24 * p;
    // Gradient rather than a flat bar: a hard-edged rectangle behind a logo
    // reads as a rendering mistake, a fading streak reads as motion.
    const gd = ctx.createLinearGradient(x0, 0, x0 + len, 0);
    gd.addColorStop(0, rgba(COL.strike, 0));
    gd.addColorStop(0.55, rgba(COL.strike, (0.09 - i * 0.022) * p));
    gd.addColorStop(1, rgba(COL.strike, 0));
    ctx.fillStyle = gd;
    ctx.fillRect(x0, yy, len, size * (0.13 - i * 0.03));
  }
  ctx.restore();

  // Two tones, one word: AFTER in the player's cold ink, BURN in heat. The
  // split is the entire fiction in nine letters — cold machine, hot exhaust —
  // and one committed branding decision does more to make a mark look designed
  // than any amount of glow.
  const track = 0.2;
  const x0 = cx - w * 0.5;
  const w1 = vecWidth('AFTER', { size, tracking: track });
  const drawMark = (hot: boolean, tint?: string) => {
    drawVec(ctx, 'AFTER', x0, wy, {
      size,
      weight: 0.108,
      tracking: track,
      baseline: 'mid',
      color: tint ?? (hot ? rgba(COL.playerCore, 0.85) : rgba(COL.ink, 1)),
      // Restrained on purpose. AFTER in ice and BURN in heat is the entire
      // fiction in nine letters, and at the old halo weight the additive pass
      // pushed both cores to the same white — the one committed branding
      // decision the mark makes, erased by its own glow.
      glow: tint ? 0 : hot ? 1.6 : 1.05,
      glowColor: rgba(COL.strike, 1),
      slant: 0.1,
    });
    drawVec(ctx, 'BURN', x0 + w1 + track * size, wy, {
      size,
      weight: 0.108,
      tracking: track,
      baseline: 'mid',
      color: tint ?? (hot ? rgba(COL.playerCore, 0.85) : rgba(COL.warn, 1)),
      // Restrained on purpose. AFTER in ice and BURN in heat is the entire
      // fiction in nine letters, and at the old halo weight the additive pass
      // pushed both cores to the same white — the one committed branding
      // decision the mark makes, erased by its own glow.
      glow: tint ? 0 : hot ? 1.6 : 1.05,
      glowColor: hot ? rgba(COL.strike, 1) : rgba(COL.warn, 1),
      slant: 0.1,
    });
  };

  // The slam, scaled about the mark's own centre so it falls straight onto its
  // resting place instead of sliding in from somewhere.
  const slam = (draw: () => void) => {
    if (intro.punch <= 0.001) {
      draw();
      return;
    }
    ctx.save();
    ctx.translate(cx, wy);
    const k = 1 + intro.punch * 0.38;
    ctx.scale(k, k);
    ctx.translate(-cx, -wy);
    draw();
    ctx.restore();
  };

  // Chromatic split, converging: two tinted ghosts either side that slide into
  // the mark as it lands. It is the cheapest way to make a static lockup look
  // like it is being *resolved by a lens* rather than blitted into place. They
  // are drawn without glow — the ghosts are a lens artefact, and an artefact
  // that blooms is just a second wordmark.
  if (intro.punch > 0.01) {
    const off = intro.punch * 30 * S;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, intro.punch * 1.4);
    for (const [dx, col] of [
      [-off, 'rgba(255,52,86,1)'], [off, 'rgba(72,236,255,1)'],
    ] as const) {
      ctx.save();
      ctx.translate(dx, 0);
      slam(() => drawMark(false, col));
      ctx.restore();
    }
    ctx.restore();
  }
  slam(() => drawMark(false));

  // The shock off the mark, as a bar tearing outward along its baseline rather
  // than as a ring.
  //
  // Rings were the first instinct and they were wrong twice over: an expanding
  // ellipse spends most of its life *large*, so it hangs around the lockup
  // reading as a badge outline rather than as an event — and a circle is the
  // wrong gesture for a game whose whole verb is a horizontal line. Two bars
  // that burst sideways and collapse to nothing say "speed" in a way a ring
  // cannot, and they cost one gradient each.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const p = clamp01((t - 0.12 - i * 0.1) / 0.5);
    if (p <= 0.001 || p >= 1) continue;
    const e = easeOutQuint(p);
    const half = e * view.w * 0.75;
    const bh = (1 - e) * size * 0.42 + 1;
    const col = i === 0 ? COL.strike : COL.warn;
    const gd = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
    gd.addColorStop(0, rgba(col, 0));
    gd.addColorStop(0.5, rgba(col, (1 - p) * (1 - p) * 0.6));
    gd.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gd;
    ctx.fillRect(cx - half, wy - bh * 0.5, half * 2, bh);
  }
  ctx.restore();

  // A highlight sweep that crosses the mark every few seconds.
  const sweep = (game.clock * 0.22) % 1;
  if (sweep < 0.36 && t > SHIP_LAND + 0.9) {
    const sx = cx - w * 0.6 + (sweep / 0.36) * w * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.rect(sx - 26 * S, wy - size, 52 * S, size * 2);
    ctx.clip();
    drawMark(true);
    ctx.restore();
  }

  // --- the rule, and the ship that lands in the break of it. The rule sweeps
  //     outward *from the touchdown*, so the line looks like it was drawn by the
  //     thing that just arrived rather than scheduled independently of it.
  const ruleY = wy + size * 0.68;
  const ruleP = stage(t, SHIP_LAND, 0.45);
  const half = w * 0.5 * ruleP;
  const gapW = 22 * S;
  ctx.fillStyle = rgba(COL.wall, 0.45 * ruleP);
  if (half > gapW) {
    ctx.fillRect(cx - half, ruleY, half - gapW, 1.5 * S);
    ctx.fillRect(cx + gapW, ruleY, half - gapW, 1.5 * S);
  }
  drawApproach(ctx, game, cx, ruleY, S);

  const tagY = ruleY + 30 * S;
  ctx.save();
  ctx.globalAlpha = stage(t, SHIP_LAND + 0.14, 0.5);
  drawUI(ctx, 'SPEED IS THE ONLY WEAPON YOU HAVE', cx, tagY, {
    size: 13 * S,
    weight: 700,
    tracking: 6.4 * S,
    align: 'center',
    color: rgba(COL.focus, 0.92),
    maxWidth: view.w * 0.92,
  });
  ctx.restore();

  // --- controls. Laid out as a real two-column block, measured and centred as
  //     a unit, so the key chips and their descriptions share one optical axis.
  const rows: [string, string][] = [
    ['HOLD', 'Time slows. A line shows everything you will kill.'],
    ['RELEASE', 'You become the line. Anything on it dies.'],
    ['KILL', 'Kills refill FOCUS. Focus buys you time to think.'],
  ];
  let keyW = 100 * S;
  let gap = 20 * S;
  let descSize = 13.5 * S;
  const measure = () => {
    const st = { size: descSize, weight: 500, tracking: 0.2 * S };
    let m = 0;
    for (const r of rows) m = Math.max(m, uiWidth(ctx, r[1], st));
    return m;
  };
  let descW = measure();
  // Shrink the block as a unit rather than letting it run off a narrow screen.
  const avail = view.w * 0.92;
  const total = keyW + gap + descW;
  if (total > avail) {
    const k = avail / total;
    keyW *= k;
    gap *= k;
    descSize *= k;
    descW = measure();
  }
  const descStyle = { size: descSize, weight: 500, tracking: 0.2 * S } as const;
  const blockX = cx - (keyW + gap + descW) * 0.5;
  const ry = tagY + 52 * S;

  for (let i = 0; i < rows.length; i++) {
    const p = stage(t, SHIP_LAND + 0.3 + i * 0.13, 0.55);
    if (p <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = p;
    const y = ry + i * 34 * S + (1 - p) * 14 * S;

    ctx.fillStyle = rgba(COL.strike, 0.09);
    ctx.fillRect(blockX, y - 15 * S, keyW, 22 * S);
    ctx.strokeStyle = rgba(COL.strike, 0.38);
    ctx.lineWidth = 1;
    ctx.strokeRect(blockX, y - 15 * S, keyW, 22 * S);
    drawVec(ctx, rows[i][0], blockX + keyW * 0.5, y, {
      size: 13 * S,
      weight: 0.15,
      tracking: 0.14,
      align: 'center',
      color: rgba(COL.strike, 1),
    });
    drawUI(ctx, rows[i][1], blockX + keyW + gap, y, {
      ...descStyle,
      color: rgba(COL.ink, 0.82),
    });
    ctx.restore();
  }

  // --- start prompt. Anchored to the bottom, but pulled up if the screen is so
  //     tall that it would be marooned a long way below the controls.
  const rowsBottom = ry + rows.length * 34 * S;
  const promptY = Math.min(view.h - 74 * S, rowsBottom + 118 * S);
  const pp = stage(t, SHIP_LAND + 0.8, 0.6);
  if (pp > 0.001) {
    const pulse = 0.6 + 0.4 * Math.sin(game.clock * 3.4);
    const label = IS_TOUCH ? 'TAP TO BEGIN' : 'CLICK TO BEGIN';
    ctx.save();
    ctx.globalAlpha = pp * pulse;
    drawVec(ctx, label, cx, promptY, {
      size: fitVec(label, view.w * 0.82, 24 * S, 0.24),
      weight: 0.13,
      tracking: 0.24,
      align: 'center',
      color: rgba(COL.ink, 1),
      glow: 1.2,
      glowColor: rgba(COL.strike, 1),
    });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = pp * 0.6;
    drawUI(
      ctx,
      IS_TOUCH
        ? 'TOUCH ANYWHERE  ·  HOLD  ·  RELEASE'
        : 'MOUSE  ·  OR WASD + SPACE  ·  M MUTES  ·  P PAUSES',
      cx,
      promptY + 24 * S,
      {
        size: 10.5 * S,
        weight: 600,
        tracking: 2.4 * S,
        align: 'center',
        color: rgba(COL.dim, 0.9),
        maxWidth: view.w * 0.94,
      },
    );
    ctx.restore();
  }

  // --- colophon. Small print grounds a title screen in a real occasion the
  //     way a colophon grounds a book; its job is to be almost unnoticed. The
  //     handles sit one step above the jam plate — quiet, but findable by
  //     anyone who liked the game enough to read the bottom of the screen.
  // Top-left corner: the only part of the title screen nothing else reaches,
  // since the lockup is centred and the colophon is along the bottom edge.
  drawNowPlaying(ctx, game, 22 * S, 28 * S, S, false, stage(t, SHIP_LAND + 1.2, 0.8) * 0.8);

  drawSocials(ctx, cx, view.h - 38 * S, S, stage(t, SHIP_LAND + 1.05, 0.7) * 0.85);
  ctx.save();
  ctx.globalAlpha = stage(t, SHIP_LAND + 1.15, 0.7) * 0.55;
  drawUI(ctx, 'MICRO JAM 062  ·  THEME: SPEED  ·  A GAME BY PRIMEDEV', cx, view.h - 16 * S, {
    size: 9.5 * S,
    weight: 600,
    tracking: 2.6 * S,
    align: 'center',
    color: rgba(COL.dim, 1),
    maxWidth: view.w * 0.9,
  });
  ctx.restore();

  // --- records
  if (game.best > 0) {
    ctx.save();
    ctx.globalAlpha = stage(t, SHIP_LAND + 0.5, 0.6);
    drawUI(ctx, 'PERSONAL BEST', view.w * 0.5, 42 * S, {
      size: 10 * S,
      weight: 700,
      tracking: 3 * S,
      align: 'center',
      color: rgba(COL.dim, 0.7),
    });
    drawVec(ctx, `${group(game.best)}  ·  WAVE ${pad(game.bestWave)}`, view.w * 0.5, 70 * S, {
      size: 19 * S,
      weight: 0.13,
      tracking: 0.12,
      align: 'center',
      color: rgba(COL.warn, 0.95),
      slant: 0.06,
    });
    ctx.restore();
  }

  // --- the cold open, over everything it is meant to be hiding.
  introStreaks(ctx, t);

  if (intro.bars > 0.001) {
    const bh = view.h * 0.5 * intro.bars;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, view.w, bh);
    ctx.fillRect(0, view.h - bh, view.w, bh);
    // A lit edge on each blade. Without it the bars are two black rectangles
    // shrinking, which reads as a rendering glitch; with it they are a shutter.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(COL.strike, intro.bars * 0.85);
    ctx.fillRect(0, bh - 1.6 * S, view.w, 1.6 * S);
    ctx.fillRect(0, view.h - bh, view.w, 1.6 * S);
    ctx.restore();
  }

  if (intro.flash > 0.002) {
    ctx.save();
    ctx.fillStyle = rgba(COL.playerCore, Math.min(1, intro.flash));
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.restore();
  }
}

// --------------------------------------------------------------------- pause
function drawPause(ctx: CanvasRenderingContext2D, game: Game) {
  const S = clamp(view.h / 860, 0.6, 1.5);
  scrim(ctx, 0.78);
  const cx = view.w * 0.5;
  const kinds = [...game.seenKinds];
  const top = view.h * (kinds.length ? 0.24 : 0.45);

  drawVec(ctx, 'PAUSED', cx, top, {
    size: fitVec('PAUSED', view.w * 0.8, 58 * S, 0.26),
    weight: 0.11,
    tracking: 0.26,
    align: 'center',
    baseline: 'mid',
    color: rgba(COL.ink, 1),
    glow: 1.4,
    glowColor: rgba(COL.strike, 1),
    slant: 0.08,
  });

  const pulse = 0.6 + 0.4 * Math.sin(game.clock * 3.4);
  ctx.save();
  ctx.globalAlpha = pulse;
  drawUI(ctx, IS_TOUCH ? 'TAP TO RESUME' : 'PRESS P OR ESC TO RESUME', cx, top + 56 * S, {
    size: 12 * S,
    weight: 700,
    tracking: 4 * S,
    align: 'center',
    color: rgba(COL.focus, 0.9),
    maxWidth: view.w * 0.9,
  });
  ctx.restore();

  // The codex. The rule cards fly past mid-fight and there is no other way back
  // to them; a paused player asking "what was the magenta one?" deserves an
  // answer that is not a second death.
  const rowH = 46 * S;
  const listW = Math.min(470 * S, view.w * 0.92);
  const x = cx - listW * 0.5;
  const y0 = top + 92 * S;

  if (kinds.length) {
    drawUI(ctx, 'CONTACTS', x, y0, {
      size: 10 * S,
      weight: 700,
      tracking: 3.4 * S,
      color: rgba(COL.dim, 0.75),
    });
  }

  for (let i = 0; i < kinds.length; i++) {
    const spec = SPECS[kinds[i]];
    const col = ENEMY_COL[kinds[i]];
    const y = y0 + 22 * S + i * rowH;

    ctx.fillStyle = rgba(COL.dim, 0.08);
    ctx.fillRect(x, y, listW, rowH - 8 * S);
    ctx.fillStyle = rgba(col, 0.9);
    ctx.fillRect(x, y, 3 * S, rowH - 8 * S);

    ctx.save();
    ctx.translate(x + 32 * S, y + (rowH - 8 * S) * 0.5);
    ctx.scale(S * 0.72, S * 0.72);
    drawEnemyIcon(ctx, spec.kind, game.clock);
    ctx.restore();

    drawVec(ctx, spec.name, x + 62 * S, y + 20 * S, {
      size: 15 * S,
      weight: 0.14,
      tracking: 0.13,
      color: rgba(col, 1),
    });
    drawUI(ctx, spec.rule, x + 62 * S, y + 34 * S, {
      size: 11 * S,
      weight: 500,
      tracking: 0.2 * S,
      color: rgba(COL.ink, 0.78),
      maxWidth: listW - 74 * S,
    });
  }

  // Hung off the bottom of the codex rather than off the bottom of the screen.
  // The pause overlay sits on top of a live HUD, and the screen's lower edge
  // already belongs to the focus bar and its hint.
  const listEnd = kinds.length ? y0 + 22 * S + kinds.length * rowH : top + 84 * S;
  drawNowPlaying(ctx, game, cx, listEnd + 26 * S, S, true, 0.75);
}

// ------------------------------------------------------------------- results
function drawResults(ctx: CanvasRenderingContext2D, game: Game) {
  const S = clamp(view.h / 860, 0.6, 1.5);
  const t = game.deadTime;
  const cx = view.w * 0.5;
  const top = view.h * 0.14;

  scrim(ctx, 0.82 * stage(t, 0.15, 0.8));

  // --- headline
  ctx.save();
  ctx.globalAlpha = stage(t, 0.3, 0.5);
  drawUI(ctx, 'RUN ENDED', cx, top, {
    size: 12 * S,
    weight: 700,
    tracking: 6 * S,
    align: 'center',
    color: rgba(COL.danger, 0.9),
  });
  ctx.restore();

  // --- score
  const sp = stage(t, 0.45, 0.7);
  if (sp > 0.001) {
    const shown = Math.round(game.score * easeOutExpo(clamp01((t - 0.45) / 0.9)));
    ctx.save();
    ctx.globalAlpha = sp;
    drawVec(ctx, group(shown), cx, top + 82 * S, {
      size: fitVec(group(shown), view.w * 0.78, 72 * S, 0.09),
      weight: 0.1,
      tracking: 0.09,
      align: 'center',
      baseline: 'mid',
      color: rgba(COL.ink, 1),
      glow: 1.6,
      glowColor: rgba(COL.strike, 1),
      slant: 0.08,
    });
    ctx.restore();
  }

  if (game.isNewBest) {
    const bp = stage(t, 1.5, 0.4);
    if (bp > 0.001) {
      ctx.save();
      ctx.globalAlpha = bp * (0.7 + 0.3 * Math.sin(game.clock * 6));
      const w = 178 * S;
      ctx.fillStyle = rgba(COL.warn, 0.16);
      ctx.fillRect(cx - w * 0.5, top + 132 * S, w, 25 * S);
      ctx.strokeStyle = rgba(COL.warn, 0.8);
      ctx.lineWidth = 1.2 * S;
      ctx.strokeRect(cx - w * 0.5, top + 132 * S, w, 25 * S);
      drawVec(ctx, 'NEW PERSONAL BEST', cx, top + 149 * S, {
        size: fitVec('NEW PERSONAL BEST', w * 0.9, 12.5 * S, 0.1),
        weight: 0.15,
        tracking: 0.1,
        align: 'center',
        color: rgba(COL.warn, 1),
      });
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.globalAlpha = stage(t, 1.5, 0.4) * 0.75;
    drawUI(ctx, `BEST  ${group(game.best)}`, cx, top + 148 * S, {
      size: 11.5 * S,
      weight: 700,
      tracking: 3.4 * S,
      align: 'center',
      color: rgba(COL.dim, 1),
    });
    ctx.restore();
  }

  // --- stat table
  const stats: [string, string][] = [
    ['WAVES CLEARED', pad(Math.max(0, game.wave - 1))],
    ['KILLS', String(game.kills)],
    ['BEST CHAIN', `×${game.bestCombo}`],
    // A plain hyphen: the display face has no em-dash, and a missing glyph
    // renders as a tofu box right in the middle of the score table.
    ['BEST STRIKE', game.bestMulti > 1 ? `${game.bestMulti} KILLS` : '-'],
    ['TIME ELAPSED', formatTime(game.runTime)],
  ];
  const tableY = top + 196 * S;
  const rowH = 33 * S;
  const halfW = Math.min(205 * S, view.w * 0.44);

  for (let i = 0; i < stats.length; i++) {
    const p = stage(t, 0.8 + i * 0.09, 0.45);
    if (p <= 0.001) continue;
    const y = tableY + i * rowH;
    ctx.save();
    ctx.globalAlpha = p;
    const slide = (1 - p) * 18 * S;
    // Rule *under* the row, not through it, and faint enough to be felt rather
    // than read — it is there to carry the eye from label to value, no more.
    ctx.fillStyle = rgba(COL.dim, 0.13);
    ctx.fillRect(cx - halfW, y + 10 * S, halfW * 2, 1);
    drawUI(ctx, stats[i][0], cx - halfW - slide, y, {
      size: 11.5 * S,
      weight: 600,
      tracking: 2.6 * S,
      color: rgba(COL.dim, 0.95),
    });
    drawVec(ctx, stats[i][1], cx + halfW + slide, y + 2 * S, {
      size: 17 * S,
      weight: 0.14,
      tracking: 0.08,
      align: 'right',
      color: rgba(COL.ink, 1),
    });
    ctx.restore();
  }

  // --- rank
  const rp = stage(t, 1.35, 0.6);
  if (rp > 0.001) {
    const rank = game.rank;
    const ry = tableY + stats.length * rowH + 66 * S;
    const col = rank.label.startsWith('S') ? COL.warn : rank.label === 'A' ? COL.hull : COL.focus;
    ctx.save();
    ctx.globalAlpha = rp;

    const boxR = 44 * S * (0.85 + easeOutCubic(rp) * 0.15);
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(cx, ry, 0, cx, ry, boxR * 2.4);
    gr.addColorStop(0, rgba(col, 0.3));
    gr.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(cx - boxR * 2.4, ry - boxR * 2.4, boxR * 4.8, boxR * 4.8);
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = rgba(col, 0.7);
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(cx, ry, boxR, 0, Math.PI * 2);
    ctx.stroke();

    drawVec(ctx, rank.label, cx, ry, {
      size: 46 * S,
      weight: 0.13,
      tracking: 0.04,
      align: 'center',
      baseline: 'mid',
      color: rgba(col, 1),
      glow: 1.6,
      glowColor: rgba(col, 1),
      slant: 0.06,
    });
    drawUI(ctx, rank.note, cx, ry + boxR + 26 * S, {
      size: 12 * S,
      weight: 600,
      tracking: 2.2 * S,
      align: 'center',
      color: rgba(COL.ink, 0.75),
      maxWidth: view.w * 0.9,
    });

    // Next rank teaser: the strongest "one more run" lever a score game has.
    const next = nextRank(game.score);
    if (next) {
      drawUI(
        ctx,
        `${group(next.min - game.score)} MORE FOR RANK ${next.label}`,
        cx,
        ry + boxR + 46 * S,
        {
          size: 10.5 * S,
          weight: 700,
          tracking: 2.4 * S,
          align: 'center',
          color: rgba(COL.dim, 0.8),
          maxWidth: view.w * 0.9,
        },
      );
    }
    ctx.restore();
  }

  // --- restart
  const gp = stage(t, 1.9, 0.5);
  if (gp > 0.001) {
    const pulse = 0.65 + 0.35 * Math.sin(game.clock * 3.6);
    ctx.save();
    ctx.globalAlpha = gp * pulse;
    const again = IS_TOUCH ? 'TAP TO GO AGAIN' : 'CLICK TO GO AGAIN';
    drawVec(ctx, again, cx, view.h - 56 * S, {
      size: fitVec(again, view.w * 0.82, 22 * S, 0.22),
      weight: 0.13,
      tracking: 0.22,
      align: 'center',
      color: rgba(COL.ink, 1),
      glow: 1.1,
      glowColor: rgba(COL.strike, 1),
    });
    ctx.restore();
  }

  // The one moment a player is most likely to follow: right after a run they
  // cared about, while the score is still on screen.
  drawSocials(ctx, cx, view.h - 22 * S, S, gp * 0.75);
}

function nextRank(score: number) {
  let best: { min: number; label: string } | null = null;
  for (const r of RANKS) {
    if (r.min > score && (!best || r.min < best.min)) best = r;
  }
  return best;
}

export function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}
