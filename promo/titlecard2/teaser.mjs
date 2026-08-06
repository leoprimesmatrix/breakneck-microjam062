/**
 * AFTERBURN — TEASER. ~24 seconds, three acts, one story:
 *
 *   ACT I — THE VOID (0–7.2s). Deep space, properly beautiful: a spiral
 *   galaxy, banks of nebula, three planes of stars, comets. The game's own
 *   pitch arrives as text cards in the display face — "YOU CANNOT WALK." /
 *   "YOU CANNOT SHOOT." — while something small and bright crosses the
 *   distance twice, closer the second time.
 *
 *   ACT II — THE SHIP (7.2–13.4s). Hard cut: the interceptor, big, tracking
 *   shot, stars streaming past. "YOU CAN ONLY STRIKE." The world drops into
 *   bullet time — streaks collapse to points, the reticle spools up — and it
 *   releases: a beam, a white-out.
 *
 *   ACT III — THE TITLE (13.4s–end). The white-out IS the cut: it decays to
 *   reveal the wordmark's debris mid-blast — the strike we just watched is
 *   the impact the title sequence opens on. The existing `seq.mjs` beat
 *   plays out whole: assembly, lock, tagline, and the release line at the
 *   bottom of frame. Nothing here re-renders that machinery; Act III simply
 *   delegates to the sequence module.
 *
 * Variants via query (`teaser.mjs?v=soon|date`) choose which seq variant the
 * third act runs: "COMING SOON." or "AUGUST 2026". mp4 only — 24 seconds
 * does not fit under a 3 MB GIF cap at any honest frame rate.
 */
import {
  COL, rgba, TAU, clamp01, glyphFor, drawShip, drawRadial, flareSprite,
} from './lib.mjs';

const VQ = new URL(import.meta.url).searchParams.get('v') || 'date';
const SEQV = VQ === 'soon' ? 'soon' : 'date';
export const VARIANT = 'teaser-' + SEQV;
const seq = await import('./seq.mjs?v=' + SEQV);

export const W = 1920;
export const H = 1080;
export const FPS = 60;
const SUB = 8;
const SHUTTER = 0.85 / FPS;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const smooth = (t) => t * t * (3 - 2 * t);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R3 = rng(0x7ea5e7);
const rr = (a, b) => a + R3() * (b - a);

// ------------------------------------------------------------------ timeline
const RUN_T0 = 7.2; // hard cut into the ship shot
const BT0 = 11.3; // bullet time onset
const ST_T = 13.05; // release
const CUT = 13.4; // white-out hands over to the title sequence
export const DURATION = CUT + seq.DURATION;

const CARDS = [
  { t0: 1.6, t1: 4.05, cold: 'YOU CANNOT WALK.', hot: '', y: H * 0.6 },
  { t0: 4.35, t1: 6.9, cold: 'YOU CANNOT SHOOT.', hot: '', y: H * 0.6 },
  { t0: 8.6, t1: 11.15, cold: 'YOU CAN ONLY ', hot: 'STRIKE.', y: H * 0.26 },
];

// ------------------------------------------------------------------ scenery
/** Nebula banks, denser than the title room's — this sky is the subject. */
function bakeNebula(nBlobs, big) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const g = c.getContext('2d');
  for (let i = 0; i < nBlobs; i++) {
    const fam = R3();
    let col;
    let al;
    let x;
    let y;
    if (fam < 0.52) {
      col = mix(COL.floor, COL.grid, rr(0.15, 0.85));
      al = rr(0.05, 0.12);
      x = rr(-0.05, 1.05) * 640;
      y = rr(-0.08, 1.05) * 360;
    } else if (fam < 0.74) {
      col = mix(COL.warn, [110, 62, 26], 0.4);
      al = rr(0.04, 0.09);
      x = (0.24 + rr(-0.2, 0.2)) * 640;
      y = (0.7 + rr(-0.18, 0.18)) * 360;
    } else if (fam < 0.93) {
      col = mix(COL.player, COL.grid, 0.55);
      al = rr(0.035, 0.08);
      x = (0.72 + rr(-0.2, 0.2)) * 640;
      y = (0.32 + rr(-0.18, 0.18)) * 360;
    } else {
      col = COL.seeder;
      al = rr(0.02, 0.045);
      x = (0.5 + rr(-0.3, 0.3)) * 640;
      y = (0.5 + rr(-0.3, 0.3)) * 360;
    }
    const r = rr(60, big ? 250 : 150);
    g.save();
    g.translate(x, y);
    g.rotate(rr(-0.6, 0.6));
    g.scale(1, rr(0.4, 0.8));
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
const NEB_A = bakeNebula(34, true);
const NEB_B = bakeNebula(52, false);

/** The galaxy — same construction as the title's, baked bigger and denser. */
const GALAXY = (() => {
  const S = 640;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  g.globalCompositeOperation = 'lighter';
  let gr = g.createRadialGradient(cx, cy, 0, cx, cy, 300);
  gr.addColorStop(0, rgba(COL.grid, 0.16));
  gr.addColorStop(1, rgba(COL.grid, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  gr = g.createRadialGradient(cx, cy, 0, cx, cy, 92);
  gr.addColorStop(0, 'rgba(255,241,216,0.85)');
  gr.addColorStop(0.3, rgba(mix([255, 240, 214], COL.player, 0.4), 0.32));
  gr.addColorStop(1, rgba(COL.player, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 340; i++) {
      const th = i * 0.027 + arm * Math.PI;
      const rad = 18 * Math.exp(0.115 * i * 0.027);
      if (rad > 302) break;
      const ja = th + rr(-0.13, 0.13);
      const jr = rad * (1 + rr(-0.15, 0.15));
      const x = cx + Math.cos(ja) * jr;
      const y = cy + Math.sin(ja) * jr;
      const along = rad / 302;
      if (i % 5 === 0) {
        const hz = rr(16, 40);
        const hg = g.createRadialGradient(x, y, 0, x, y, hz);
        const hc = mix(COL.grid, COL.player, rr(0.15, 0.5));
        hg.addColorStop(0, rgba(hc, (0.11 - 0.07 * along) * rr(0.5, 1)));
        hg.addColorStop(1, rgba(hc, 0));
        g.fillStyle = hg;
        g.fillRect(x - hz, y - hz, hz * 2, hz * 2);
      }
      const cold = R3() < 0.8;
      g.fillStyle = rgba(
        cold ? mix(COL.wall, COL.player, 0.4) : mix(COL.warn, [255, 222, 176], 0.5),
        (0.55 - 0.34 * along) * rr(0.4, 1),
      );
      g.beginPath();
      g.arc(x, y, rr(0.7, 2.3), 0, TAU);
      g.fill();
    }
  }
  return c;
})();

/** Three planes of stars. Drawn as points in the vista, streaks in the run. */
function bakeStars(n, rMin, rMax, aMin, aMax, px) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: R3() * (W + 40),
      y: R3() * H,
      r: rr(rMin, rMax),
      a: rr(aMin, aMax),
      tw: rr(0.5, 2.2),
      ph: R3() * TAU,
      px,
      hero: false,
    });
  }
  return arr;
}
const STARS = [
  ...bakeStars(210, 0.5, 1.1, 0.1, 0.34, 0.25),
  ...bakeStars(120, 0.8, 1.6, 0.16, 0.5, 0.55),
  ...bakeStars(60, 1.0, 2.2, 0.22, 0.66, 1.0),
];
for (let i = 0; i < 9; i++) STARS[210 + 120 + ((R3() * 60) | 0)].hero = true;

const COMETS = [
  { t0: 2.6, x0: W * 0.2, y0: H * 0.1, dx: 560, dy: 190, warm: false },
  { t0: 5.15, x0: W * 0.82, y0: H * 0.08, dx: -500, dy: 230, warm: true },
  { t0: 9.7, x0: W * 0.7, y0: H * 0.08, dx: 430, dy: 150, warm: false },
];
const COMET_D = 0.95;

/** Film grain, three baked tiles cycled per frame. */
const GRAIN = [];
{
  const G3 = rng(0xfee1);
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

// ------------------------------------------------ world speed and distance
/**
 * How fast the star river flows: zero in the vista (its motion is the pan),
 * full flow through the ship run, collapsing to a trickle in bullet time.
 * Integrated once at 240Hz so every sub-sample reads the same world.
 */
const spdAt = (t) => {
  if (t < RUN_T0) return 0;
  const u = clamp01((t - BT0) / 1.2);
  return 1 - 0.93 * smooth(u);
};
const DIST = new Float32Array(Math.ceil(16 * 240) + 2);
for (let i = 1; i < DIST.length; i++) DIST[i] = DIST[i - 1] + spdAt(i / 240) * (560 / 240);
const distAt = (t) => {
  const f = clamp(t, 0, 15.9) * 240;
  const i = f | 0;
  return lerp(DIST[i], DIST[i + 1], f - i);
};

// ---------------------------------------------------------------- lettering
function advance(text, size, track) {
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a + track;
  return (w - track) * size;
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

/**
 * A teaser card: two-tone display-face line, pen write-on, held, then let
 * go. The third card's "STRIKE." takes the warn colour — the one word in the
 * whole teaser allowed to be hot before the title is.
 */
function strokeCard(ctx, card, t, alpha) {
  const wu = clamp01((t - card.t0) / 0.7);
  if (wu <= 0) return;
  const fade = 1 - clamp01((t - (card.t1 - 0.35)) / 0.35);
  if (fade <= 0) return;
  const size = 56;
  const track = 0.46;
  const slant = 0.055;
  const text = card.cold + card.hot;
  const total = penLength(text, size);
  let budget = wu >= 1 ? Infinity : total * wu;
  const w = advance(text, size, track);
  let x = W * 0.5 - w * 0.5;
  const flash = wu >= 1 ? Math.exp(-(t - (card.t0 + 0.7)) * 5) : 0;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  let i = 0;
  for (const ch of text) {
    if (budget <= 0) break;
    const hot = i >= card.cold.length;
    ctx.globalAlpha = alpha * 0.96 * fade;
    ctx.strokeStyle = rgba(hot ? COL.warn : COL.ink, 1);
    ctx.lineWidth = 0.12 * size;
    ctx.beginPath();
    const used = glyphPath(ctx, glyphFor(ch).p, x, size, slant, card.y + size * 0.5, budget);
    ctx.stroke();
    if (flash > 0.01) {
      ctx.globalAlpha = alpha * flash * 0.7 * fade;
      ctx.strokeStyle = rgba(COL.playerCore, 1);
      ctx.lineWidth = 0.12 * size * (1 + flash * 0.8);
      ctx.stroke();
    }
    budget -= used;
    x += (glyphFor(ch).a + track) * size;
    i++;
  }
}

// ---------------------------------------------------------------- the ship
/** The far glints of Act I: something crossing the distance, twice. */
function vistaGlints(t) {
  const out = [];
  if (t > 1.4 && t < 4.4) {
    const u = (t - 1.4) / 3.0;
    out.push({
      x: lerp(W * 0.1, W * 0.56, u),
      y: lerp(H * 0.3, H * 0.2, u) + Math.sin(t * 1.7) * 6,
      r: 5,
      a: 0.5 + 0.3 * Math.sin(t * 5.1),
      tail: 34,
    });
  }
  if (t > 4.6 && t < 6.95) {
    const u = (t - 4.6) / 2.35;
    out.push({
      x: lerp(W * 0.9, W * 0.42, u),
      y: lerp(H * 0.14, H * 0.36, u) + Math.sin(t * 1.9) * 5,
      r: 7,
      a: 0.6 + 0.3 * Math.sin(t * 4.3),
      tail: -46,
    });
  }
  return out;
}

/** The hero pose of Act II: enter fast, cruise, coil, release. */
function runShip(t) {
  if (t < RUN_T0) return null;
  const ts = t - RUN_T0;
  const ch = easeOutCubic(clamp01((t - (BT0 + 0.2)) / (ST_T - BT0 - 0.2)));
  if (t < ST_T) {
    const ent = easeOutCubic(clamp01(ts / 0.9));
    const calm = 1 - clamp01((t - BT0) / 1.0);
    return {
      x: -260 + (W * 0.43 + 260) * ent + Math.sin(ts * 0.5) * 26 * (1 - ch) + ch * 56,
      y: H * 0.54 + Math.sin(ts * 1.25) * 14 * calm - ch * 12,
      angle: Math.sin(ts * 0.8) * 0.05 * (1 - ch) - ch * 0.05,
      r: 78 + ch * 8,
      thrust: 0.95 - 0.45 * ch,
      bank: Math.sin(ts * 0.85) * 0.3 * (1 - ch) + (1 - ent) * (1 - ent) * 0.5,
      charge: ch,
      stretch: 0,
    };
  }
  const w = clamp01((t - ST_T) / 0.3);
  const ei = w * w * (0.35 + 0.65 * w);
  return {
    x: W * 0.43 + 56 + ei * 2600,
    y: H * 0.54 - 12 - 26 * w,
    angle: -0.05,
    r: 86,
    thrust: 1,
    bank: 0,
    charge: 1 - w,
    stretch: Math.min(1, w * 5),
  };
}

/** Spindle afterimages sampled off the pose history. */
function drawRunTrail(ctx, t, alpha) {
  for (let k = 1; k <= 14; k++) {
    const tq = t - k * 0.016;
    const p = runShip(tq);
    if (!p) break;
    const a = 1 - k / 15;
    const striking = tq >= ST_T;
    const len = p.r * (striking ? 4.6 : 1.9) * a;
    const wid = p.r * (striking ? 0.32 : 0.44) * a;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = rgba(COL.strike, a * a * 0.36 * alpha);
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

/** The charge reticle, as in the game and the title beat. */
function drawReticle(ctx, p, t, alpha) {
  if (p.charge < 0.02) return;
  const cr = p.r * (3.1 - p.charge * 1.5);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = rgba(COL.focus, 0.45 * p.charge * alpha);
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(0, 0, cr, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(COL.playerCore, 0.8 * p.charge * alpha);
  ctx.lineWidth = 3.2;
  for (let i = 0; i < 3; i++) {
    const a = t * 3.4 + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, cr, a, a + 0.42);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(COL.strike, 0.7 * p.charge * alpha);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = -p.angle + (i / 4) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * (cr + 3), s * (cr + 3));
    ctx.lineTo(c * (cr + 10), s * (cr + 10));
  }
  ctx.stroke();
  ctx.restore();
}

/** The release beam, rightward from the ship's coil point. */
function drawRunBeam(ctx, t, alpha) {
  if (t < ST_T) return;
  const p = runShip(t);
  const env = Math.min(1, (t - ST_T) / 0.03) * Math.exp(-Math.max(0, t - ST_T - 0.3) * 5);
  if (env < 0.01) return;
  const x0 = W * 0.43 + 90;
  const y0 = H * 0.54 - 14;
  const dx = Math.cos(-0.05);
  const dy = Math.sin(-0.05);
  const len = Math.min(Math.hypot(p.x - x0, p.y - y0) + p.r * 1.6, 2500);
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, col, a] of [
    [2.4, COL.strike, 0.2],
    [0.9, COL.strike, 0.55],
    [0.34, COL.playerCore, 0.95],
  ]) {
    ctx.strokeStyle = rgba(col, a * env * alpha);
    ctx.lineWidth = 52 * w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + dx * len, y0 + dy * len);
    ctx.stroke();
  }
  drawRadial(ctx, flareSprite(COL.strike, 1), x0, y0, 150 * env, env * alpha);
  ctx.restore();
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

// ---------------------------------------------------------------- the acts
/** Camera for acts I–II: vista drift, run handheld, charge lean-in. */
function actCam(t) {
  if (t < RUN_T0) {
    const z = 1.05 + 0.07 * smooth(clamp01(t / RUN_T0));
    return {
      z,
      x: Math.sin(t * 0.24) * 5,
      y: Math.cos(t * 0.2) * 3.5,
      rot: 0.004 * Math.sin(t * 0.17),
    };
  }
  const p = runShip(t);
  let z = 1.06 + (p ? p.charge * 0.03 : 0);
  if (t > ST_T) z += Math.exp(-(t - ST_T) * 7) * 0.03;
  return {
    z,
    x: Math.sin(t * 1.3) * 2.4 + Math.sin(t * 3.1) * 1.1,
    y: Math.cos(t * 1.1) * 2 + Math.cos(t * 2.7) * 0.9,
    rot: 0.003 * Math.sin(t * 0.9),
  };
}

/** The sky of both acts: nebula, galaxy, star river, comets. */
function drawActSky(g, t, cam) {
  const vista = t < RUN_T0;
  const D = distAt(t);
  // The nebula is atmosphere, not parallax: its drift is bounded so its
  // edges never enter frame, and the run recomposes it by fixed offset —
  // A swings left, B swings right — so the cut reads as somewhere else.
  const shiftA = vista ? t * 5 : 190 + D * 0.022;
  const shiftB = vista ? t * 12 : -230 + D * 0.05;
  const breathe = 1 + 0.08 * Math.sin(t * 0.43 + 1);

  g.save();
  g.globalCompositeOperation = 'lighter';
  g.imageSmoothingEnabled = true;
  const nw = W + 760;
  const nh = H + 160;
  g.save();
  g.translate(W * 0.5 - shiftA + cam.x * 0.5, H * 0.5 - 40 + cam.y * 0.5);
  g.rotate(0.005 * t - 0.01);
  g.globalAlpha = Math.min(1, 0.6 * breathe);
  g.drawImage(NEB_A, -nw * 0.5, -nh * 0.5, nw, nh);
  g.restore();
  g.save();
  g.translate(W * 0.5 - shiftB + cam.x * 1.1, H * 0.5 + 30 + cam.y * 1.1);
  g.rotate(-0.004 * t + 0.008);
  g.globalAlpha = Math.min(1, 0.72 * breathe);
  g.drawImage(NEB_B, -nw * 0.5, -nh * 0.5, nw, nh);
  g.restore();

  // The galaxy: the vista's subject upper right; smaller and passing in the
  // run, half a world further on.
  const gx = vista ? W * 0.685 - t * 4 : W * 0.84 - D * 0.05;
  const gy = vista ? H * 0.3 : H * 0.22;
  const gs = (vista ? 335 : 210) * (1 + 0.025 * Math.sin(t * 0.31));
  g.save();
  g.translate(gx + cam.x * 0.7, gy + cam.y * 0.7);
  g.rotate(-0.34);
  g.scale(1, 0.56);
  g.rotate(0.6 + t * 0.04);
  g.globalAlpha = vista ? 0.78 : 0.6;
  g.drawImage(GALAXY, -gs, -gs, gs * 2, gs * 2);
  g.restore();

  // Stars: points in the vista, a river in the run.
  const spd = spdAt(t);
  const pan = (vista ? t * 9 : 90) + D;
  for (const s of STARS) {
    const span = W + 40;
    const sx = ((((s.x - pan * s.px) % span) + span) % span);
    const x = sx + cam.x * s.px * 2;
    const y = s.y + cam.y * s.px * 2;
    const tw = 0.72 + 0.28 * Math.sin(t * s.tw + s.ph);
    const a = s.a * tw;
    const len = (6 + 96 * s.px) * spd;
    g.globalAlpha = a;
    if (len > 2) {
      g.strokeStyle = rgba(COL.wall, 1);
      g.lineWidth = Math.min(1.6, s.r);
      g.beginPath();
      g.moveTo(x + len, y);
      g.lineTo(x, y);
      g.stroke();
    } else {
      g.fillStyle = rgba(COL.wall, 1);
      g.beginPath();
      g.arc(x, y, s.r, 0, TAU);
      g.fill();
    }
    if (s.hero && vista) {
      g.globalAlpha = a * 0.5;
      g.lineWidth = 1;
      g.strokeStyle = rgba(COL.wall, 1);
      g.beginPath();
      g.moveTo(x - s.r * 4.5, y);
      g.lineTo(x + s.r * 4.5, y);
      g.moveTo(x, y - s.r * 4.5);
      g.lineTo(x, y + s.r * 4.5);
      g.stroke();
    }
  }

  // Comets.
  for (const cm of COMETS) {
    const p = (t - cm.t0) / COMET_D;
    if (p <= 0 || p >= 1) continue;
    const env = Math.sin(Math.PI * p);
    const hx = cm.x0 + cm.dx * p + cam.x;
    const hy = cm.y0 + cm.dy * p + cam.y;
    const dd = Math.hypot(cm.dx, cm.dy);
    const tl = 0.24 * dd * env;
    const tx = hx - (cm.dx / dd) * tl;
    const ty = hy - (cm.dy / dd) * tl;
    const col = cm.warm ? mix(COL.warn, [255, 225, 180], 0.5) : mix(COL.wall, COL.playerCore, 0.6);
    const gd = g.createLinearGradient(tx, ty, hx, hy);
    gd.addColorStop(0, rgba(col, 0));
    gd.addColorStop(1, rgba(col, 0.55 * env));
    g.strokeStyle = gd;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(hx, hy);
    g.stroke();
    g.globalAlpha = env * 0.9;
    g.fillStyle = rgba(mix(col, [255, 255, 255], 0.5), 1);
    g.beginPath();
    g.arc(hx, hy, 2.1, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Everything bright in acts I–II, one shutter sub-sample's worth. */
function drawActInk(ctx, t, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Far glints of Act I: the ship, twice, closer the second time.
  for (const gl of vistaGlints(t)) {
    ctx.globalAlpha = alpha * gl.a * 0.5;
    ctx.strokeStyle = rgba(COL.strike, 1);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(gl.x - gl.tail, gl.y + gl.tail * 0.12);
    ctx.lineTo(gl.x, gl.y);
    ctx.stroke();
    drawRadial(ctx, flareSprite(COL.player, 1), gl.x, gl.y, gl.r * 4.5, alpha * gl.a);
    ctx.globalAlpha = alpha * gl.a;
    ctx.fillStyle = rgba(COL.playerCore, 1);
    ctx.beginPath();
    ctx.arc(gl.x, gl.y, gl.r * 0.42, 0, TAU);
    ctx.fill();
  }

  // The cards.
  for (const card of CARDS) strokeCard(ctx, card, t, alpha);

  // Act II: the interceptor.
  const p = runShip(t);
  if (p && p.x < W + 640) {
    drawRunTrail(ctx, t, alpha);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    drawShip(ctx, p.x, p.y, p.angle, p.r, {
      thrust: p.thrust,
      bank: p.bank,
      stretch: p.stretch,
      charge: p.charge,
      alpha: 1,
      clock: t,
    });
    ctx.globalCompositeOperation = 'lighter';
    drawReticle(ctx, p, t, alpha);
  }
  drawRunBeam(ctx, t, alpha);
  ctx.restore();
}

/** One finished frame of acts I–II. */
function actFrame(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);

  const cam = actCam(t);
  drawActSky(g, t, cam);

  inkC.setTransform(1, 0, 0, 1, 0, 0);
  inkC.globalCompositeOperation = 'source-over';
  inkC.clearRect(0, 0, W, H);
  inkC.save();
  inkC.translate(W * 0.5 + cam.x, H * 0.5 + cam.y);
  inkC.rotate(cam.rot);
  inkC.scale(cam.z, cam.z);
  inkC.translate(-W * 0.5, -H * 0.5);
  for (let s = 0; s < SUB; s++) {
    drawActInk(inkC, t + (s / SUB) * SHUTTER, 1 / SUB);
  }
  inkC.restore();

  // Chromatic split: a hair always, a shear at the release.
  const ca = 1.4 + (t > ST_T ? Math.exp(-(t - ST_T) * 6.5) * 14 : 0);
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

  const heat = (t > ST_T ? Math.exp(-(t - ST_T) * 3) * 0.9 : 0) + (runShip(t) ? 0.25 : 0);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(9px)';
  g.globalAlpha = 0.72;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(30px)';
  g.globalAlpha = 0.55 + heat * 0.3;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(96px)';
  g.globalAlpha = 0.26 + heat * 0.1;
  g.drawImage(ink, 0, 0);
  g.restore();

  // Bullet time holds its breath.
  const p = runShip(t);
  if (p && p.charge > 0.02 && t < ST_T) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(2,6,12,${0.17 * p.charge})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rgba(COL.focus, 0.03 * p.charge);
    g.fillRect(0, 0, W, H);
  }

  // Vignette and grain.
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

  // The open of the piece.
  const inn = 1 - clamp01(t / 0.9);
  if (inn > 0) {
    g.fillStyle = `rgba(0,0,0,${inn})`;
    g.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------ frame
/** The whole teaser: acts I–II here, act III delegated to the title beat. */
export function frame(g, t) {
  if (t < CUT) {
    actFrame(g, t);
    // The white-out builds into the cut...
    const wp = t > ST_T + 0.15 ? clamp01((t - (ST_T + 0.15)) / (CUT - ST_T - 0.15)) : 0;
    if (wp > 0) {
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = `rgba(246,250,255,${wp * wp})`;
      g.fillRect(0, 0, W, H);
    }
    return;
  }
  // ...and decays off the far side, revealing the wordmark's debris:
  // the strike we just watched is the impact the title opens on.
  seq.frame(g, t - CUT);
  const flash = Math.exp(-(t - CUT) * 7);
  if (flash > 0.01) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(246,250,255,${flash})`;
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
  RUN_T0,
  BT0,
  ST_T,
  CUT,
  seqLOCK: CUT + seq.marks.LOCK,
  frames: Math.round(DURATION * FPS),
  DURATION,
};
