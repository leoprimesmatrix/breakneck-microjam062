/**
 * AFTERBURN TITLE SEQUENCE v2 — the wordmark assembling itself out of debris,
 * over a room that exists this time.
 *
 * Same contract as `titlecard.mjs`: dev-only, rendered offline one frame at a
 * time, never imported by the game, deterministic to the last pixel. What
 * changed, and why:
 *
 *   THE ROOM.  v1 played on a black card with dust. v2 stages the same event
 *   in the game's own space: a graphite nebula with one warm pocket (the
 *   enemy's side of the palette) and one cold one (yours), three layers of
 *   parallax starfield that flinch when the mark detonates, and a dark deck
 *   under everything that carries a blurred reflection of the whole sequence.
 *   The reflection is the load-bearing addition — light that lands on a
 *   surface is what makes a void read as a place rather than as a PNG.
 *
 *   THE COLD OPEN.  The mark is never seen whole. SHATTER sits before t=0,
 *   so frame 0 is already wreckage riding the blast wave — recoiling camera,
 *   decaying flash, star-streaks — an impact the viewer just missed. The
 *   anticipation beat belongs to the *assembly* instead: the word is the
 *   payoff, never the setup.
 *
 *   THE PHYSICS.  v1 shards flew home on straight lerps and spun freely the
 *   whole way, which is why it read as a tween. v2 pieces ride an elliptical
 *   blast wave out (debris leaves along the shockfront, not along random
 *   spokes), drift in a differentially-rotating field — inner pieces orbit
 *   faster, so the wreckage is a slow galaxy instead of a screensaver — and
 *   come home on a curved path, swinging wide before carving in, with the
 *   pieces of each letter biased to swirl the same way. In flight they stop
 *   tumbling and *bank into the curve*, nose-first like the ship does, and
 *   they land with a directional overshoot and a spray of sparks, like metal
 *   finding its seam. A tenth of them leave late and whip in fast — rubato is
 *   the difference between a mechanism and a performance.
 *
 *   THE METAL.  v1 shards were uniform butt-capped strokes. v2 pieces taper
 *   at the ends, carry a white-hot core, and glint as their tumble carries
 *   them through the key light — three passes instead of one, which offline
 *   rendering is allowed to afford.
 *
 * Variants, chosen by query string on the module URL (`seq.mjs?v=...`):
 *   plain    — the sequence
 *   soon     — "COMING SOON." at the bottom of frame, in the mark's two-tone
 *   date     — "AUGUST 2026", same treatment
 *   shipsoon — the game's interceptor sweeps in low over the deck, coils on
 *              the exact spot the words are about to occupy (the game's own
 *              charge language: reticle, bullet-time dim), pitches its nose
 *              at the sky and strikes away through the top of frame — and
 *              "COMING SOON." is what the flash leaves behind.
 *   shipdate — the same beat, closing on "AUGUST 2026".
 *
 * One rule the whole family obeys: the mark is never seen whole before it
 * breaks. The video opens mid-detonation — shards already riding the blast
 * wave out of a word that failed before the first frame.
 */
import {
  COL, rgba, TAU, clamp01, glyphFor, drawShip, drawRadial, flareSprite,
} from './lib.mjs';
import { drawVista } from './vista.mjs';

// ------------------------------------------------------------------ variant
const VQ = new URL(import.meta.url).searchParams.get('v') || 'plain';
export const VARIANT = ['plain', 'soon', 'date', 'shipsoon', 'shipdate'].includes(VQ) ? VQ : 'plain';
const SUBTITLE =
  VARIANT === 'soon' || VARIANT === 'shipsoon' ? { cold: 'COMING ', hot: 'SOON.' } :
  VARIANT === 'date' || VARIANT === 'shipdate' ? { cold: 'AUGUST ', hot: '2026' } : null;
const SHIP = VARIANT.startsWith('ship');

export const W = 1920;
export const H = 1080;
export const FPS = 60;

/** Sub-samples per output frame, and how much of the frame the shutter is open. */
const SUB = 8;
const SHUTTER = 0.85 / FPS;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
/** Shortest signed distance from `a` to the nearest multiple of `m`. */
const wrapTo = (a, m) => a - Math.round(a / m) * m;

/** Deterministic PRNG: every re-render of the sequence is the same sequence. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R = rng(0x0af7e2);
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
const MARK_Y = 430; // vertical centre of the cap box — a hair high, the room below breathes
const X0 = W * 0.5 - MARK_W * 0.5;
const BASE = MARK_Y + SIZE * 0.5;

const GX = (gx, gy, ox) => ox + (gx + SLANT * (1 - gy)) * SIZE;
const GY = (gy) => BASE - (1 - gy) * SIZE;

// ------------------------------------------------------------------ timing
// SHATTER sits before zero: the word broke before the camera was rolling.
// Frame 0 inherits the recoiling camera, the decaying flash, the chromatic
// shear and the star-streaks of an impact the viewer just missed — a cold
// open on wreckage, never on the brand.
const SHATTER = -0.12;
const BLOW = 0.82;
const LAUNCH = 1.4; // the wreckage gets a beat to be a place before it moves
const TRAVEL = 1.95;
const COLD = [104, 124, 158];
const DEEP = [46, 58, 86]; // what a far piece cools toward — the nebula's own hue
const INK = COL.ink;
const HOT = COL.warn;

/** The blast is centred on the seam the word actually breaks on: AFTER|BURN. */
const BLAST = { x: X0 + advance('AFTER', SIZE, TRACK) + TRACK * SIZE * 0.5, y: MARK_Y };

const LETTERS = [];
const SHARDS = [];

{
  let ox = X0;
  for (let ci = 0; ci < WORD.length; ci++) {
    const gl = glyphFor(WORD[ci]);
    const hot = ci >= SPLIT;
    const delay = hot ? 0.74 + (ci - SPLIT) * 0.11 : ci * 0.1;
    const cx = ox + (gl.a * 0.5) * SIZE;
    const L = { ci, ox, cx, runs: gl.p, hot, land: 0 };

    // Letter-coherent displacement and swirl: the wreckage reads as a word
    // broken into letters, and the pieces of one letter orbit home the same
    // way round, so each letter *converges* rather than merely accretes.
    const lox = rr(-1, 1) * 150;
    const loy = rr(-1, 1) * 88;
    const ltilt = rr(-1, 1) * 0.16;
    const lswirl = R() < 0.5 ? -1 : 1;

    for (const run of gl.p) {
      for (let i = 2; i < run.length; i += 2) {
        const ax = GX(run[i - 2], run[i - 1], ox);
        const ay = GY(run[i - 1]);
        const bx = GX(run[i], run[i + 1], ox);
        const by = GY(run[i + 1]);
        const len = Math.hypot(bx - ax, by - ay);
        // Chunk length jittered per stroke: slivers and stubs, not parts cut
        // to one length. Finer than v1 — twice the pieces — because the field
        // has to read as wreckage from a 1080p promo, not from a game HUD.
        const k = Math.max(1, Math.round(len / (SIZE * rr(0.17, 0.44))));
        for (let j = 0; j < k; j++) {
          const t0 = j / k;
          const t1 = (j + 1) / k;
          const x0 = lerp(ax, bx, t0);
          const y0 = lerp(ay, by, t0);
          const x1 = lerp(ax, bx, t1);
          const y1 = lerp(ay, by, t1);
          const hx = (x0 + x1) * 0.5;
          const hy = (y0 + y1) * 0.5;

          // Three tiers of scatter, as in v1 — a quarter barely cracked, a
          // middle properly dislocated, the rest flung past frame — but the
          // throw direction now rides the blast: far pieces leave along the
          // shockfront from the seam, near pieces just break where they stand.
          const tier = R();
          const rad = tier < 0.34 ? rr(14, 110) : tier < 0.66 ? rr(230, 600) : rr(760, 1500);
          const bang = Math.atan2((hy - BLAST.y) * 1.35, (hx - BLAST.x) * 0.72);
          const a = bang + rr(-1, 1) * (tier < 0.34 ? 1.5 : tier < 0.66 ? 0.8 : 0.45);

          let start = LAUNCH + delay + rr(0, 0.13);
          let dur = TRAVEL + rr(-0.18, 0.3);
          // Rubato: a tenth of the pieces hold back, then whip in fast.
          if (R() < 0.1) {
            start += rr(0.12, 0.32);
            dur *= rr(0.5, 0.68);
          }

          const seglen = Math.hypot(x1 - x0, y1 - y0);
          const sh = {
            L,
            hot,
            hx,
            hy,
            lx0: x0 - hx,
            ly0: y0 - hy,
            lx1: x1 - hx,
            ly1: y1 - hy,
            seglen,
            axis: Math.atan2(y1 - y0, x1 - x0),
            rad,
            sx: lox + Math.cos(a) * rad * 1.28,
            sy: loy + Math.sin(a) * rad * 0.8,
            sz: 1 + (rad / 1420) * rr(-0.62, 0.55),
            sr: ltilt + rr(-1, 1) * Math.PI * (0.05 + (rad / 1420) * 0.95),
            spin: rr(-1, 1) * (0.05 + (rad / 1420) * 0.85),
            // Barely-thrown pieces barely wander — they are what keeps the
            // word almost readable inside its own wreckage.
            vx: rr(-58, 58) * (0.25 + 0.75 * Math.min(1, rad / 650)),
            vy: rr(-38, 38) * (0.25 + 0.75 * Math.min(1, rad / 650)),
            wob: R() * TAU,
            bd: rr(0.86, 1.16),
            lit: rr(0.62, 1.45),
            // Curved approach: swing wide, then carve in. Sign is biased to
            // the letter's own swirl so each letter closes like a hand.
            arc: rr(0.1, 0.42) * (rad > 600 ? 1.25 : 1) * (R() < 0.72 ? lswirl : -lswirl),
            gph: R() * TAU,
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

/** The moment the last piece sets. Everything downstream hangs off it. */
const LOCK = Math.max(...LETTERS.map((l) => l.land));
const TAG_T = LOCK + 0.58;
const TAG_DUR = 1.1;
const FADE = 0.6;

// Ship beat (`shipsoon` / `shipdate`). Approach, coil, release — the game's
// own grammar for a strike. The interceptor sweeps in low over the deck,
// coils on the exact spot the release line is about to occupy, pitches its
// nose at the sky, and strikes away through the top-right of frame. The
// subtitle is what the flash leaves behind.
const SHIP_T0 = TAG_T + TAG_DUR + 0.35;
const APPR = 1.3;
const CHARGE_D = 0.65;
const STRIKE_D = 0.26;
const ST = SHIP_T0 + APPR + CHARGE_D; // release
const SHIP_C = { x: W * 0.49, y: H * 0.862 }; // where it coils: the subtitle's spot
const STRIKE_ANG = -0.515; // up and out, clearing under BURN and past it
const REL = { x: SHIP_C.x + 26, y: SHIP_C.y - 10 }; // where the strike leaves from

// The subtitle takes a full breath after the tagline before it speaks; in
// the ship variants it is the strike's own punctuation instead, arriving a
// beat after the flash clears.
const TAG2_T = SHIP ? ST + 0.6 : TAG_T + TAG_DUR + 1.0;
const TAG2_DUR = SHIP ? 0.8 : 0.95;
/** Bottom-centre of the whole frame — poster placement, clear of the lockup. */
const SUB_Y = H * 0.868;

export const DURATION =
  SHIP ? TAG2_T + TAG2_DUR + 2.4 :
  SUBTITLE ? TAG2_T + TAG2_DUR + 2.45 :
  TAG_T + TAG_DUR + 2.6;

// ------------------------------------------------------------------ scenery
const R2 = rng(0x5eed);
const rr2 = (a, b) => a + R2() * (b - a);

/** Deck line. Everything above is sky; below is the dark floor that reflects. */
const HORIZON = H * 0.802;

/**
 * Which sky this variant stands in. Five files that all open on the same
 * backdrop look like five renders of one asset; giving the ship variants their
 * own worlds makes the set read as a campaign. `vista.mjs` documents each.
 */
const STAGE =
  VARIANT === 'shipsoon' ? 'eclipse' :
  VARIANT === 'shipdate' ? 'rise' :
  'companion';

/**
 * How much of the old flat nebula survives on top of the new sky, and how much
 * of the old star spray. Both used to carry the whole background; now they are
 * accents over something with real depth, and left at full strength they turn
 * a shaded world and a volumetric nebula back into grey soup.
 */
const NEB_MIX = 0.34;
const STAR_MIX = 0.4;

/**
 * The nebula, two parallax layers of it, baked once. Elongated soft blobs in
 * the game's graphite, with the palette war painted in at very low alpha: a
 * warm pocket upper-right (their side), a cold one lower-left (yours). It has
 * to stay close to black — the brief is still a dark room, just not an empty
 * one.
 */
function bakeNebula(nBlobs, big) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d');
  for (let i = 0; i < nBlobs; i++) {
    const fam = R2();
    let col;
    let al;
    let x;
    let y;
    if (fam < 0.6) {
      col = mix(COL.floor, COL.grid, rr2(0.1, 0.8));
      al = rr2(0.05, 0.11);
      x = rr2(-0.05, 1.05) * 640;
      y = rr2(-0.08, 0.72) * 360;
    } else if (fam < 0.78) {
      col = mix(COL.warn, [110, 62, 26], 0.45);
      al = rr2(0.04, 0.085);
      x = (0.72 + rr2(-0.16, 0.16)) * 640;
      y = (0.24 + rr2(-0.13, 0.13)) * 360;
    } else if (fam < 0.94) {
      col = mix(COL.player, COL.grid, 0.6);
      al = rr2(0.03, 0.07);
      x = (0.2 + rr2(-0.15, 0.15)) * 640;
      y = (0.58 + rr2(-0.12, 0.12)) * 360;
    } else {
      col = COL.seeder;
      al = rr2(0.02, 0.04);
      x = (0.86 + rr2(-0.1, 0.1)) * 640;
      y = (0.55 + rr2(-0.1, 0.1)) * 360;
    }
    const r = rr2(60, big ? 230 : 150);
    g.save();
    g.translate(x, y);
    g.rotate(rr2(-0.5, 0.5));
    g.scale(1, rr2(0.42, 0.8));
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, rgba(col, al));
    gr.addColorStop(0.6, rgba(col, al * 0.45));
    gr.addColorStop(1, rgba(col, 0));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = gr;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
  return c;
}
const NEB_FAR = bakeNebula(26, true);
const NEB_NEAR = bakeNebula(42, false);

/**
 * A spiral galaxy, baked face-on and drawn tilted. Two log-spiral arms of
 * star flecks and haze around a warm core — the one thing in the sky that
 * visibly *turns*, because a background only reads as alive if something in
 * it is going somewhere slowly.
 */
const GALAXY = (() => {
  const S = 560;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  g.globalCompositeOperation = 'lighter';
  let gr = g.createRadialGradient(cx, cy, 0, cx, cy, 250);
  gr.addColorStop(0, rgba(COL.grid, 0.15));
  gr.addColorStop(1, rgba(COL.grid, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  gr = g.createRadialGradient(cx, cy, 0, cx, cy, 76);
  gr.addColorStop(0, 'rgba(255,240,214,0.8)');
  gr.addColorStop(0.3, rgba(mix([255, 240, 214], COL.player, 0.4), 0.3));
  gr.addColorStop(1, rgba(COL.player, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 300; i++) {
      const th = i * 0.028 + arm * Math.PI;
      const rad = 16 * Math.exp(0.118 * i * 0.028);
      if (rad > 262) break;
      const ja = th + rr2(-0.13, 0.13);
      const jr = rad * (1 + rr2(-0.15, 0.15));
      const x = cx + Math.cos(ja) * jr;
      const y = cy + Math.sin(ja) * jr;
      const along = rad / 262;
      if (i % 5 === 0) {
        const hz = rr2(14, 34);
        const hg = g.createRadialGradient(x, y, 0, x, y, hz);
        const hc = mix(COL.grid, COL.player, rr2(0.15, 0.5));
        hg.addColorStop(0, rgba(hc, (0.1 - 0.06 * along) * rr2(0.5, 1)));
        hg.addColorStop(1, rgba(hc, 0));
        g.fillStyle = hg;
        g.fillRect(x - hz, y - hz, hz * 2, hz * 2);
      }
      const cold = R2() < 0.8;
      g.fillStyle = rgba(
        cold ? mix(COL.wall, COL.player, 0.4) : mix(COL.warn, [255, 222, 176], 0.5),
        (0.55 - 0.34 * along) * rr2(0.4, 1),
      );
      g.beginPath();
      g.arc(x, y, rr2(0.7, 2.2), 0, TAU);
      g.fill();
    }
  }
  return c;
})();

/** Wisps: small baked cloud tiles that drift across the sky all sequence. */
function bakeWisp(n) {
  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 120;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const col = R2() < 0.66
      ? mix(COL.grid, COL.player, rr2(0.2, 0.6))
      : mix(COL.warn, [120, 70, 30], 0.5);
    const x = rr2(40, 320);
    const y = rr2(28, 92);
    const r = rr2(28, 80);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(col, rr2(0.05, 0.1)));
    gr.addColorStop(1, rgba(col, 0));
    g.save();
    g.translate(x, y);
    g.scale(1, rr2(0.22, 0.4));
    g.translate(-x, -y);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }
  return c;
}
const WISPS = [bakeWisp(9), bakeWisp(7), bakeWisp(8)];
const WISP_POS = [
  { img: 0, y: H * 0.13, v: 14, x0: 260, s: 2.7, a: 0.075 },
  { img: 1, y: H * 0.35, v: -9, x0: 980, s: 2.1, a: 0.06 },
  { img: 2, y: H * 0.55, v: 21, x0: 1560, s: 1.7, a: 0.05 },
  { img: 0, y: H * 0.24, v: -16, x0: 540, s: 3.0, a: 0.06 },
  { img: 1, y: H * 0.46, v: 11, x0: 1240, s: 2.3, a: 0.05 },
];

/** Shooting stars, on a deterministic schedule, kept out of the mark's band. */
const COMETS = [
  { t0: 1.7, x0: W * 0.78, y0: H * 0.07, dx: -520, dy: 200, warm: false },
  { t0: 4.6, x0: W * 0.1, y0: H * 0.15, dx: 480, dy: 140, warm: false },
  { t0: 8.1, x0: W * 0.58, y0: H * 0.05, dx: 400, dy: 240, warm: true },
  { t0: 10.9, x0: W * 0.24, y0: H * 0.09, dx: 520, dy: 170, warm: false },
];
const COMET_D = 0.9;

/** Three planes of stars. `px` is the parallax factor against the camera. */
function bakeStars(n, rMin, rMax, aMin, aMax, px) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: R2() * W,
      y: R2() * HORIZON * 1.02,
      r: rr2(rMin, rMax),
      a: rr2(aMin, aMax),
      tw: rr2(0.5, 2.2),
      ph: R2() * TAU,
      px,
      hero: false,
    });
  }
  return arr;
}
const STARS = [
  ...bakeStars(120, 0.5, 1.1, 0.1, 0.34, 0.25),
  ...bakeStars(70, 0.8, 1.6, 0.16, 0.5, 0.55),
  ...bakeStars(34, 1.0, 2.1, 0.22, 0.62, 1.0),
];
for (let i = 0; i < 6; i++) STARS[120 + 70 + (R2() * 34 | 0)].hero = true;

/** Cold dust inside the camera space, as in v1 — the room has air in it. */
const DUST = Array.from({ length: 240 }, () => ({
  x: R() * W,
  y: R() * H,
  z: rr(0.25, 1),
  r: rr(0.7, 2.1),
  a: rr(0.05, 0.3),
  vx: rr(-9, 9),
  vy: rr(-7, 7),
  ph: R() * TAU,
}));

/** Embers off BURN once it is lit. */
const EMBERS = [];
{
  const src = SHARDS.filter((s) => s.hot);
  for (let i = 0; i < 110; i++) {
    const s = src[(R() * src.length) | 0];
    EMBERS.push({
      x: s.hx + rr(-14, 14),
      y: s.hy + rr(-26, 26),
      born: LOCK - 0.1 + (i / 110) * (DURATION - LOCK + 0.1) * 1.05,
      life: rr(1.4, 2.9),
      vx: rr(-16, 16),
      vy: rr(-52, -14),
      r: rr(1.1, 2.9),
      a: rr(0.35, 0.95),
    });
  }
  // The strike's wake: a shower of embers strewn along the departure line,
  // tumbling slowly after the ship that left them.
  if (SHIP) {
    const dx = Math.cos(STRIKE_ANG);
    const dy = Math.sin(STRIKE_ANG);
    for (let i = 0; i < 70; i++) {
      const d = rr(50, 1350);
      EMBERS.push({
        x: REL.x + dx * d + rr(-32, 32),
        y: REL.y + dy * d + rr(-26, 26),
        born: ST + 0.02 + (i / 70) * 0.8,
        life: rr(0.9, 2.1),
        vx: rr(20, 130) * dx,
        vy: rr(20, 130) * dy + rr(-26, 12),
        r: rr(1.0, 2.5),
        a: rr(0.38, 0.95),
      });
    }
  }
}

/** Swarf: fine debris that is not part of the mark. Nothing here ever lands. */
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

/** Film grain, three baked tiles cycled per frame. */
const GRAIN = [];
{
  const G3 = rng(0x97a1);
  for (let n = 0; n < 3; n++) {
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    const g = c.getContext('2d');
    const id = g.createImageData(320, 320);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 122 + (G3() - 0.5) * 40;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    GRAIN.push(c);
  }
}

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
const refl = makeCanvas(W, H);
const reflC = refl.getContext('2d');

// ------------------------------------------------------------------ drawing
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

/** Centred run of the display face with a pen budget — the tagline. */
function strokeText(ctx, text, cx, y, size, track, weight, progress, slant = SLANT * 0.55) {
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
    budget -= glyphPath(ctx, glyphFor(ch).p, x, size, slant, y + size * 0.5, budget);
    x += (glyphFor(ch).a + track) * size;
  }
  ctx.stroke();
}

/**
 * The subtitle, in the mark's own two-tone: cold run, then hot run, drawn on
 * with one shared pen. This is the "COMING SOON." / "AUGUST 2026" of the
 * variants — title-styled on purpose, down to the full slant. It lives at
 * the bottom-centre of the whole frame, on the deck, like the credit line on
 * a poster — and in the ship variants it is born straight out of the strike
 * flash, white-hot, cooling into its own two colours as it draws.
 */
function strokeSubtitle(ctx, t, alpha) {
  if (!SUBTITLE) return;
  const su = clamp01((t - TAG2_T) / TAG2_DUR);
  if (su <= 0) return;
  const size = 50;
  const track = 0.5;
  const y = SUB_Y;
  const text = SUBTITLE.cold + SUBTITLE.hot;
  const total = penLength(text, size);
  let budget = su >= 1 ? Infinity : total * su;
  const w = advance(text, size, track);
  let x = W * 0.5 - w * 0.5;
  const flash = su >= 1 ? Math.exp(-(t - (TAG2_T + TAG2_DUR)) * 5) : 0;
  // Born hot: for the first beat the pen writes in near-white, and the line
  // cools to its true colour behind it. Strongest in the ship variants,
  // where the words are what the strike flash leaves on the deck.
  const birth = (SHIP ? 0.9 : 0.45) * (1 - clamp01((t - TAG2_T) / 0.34));

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  let i = 0;
  for (const ch of text) {
    if (budget <= 0) break;
    const hot = i >= SUBTITLE.cold.length;
    ctx.globalAlpha = alpha * 0.98;
    ctx.strokeStyle = rgba(mix(hot ? HOT : INK, [255, 255, 255], birth), 1);
    ctx.lineWidth = 0.11 * size;
    ctx.beginPath();
    const used = glyphPath(ctx, glyphFor(ch).p, x, size, SLANT, y + size * 0.5, budget);
    ctx.stroke();
    if (flash > 0.01) {
      ctx.globalAlpha = alpha * flash * 0.8;
      ctx.strokeStyle = rgba(COL.playerCore, 1);
      ctx.lineWidth = 0.11 * size * (1 + flash * 0.9);
      ctx.stroke();
    }
    budget -= used;
    x += (glyphFor(ch).a + track) * size;
    i++;
  }
}

// ---------------------------------------------------------------- the ship
/**
 * Cubic bezier and its derivative, for the approach path: in from mid-left,
 * a diving sweep low across the deck — its reflection riding with it while
 * it is still above the horizon — then a level hook up into the coil point
 * at bottom-centre, nose already drifting toward the sky.
 */
const SHIP_P = [
  { x: -340, y: H * 0.56 },
  { x: W * 0.3, y: H * 1.02 },
  { x: W * 0.335, y: H * 0.885 },
  { x: SHIP_C.x, y: SHIP_C.y },
];
function bez3(p, u) {
  const iu = 1 - u;
  return {
    x: iu * iu * iu * p[0].x + 3 * iu * iu * u * p[1].x + 3 * iu * u * u * p[2].x + u * u * u * p[3].x,
    y: iu * iu * iu * p[0].y + 3 * iu * iu * u * p[1].y + 3 * iu * u * u * p[2].y + u * u * u * p[3].y,
  };
}
function bez3d(p, u) {
  const iu = 1 - u;
  return {
    x: 3 * iu * iu * (p[1].x - p[0].x) + 6 * iu * u * (p[2].x - p[1].x) + 3 * u * u * (p[3].x - p[2].x),
    y: 3 * iu * iu * (p[1].y - p[0].y) + 6 * iu * u * (p[2].y - p[1].y) + 3 * u * u * (p[3].y - p[2].y),
  };
}

/** The heading the approach path arrives on — the charge pitches up from it. */
const ENTRY_ANG = Math.atan2(SHIP_P[3].y - SHIP_P[2].y, SHIP_P[3].x - SHIP_P[2].x);

/** Where the interceptor is and what it is doing, at any instant of the beat. */
function shipPose(t) {
  if (!SHIP || t < SHIP_T0) return null;
  if (t < SHIP_T0 + APPR) {
    const u = easeOutCubic(clamp01((t - SHIP_T0) / APPR)) * 0.999;
    const p = bez3(SHIP_P, u);
    const d = bez3d(SHIP_P, u);
    const ahead = bez3d(SHIP_P, Math.min(1, u + 0.03));
    const turn = wrapTo(Math.atan2(ahead.y, ahead.x) - Math.atan2(d.y, d.x), TAU);
    return {
      x: p.x,
      y: p.y + Math.sin(t * 2.1) * 4,
      angle: Math.atan2(d.y, d.x),
      r: 40 + 20 * u,
      thrust: 0.92,
      // Rolls out of the entry, then banks with the path's own curvature.
      bank: clamp(turn * 16, -0.62, 0.62) + (1 - u) * (1 - u) * 0.55,
      charge: 0,
      stretch: 0,
    };
  }
  if (t < ST) {
    // The coil: it holds the subtitle's spot, and over the charge its nose
    // pitches up from the arrival heading to the departure line — the ship
    // aims at the sky while the reticle spins, so the release needs no words.
    const v = clamp01((t - SHIP_T0 - APPR) / CHARGE_D);
    const e = easeOutCubic(v);
    return {
      x: SHIP_C.x + v * 26,
      y: SHIP_C.y + Math.sin(t * 2.1) * (1 - v) * 3 - e * 10,
      angle: ENTRY_ANG + wrapTo(STRIKE_ANG - ENTRY_ANG, TAU) * e,
      r: 60,
      thrust: 0.8 - 0.5 * e,
      bank: 0,
      charge: e,
      stretch: 0,
    };
  }
  const w = clamp01((t - ST) / STRIKE_D);
  const ei = w * w * (0.35 + 0.65 * w);
  return {
    x: REL.x + Math.cos(STRIKE_ANG) * ei * 2100,
    y: REL.y + Math.sin(STRIKE_ANG) * ei * 2100,
    angle: STRIKE_ANG,
    r: 60,
    thrust: 1,
    bank: 0,
    charge: 1 - w,
    stretch: Math.min(1, w * 5),
  };
}

/** The spindle afterimages of `drawTrail`, sampled off the analytic path. */
function drawShipTrail(ctx, t, alpha) {
  for (let k = 1; k <= 14; k++) {
    const tq = t - k * 0.016;
    const p = shipPose(tq);
    if (!p) break;
    const a = 1 - k / 15;
    const striking = tq >= ST;
    const len = p.r * (striking ? 4.8 : 2.1) * a;
    const wid = p.r * (striking ? 0.34 : 0.46) * a;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = rgba(COL.strike, a * a * 0.4 * alpha);
    ctx.beginPath();
    ctx.moveTo(len, 0);
    ctx.lineTo(-len * 0.35, -wid);
    ctx.lineTo(-len, 0);
    ctx.lineTo(-len * 0.35, wid);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** The charge reticle from `drawAura`: the weapon going live, in miniature. */
function drawReticle(ctx, p, t, alpha) {
  if (p.charge < 0.02) return;
  const cr = p.r * (3.3 - p.charge * 1.6);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = rgba(COL.focus, 0.45 * p.charge * alpha);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, cr, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = rgba(COL.playerCore, 0.8 * p.charge * alpha);
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const a = t * 3.4 + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, cr, a, a + 0.42);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(COL.strike, 0.7 * p.charge * alpha);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = -p.angle + (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * (cr + 3), s * (cr + 3));
    ctx.lineTo(c * (cr + 9), s * (cr + 9));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The strike beam — the game's three-layer bar, from the release point up
 * and out along the departure line. It clears under BURN and exits past the
 * top-right corner: the sky gets underlined, not the mark.
 */
function drawBeam(ctx, t, alpha) {
  if (!SHIP || t < ST) return;
  const p = shipPose(t);
  const env = Math.min(1, (t - ST) / 0.03) * Math.exp(-Math.max(0, t - ST - STRIKE_D) * 5.2);
  if (env < 0.01) return;
  const dx = Math.cos(STRIKE_ANG);
  const dy = Math.sin(STRIKE_ANG);
  const len = Math.min(Math.hypot(p.x - REL.x, p.y - REL.y) + p.r * 1.5, 2400);
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, col, a] of [
    [2.4, COL.strike, 0.2],
    [0.9, COL.strike, 0.55],
    [0.34, COL.playerCore, 0.95],
  ]) {
    ctx.strokeStyle = rgba(col, a * env * alpha);
    ctx.lineWidth = 46 * w;
    ctx.beginPath();
    ctx.moveTo(REL.x + dx * 26, REL.y + dy * 26);
    ctx.lineTo(REL.x + dx * len, REL.y + dy * len);
    ctx.stroke();
  }
  drawRadial(ctx, flareSprite(COL.strike, 1), REL.x, REL.y, 132 * env, env * alpha);
  ctx.restore();
}

// ------------------------------------------------------------- shard motion
/**
 * Where a shard's centre is at time t. The drift is a differentially rotating
 * field (inner pieces orbit the blast faster), and the flight home is a
 * quadratic bezier whose control point hangs off the drift — swing wide,
 * carve in, arrive at speed.
 */
function shardAt(s, t) {
  const eb = 1 - (1 - clamp01((t - SHATTER) / (BLOW * s.bd))) ** 3;
  const u = clamp01((t - s.start) / s.dur);
  const e = u ** 2.2;

  const spin = 0.038 + 0.06 * (1 - Math.min(1, s.rad / 1500));
  const th = t * spin;
  const c = Math.cos(th);
  const n = Math.sin(th);
  const ox = s.sx * c - s.sy * n;
  const oy = s.sx * n + s.sy * c;
  const wx = Math.sin(t * 0.7 + s.wob) * 26 + Math.sin(t * 1.9 + s.wob * 2.3) * 8;
  const wy = Math.cos(t * 0.6 + s.wob) * 21 + Math.cos(t * 2.1 + s.wob * 1.7) * 7;
  // Drift saturates instead of accumulating: debris coasts to a stop in
  // vacuum-with-drag, it does not stroll off the set.
  const tt = 2.6 * (1 - Math.exp(-t / 1.9));
  const fx = s.hx + (ox + s.vx * tt + wx) * eb;
  const fy = s.hy + (oy + s.vy * tt + wy) * eb;

  const dx = s.hx - fx;
  const dy = s.hy - fy;
  const d = Math.hypot(dx, dy) || 1;
  const cx = (fx + s.hx) * 0.5 - (dy / d) * s.arc * d;
  const cy = (fy + s.hy) * 0.5 + (dx / d) * s.arc * d;
  const ie = 1 - e;
  return {
    x: ie * ie * fx + 2 * ie * e * cx + e * e * s.hx,
    y: ie * ie * fy + 2 * ie * e * cy + e * e * s.hy,
    eb,
    u,
    e,
  };
}

/**
 * The whole moving picture, at one instant, into the additive ink layer.
 * Called SUB times per output frame across the shutter — real motion blur.
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
  const blast = t > LOCK - 0.14 ? t - (LOCK - 0.14) : -1;
  const chipOut = 1 - (1 - clamp01((t - SHATTER) / 0.75)) ** 3;
  for (const c of CHIPS) {
    let a = alpha * c.al * clamp01((t - SHATTER) / 0.3);
    if (blast >= 0) a *= Math.max(0, 1 - blast / 0.5);
    if (a <= 0.001) continue;
    let rad = c.rad * chipOut * (1 - 0.42 * conv * conv);
    if (blast >= 0) rad += blast * 1500 * (0.6 + c.al);
    const ang = c.a + c.orb * t;
    const x = BLAST.x + Math.cos(ang) * rad * 1.5;
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
  const fadeIn = clamp01(t / 0.14);
  for (const s of SHARDS) {
    const settled = t >= s.landAt;
    const handoff = clamp01((t - s.L.land) / 0.13);
    if (handoff >= 1) continue;

    const P = shardAt(s, t);
    const { eb, u, e } = P;
    let { x, y } = P;
    const eR = clamp01(u * 1.14) ** 2;
    const eS = u * u;

    // Orientation: tumble while adrift, bank nose-first into the curve while
    // homing, settle to the letterform at the end. All blends take the short
    // way round, and the final unwind goes to the nearest half-turn — a
    // segment is symmetric under pi, so no piece pirouettes to zero.
    let rot = (s.sr + s.spin * t) * eb;
    if (u > 0.06 && u < 0.985) {
      const P2 = shardAt(s, t - 1 / 240);
      const va = Math.atan2(y - P2.y, x - P2.x);
      const wA = clamp01((u - 0.1) / 0.45) * 0.85;
      rot += wrapTo(va - s.axis - rot, TAU) * wA;
    }
    const eEnd = clamp01((u - 0.75) / 0.25) ** 2;
    rot += wrapTo(-rot, Math.PI) * eEnd;
    const sc = lerp(lerp(1, s.sz, eb), 1, eS);

    // Landing: damped overshoot along the arrival direction, so the piece
    // sets like metal. Direction from the flight path itself.
    if (settled) {
      const q = t - s.landAt;
      const k = Math.exp(-q * 14) * Math.sin(q * 42);
      if (Math.abs(k) > 0.002) {
        const Pl = shardAt(s, s.landAt - 1 / 120);
        const dxl = s.hx - Pl.x;
        const dyl = s.hy - Pl.y;
        const dl = Math.hypot(dxl, dyl) || 1;
        const amp = 5 + Math.min(9, s.rad / 150);
        x += (dxl / dl) * k * amp;
        y += (dyl / dl) * k * amp;
      }
    }

    const base = s.hot ? HOT : INK;
    // The arc in one line: lit -> unlit metal going out (far pieces cool all
    // the way to the nebula's hue), unlit -> lit coming home.
    const coolTo = mix(COLD, DEEP, clamp01((s.rad - 300) / 1100));
    let col = mix(mix(base, coolTo, eb), base, clamp01(e * 1.35));
    const glowUp = settled ? Math.exp(-(t - s.landAt) * 6.2) : 0;
    const depth = lerp(0.5, 1, clamp01((sc - 0.32) / 0.95));
    let a = alpha * (1 - handoff) * lerp(lerp(1, 0.5 * s.lit, eb), 1, e) * fadeIn * depth;

    // Glint: tumbling metal catching the key light.
    if (eb > 0.25 && e < 0.75) {
      const gl = Math.max(0, Math.sin(rot * 2 + s.gph)) ** 8 * s.lit;
      if (gl > 0.04) {
        col = mix(col, [255, 255, 255], gl * 0.7);
        a = Math.min(1, a * (1 + gl * 0.8));
      }
    }

    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const px0 = x + (s.lx0 * cs - s.ly0 * sn) * sc;
    const py0 = y + (s.lx0 * sn + s.ly0 * cs) * sc;
    const px1 = x + (s.lx1 * cs - s.ly1 * sn) * sc;
    const py1 = y + (s.lx1 * sn + s.ly1 * cs) * sc;

    // Tapered metal in two passes, then a white-hot core. The passes share
    // the piece's alpha budget rather than stacking it — stacked, the whole
    // drift saturated to white and the cooling arc disappeared.
    const w0 = WEIGHT * SIZE * sc;
    ctx.globalAlpha = a * 0.4;
    ctx.strokeStyle = rgba(col, 1);
    ctx.lineWidth = w0 * 0.62;
    ctx.beginPath();
    ctx.moveTo(px0, py0);
    ctx.lineTo(px1, py1);
    ctx.stroke();

    ctx.globalAlpha = a * 0.52;
    ctx.lineWidth = w0 * 1.04;
    ctx.beginPath();
    ctx.moveTo(lerp(px0, px1, 0.22), lerp(py0, py1, 0.22));
    ctx.lineTo(lerp(px0, px1, 0.78), lerp(py0, py1, 0.78));
    ctx.stroke();

    // The white-hot core follows the temperature arc: it dies as the piece
    // cools into the drift and re-ignites on the way home. Without this the
    // whole field reads as hot confetti and the assembly earns nothing.
    const coreVis = Math.min(1, Math.max(0, 1 - eb * 1.3) + clamp01((e - 0.12) / 0.5));
    if (eb > 0.04 && handoff <= 0 && coreVis > 0.03) {
      ctx.globalAlpha = a * 0.42 * coreVis;
      ctx.strokeStyle = rgba(s.hot ? [255, 236, 200] : COL.playerCore, 1);
      ctx.lineWidth = w0 * 0.3;
      ctx.beginPath();
      ctx.moveTo(lerp(px0, px1, 0.1), lerp(py0, py1, 0.1));
      ctx.lineTo(lerp(px0, px1, 0.9), lerp(py0, py1, 0.9));
      ctx.stroke();
    }

    // Ignition flash as the piece takes its side.
    if (glowUp > 0.01) {
      ctx.globalAlpha = a * glowUp * 0.9;
      ctx.strokeStyle = rgba(COL.playerCore, 1);
      ctx.lineWidth = w0 * (1 + glowUp * 1.1);
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(px1, py1);
      ctx.stroke();
    }

    // Landing sparks off the big pieces: metal finding its seam.
    if (settled && s.seglen > SIZE * 0.34) {
      const q = t - s.landAt;
      if (q < 0.3) {
        const h = s.wob;
        for (let j = 0; j < 3; j++) {
          const dir = s.axis + (j - 1) * 0.85 + Math.sin(h * 3 + j * 2.1) * 0.5;
          const spd = 120 + 70 * ((Math.sin(h * 7 + j) + 1) / 2);
          const sx2 = s.hx + Math.cos(dir) * spd * q;
          const sy2 = s.hy + Math.sin(dir) * spd * q + 160 * q * q;
          ctx.globalAlpha = a * (1 - q / 0.3) * 0.8;
          ctx.strokeStyle = rgba(s.hot ? HOT : COL.playerCore, 1);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx2, sy2);
          ctx.lineTo(sx2 - Math.cos(dir) * 6, sy2 - Math.sin(dir) * 6);
          ctx.stroke();
        }
      }
    }
  }

  // --- letters that have set: the real mark, drawn properly
  for (const L of LETTERS) {
    const handoff = clamp01((t - L.land) / 0.13);
    if (handoff <= 0) continue;
    const flash = Math.exp(-Math.max(0, t - L.land) * 5.4);
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
    // A ring leaves each letter as it sets — nine small impacts before the big one.
    const q = t - L.land;
    if (q > 0 && q < 0.38) {
      const p = q / 0.38;
      ctx.globalAlpha = alpha * (1 - p) * 0.22;
      ctx.strokeStyle = rgba(L.hot ? HOT : COL.strike, 1);
      ctx.lineWidth = 2.2 * (1 - p) + 0.6;
      ctx.beginPath();
      ctx.ellipse(L.cx, MARK_Y, 26 + easeOutQuint(p) * 96, (26 + easeOutQuint(p) * 96) * 0.6, 0, 0, TAU);
      ctx.stroke();
    }
  }

  // --- speed rules
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

  strokeSubtitle(ctx, t, alpha);

  // --- the interceptor (variant `ship`), flying the lane under the lockup.
  // Drawn in front: its stage is clear air over the deck, and the dark hull
  // has to stay solid against its own engine light.
  const pose = shipPose(t);
  if (pose && pose.x < W + 620) {
    drawShipTrail(ctx, t, alpha);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    drawShip(ctx, pose.x, pose.y, pose.angle, pose.r, {
      thrust: pose.thrust,
      bank: pose.bank,
      stretch: pose.stretch,
      charge: pose.charge,
      alpha: 1,
      clock: t,
    });
    ctx.globalCompositeOperation = 'lighter';
    drawReticle(ctx, pose, t, alpha);
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

  // --- the strike beam, in front of everything
  drawBeam(ctx, t, alpha);

  ctx.restore();
}

// ---------------------------------------------------------------- the room
/** Every blast the room reacts to: nebula flash, star streak, horizon flare. */
function blasts(t) {
  const out = [];
  if (t > SHATTER) out.push({ q: t - SHATTER, cx: BLAST.x, cy: MARK_Y, amp: 0.75 });
  if (t > LOCK) out.push({ q: t - LOCK, cx: W * 0.5, cy: MARK_Y, amp: 1 });
  if (SHIP && t > ST) out.push({ q: t - ST, cx: REL.x, cy: REL.y, amp: 1.15 });
  // The date stamping itself onto the deck is a small impact of its own.
  if (SHIP && t > TAG2_T) out.push({ q: t - TAG2_T, cx: W * 0.5, cy: SUB_Y, amp: 0.3 });
  return out;
}

function drawBackground(g, t, cam) {
  const bl = blasts(t);
  let flare = 0;
  for (const b of bl) flare += Math.exp(-b.q * 5) * b.amp;

  // The room itself, behind everything: a shaded world, its rings, a volumetric
  // nebula and a starfield with real colour temperature. All of it already
  // existed in space.mjs and only the trailer had ever called it, so the asset
  // most people will actually see was the one staged worst.
  drawVista(g, t, cam, { stage: STAGE, flare });

  // Nebula: two parallax layers, warming as the mark assembles, flinching
  // with each impact — and *moving* now: the far layer slowly rotates and
  // breathes, the near one streams past and counter-turns. Drawn dark; the
  // room must stay a room, not a poster.
  const warm =
    (0.62 + 0.22 * clamp01((t - LAUNCH) / Math.max(0.01, LOCK - LAUNCH)) + flare * 0.3) *
    (1 + 0.09 * Math.sin(t * 0.47 + 1.2));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.imageSmoothingEnabled = true;
  const fw = W + 90;
  const fh = H * 0.86 + 60;
  g.save();
  g.translate(W * 0.5 + cam.x * 0.4 + Math.sin(t * 0.021) * 14, fh * 0.5 - 30 + cam.y * 0.4);
  g.rotate(0.006 * t - 0.012);
  const brf = 1 + 0.014 * Math.sin(t * 0.23);
  // Pulled well back now. These two flat tiles used to *be* the sky; with a
  // real one behind them their job is only to keep the palette war moving
  // across the frame, and at the old strength they washed the vista grey.
  g.globalAlpha = Math.min(1, warm * 0.62) * NEB_MIX;
  g.drawImage(NEB_FAR, -fw * 0.5 * brf, -fh * 0.5 * brf, fw * brf, fh * brf);
  g.restore();
  const nw = W + 160;
  const nh = H * 0.9 + 80;
  g.save();
  g.translate(W * 0.5 + cam.x * 1.1 - ((t * 4.2) % 140), nh * 0.5 - 46 + cam.y * 1.1);
  g.rotate(-0.004 * t + 0.008);
  g.globalAlpha = Math.min(1, warm * 0.78) * NEB_MIX;
  g.drawImage(NEB_NEAR, -nw * 0.5, -nh * 0.5, nw, nh);
  g.restore();
  g.restore();

  // The galaxy: upper-left, tilted, spinning in its own plane just fast
  // enough to catch — the sky's proof of life. It sits behind the near
  // nebula's haze in depth terms, so it stays a resident, not a sticker.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gxx = W * 0.152 + cam.x * 0.6;
  const gyy = H * 0.172 + cam.y * 0.6;
  const gs = 295 * (1 + 0.03 * Math.sin(t * 0.33));
  g.translate(gxx, gyy);
  g.rotate(-0.3);
  g.scale(1, 0.55);
  g.rotate(0.8 + t * 0.045);
  g.globalAlpha = Math.min(1, 0.55 + warm * 0.2);
  g.drawImage(GALAXY, -gs, -gs, gs * 2, gs * 2);
  g.restore();

  // Wisps: thin cloud tiles streaming across the sky at their own speeds —
  // the layer that keeps every second of the background alive.
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let wi = 0; wi < WISP_POS.length; wi++) {
    const wp = WISP_POS[wi];
    const ww = 360 * wp.s;
    const wh = 120 * wp.s;
    const span = W + ww * 2;
    const wx = ((((wp.x0 + wp.v * t) % span) + span) % span) - ww;
    g.globalAlpha = wp.a * (0.75 + 0.25 * Math.sin(t * 0.4 + wi * 1.9)) * Math.min(1, warm);
    g.drawImage(WISPS[wp.img], wx + cam.x * 0.7, wp.y + cam.y * 0.7 - wh * 0.5, ww, wh);
  }
  g.restore();

  // Comets: brief, scheduled, upper sky only. A tail, a bright head, gone.
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const cm of COMETS) {
    const p = (t - cm.t0) / COMET_D;
    if (p <= 0 || p >= 1) continue;
    const env = Math.sin(Math.PI * p);
    const hx = cm.x0 + cm.dx * p + cam.x * 0.9;
    const hy = cm.y0 + cm.dy * p + cam.y * 0.9;
    const dd = Math.hypot(cm.dx, cm.dy);
    const tl = 0.22 * dd * env;
    const tx = hx - (cm.dx / dd) * tl;
    const ty = hy - (cm.dy / dd) * tl;
    const col = cm.warm ? mix(HOT, [255, 225, 180], 0.5) : mix(COL.wall, COL.playerCore, 0.6);
    const gd = g.createLinearGradient(tx, ty, hx, hy);
    gd.addColorStop(0, rgba(col, 0));
    gd.addColorStop(1, rgba(col, 0.5 * env));
    g.strokeStyle = gd;
    g.lineWidth = 1.7;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(hx, hy);
    g.stroke();
    g.globalAlpha = env * 0.85;
    g.fillStyle = rgba(mix(col, [255, 255, 255], 0.5), 1);
    g.beginPath();
    g.arc(hx, hy, 1.9, 0, TAU);
    g.fill();
  }
  g.restore();

  // Stars: three planes, twinkling, streaking radially when the room flinches.
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const s of STARS) {
    const x = s.x + cam.x * s.px * 2.2;
    const y = s.y + cam.y * s.px * 2.2;
    const tw = 0.72 + 0.28 * Math.sin(t * s.tw + s.ph);
    // Two alphas: the dot steps aside for the real starfield underneath, the
    // streak does not. The streak is the room flinching at an impact, and the
    // new field has no equivalent — dimming it would cost the flinch to solve
    // a crowding problem the flinch was never part of.
    const a = s.a * tw * STAR_MIX;
    const aStreak = s.a * tw;
    g.globalAlpha = a;
    g.fillStyle = rgba(COL.wall, 1);
    g.beginPath();
    g.arc(x, y, s.r, 0, TAU);
    g.fill();
    if (s.hero) {
      g.globalAlpha = a * 0.5;
      g.lineWidth = 1;
      g.strokeStyle = rgba(COL.wall, 1);
      g.beginPath();
      g.moveTo(x - s.r * 4, y);
      g.lineTo(x + s.r * 4, y);
      g.moveTo(x, y - s.r * 4);
      g.lineTo(x, y + s.r * 4);
      g.stroke();
    }
    for (const b of bl) {
      const st = easeOutQuint(clamp01(b.q / 0.3)) * Math.max(0, 1 - b.q / 0.55) * b.amp;
      if (st < 0.05) continue;
      const dx = x - b.cx;
      const dy = y - b.cy;
      const d = Math.hypot(dx, dy) || 1;
      const ln = st * (16 + s.px * 42) * Math.min(1, 900 / d);
      g.globalAlpha = aStreak * st * 0.7;
      g.lineWidth = Math.min(1.4, s.r);
      g.strokeStyle = rgba(COL.wall, 1);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (dx / d) * ln, y + (dy / d) * ln);
      g.stroke();
    }
  }
  g.restore();

  // The deck: darkness with a horizon seam that takes the hits.
  const dg = g.createLinearGradient(0, HORIZON - 60, 0, H);
  dg.addColorStop(0, 'rgba(4,5,9,0)');
  dg.addColorStop(0.25, 'rgba(4,5,9,0.85)');
  dg.addColorStop(1, 'rgba(2,3,5,0.97)');
  g.fillStyle = dg;
  g.fillRect(0, HORIZON - 60, W, H - HORIZON + 60);

  const hf = Math.min(1, 0.32 + flare * 0.9);
  const hw = 620 + easeOutQuint(clamp01((flare > 0.02 ? 1 : 0) * Math.min(1, flare))) * 500;
  const hg = g.createLinearGradient(W * 0.5 - 860, 0, W * 0.5 + 860, 0);
  hg.addColorStop(0, rgba(COL.grid, 0));
  hg.addColorStop(0.5, rgba(mix(COL.grid, COL.gridHot, Math.min(1, flare)), 0.24 * hf));
  hg.addColorStop(1, rgba(COL.grid, 0));
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = hg;
  g.fillRect(W * 0.5 - hw, HORIZON - 1, hw * 2, 1.6);
  const sg = g.createLinearGradient(0, HORIZON - 14, 0, HORIZON + 10);
  sg.addColorStop(0, 'rgba(0,0,0,0)');
  sg.addColorStop(0.6, rgba(mix(COL.grid, COL.gridHot, Math.min(1, flare * 0.8)), 0.05 + flare * 0.08));
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sg;
  g.fillRect(W * 0.5 - hw, HORIZON - 14, hw * 2, 24);

  // A pair of glints race the horizon line away from each big impact — the
  // deck carrying the hit to the edges of frame.
  const racers = SHIP ? [[LOCK, W * 0.5], [ST, REL.x]] : [[LOCK, W * 0.5]];
  for (const [rt, rx] of racers) {
    const rq = t - rt;
    if (rq <= 0 || rq >= 0.6) continue;
    const p = easeOutQuint(clamp01(rq / 0.6));
    for (const dir of [-1, 1]) {
      const x = rx + dir * p * W * 0.58;
      const gg = g.createLinearGradient(x - 80, 0, x + 80, 0);
      gg.addColorStop(0, rgba(COL.strike, 0));
      gg.addColorStop(0.5, rgba(COL.playerCore, 0.55 * (1 - p)));
      gg.addColorStop(1, rgba(COL.strike, 0));
      g.fillStyle = gg;
      g.fillRect(x - 80, HORIZON - 2, 160, 3.4);
    }
  }
  g.restore();
}

/** Camera: slow push through the drift, kicks at every impact, a lazy sway. */
function camera(t) {
  let push = 1.078 - 0.078 * easeOutCubic(clamp01((t - SHATTER) / 5.6));
  let kick =
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 8) * 0.032 : 0) +
    (t > LOCK ? Math.exp(-(t - LOCK) * 7) * 0.023 : 0);
  for (const L of LETTERS) {
    if (t > L.land) kick += Math.exp(-(t - L.land) * 9) * 0.0045;
  }
  if (SHIP) {
    if (t > ST) kick += Math.exp(-(t - ST) * 7) * 0.03;
    if (t > TAG2_T) kick += Math.exp(-(t - TAG2_T) * 8) * 0.008;
    // Bullet time leans in: the camera creeps toward the coiling ship, and
    // the release kick plays against the built-up zoom.
    const sp = shipPose(t);
    if (sp && t < ST) push += sp.charge * 0.014;
  }
  const sway = Math.sin(t * 0.31) * 3.5;
  const rot =
    0.0038 * Math.sin(t * 0.21) +
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 6) * 0.005 * Math.sin(t * 30) : 0);
  return { z: push + kick, x: sway, y: Math.cos(t * 0.24) * 2.4, rot };
}

/** An impact: a tight white flash and a soft ring leaving frame. */
function burst(g, q, veilAmp, ringAmp, cx = W * 0.5, cy = MARK_Y) {
  if (q < -0.02) return;
  const veil = Math.exp(-Math.max(0, q) * 21) * veilAmp;
  if (veil > 0.004) {
    const fg = g.createRadialGradient(cx, cy, 0, cx, cy, 820);
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
    g.ellipse(cx, cy, rad, rad * 0.74, 0, 0, TAU);
    g.stroke();
    g.restore();
  }
}

/** Anamorphic lens streak: the cheapest honest way to say "too bright". */
function anamorphic(g, q, amp, cy = MARK_Y, cx = W * 0.5) {
  if (q < 0 || q > 0.55) return;
  const p = clamp01(q / 0.55);
  const len = (700 + easeOutQuint(p) * 1400) * amp;
  const a = (1 - p) ** 2 * 0.55 * amp;
  if (a < 0.01) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [hh, aa, col] of [
    [14, 0.35, COL.strike],
    [3.6, 0.8, COL.playerCore],
  ]) {
    const gd = g.createLinearGradient(cx - len, 0, cx + len, 0);
    gd.addColorStop(0, rgba(col, 0));
    gd.addColorStop(0.5, rgba(col, a * aa));
    gd.addColorStop(1, rgba(col, 0));
    g.fillStyle = gd;
    g.fillRect(cx - len, cy - hh / 2, len * 2, hh);
  }
  g.restore();
}

/** One finished frame at time `t`, onto a 1920x1080 context. */
export function frame(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);

  const cam = camera(t);
  drawBackground(g, t, cam);

  // Ink: SUB sub-samples across the shutter, summed. Fast pieces smear.
  inkC.setTransform(1, 0, 0, 1, 0, 0);
  inkC.globalCompositeOperation = 'source-over';
  inkC.clearRect(0, 0, W, H);
  inkC.save();
  inkC.translate(W * 0.5 + cam.x, H * 0.5 + cam.y);
  inkC.rotate(cam.rot);
  inkC.scale(cam.z, cam.z);
  inkC.translate(-W * 0.5, -H * 0.5);
  for (let s = 0; s < SUB; s++) {
    drawInk(inkC, t + (s / SUB) * SHUTTER, 1 / SUB);
  }
  inkC.restore();

  // The deck reflection: everything lit, mirrored, blurred, dying quickly
  // with distance from the seam. This is what makes the void a place.
  reflC.setTransform(1, 0, 0, 1, 0, 0);
  reflC.globalCompositeOperation = 'source-over';
  reflC.filter = 'none';
  reflC.clearRect(0, 0, W, H);
  reflC.save();
  reflC.translate(0, HORIZON * 2);
  reflC.scale(1, -1);
  reflC.drawImage(ink, 0, 0);
  reflC.restore();
  reflC.globalCompositeOperation = 'destination-in';
  const rg = reflC.createLinearGradient(0, HORIZON, 0, HORIZON + 210);
  rg.addColorStop(0, 'rgba(0,0,0,0.55)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  reflC.fillStyle = rg;
  reflC.fillRect(0, HORIZON, W, 240);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(5px)';
  g.globalAlpha = 0.34;
  g.drawImage(refl, 0, 0);
  g.restore();

  // Chromatic split: always a hair, a hard shear at each impact.
  const ca =
    1.6 +
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 6.5) * 13 : 0) +
    (t > LOCK ? Math.exp(-(t - LOCK) * 6.5) * 15 : 0) +
    (SHIP && t > ST ? Math.exp(-(t - ST) * 6.5) * 16 : 0);
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

  // Bloom: three radii. The widest is atmosphere, not glow.
  const heat =
    (t > LOCK ? Math.exp(-(t - LOCK) * 4.5) : 0) +
    (t > SHATTER ? Math.exp(-(t - SHATTER) * 5) * 0.8 : 0.8) +
    (SHIP && t > ST ? Math.exp(-(t - ST) * 3) * 0.9 : 0) +
    (SUBTITLE && t > TAG2_T + TAG2_DUR ? Math.exp(-(t - TAG2_T - TAG2_DUR) * 5) * 0.35 : 0);
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

  // The impacts.
  burst(g, t - SHATTER, 0.3, 0.32, BLAST.x, MARK_Y);
  burst(g, t - LOCK, 0.52, 0.5);
  anamorphic(g, t - SHATTER, 0.5, MARK_Y, BLAST.x);
  anamorphic(g, t - LOCK, 1);
  if (SHIP) {
    burst(g, t - ST, 0.52, 0.45, REL.x, REL.y);
    anamorphic(g, t - ST, 1.15, REL.y, REL.x + 120);
    // The words arriving is a small lens event of its own.
    anamorphic(g, t - TAG2_T, 0.5, SUB_Y, W * 0.5);
    // A hard white pop the instant the strike releases.
    const pop = t > ST ? Math.exp(-(t - ST) * 18) * 0.26 : 0;
    if (pop > 0.005) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 1;
      g.fillStyle = `rgba(255,255,255,${pop})`;
      g.fillRect(0, 0, W, H);
    }
    // Bullet time while the ship coils: the room holds its breath.
    const pose = shipPose(t);
    if (pose && pose.charge > 0.02 && t < ST) {
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(2,6,12,${0.16 * pose.charge})`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(COL.focus, 0.03 * pose.charge);
      g.fillRect(0, 0, W, H);
    }
  }

  // Vignette, grain, and the fades that bound the loop.
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.58, W * 0.5, H * 0.5, H * 1.18);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  const fi = Math.floor(t * FPS);
  const gr = GRAIN[fi % 3];
  const gox = (fi * 97) % 320;
  const goy = (fi * 131) % 320;
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.055;
  for (let yy = -goy; yy < H; yy += 320) {
    for (let xx = -gox; xx < W; xx += 320) {
      g.drawImage(gr, xx, yy);
    }
  }
  g.restore();

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

export const marks = {
  VARIANT,
  SHATTER,
  LOCK,
  TAG_T,
  TAG2_T: SUBTITLE ? TAG2_T : null,
  SHIP_T0: SHIP ? SHIP_T0 : null,
  ST: SHIP ? ST : null,
  SIZE,
  MARK_W,
  shards: SHARDS.length,
  frames: Math.round(DURATION * FPS),
  DURATION,
};
