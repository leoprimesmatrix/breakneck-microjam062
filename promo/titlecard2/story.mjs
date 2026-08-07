/**
 * THE STORY CUT — nine clips, delivered separately and as one assembled piece.
 *
 * The copy is the author's, verbatim and in order:
 *
 *   IN OUR WORLD...  /  THERE'S LOVE...  /  THERE'S DEATH...
 *   BUT... AMONGST ALL...  /  THERE'S YOU.
 *
 * ...then gameplay, then the peak, then the title with the ship, then the date.
 *
 * **Why every clip is its own file.** These are cut together in an editor with
 * music over the top, which is also the only place the score can live — the
 * muxer here is configured `video:` only, so every mp4 this pipeline writes is
 * silent. Separate clips means the beats can be retimed against a track without
 * re-rendering anything, which for a piece whose whole job is to land on a
 * swell is the difference between editable and not.
 *
 * **Why the assembled cut needs no concatenation step.** Each clip fades up
 * from black and back down to it, so playing them back to back *is* the
 * transition — every statement gets its own dip, which is the grammar this kind
 * of card-driven trailer wants anyway. `FULL` just dispatches on cumulative
 * time; there is no second encode and no seam to get wrong.
 *
 * The one rule the visuals follow, inherited from the game: **you are the only
 * cold light in a warm room.** So the cards run a deliberate colour arc —
 * neutral, then warm, then red, then neutral, then ice. By the time the word
 * YOU arrives it is the only cold thing that has been on screen, and the
 * palette has been making that argument for forty seconds without saying it.
 */
import {
  makeStars, drawStars, bakeCloud, bakeDust, makeNebula, drawNebula, drawDust,
  drawFlare, makeWrecks, drawWrecks,
} from './space.mjs';
import {
  COL, rgba, TAU, clamp01, glyphFor, drawShip, drawRadial, flareSprite, haloSprite,
} from './lib.mjs';
import { drawFoe, burstFoe } from './foes.mjs';
import { drawVista } from './vista.mjs';

export const W = 1920;
export const H = 1080;
export const FPS = 60;

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const easeInCubic = (t) => t * t * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// --------------------------------------------------------------------- type
const TRACK = 0.2;
const SLANT = 0.08;
const WEIGHT = 0.1;

const advance = (text, size, track) => {
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a + track;
  return (w - track) * size;
};

/** Total pen travel, so a line can be drawn on at a constant *speed*. */
function penLength(text, size) {
  let total = 0;
  for (const ch of text) {
    for (const run of glyphFor(ch).p) {
      for (let i = 2; i < run.length; i += 2) {
        total += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1]);
      }
    }
  }
  return total * size;
}

/** Lay one glyph's strokes into the current path, truncated to `budget`. */
function glyphPath(ctx, runs, ox, size, slant, baseY, budget = Infinity) {
  const X = (gx, gy) => ox + (gx + slant * (1 - gy)) * size;
  const Y = (gy) => baseY - (1 - gy) * size;
  let used = 0;
  for (const run of runs) {
    if (budget - used <= 0) break;
    ctx.moveTo(X(run[0], run[1]), Y(run[1]));
    for (let i = 2; i < run.length; i += 2) {
      const seg = Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1]) * size;
      const left = budget - used;
      if (seg <= left) {
        ctx.lineTo(X(run[i], run[i + 1]), Y(run[i + 1]));
        used += seg;
      } else {
        const k = left / seg;
        ctx.lineTo(
          X(run[i - 2] + (run[i] - run[i - 2]) * k, run[i - 1] + (run[i + 1] - run[i - 1]) * k),
          Y(run[i - 1] + (run[i + 1] - run[i - 1]) * k),
        );
        return budget;
      }
    }
  }
  return used;
}

/**
 * A line of the game's own display face, written on by a pen.
 *
 * Drawn rather than typed: the face is vector data, so the line can be revealed
 * at a constant speed along its own strokes instead of appearing character by
 * character. That is what makes a card feel authored rather than animated.
 */
function drawCard(g, text, cx, y, size, opts = {}) {
  const {
    progress = 1, cold = COL.ink, hot = null, hotFrom = Infinity,
    alpha = 1, track = TRACK, weight = WEIGHT, glow = 1,
  } = opts;
  if (alpha <= 0.002) return;
  const total = penLength(text, size);
  let budget = progress >= 1 ? Infinity : total * progress;
  if (budget <= 0) return;
  const baseY = y + size * 0.5;
  let x = cx - advance(text, size, track) * 0.5;

  g.save();
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  let i = 0;
  for (const ch of text) {
    if (budget <= 0) break;
    const gl = glyphFor(ch);
    const col = hot && i >= hotFrom ? hot : cold;
    g.beginPath();
    const used = glyphPath(g, gl.p, x, size, SLANT, baseY, budget);
    if (glow > 0) {
      // Round joins on the halo, mitred on the letter itself. A mitre is a
      // spike whose length grows with line width, so the same path stroked
      // three times as thick throws long angular shards off every corner of
      // the face — which reads as a second, broken copy of the word sitting
      // behind the real one. It is only visible once it is on screen.
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = rgba(col, 0.17 * alpha * glow);
      g.lineWidth = size * weight * 2.6;
      g.stroke();
      g.lineJoin = 'miter';
      g.lineCap = 'butt';
    }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = rgba(col, alpha);
    g.lineWidth = size * weight;
    g.stroke();
    budget -= used;
    x += (gl.a + track) * size;
    i++;
  }
  g.restore();
}

/** A rule sliding out from a card's shoulders. Punctuation, not decoration. */
function rules(g, cx, y, halfWidth, p, col, alpha) {
  if (p <= 0 || alpha <= 0.002) return;
  const e = easeOutQuint(clamp01(p));
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const dir of [-1, 1]) {
    const x0 = cx + dir * 40;
    const x1 = cx + dir * (40 + halfWidth * e);
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, rgba(col, 0.55 * alpha));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(Math.min(x0, x1), y - 1.2, Math.abs(x1 - x0), 2.4);
  }
  g.restore();
}

/** Fade up from black and back down to it — the seam the full cut is built on. */
function veil(g, t, dur, inD = 0.55, outD = 0.7) {
  const a = 1 - Math.min(clamp01(t / inD), clamp01((dur - t) / outD));
  if (a <= 0.002) return;
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
  g.fillRect(0, 0, W, H);
  g.restore();
}

/** A white blink — used where the frame is supposed to hurt slightly. */
function blink(g, q, amp) {
  if (q < 0 || amp <= 0) return;
  const a = Math.exp(-q * 9) * amp;
  if (a <= 0.003) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = `rgba(255,255,255,${Math.min(1, a).toFixed(4)})`;
  g.fillRect(0, 0, W, H);
  g.restore();
}

// ------------------------------------------------------------------- the sky
const COLD_RAMP = [[18, 30, 62], [52, 86, 146], [156, 206, 255]];
const WARM_RAMP = [[46, 20, 16], [128, 58, 34], [255, 196, 138]];
const ROSE_RAMP = [[40, 14, 30], [138, 46, 90], [255, 172, 208]];
const GREY_RAMP = [[12, 14, 22], [44, 50, 68], [128, 146, 180]];

const CLOUDS = [
  bakeCloud(0x101, COLD_RAMP, 512),
  bakeCloud(0x202, ROSE_RAMP, 512),
  bakeCloud(0x303, WARM_RAMP, 512),
  bakeCloud(0x404, GREY_RAMP, 512),
];
const LANES = [bakeDust(0x77, 512), bakeDust(0x88, 512)];
const PUFFS = makeNebula(30, 0xa11ce, { box: { x: 7800, y: 4200, z: 5200 }, rMin: 1000, rMax: 3000, tiles: 4 });
const DUSTP = makeNebula(10, 0xd0057, { box: { x: 6400, y: 3400, z: 4200 }, rMin: 900, rMax: 2200, tiles: 2 });
const STARS = makeStars(820, 0x5747, { x: 5800, y: 3500, z: 4500 });
const WRECKS = makeWrecks(30, 0xdead1, { box: { x: 5200, y: 2600, z: 4200 }, zMin: 520, sMin: 60, sMax: 460 });

/**
 * The room, for the clips that are not staged on `vista.mjs`.
 *
 * `tiles` picks which cloud bakes are in play, which is the whole difference
 * between the LOVE clip and the DEATH clip: same geometry, same starfield, one
 * warm palette and one that has had the colour taken out of it.
 */
function sky(g, cam, opts = {}) {
  const { neb = 0.6, star = 0.9, dust = 0.45, tiles = CLOUDS, top = 'rgb(7,9,18)', bot = 'rgb(3,4,8)' } = opts;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, top);
  bg.addColorStop(0.55, 'rgb(8,9,15)');
  bg.addColorStop(1, bot);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  drawNebula(g, PUFFS, tiles, cam, W, H, neb);
  drawStars(g, STARS, cam, W, H, star);
  drawDust(g, DUSTP, LANES, cam, W, H, dust);
}

const cam3 = (t, z, x = 0, y = 0) => ({ x, y, z, t, f: 900 });

// --------------------------------------------------------------- the arena
/**
 * The game's floor, for the two gameplay clips. Not a screenshot — the real
 * renderer cannot be driven from this page — but the same furniture: constant
 * grid, cold border, everything near-black so the actors own the saturation.
 */
function arena(g, t, dim = 0) {
  g.fillStyle = rgba(COL.floor, 1);
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.5 * (1 - dim * 0.55);
  g.strokeStyle = rgba(COL.grid, 1);
  g.lineWidth = 1;
  const step = 96;
  g.beginPath();
  for (let x = (t * 6) % step; x < W; x += step) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0; y < H; y += step) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  g.restore();

  // Border: the arena is a box you are trapped in, and saying so costs two rects.
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = rgba(COL.gridHot, 0.5);
  g.lineWidth = 2;
  g.strokeRect(56, 44, W - 112, H - 88);
  g.restore();

  // Vignette, closing further while the world is in bullet time.
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.28, W * 0.5, H * 0.5, H * 0.86);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${(0.62 + dim * 0.26).toFixed(3)})`);
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

/** The aim preview: the promise the game makes before you commit to it. */
function aimLine(g, x0, y0, ang, len, targets, alpha, t) {
  if (alpha <= 0.002) return;
  const x1 = x0 + Math.cos(ang) * len;
  const y1 = y0 + Math.sin(ang) * len;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, rgba(COL.strike, 0.9 * alpha));
  gr.addColorStop(1, rgba(COL.strike, 0.12 * alpha));
  g.strokeStyle = gr;
  g.lineWidth = 3;
  g.setLineDash([26, 14]);
  g.lineDashOffset = -t * 90;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.setLineDash([]);

  // A ring on every body the line will take, in the order it takes them.
  for (const p of targets) {
    const r = 34 + Math.sin(t * 6 + p.i) * 3;
    g.strokeStyle = rgba(COL.playerCore, 0.8 * alpha);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.stroke();
    drawRadial(g, flareSprite(COL.strike, 1), p.x, p.y, r * 0.9, 0.28 * alpha);
  }
  // Where it stops.
  g.strokeStyle = rgba(COL.player, 0.85 * alpha);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x1 - Math.sin(ang) * 22, y1 + Math.cos(ang) * 22);
  g.lineTo(x1 + Math.sin(ang) * 22, y1 - Math.cos(ang) * 22);
  g.stroke();
  g.restore();
}

/** The reticle that spins while the strike charges. */
function reticle(g, x, y, charge, t, alpha) {
  if (alpha <= 0.002 || charge <= 0) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.translate(x, y);
  g.rotate(t * 2.4);
  const r = lerp(120, 62, easeOutCubic(charge));
  g.strokeStyle = rgba(COL.focus, 0.75 * alpha * charge);
  g.lineWidth = 2.4;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.arc(0, 0, r, k * (TAU / 4) + 0.16, k * (TAU / 4) + TAU / 4 - 0.16);
    g.stroke();
  }
  g.restore();
}

/** A strike in flight: the ship *is* the line, and the line is what kills. */
function strikeBeam(g, x0, y0, x1, y1, amp) {
  if (amp <= 0.002) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [w, a] of [[46, 0.16], [18, 0.4], [6, 0.95]]) {
    g.strokeStyle = rgba(w > 20 ? COL.strike : COL.playerCore, a * amp);
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  g.restore();
}

// ------------------------------------------------------------------- clips
/**
 * Each clip owns its own time base starting at zero, its own fade, and its own
 * duration. Nothing reads a wall clock and nothing is random, so a re-render is
 * byte-identical and a clip can be re-cut without disturbing its neighbours.
 */
const DEFS = [];
const def = (key, title, dur, draw) => { DEFS.push({ key, title, dur, draw }); };

// ---------------------------------------------------------------- 1. WORLD
def('01-in-our-world', 'IN OUR WORLD...', 5.4, (g, t, dur) => {
  drawVista(g, t + 4, { x: Math.sin(t * 0.19) * 7, y: Math.cos(t * 0.15) * 5, z: 1, rot: 0 },
    { stage: 'companion', flare: 0 });
  const p = clamp01((t - 0.85) / 1.7);
  const a = clamp01((t - 0.75) / 0.6) * (1 - clamp01((t - (dur - 1.15)) / 0.75));
  drawCard(g, 'IN OUR WORLD...', W * 0.5, H * 0.53, 88, { progress: p, cold: COL.ink, alpha: a });
  veil(g, t, dur);
});

// ----------------------------------------------------------------- 2. LOVE
// Keys are the filenames, so they stay inside `^[a-zA-Z0-9._-]+$` — the sink
// in serve.ps1 rejects anything else, and an apostrophe in a key would fail at
// the very end of a render rather than at the start of one.
def('02-theres-love', "THERE'S LOVE...", 5.4, (g, t, dur) => {
  // The gas is turned down deliberately. The pair is the subject of this shot,
  // and at full strength the nebula was prettier than the thing it was meant to
  // be a room for — which is the same mistake the title card made before the
  // corridor rule went in.
  sky(g, cam3(t, t * 16), { neb: 0.5, star: 0.7, dust: 0.22, tiles: [CLOUDS[1], CLOUDS[2], CLOUDS[1], CLOUDS[2]],
    top: 'rgb(16,8,16)', bot: 'rgb(6,3,7)' });

  // A binary pair: one cold light and one warm, holding a shared centre. The
  // game's two colours are otherwise only ever in opposition — this is the one
  // frame in the whole cut where they orbit each other instead.
  const cx = W * 0.5;
  const cy = H * 0.4;
  const ang = 0.6 + t * 0.46;
  const R = 250 + Math.sin(t * 0.4) * 12;
  const YS = 0.32;
  const ax = cx + Math.cos(ang) * R;
  const ay = cy + Math.sin(ang) * R * YS;
  const bx = cx - Math.cos(ang) * R;
  const by = cy - Math.sin(ang) * R * YS;

  g.save();
  g.globalCompositeOperation = 'lighter';
  // The trails they leave, sampled backwards along their own orbit.
  for (let k = 1; k <= 34; k++) {
    const q = k / 34;
    const aa = ang - q * 1.7;
    const fade = (1 - q) ** 1.8 * 0.55;
    const rr = 40 * (1 - q * 0.55);
    drawRadial(g, flareSprite(COL.player, 1), cx + Math.cos(aa) * R, cy + Math.sin(aa) * R * YS, rr, fade);
    drawRadial(g, flareSprite(COL.seeder, 1), cx - Math.cos(aa) * R, cy - Math.sin(aa) * R * YS, rr, fade);
  }
  // The light that passes between them.
  const bg = g.createLinearGradient(ax, ay, bx, by);
  bg.addColorStop(0, rgba(COL.player, 0.5));
  bg.addColorStop(0.5, rgba(mix(COL.player, COL.seeder, 0.5), 0.22));
  bg.addColorStop(1, rgba(COL.seeder, 0.5));
  g.strokeStyle = bg;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
  // Halo under flare: the flare alone gives a bright pinprick, and a pinprick
  // reads as a star rather than as one of the two things this shot is about.
  drawRadial(g, haloSprite(COL.player), ax, ay, 260, 1);
  drawRadial(g, haloSprite(COL.seeder), bx, by, 260, 0.95);
  drawRadial(g, flareSprite(COL.player, 1), ax, ay, 132, 1);
  drawRadial(g, flareSprite(COL.seeder, 1), bx, by, 132, 0.95);
  g.restore();

  const p = clamp01((t - 0.9) / 1.5);
  const a = clamp01((t - 0.8) / 0.6) * (1 - clamp01((t - (dur - 1.15)) / 0.75));
  drawCard(g, "THERE'S LOVE...", W * 0.5, H * 0.72, 88,
    { progress: p, cold: mix(COL.ink, COL.seeder, 0.45), alpha: a });
  veil(g, t, dur);
});

// ---------------------------------------------------------------- 3. DEATH
def('03-theres-death', "THERE'S DEATH...", 5.4, (g, t, dur) => {
  const cam = cam3(t, t * 34, -220 + t * 26, 0);
  sky(g, cam, { neb: 0.42, star: 0.6, dust: 0.6, tiles: [CLOUDS[3], CLOUDS[3], CLOUDS[0], CLOUDS[3]],
    top: 'rgb(6,7,12)', bot: 'rgb(2,2,4)' });
  // The graveyard. Near-black hulls with one lit edge — the same bodies the
  // DERELICT is full of, and the reason its card in the trailer reads
  // "EVERY SHIP THAT CAME HERE / NEVER LEFT."
  drawWrecks(g, WRECKS, cam, W, H, [-0.5, -0.35, 0.79], 1);

  const p = clamp01((t - 0.9) / 1.5);
  const a = clamp01((t - 0.8) / 0.6) * (1 - clamp01((t - (dur - 1.15)) / 0.75));
  drawCard(g, "THERE'S DEATH...", W * 0.5, H * 0.53, 88,
    { progress: p, cold: mix(COL.ink, COL.danger, 0.62), alpha: a });
  veil(g, t, dur);
});

// -------------------------------------------------------------- 4. AMONGST
def('04-but-amongst-all', 'BUT... AMONGST ALL...', 6.6, (g, t, dur) => {
  // A pull-back. `drawNebula` projects with z = puff.z - cam.z, so walking the
  // camera *backwards* is what makes the room open out — the frame gets bigger
  // than the viewer expected, which is the only job this beat has.
  const cam = cam3(t, 900 - t * 220);
  sky(g, cam, { neb: 0.66, star: 0.95, dust: 0.4, top: 'rgb(8,10,20)', bot: 'rgb(3,3,7)' });
  drawFlare(g, W * 0.24, H * 0.3, W, H, {
    i: 0.4, core: [255, 244, 224], streak: [150, 196, 255], ghost: [255, 186, 120], rays: 0.4, t, size: 0.7,
  });

  const aOut = 1 - clamp01((t - (dur - 1.15)) / 0.75);
  drawCard(g, 'BUT...', W * 0.5, H * 0.43, 84,
    { progress: clamp01((t - 0.7) / 0.9), cold: COL.ink, alpha: clamp01((t - 0.6) / 0.5) * aOut });
  drawCard(g, 'AMONGST ALL...', W * 0.5, H * 0.6, 84,
    { progress: clamp01((t - 2.5) / 1.4), cold: COL.ink, alpha: clamp01((t - 2.4) / 0.5) * aOut });
  veil(g, t, dur);
});

// ------------------------------------------------------------------ 5. YOU
def('05-theres-you', "THERE'S YOU.", 5.8, (g, t, dur) => {
  sky(g, cam3(t, t * 40), { neb: 0.34, star: 0.85, dust: 0.3, tiles: [CLOUDS[0], CLOUDS[3], CLOUDS[0], CLOUDS[3]],
    top: 'rgb(5,6,12)', bot: 'rgb(2,2,5)' });

  // One cold point, arriving. It is a spark for two seconds before it is a
  // ship, because the argument the whole cut has been building is that there is
  // exactly one of these left and it is small.
  const grow = easeOutCubic(clamp01((t - 0.5) / 2.6));
  const sx = W * 0.5;
  const sy = H * 0.47;
  g.save();
  g.globalCompositeOperation = 'lighter';
  drawRadial(g, flareSprite(COL.playerCore, 1), sx, sy, lerp(14, 180, grow), lerp(0.5, 0.85, grow));
  g.restore();
  if (grow > 0.25) {
    const a = clamp01((grow - 0.25) / 0.4);
    drawRadial(g, haloSprite(COL.player), sx, sy, 210 * a, 0.9 * a);
    drawShip(g, sx, sy, -Math.PI / 2 + Math.sin(t * 0.7) * 0.06, lerp(10, 62, grow), {
      thrust: 0.55 + 0.25 * Math.sin(t * 3), bank: Math.sin(t * 0.8) * 0.12, alpha: a, clock: t,
    });
  }

  const slam = clamp01((t - 3.05) / 0.5);
  blink(g, t - 3.05, 0.5);
  const aOut = 1 - clamp01((t - (dur - 1.2)) / 0.8);
  drawCard(g, "THERE'S YOU.", W * 0.5, H * 0.76, lerp(150, 96, easeOutQuint(slam)), {
    progress: 1, cold: COL.playerCore, hot: COL.player, hotFrom: 8,
    alpha: slam * aOut, glow: 1.5,
  });
  rules(g, W * 0.5, H * 0.76 + 74, 430, (t - 3.2) / 0.7, COL.player, slam * aOut);
  veil(g, t, dur);
});

// ------------------------------------------------------------- 6. GAMEPLAY
/**
 * A strike, authored rather than sampled.
 *
 * The first pass scattered bodies and then asked which ones happened to fall
 * near the line. Two did, and the card still said ANNIHILATION over a board
 * that had mostly survived. In a game whose entire promise is that the preview
 * does not lie, a trailer that miscounts its own kill is the one mistake not
 * available — so the line comes first and the bodies are placed *on* it, at
 * chosen distances, and the word is derived from how many there are.
 *
 * `decoys` are the rest of the board: they exist so the frame is a fight rather
 * than a queue, and they are deliberately nowhere near the line.
 */
function strikeShot(g, t, dur, cfg) {
  const { px, py, ang, reach, hits, decoys, word, hold, rel, tailCard, dimAmt = 1, flash } = cfg;
  const charge = clamp01((t - hold) / (rel - hold));
  const dim = (t < rel ? charge : Math.max(0, 1 - (t - rel) * 3.4)) * dimAmt;
  arena(g, t, dim);

  const w = t < rel ? 0 : clamp01((t - rel) / 0.3);
  const pts = hits.map((h, i) => ({
    x: px + Math.cos(ang) * h.d,
    y: py + Math.sin(ang) * h.d,
    i, kind: h.kind, r: h.r, s: i * 1.9 + 0.4,
  }));

  for (const e of decoys) {
    drawFoe(g, e.kind, e.x + Math.sin(t * 0.55 + e.s) * 10, e.y + Math.cos(t * 0.47 + e.s) * 8, {
      r: e.r, clock: t, seed: e.s, alpha: 0.92, rot: t * 0.5 + e.s, toP: 0.5, shield: 0.7,
    });
  }
  for (const p of pts) {
    const killAt = (p.i + 1) / (pts.length + 1);
    if (w > killAt) {
      burstFoe(g, p.kind, p.x, p.y, p.r, t - (rel + killAt * 0.3), 1);
      continue;
    }
    drawFoe(g, p.kind, p.x, p.y, {
      r: p.r, clock: t, seed: p.s, alpha: 1, rot: t * 0.55 + p.s, toP: 0.9, shield: 0.85,
      driftX: -Math.cos(ang) * 0.45, driftY: -Math.sin(ang) * 0.45,
    });
  }

  if (t < rel) {
    aimLine(g, px, py, ang, reach, pts, clamp01((t - (hold - 0.15)) / 0.5), t);
    reticle(g, px, py, charge, t, 1);
    drawShip(g, px, py, ang, 48, { thrust: 0.5, charge, clock: t });
  } else {
    const e = easeOutQuint(w);
    const ex = px + Math.cos(ang) * reach * e;
    const ey = py + Math.sin(ang) * reach * e;
    strikeBeam(g, px, py, ex, ey, (1 - w) * 0.9 + 0.12);
    drawShip(g, ex, ey, ang, 48, { thrust: 1, stretch: Math.min(1, w * 4), clock: t });
    blink(g, t - rel, flash);
  }

  const mk = clamp01((t - (rel + 0.32)) / 0.3);
  const mkOut = 1 - clamp01((t - tailCard) / 0.7);
  drawCard(g, word, W * 0.5, H * 0.135, lerp(132, 86, easeOutQuint(mk)), {
    cold: COL.warn, alpha: mk * mkOut, glow: 1.5,
  });
  rules(g, W * 0.5, H * 0.135 + 68, 460, (t - (rel + 0.45)) / 0.7, COL.warn, mk * mkOut);
  veil(g, t, dur);
}

def('06-gameplay', 'gameplay', 7.8, (g, t, dur) => {
  strikeShot(g, t, dur, {
    // Aimed down-right across open floor, and stopping at x≈1465 — well inside
    // frame. The first cut sent the ship out through the right edge, which left
    // four seconds of empty arena with the hero off screen.
    px: 560, py: 322, ang: 0.46, reach: 1010,
    hits: [
      { d: 260, kind: 'mote', r: 26 },
      { d: 450, kind: 'seeder', r: 30 },
      { d: 640, kind: 'mote', r: 26 },
      { d: 830, kind: 'ward', r: 32 },
    ],
    decoys: [
      { kind: 'lancer', x: 1560, y: 300, r: 30, s: 1.3 },
      { kind: 'mote', x: 360, y: 812, r: 26, s: 2.7 },
      { kind: 'mote', x: 1690, y: 880, r: 26, s: 4.1 },
      { kind: 'seeder', x: 230, y: 570, r: 28, s: 5.5 },
    ],
    word: 'QUAD', hold: 1.5, rel: 4.4, tailCard: 6.4, flash: 0.55,
  });
});

// ----------------------------------------------------------------- 7. PEAK
def('07-peak', 'the peak', 9.2, (g, t, dur) => {
  // ANNIHILATION is `MULTI_NAMES[kills - 2]` at index 5, which is seven kills.
  // So there are seven bodies on the line — the copy is taken from the game's
  // own table rather than chosen for how it sounds.
  strikeShot(g, t, dur, {
    px: 330, py: 690, ang: -0.4, reach: 1330,
    hits: [
      { d: 230, kind: 'mote', r: 26 },
      { d: 380, kind: 'seeder', r: 30 },
      { d: 530, kind: 'mote', r: 26 },
      { d: 680, kind: 'ward', r: 32 },
      { d: 830, kind: 'mote', r: 26 },
      { d: 980, kind: 'seeder', r: 30 },
      { d: 1130, kind: 'lancer', r: 30 },
    ],
    decoys: [
      { kind: 'mote', x: 700, y: 940, r: 26, s: 1.1 },
      { kind: 'lancer', x: 1520, y: 760, r: 30, s: 2.4 },
      { kind: 'mote', x: 1760, y: 470, r: 26, s: 3.3 },
      { kind: 'seeder', x: 300, y: 250, r: 28, s: 4.9 },
      { kind: 'mote', x: 1120, y: 900, r: 26, s: 6.2 },
    ],
    word: 'ANNIHILATION', hold: 1.2, rel: 5.0, tailCard: 7.6, flash: 0.95,
  });
});

// ---------------------------------------------------------------- 8. TITLE
// The title beat, with the ship arrival and no closing words — the date gets
// its own clip rather than being said twice.
const TITLE = await import('./seq.mjs?v=shipplain');
def('08-title', 'the title', TITLE.DURATION, (g, t) => {
  TITLE.frame(g, t);
});

// ----------------------------------------------------------------- 9. DATE
def('09-august-2026', 'AUGUST 2026', 4.8, (g, t, dur) => {
  drawVista(g, t + 11, { x: Math.sin(t * 0.2) * 5, y: 0, z: 1, rot: 0 }, { stage: 'companion', flare: 0 });
  const slam = clamp01((t - 0.7) / 0.45);
  blink(g, t - 0.7, 0.34);
  const aOut = 1 - clamp01((t - (dur - 1.2)) / 0.8);
  drawCard(g, 'AUGUST 2026', W * 0.5, H * 0.5, lerp(168, 112, easeOutQuint(slam)), {
    progress: 1, cold: COL.ink, hot: COL.warn, hotFrom: 7, alpha: slam * aOut, glow: 1.4,
  });
  rules(g, W * 0.5, H * 0.5 + 86, 470, (t - 0.9) / 0.7, COL.warn, slam * aOut);
  veil(g, t, dur);
});

// ------------------------------------------------------------------ exports
export const KEYS = DEFS.map((d) => d.key);

/**
 * The encoder pulls frames off a canvas the module owns, not one it passes in,
 * so anything handed to `encodeVariant` has to supply `canvas()` and `render()`
 * alongside `frame()`. One shared surface for every clip: they render strictly
 * one at a time, and nine 1920x1080 buffers held open for no reason is sixty
 * megabytes of nothing.
 */
let surface = null;
function surfaceOf() {
  if (!surface) {
    surface = document.createElement('canvas');
    surface.width = W;
    surface.height = H;
  }
  return surface;
}

/** One clip, shaped like a module the encoder already knows how to render. */
export function clip(key) {
  const d = DEFS.find((x) => x.key === key || x.key.endsWith(key));
  if (!d) throw new Error(`no clip "${key}" — have ${KEYS.join(', ')}`);
  return {
    W, H, FPS,
    VARIANT: d.key,
    DURATION: d.dur,
    frame(g, t) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.filter = 'none';
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      d.draw(g, Math.max(0, Math.min(t, d.dur)), d.dur);
    },
    canvas: surfaceOf,
    render(t) {
      const c = surfaceOf();
      this.frame(c.getContext('2d'), t);
      return c;
    },
    // `frames` is not informational — `encodeVariant` takes its loop bound from
    // `marks.frames`, and without it the count is undefined, zero frames are
    // encoded, and the failure surfaces as the muxer reading `colorSpace` off a
    // decoder config it was never given.
    marks: { key: d.key, title: d.title, dur: d.dur, frames: Math.round(d.dur * FPS) },
  };
}

/**
 * Every clip end to end. No concatenation and no re-encode of anything — each
 * clip already fades to black at its tail and up from it at its head, so the
 * joins are the dips, and the only thing this has to get right is which clip
 * owns the current second.
 */
const STARTS = [];
let acc = 0;
for (const d of DEFS) { STARTS.push(acc); acc += d.dur; }

export const FULL = {
  W, H, FPS,
  VARIANT: 'story',
  DURATION: acc,
  frame(g, t) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.filter = 'none';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    let i = DEFS.length - 1;
    while (i > 0 && t < STARTS[i]) i--;
    const d = DEFS[i];
    d.draw(g, Math.max(0, Math.min(t - STARTS[i], d.dur)), d.dur);
  },
  canvas: surfaceOf,
  render(t) {
    const c = surfaceOf();
    this.frame(c.getContext('2d'), t);
    return c;
  },
  marks: {
    clips: DEFS.map((d, i) => ({ key: d.key, at: +STARTS[i].toFixed(2), dur: d.dur })),
    frames: Math.round(acc * FPS),
    DURATION: +acc.toFixed(2),
  },
};
