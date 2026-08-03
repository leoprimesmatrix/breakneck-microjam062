/**
 * AFTERBURN TITLE SEQUENCE — the wordmark assembling itself out of debris.
 *
 * Dev-only, exactly like `composer.mjs`: loaded by hand from the browser
 * console against the vite dev server, rendered offline one frame at a time,
 * never imported by the game. Nothing here ships in the bundle.
 *
 * It draws with the game's own display face (`glyphs.ts`), so the shards are
 * genuine fragments of the real letterforms — every piece in flight is a run
 * of the polyline it will eventually become part of, not a stand-in shape.
 * The sequence therefore *cannot* land on anything but the real mark.
 *
 * The beat sheet:
 *
 *   0.0 – 0.5   the mark, whole and blazing, out of black. Half a second of
 *               brand before anything happens to it — a title sequence that
 *               opens on rubble has thrown away its own hook, and a sixth of a
 *               second of it reads as a flicker rather than as a statement.
 *   0.5 – 1.4   the shatter. It comes apart and the pieces are thrown out of
 *               frame, fast and decelerating, cooling to unlit metal as they go.
 *   1.4 – 4.9   the gather. Pieces close on their places and rush the last of
 *               it — the travel curve accelerates all the way, so they arrive
 *               at speed. AFTER locks left to right in cold ink; BURN follows
 *               after a held beat and ignites hot.
 *   4.9 – 5.5   the lock. Shockwave, chromatic split, speed rules through the
 *               mark, and every letter flashing white as it takes its colour.
 *   5.5 – 6.7   the tagline draws on beneath, pen-style, under a rule that
 *               opens from the centre.
 *   6.7 – 8.9   hold and breathe. Embers off BURN, then fade to black so the
 *               loop restarts from nothing.
 *
 * Offline is the one place `ctx.filter` blur is allowed — there is no next
 * frame to pay for it — so the bloom here is a real Gaussian rather than the
 * sprite-stamped accumulator the game runs at 60fps.
 */
import { COL, rgba } from '/src/config.ts';
import { glyphFor } from '/src/render/glyphs.ts';

export const W = 1920;
export const H = 1080;
export const FPS = 60;
export const DURATION = 8.9;

/** Sub-samples per output frame, and how much of the frame the shutter is open. */
const SUB = 4;
const SHUTTER = 0.85 / FPS;

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;

/** Deterministic PRNG: every re-render of the sequence is the same sequence. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R = rng(0x0af7e);
const rr = (a, b) => a + R() * (b - a);

// --------------------------------------------------------------- typography
const WORD = 'AFTERBURN';
const SPLIT = 5; // AFTER | BURN
const TRACK = 0.2;
const SLANT = 0.1;
const WEIGHT = 0.108;

const advance = (text, size, track) => {
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a + track;
  return (w - track) * size;
};

const SIZE = 1244 / (advance(WORD, 1, TRACK) || 1);
const MARK_W = advance(WORD, SIZE, TRACK);
const MARK_Y = 452; // vertical centre of the cap box
const X0 = W * 0.5 - MARK_W * 0.5;
const BASE = MARK_Y + SIZE * 0.5; // baseline, matching drawVec's 'mid'

/** Glyph space → canvas. Mirrors `strokeGlyph` in render/text.ts exactly. */
const GX = (gx, gy, ox) => ox + (gx + SLANT * (1 - gy)) * SIZE;
const GY = (gy) => BASE - (1 - gy) * SIZE;

// ------------------------------------------------------------------ timing
const SHATTER = 0.5; // the mark comes apart
const BLOW = 0.82; // how long the pieces take to reach the far end of the throw
const LAUNCH = 1.45; // when the pieces stop drifting and start homing
const TRAVEL = 2.0; // base flight time
const COLD = [104, 124, 158]; // debris: unlit metal, no side taken yet
const INK = COL.ink;
const HOT = COL.warn;

const LETTERS = [];
const SHARDS = [];

{
  let ox = X0;
  for (let ci = 0; ci < WORD.length; ci++) {
    const gl = glyphFor(WORD[ci]);
    const hot = ci >= SPLIT;
    // AFTER reads left to right; then the mark holds its breath for a fifth of
    // a second before BURN arrives, so the two-tone split is a *beat*, not just
    // two colours.
    const delay = hot ? 0.72 + (ci - SPLIT) * 0.11 : ci * 0.1;
    const L = { ci, ox, runs: gl.p, hot, land: 0 };

    // Every piece of a letter shares most of its displacement, so the wreckage
    // reads as a word broken into letters rather than as a bag of parts that
    // happens to contain one. Coherence at the letter scale is what makes the
    // drift look shattered instead of shuffled.
    const lox = rr(-1, 1) * 150;
    const loy = rr(-1, 1) * 88;
    const ltilt = rr(-1, 1) * 0.16;

    for (const run of gl.p) {
      for (let i = 2; i < run.length; i += 2) {
        const ax = GX(run[i - 2], run[i - 1], ox);
        const ay = GY(run[i - 1]);
        const bx = GX(run[i], run[i + 1], ox);
        const by = GY(run[i + 1]);
        const len = Math.hypot(bx - ax, by - ay);
        // Break long strokes into chunks, leave short ones — a crossbar wants
        // to arrive as a crossbar. The chunk length is jittered per stroke, so
        // the debris is a mix of slivers and stubs rather than a set of parts
        // cut to one length, which is the tell that a shatter was generated.
        // Pieces this size read as broken metal; finer and the mark dissolves
        // into sparks instead of wreckage.
        const k = Math.max(1, Math.round(len / (SIZE * rr(0.32, 0.78))));
        for (let j = 0; j < k; j++) {
          const t0 = j / k;
          const t1 = (j + 1) / k;
          const x0 = lerp(ax, bx, t0);
          const y0 = lerp(ay, by, t0);
          const x1 = lerp(ax, bx, t1);
          const y1 = lerp(ay, by, t1);
          const hx = (x0 + x1) * 0.5;
          const hy = (y0 + y1) * 0.5;

          // Scatter, in three tiers. A quarter of the mark stays roughly where
          // it belongs — cracked apart by a letter's width, not thrown — so the
          // word is *almost* there from the first frame and the audience is
          // reading it before they know they are. The middle tier dislocates
          // properly. The last is flung past the edge of frame and streams back
          // in, which is what keeps the field moving.
          const a = R() * TAU;
          const tier = R();
          const rad = tier < 0.34 ? rr(12, 96) : tier < 0.66 ? rr(200, 560) : rr(700, 1450);
          const start = LAUNCH + delay + rr(0, 0.13);
          const dur = TRAVEL + rr(-0.18, 0.3);
          const sh = {
            L,
            hot,
            hx,
            hy,
            // Local geometry, relative to the piece's own centre, so it can
            // tumble about itself.
            lx0: x0 - hx,
            ly0: y0 - hy,
            lx1: x1 - hx,
            ly1: y1 - hy,
            sx: lox + Math.cos(a) * rad * 1.3,
            sy: loy + Math.sin(a) * rad * 0.8,
            // Tumble and depth scale with how far the piece was thrown. A
            // fragment still hanging near its place is only tilted, so the
            // silhouette of the word survives in the wreckage; the ones flung
            // past the edge of frame are end-over-end and far away. Structure
            // is carried by orientation at least as much as by position — with
            // every piece spinning freely the field is confetti no matter where
            // it sits.
            sz: 1 + (rad / 1420) * rr(-0.62, 0.55),
            sr: ltilt + rr(-1, 1) * Math.PI * (0.05 + (rad / 1420) * 0.95),
            spin: rr(-1, 1) * (0.05 + (rad / 1420) * 0.85),
            vx: rr(-58, 58),
            vy: rr(-38, 38),
            wob: R() * TAU,
            bd: rr(0.86, 1.16), // not every piece leaves at the same speed

            lit: rr(0.62, 1.45), // not every piece catches the same light

            start,
            dur,
            landAt: start + dur,
          };
          SHARDS.push(sh);
          L.land = Math.max(L.land, sh.landAt);
        }
      }
    }
    LETTERS.push(L);
    ox += (gl.a + TRACK) * SIZE;
  }
}

/** The moment the last piece of the N sets. Everything downstream hangs off it. */
const LOCK = Math.max(...LETTERS.map((l) => l.land));
const TAG_T = LOCK + 0.62;
const TAG_DUR = 1.15;
const FADE = 0.6;

// ------------------------------------------------------------------ scenery
/** Cold dust, so the black reads as depth rather than as an empty PNG. */
const DUST = Array.from({ length: 260 }, () => ({
  x: R() * W,
  y: R() * H,
  z: rr(0.25, 1),
  r: rr(0.7, 2.1),
  a: rr(0.05, 0.3),
  vx: rr(-9, 9),
  vy: rr(-7, 7),
  ph: R() * TAU,
}));

/** Embers off BURN once it is lit. Deterministic births across the hold. */
const EMBERS = [];
{
  const src = SHARDS.filter((s) => s.hot);
  for (let i = 0; i < 90; i++) {
    const s = src[(R() * src.length) | 0];
    EMBERS.push({
      x: s.hx + rr(-14, 14),
      y: s.hy + rr(-26, 26),
      born: LOCK - 0.1 + (i / 90) * (DURATION - LOCK + 0.1) * 1.05,
      life: rr(1.4, 2.9),
      vx: rr(-16, 16),
      vy: rr(-52, -14),
      r: rr(1.1, 2.9),
      a: rr(0.35, 0.95),
    });
  }
}

/**
 * Swarf: fine debris that is *not* part of the mark. The letter fragments have
 * to stay big enough to read as fragments, which leaves the void thin — so the
 * density comes from chips instead, drifting inward with the pieces and then
 * blown out of frame by the shockwave. Nothing here ever lands.
 */
const CHIPS = Array.from({ length: 215 }, () => ({
  a: R() * TAU,
  rad: rr(180, 1500),
  orb: rr(-0.06, 0.06),
  len: rr(7, 34),
  wid: rr(1.2, 3.4),
  rot: R() * TAU,
  spin: rr(-1.6, 1.6),
  al: rr(0.07, 0.38),
  hot: R() < 0.18,
}));

// ------------------------------------------------------------------ canvas
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ink = makeCanvas(W, H);
const inkC = ink.getContext('2d');
const tint = makeCanvas(W, H);
const tintC = tint.getContext('2d');

// ------------------------------------------------------------------ drawing
/** Build one glyph's polylines as a path, spending at most `budget` pen px. */
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
        const t = left / seg;
        const mx = run[i - 2] + (run[i] - run[i - 2]) * t;
        const my = run[i - 1] + (run[i + 1] - run[i - 1]) * t;
        ctx.lineTo(X(mx, my), Y(my));
        return budget;
      }
    }
  }
  return used;
}

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

/** Centred run of the display face with a pen budget — used for the tagline. */
function strokeText(ctx, text, cx, y, size, track, weight, progress) {
  const w = advance(text, size, track);
  let budget = progress >= 1 ? Infinity : penLength(text, size) * progress;
  if (budget <= 0) return;
  let x = cx - w * 0.5;
  ctx.lineWidth = weight * size;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.beginPath();
  for (const ch of text) {
    if (budget <= 0) break;
    budget -= glyphPath(ctx, glyphFor(ch).p, x, size, SLANT * 0.55, y + size * 0.5, budget);
    x += (glyphFor(ch).a + track) * size;
  }
  ctx.stroke();
}

/**
 * The whole moving picture, at one instant, into the additive ink layer.
 * Called `SUB` times per output frame across the shutter, so anything travelling
 * fast smears itself — real motion blur rather than a streak drawn behind it.
 */
function drawInk(ctx, t, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;

  // --- dust
  const dz = clamp01(t / 1.0) * (1 - clamp01((t - (DURATION - FADE - 0.1)) / FADE));
  for (const d of DUST) {
    const x = (((d.x + d.vx * t) % W) + W) % W;
    const y = (((d.y + d.vy * t) % H) + H) % H;
    const tw = 0.6 + 0.4 * Math.sin(t * 1.4 + d.ph);
    ctx.globalAlpha = alpha * d.a * tw * dz * 0.75;
    ctx.fillStyle = rgba(COL.wall, 1);
    ctx.beginPath();
    ctx.arc(x, y, d.r * d.z, 0, TAU);
    ctx.fill();
  }

  // --- swarf
  const conv = clamp01((t - 0.5) / Math.max(0.001, LOCK - 0.5));
  // The swarf starts clearing just before the mark sets, so the flash does not
  // land on a screen full of lit grit.
  const blast = t > LOCK - 0.14 ? t - (LOCK - 0.14) : -1;
  const chipOut = 1 - (1 - clamp01((t - SHATTER) / 0.75)) ** 3;
  for (const c of CHIPS) {
    let a = alpha * c.al * clamp01((t - SHATTER) / 0.3);
    if (blast >= 0) a *= Math.max(0, 1 - blast / 0.5);
    if (a <= 0.001) continue;
    let rad = c.rad * chipOut * (1 - 0.42 * conv * conv);
    if (blast >= 0) rad += blast * 1500 * (0.6 + c.al);
    const ang = c.a + c.orb * t;
    const x = W * 0.5 + Math.cos(ang) * rad * 1.5;
    const y = MARK_Y + Math.sin(ang) * rad * 0.82;
    const rot = c.rot + c.spin * t;
    ctx.globalAlpha = a;
    ctx.strokeStyle = rgba(c.hot ? HOT : COL.wall, 1);
    ctx.lineWidth = c.wid;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(rot) * c.len * 0.5, y - Math.sin(rot) * c.len * 0.5);
    ctx.lineTo(x + Math.cos(rot) * c.len * 0.5, y + Math.sin(rot) * c.len * 0.5);
    ctx.stroke();
  }

  // --- shards
  // The mark is whole for the first fifth of a second and blazing; `fadeIn` is
  // the cut up from black, not a slow reveal.
  const fadeIn = clamp01(t / 0.14);
  const cloudC = Math.cos(t * 0.052);
  const cloudS = Math.sin(t * 0.052);
  for (const s of SHARDS) {
    const u = clamp01((t - s.start) / s.dur);
    const settled = t >= s.landAt;
    // Once a letter has fully set it is drawn intact — mitred joints and all —
    // so the finished mark is the real mark and not an approximation of it
    // stitched out of butt-capped pieces.
    const handoff = clamp01((t - s.L.land) / 0.13);
    if (handoff >= 1) continue;

    // The travel curve accelerates the whole way, so pieces arrive at speed
    // rather than easing into place. It was cubic, which spends the first half
    // of the flight moving almost nothing — combined with the drift before it,
    // that put three seconds of a nine-second piece on screen with no visible
    // progress. This exponent is the shallowest one that still reads as a rush
    // at the end.
    const e = u ** 2.2;
    const eR = clamp01(u * 1.14) ** 2;
    const eS = u * u;

    // Where the piece would be if it had never been called home. It keeps
    // drifting the whole time; the homing is a lerp *towards* the mark from
    // wherever the debris happens to have got to.
    // The whole cloud turns slowly about the mark, so the void has a system
    // in it rather than a screensaver.
    const ox = s.sx * cloudC - s.sy * cloudS;
    const oy = s.sx * cloudS + s.sy * cloudC;
    const dx0 = ox + s.vx * t + Math.sin(t * 0.6 + s.wob) * 30;
    const dy0 = oy + s.vy * t + Math.cos(t * 0.5 + s.wob) * 24;

    // The throw. Pieces leave the mark hard and decelerate into the drift —
    // easeOut, because debris is fastest at the instant it stops being a logo.
    const eb = 1 - (1 - clamp01((t - SHATTER) / (BLOW * s.bd))) ** 3;
    const fx = s.hx + dx0 * eb;
    const fy = s.hy + dy0 * eb;

    let x = lerp(fx, s.hx, e);
    let y = lerp(fy, s.hy, e);
    const rot = lerp((s.sr + s.spin * t) * eb, 0, eR);
    const sc = lerp(lerp(1, s.sz, eb), 1, eS);

    // Landing ring: a few pixels of damped overshoot along the approach, so the
    // piece sets like metal rather than like a tween finishing.
    if (settled) {
      const q = t - s.landAt;
      const k = Math.exp(-q * 16) * Math.sin(q * 46);
      const dx = s.hx - fx;
      const dy = s.hy - fy;
      const d = Math.hypot(dx, dy) || 1;
      x += (dx / d) * k * 5.5;
      y += (dy / d) * k * 5.5;
    }

    // Colour is the whole arc in one line: lit mark → unlit metal on the way
    // out, unlit metal → lit mark on the way back.
    const base = s.hot ? HOT : INK;
    const col = mix(mix(base, COLD, eb), base, clamp01(e * 1.35));
    const glowUp = settled ? Math.exp(-(t - s.landAt) * 6.2) : 0;
    // Near pieces are brighter than deep ones, and nothing in the void is
    // more than half lit — the mark earns its brightness by assembling.
    const depth = lerp(0.5, 1, clamp01((sc - 0.32) / 0.95));
    const a = alpha * (1 - handoff) * lerp(lerp(1, 0.5 * s.lit, eb), 1, e) * fadeIn * depth;

    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const px0 = x + (s.lx0 * cs - s.ly0 * sn) * sc;
    const py0 = y + (s.lx0 * sn + s.ly0 * cs) * sc;
    const px1 = x + (s.lx1 * cs - s.ly1 * sn) * sc;
    const py1 = y + (s.lx1 * sn + s.ly1 * cs) * sc;

    ctx.globalAlpha = a;
    ctx.strokeStyle = rgba(col, 1);
    ctx.lineWidth = WEIGHT * SIZE * sc;
    ctx.beginPath();
    ctx.moveTo(px0, py0);
    ctx.lineTo(px1, py1);
    ctx.stroke();

    // Ignition: the piece takes its side in a flash of white.
    if (glowUp > 0.01) {
      ctx.globalAlpha = a * glowUp * 0.9;
      ctx.strokeStyle = rgba(COL.playerCore, 1);
      ctx.lineWidth = WEIGHT * SIZE * (1 + glowUp * 1.1);
      ctx.stroke();
    }
  }

  // --- the mark before it comes apart. The shards sit exactly on it at eb = 0,
  // so this only exists to supply the mitred joints for the few frames the word
  // is whole; it hands over inside four frames and nothing pops.
  const whole = 1 - clamp01((t - SHATTER) / 0.06);
  if (whole > 0.001) {
    for (const L of LETTERS) {
      ctx.globalAlpha = alpha * whole * fadeIn;
      ctx.strokeStyle = rgba(L.hot ? HOT : INK, 1);
      ctx.lineWidth = WEIGHT * SIZE;
      ctx.beginPath();
      glyphPath(ctx, L.runs, L.ox, SIZE, SLANT, BASE);
      ctx.stroke();
    }
  }

  // --- letters that have set: the real mark, drawn properly
  for (const L of LETTERS) {
    const handoff = clamp01((t - L.land) / 0.13);
    if (handoff <= 0) continue;
    const flash = Math.exp(-Math.max(0, t - L.land) * 5.4);
    // A slow breath once everything is home — a static logo held for three
    // seconds reads as a freeze-frame, a breathing one reads as alive.
    const breathe = 1 + 0.045 * Math.sin((t - LOCK) * 1.9) * clamp01((t - LOCK) / 0.8);
    const col = L.hot ? HOT : INK;
    ctx.globalAlpha = alpha * handoff * breathe;
    ctx.strokeStyle = rgba(col, 1);
    ctx.lineWidth = WEIGHT * SIZE;
    ctx.beginPath();
    glyphPath(ctx, L.runs, L.ox, SIZE, SLANT, BASE);
    ctx.stroke();
    if (flash > 0.01) {
      ctx.globalAlpha = alpha * handoff * flash * 0.85;
      ctx.strokeStyle = rgba(COL.playerCore, 1);
      ctx.lineWidth = WEIGHT * SIZE * (1 + flash * 0.9);
      ctx.stroke();
    }
  }

  // --- speed rules: the mark should look like it arrived at velocity
  const rl = t - LOCK;
  if (rl > -0.05 && rl < 1.6) {
    for (let i = 0; i < 3; i++) {
      const p = clamp01((rl - i * 0.05) / 0.55);
      if (p <= 0) continue;
      const fade = clamp01(1 - (rl - 0.35 - i * 0.05) / 0.9);
      const yy = MARK_Y - SIZE * 0.46 + i * SIZE * 0.44;
      const x0 = W * 0.5 - MARK_W * 0.66;
      const len = MARK_W * 1.32 * easeOutQuint(p);
      const gd = ctx.createLinearGradient(x0, 0, x0 + len, 0);
      gd.addColorStop(0, rgba(COL.strike, 0));
      gd.addColorStop(0.6, rgba(COL.strike, (0.13 - i * 0.03) * fade));
      gd.addColorStop(1, rgba(COL.strike, 0));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = gd;
      ctx.fillRect(x0, yy, len, SIZE * (0.12 - i * 0.028));
    }
  }

  // --- rule + tagline
  const ru = clamp01((t - LOCK - 0.3) / 0.7);
  if (ru > 0) {
    const rw = 900 * easeOutQuint(ru);
    const ry = MARK_Y + SIZE * 0.72;
    const gd = ctx.createLinearGradient(W * 0.5 - rw * 0.5, 0, W * 0.5 + rw * 0.5, 0);
    gd.addColorStop(0, rgba(COL.focus, 0));
    gd.addColorStop(0.5, rgba(COL.focus, 0.5));
    gd.addColorStop(1, rgba(COL.focus, 0));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gd;
    ctx.fillRect(W * 0.5 - rw * 0.5, ry, rw, 2);
  }

  const tu = clamp01((t - TAG_T) / TAG_DUR);
  if (tu > 0) {
    ctx.globalAlpha = alpha * 0.98;
    ctx.strokeStyle = rgba(COL.focus, 1);
    strokeText(ctx, 'SPEED IS THE ONLY WEAPON', W * 0.5, MARK_Y + SIZE * 0.95, 34, 0.44, 0.13, tu);
  }

  // --- embers
  for (const e of EMBERS) {
    const q = t - e.born;
    if (q < 0 || q > e.life) continue;
    const p = q / e.life;
    ctx.globalAlpha = alpha * e.a * (1 - p) * clamp01(p * 8);
    ctx.fillStyle = rgba(mix(HOT, COL.playerCore, 0.25 * (1 - p)), 1);
    ctx.beginPath();
    ctx.arc(e.x + e.vx * q + Math.sin(q * 2.2 + e.x) * 6, e.y + e.vy * q + 9 * q * q, e.r * (1 - p * 0.5), 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

/** Camera: a slow push-in through the drift, and a kick at each impact. */
function camera(t) {
  const push = 1.085 - 0.085 * easeOutCubic(clamp01((t - SHATTER) / 5.6));
  const kick =
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 8) * 0.024 : 0) +
    (t > LOCK ? Math.exp(-(t - LOCK) * 7) * 0.02 : 0);
  const sway = Math.sin(t * 0.31) * 3.5;
  return { z: push + kick, x: sway, y: Math.cos(t * 0.24) * 2.4 };
}

/**
 * An impact: a tight white flash off the mark and a soft ring leaving frame.
 * `q` is seconds since it happened; negative does nothing.
 *
 * White and tight on purpose. A wide tinted veil turns the whole picture teal
 * for a sixth of a second, and the brief for this piece is a black background.
 * The ring is heavily blurred and past the edge of frame inside half a second —
 * a crisp ellipse held over a logo reads as clip art, not as pressure.
 */
function burst(g, q, veilAmp, ringAmp) {
  if (q < -0.02) return;
  const veil = Math.exp(-Math.max(0, q) * 21) * veilAmp;
  if (veil > 0.004) {
    const fg = g.createRadialGradient(W * 0.5, MARK_Y, 0, W * 0.5, MARK_Y, 820);
    fg.addColorStop(0, rgba(COL.playerCore, veil));
    fg.addColorStop(0.34, rgba(COL.playerCore, veil * 0.26));
    fg.addColorStop(1, rgba(COL.playerCore, 0));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    g.fillStyle = fg;
    g.fillRect(0, 0, W, H);
  }
  const rp = clamp01(q / 0.5);
  if (rp > 0 && rp < 1) {
    const rad = 150 + easeOutQuint(rp) * 2150;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.filter = `blur(${(26 + rp * 90).toFixed(1)}px)`;
    g.globalAlpha = (1 - rp) ** 2.2 * ringAmp;
    g.strokeStyle = rgba(COL.strike, 1);
    g.lineWidth = 10 + (1 - rp) * 46;
    g.beginPath();
    g.ellipse(W * 0.5, MARK_Y, rad, rad * 0.74, 0, 0, TAU);
    g.stroke();
    g.restore();
  }
}

/** One finished frame at time `t`, onto a 1920×1080 context. */
export function frame(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);

  // Ink: SUB sub-samples across the shutter, summed. Fast pieces smear.
  inkC.setTransform(1, 0, 0, 1, 0, 0);
  inkC.clearRect(0, 0, W, H);
  const cam = camera(t);
  inkC.save();
  inkC.translate(W * 0.5 + cam.x, H * 0.5 + cam.y);
  inkC.scale(cam.z, cam.z);
  inkC.translate(-W * 0.5, -H * 0.5);
  for (let s = 0; s < SUB; s++) {
    drawInk(inkC, t + (s / SUB) * SHUTTER, 1 / SUB);
  }
  inkC.restore();

  // Chromatic split: always a hair, a hard shear at the lock. Two tinted
  // copies of the ink, offset in opposite directions and added back.
  const ca =
    1.6 +
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 6.5) * 13 : 0) +
    (t > LOCK ? Math.exp(-(t - LOCK) * 6.5) * 15 : 0);
  for (const [dx, col] of [
    [-ca, [90, 200, 255]],
    [ca, [255, 96, 70]],
  ]) {
    tintC.setTransform(1, 0, 0, 1, 0, 0);
    tintC.globalCompositeOperation = 'source-over';
    tintC.globalAlpha = 1;
    tintC.clearRect(0, 0, W, H);
    tintC.drawImage(ink, 0, 0);
    tintC.globalCompositeOperation = 'source-in';
    tintC.fillStyle = rgba(col, 1);
    tintC.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.4;
    g.drawImage(tint, dx, 0);
  }

  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 1;
  g.drawImage(ink, 0, 0);

  // Bloom: three radii. The widest one is atmosphere, not glow — it is what
  // makes the black around the mark feel lit instead of switched off.
  const heat =
    (t > LOCK ? Math.exp(-(t - LOCK) * 4.5) : 0) +
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 5) * 0.8 : 0.8);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(9px)';
  g.globalAlpha = 0.72;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(30px)';
  g.globalAlpha = 0.62 + heat * 0.3;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(96px)';
  g.globalAlpha = 0.28 + heat * 0.1;
  g.drawImage(ink, 0, 0);
  g.restore();

  // The two impacts: the mark coming apart, and the mark setting.
  burst(g, t - SHATTER, 0.3, 0.3);
  burst(g, t - LOCK, 0.52, 0.5);

  // Vignette, then the fade that returns the loop to black.
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  // Wide and late: at the old radius the falloff reached the A and the N and
  // greyed them out, which reads as a badly exposed logo rather than as depth.
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.58, W * 0.5, H * 0.5, H * 1.18);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  const out = clamp01((t - (DURATION - FADE)) / FADE);
  const inn = 1 - clamp01(t / 0.12);
  const dark = Math.max(out, inn);
  if (dark > 0) {
    g.fillStyle = `rgba(0,0,0,${dark})`;
    g.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------ capture
let cv = null;

export function canvas() {
  if (!cv) cv = makeCanvas(W, H);
  return cv;
}

export function render(t) {
  const c = canvas();
  frame(c.getContext('2d'), t);
  return c;
}

/**
 * Render frames [from, to) and POST each as a PNG to the local receiver.
 * Chunked by the caller so no single console call runs for minutes.
 */
export async function shoot(from, to, port = 8788) {
  const c = canvas();
  const g = c.getContext('2d');
  for (let i = from; i < to; i++) {
    frame(g, i / FPS);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    // Retyped as text/plain so the POST stays a simple request: an image/png
    // body triggers a CORS preflight on every single one of 550 frames.
    await fetch(`http://localhost:${port}/?f=${String(i).padStart(4, '0')}.png`, {
      method: 'POST',
      body: new Blob([blob], { type: 'text/plain' }),
    });
  }
  return { done: to, total: Math.round(DURATION * FPS) };
}

export const marks = { LOCK, TAG_T, SIZE, MARK_W, shards: SHARDS.length, frames: Math.round(DURATION * FPS) };
