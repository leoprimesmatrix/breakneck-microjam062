import { COL, rgba } from '../config';
import { clamp, clamp01, easeOutCubic, easeOutExpo, easeOutQuint } from '../engine/math';
import { ENEMY_COL, RANKS, pad, type Game } from '../game/game';
import { SPECS } from '../game/enemies';
import { view } from '../viewport';
import { drawEnemyIcon, group } from './hud';
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

export function drawScreens(ctx: CanvasRenderingContext2D, game: Game) {
  if (game.state === 'title') drawTitle(ctx, game);
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
function drawTitle(ctx: CanvasRenderingContext2D, game: Game) {
  const S = clamp(view.h / 860, 0.6, 1.5);
  const t = game.titleTime;
  const cx = view.w * 0.5;

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
  const drawMark = (hot: boolean) => {
    drawVec(ctx, 'AFTER', x0, wy, {
      size,
      weight: 0.108,
      tracking: track,
      baseline: 'mid',
      color: hot ? rgba(COL.playerCore, 0.85) : rgba(COL.ink, 1),
      glow: hot ? 2 : 1.7,
      glowColor: rgba(COL.strike, 1),
      slant: 0.1,
      progress: hot ? 1 : stage(t, 0.1, 0.85),
    });
    drawVec(ctx, 'BURN', x0 + w1 + track * size, wy, {
      size,
      weight: 0.108,
      tracking: track,
      baseline: 'mid',
      color: hot ? rgba(COL.playerCore, 0.85) : rgba(COL.warn, 1),
      glow: hot ? 2 : 1.7,
      glowColor: hot ? rgba(COL.strike, 1) : rgba(COL.warn, 1),
      slant: 0.1,
      progress: hot ? 1 : stage(t, 0.5, 0.85),
    });
  };
  drawMark(false);

  // A highlight sweep that crosses the mark every few seconds.
  const sweep = (game.clock * 0.22) % 1;
  if (sweep < 0.36 && t > 1.6) {
    const sx = cx - w * 0.6 + (sweep / 0.36) * w * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.rect(sx - 26 * S, wy - size, 52 * S, size * 2);
    ctx.clip();
    drawMark(true);
    ctx.restore();
  }

  // --- rule + tagline. The rule parts around the ship's own chevron — the
  //     emblem sits in the break like a maker's mark set into an engraved line.
  const ruleY = wy + size * 0.68;
  const ruleP = stage(t, 0.55, 0.6);
  const half = w * 0.5 * ruleP;
  const gapW = 24 * S;
  ctx.fillStyle = rgba(COL.wall, 0.45 * ruleP);
  if (half > gapW) {
    ctx.fillRect(cx - half, ruleY, half - gapW, 1.5 * S);
    ctx.fillRect(cx + gapW, ruleY, half - gapW, 1.5 * S);
  }
  if (ruleP > 0.3) {
    ctx.save();
    ctx.globalAlpha = ruleP;
    ctx.translate(cx, ruleY + 0.75 * S);
    const es = 1.05 * S;
    ctx.scale(es, es);
    ctx.fillStyle = rgba(COL.playerCore, 0.95);
    ctx.strokeStyle = rgba(COL.player, 0.9);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-3.5, 0);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Its own little strike line, trailing off to the left of the break.
    ctx.strokeStyle = rgba(COL.strike, 0.55);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-19, 0);
    ctx.lineTo(-10, 0);
    ctx.stroke();
    ctx.restore();
  }

  const tagY = ruleY + 30 * S;
  ctx.save();
  ctx.globalAlpha = stage(t, 0.72, 0.5);
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
    const p = stage(t, 0.95 + i * 0.14, 0.55);
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
  const pp = stage(t, 1.6, 0.6);
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

  // --- jam plate. Small print grounds a title screen in a real occasion the
  //     way a colophon grounds a book; its job is to be almost unnoticed.
  ctx.save();
  ctx.globalAlpha = stage(t, 2.0, 0.7) * 0.55;
  drawUI(ctx, 'MICRO JAM 062  ·  THEME: SPEED', cx, view.h - 16 * S, {
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
    ctx.globalAlpha = stage(t, 1.3, 0.6);
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
  if (!kinds.length) return;
  const rowH = 46 * S;
  const listW = Math.min(470 * S, view.w * 0.92);
  const x = cx - listW * 0.5;
  const y0 = top + 92 * S;

  drawUI(ctx, 'CONTACTS', x, y0, {
    size: 10 * S,
    weight: 700,
    tracking: 3.4 * S,
    color: rgba(COL.dim, 0.75),
  });

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
    ['BEST STRIKE', game.bestMulti > 1 ? `${game.bestMulti} KILLS` : '—'],
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
