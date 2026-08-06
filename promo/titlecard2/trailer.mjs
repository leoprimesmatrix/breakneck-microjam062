/**
 * AFTERBURN — THE TRAILER. ~83 seconds.
 *
 * What a trailer has to do, in order: stop the scroll, withhold, escalate,
 * turn, pay off. The first cut of this piece did none of it, because it was
 * staged in a black void — and a void gives the eye nothing to want. So this
 * version is built the other way round: every shot is a *place* first, and the
 * game happens inside it.
 *
 *   I.   THE VISTA (0–12).      A gas giant, its rings, and a star cresting
 *        the limb. No ship, no enemy, no explanation. Just scale.
 *        "EVERY SHIP THAT CAME HERE" / "NEVER LEFT."
 *   II.  THE GRAVEYARD (12–24). Through a field of dead hulls, black against
 *        the planet — and among them, small orange lights waking up.
 *        "NEITHER DID" / "WHAT KILLED THEM."
 *   III. THE MOVE (24–47).      One live ship, smaller than the wrecks. The
 *        ring closes. "NO GUNS." / "NO RETREAT." The engine lights, the world
 *        slows, the line reaches through three of them — "YOU GET ONE MOVE." —
 *        and the release crosses the whole frame.
 *   IV.  THE OTHERS (47–64).    Three hunters in three different places, each
 *        half-lit, each given one rule and no more: "THEY LEARN." /
 *        "THEY HUNT." / "AND THEY MULTIPLY." Cut to black mid-sentence.
 *   V.   THE RUSH (65–72).      Six kills, 1.2s apiece, no setup on any.
 *   VI.  TITLE (72–end).        White-out into the title beat.
 *
 * Never shown: the SPINE, the arena, the HUD, a round of play. The trailer's
 * job is the itch, not the manual.
 *
 * Space comes from `space.mjs`, bodies from `foes.mjs`, the ship from
 * `lib.mjs`, the finale from `seq.mjs?v=date`. mp4 only.
 */
import {
  COL, rgba, TAU, clamp01, glyphFor, drawShip, drawRadial, flareSprite,
} from './lib.mjs';
import { drawFoe, burstFoe } from './foes.mjs';
import {
  bakePlanet, drawAtmosphere, bakeRings, drawRings, makeStars, drawStars,
  bakeCloud, bakeDust, makeNebula, drawNebula, drawDust, drawFlare,
  makeMotes, drawMotes, makeWrecks, drawWrecks, drawHulk,
} from './space.mjs';

export const VARIANT = 'trailer';
const seq = await import('./seq.mjs?v=date');

export const W = 1920;
export const H = 1080;
export const FPS = 60;
const SUB = 8;
const SHUTTER = 0.85 / FPS;
const BAR = 106; // 2.2:1

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => clamp01((t - a) / (b - a));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const R4 = rng(0xa57e01d);
const rr = (a, b) => a + R4() * (b - a);

// ------------------------------------------------------------------ timeline
const A2 = 12.0; // the graveyard
const A3 = 24.0; // adrift, then the move
const IGN = 37.2; // the engine lights
const SLOW = 38.4; // bullet time
const REL = 45.0; // the release
const A4 = 47.0; // ward
const BLK = 50.6; // the block
const A5 = 52.5; // lancer
const CHG = 56.4; // the charge
const A6 = 58.0; // seeder
const BLACKT = 64.0; // cut to black mid-split
const MON = 65.2; // the rush
const MSHOT = [MON, 66.4, 67.6, 68.8, 70.0, 71.2];
const MLAST = MSHOT[MSHOT.length - 1];
const CUT = 72.4;
export const DURATION = CUT + seq.DURATION;

const ACTS = [0, A2, A3, A4, A5, A6, MON, CUT];
/** Which act owns instant `t` — 0 vista, 1 graveyard, 2 the move, 3 ward,
 *  4 lancer, 5 seeder, 6 the rush. */
function actAt(t) {
  for (let i = ACTS.length - 2; i >= 0; i--) if (t >= ACTS[i]) return i;
  return 0;
}

// --------------------------------------------------------------------- cards
const CARDS = [
  { t0: 5.4, hold: 4.6, cold: 'EVERY SHIP THAT CAME HERE', hot: 'NEVER LEFT.', hc: null, cy: H * 0.46 },
  { t0: 17.0, hold: 4.4, cold: 'NEITHER DID', hot: 'WHAT KILLED THEM.', hc: COL.mote, cy: H * 0.44 },
  { t0: 27.6, hold: 3.2, cold: '', hot: 'NO GUNS.', hc: null, cy: H * 0.42 },
  { t0: 32.4, hold: 3.2, cold: '', hot: 'NO RETREAT.', hc: null, cy: H * 0.42 },
  { t0: 40.5, hold: 3.9, cold: 'YOU GET', hot: 'ONE MOVE.', hc: COL.strike, cy: H * 0.27 },
  { t0: 48.7, hold: 3.2, cold: 'THEY', hot: 'LEARN.', hc: COL.ward, cy: H * 0.4 },
  { t0: 54.2, hold: 2.9, cold: 'THEY', hot: 'HUNT.', hc: COL.lancer, cy: H * 0.4 },
  { t0: 59.7, hold: 3.4, cold: 'AND THEY', hot: 'MULTIPLY.', hc: COL.seeder, cy: H * 0.38 },
];
const CONF = [42.6, 43.25, 43.9]; // the line confirming its three kills

// ------------------------------------------------------------------- the sky
const LIGHT = [-0.74, -0.3, 0.6];
const LIGHT2 = [0.68, -0.36, 0.64];

const GIANT = bakePlanet({
  size: 1000, seed: 21, light: LIGHT,
  deep: [17, 13, 31], mid: [102, 57, 96], hot: [246, 196, 150],
  air: [140, 186, 255], bands: 3.4, turb: 0.95,
});
/** The moon the hunters are staged against: cold, cratered, unlit air. */
const MOON = bakePlanet({
  size: 620, seed: 88, light: LIGHT2,
  deep: [10, 12, 18], mid: [58, 62, 78], hot: [176, 184, 200],
  air: [110, 130, 170], bands: 0.4, turb: 1.6, rough: 0.5, ambient: 0.02,
});
const RINGTEX = bakeRings({ seed: 9 });

const RAMPS = [
  [[40, 18, 70], [150, 48, 130], [255, 168, 190]],
  [[12, 32, 66], [36, 128, 168], [168, 244, 255]],
  [[52, 22, 40], [176, 84, 60], [255, 208, 150]],
  [[22, 20, 62], [86, 70, 190], [206, 190, 255]],
];
const TILES = RAMPS.map((r, i) => bakeCloud(101 + i * 7, r, 512, { scale: 2.2 + i * 0.3 }));
const DUSTT = [bakeDust(301), bakeDust(307)];

const STARS = makeStars(1500, 55);
const NEB = makeNebula(48, 77);
const LANES = makeNebula(18, 91, { rMin: 1100, rMax: 3000, tiles: 2 }).map((p) => ({
  ...p, tile: p.tile % 2, a: 0.4 + p.a * 0.5,
}));
const MOTES3 = makeMotes(90, 133);
const WRECKS = makeWrecks(64, 515, {
  sMin: 22, sMax: 760, zMin: 500, box: { x: 6400, y: 3400, z: 6200 },
});

/** The swarm waking among the dead: 3D points that blink on with a stagger. */
const WAKE = Array.from({ length: 190 }, () => ({
  x: rr(-3400, 3400),
  y: rr(-1700, 1700),
  z: rr(700, 4600),
  at: rr(15.4, 20.4),
  ph: R4() * TAU,
  r: rr(2.6, 7),
}));

const sky = document.createElement('canvas');
sky.width = W;
sky.height = H;
const skyC = sky.getContext('2d');

/** Draw the starfield, gas and dust into their own layer so dust can occlude. */
function drawDeepSky(g, cam, a, nebA = 1) {
  skyC.setTransform(1, 0, 0, 1, 0, 0);
  skyC.globalCompositeOperation = 'source-over';
  skyC.globalAlpha = 1;
  skyC.clearRect(0, 0, W, H);
  drawStars(skyC, STARS, cam, W, H, a);
  drawNebula(skyC, NEB, TILES, cam, W, H, a * nebA);
  drawDust(skyC, LANES, DUSTT, cam, W, H, a);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.drawImage(sky, 0, 0);
}

/** The camera through the 3D layers. Every act moves; none of them sit still. */
function spaceCam(t) {
  const act = actAt(t);
  if (act === 0) return { x: -220 + t * 26, y: 40 - t * 7, z: t * 34, t, f: 1050 };
  if (act === 1) {
    const u = t - A2;
    return { x: 200 - u * 14, y: -30 + u * 6, z: 300 + u * 150, t, f: 1000 };
  }
  if (act === 2) {
    const u = t - A3;
    const punch = t > REL ? Math.min(1, (t - REL) * 3) * 900 : 0;
    return { x: -80 + u * 6, y: 20 - u * 2, z: 4000 + u * 26 + punch, t, f: 1020 };
  }
  if (act === 3) return { x: 900 + (t - A4) * 22, y: -140, z: 900 + (t - A4) * 40, t, f: 980 };
  if (act === 4) return { x: -1400 - (t - A5) * 26, y: 220, z: 1800 + (t - A5) * 46, t, f: 980 };
  if (act === 5) return { x: 2400, y: -420 + (t - A6) * 12, z: 2600 + (t - A6) * 30, t, f: 1000 };
  return { x: 300, y: 0, z: 5200 + (t - MON) * 120, t, f: 1000 };
}

/** Where the star sits on screen, per act, and how hard it is blowing out. */
function starAt(t) {
  const act = actAt(t);
  if (act === 0) {
    // It climbs out from behind the limb. The flare's source is drawn under
    // the planet, so the disc eats it until it clears — that is the shot.
    const u = seg(t, 1.4, 5.6);
    return {
      x: W * (0.42 + u * 0.28), y: H * (0.62 - u * 0.32),
      i: 0.4 + easeOut(u) * 0.75, rays: 0.35 + easeOut(u) * 1.1, size: 1.3,
    };
  }
  if (act === 1) return { x: W * 0.3, y: H * 0.12, i: 0.5, rays: 0.3 };
  if (act === 2) return { x: W * 0.79, y: H * 0.17, i: 0.5, rays: 0.25 };
  if (act === 3) return { x: W * 0.1, y: H * 0.82, i: 0.34, rays: 0.14 };
  if (act === 4) return { x: W * 0.94, y: H * 0.1, i: 0.3, rays: 0.1 };
  if (act === 5) return { x: W * 0.5, y: H * 0.24, i: 0.42, rays: 0.2 };
  return { x: W * 0.8, y: H * 0.2, i: 0.4, rays: 0.15 };
}

/** The gas giant's placement per act — or null where it is not in shot. */
function giantAt(t) {
  const act = actAt(t);
  if (act === 0) {
    // A slow, continuous rise: the limb sinks through frame while the disc
    // swells, so the shot is never the same twice even though nothing "moves".
    const u = seg(t, 0, A2);
    return { x: W * (0.24 - u * 0.1), y: H * (0.98 + u * 0.22), r: H * (0.78 + u * 0.42), a: 1 };
  }
  if (act === 1) {
    // Pushed off to the lower right so most of the frame stays dark: the
    // wrecks need somewhere black to be silhouetted against.
    const u = seg(t, A2, A3);
    return { x: W * (0.84 + u * 0.06), y: H * (1.12 - u * 0.04), r: H * (0.72 + u * 0.08), a: 1 };
  }
  if (act === 2) {
    const u = seg(t, A3, A4);
    return { x: W * (0.78 + u * 0.06), y: H * (1.24 - u * 0.05), r: H * (1.15 + u * 0.1), a: 1 };
  }
  if (act === 6) {
    // The rush cuts between places, not just between kills — every shot gets
    // its own horizon so the montage does not read as one long take.
    const i = MSHOT.reduce((k, m, j) => (t >= m ? j : k), 0);
    const P = [
      { x: 0.16, y: 1.32, r: 1.1 }, { x: 0.9, y: 0.16, r: 0.85 },
      { x: 0.42, y: 1.5, r: 1.35 }, { x: 1.06, y: 0.9, r: 0.95 },
      { x: -0.1, y: 0.5, r: 0.8 }, { x: 0.6, y: 1.42, r: 1.2 },
    ][i];
    return { x: W * P.x, y: H * P.y, r: H * P.r, a: 1 };
  }
  return null;
}

function drawSpace(g, t) {
  const cam = spaceCam(t);
  const act = actAt(t);
  // Bullet time drains the room so the line is the only thing with colour.
  const drain = act === 2 ? smooth(seg(t, SLOW, SLOW + 1.1)) * (1 - seg(t, REL, REL + 0.5)) : 0;
  const skyA = [1, 1, 0.92, 0.86, 0.8, 0.9, 0.75][act] * (1 - drain * 0.4);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.fillStyle = '#020307';
  g.fillRect(0, 0, W, H);

  drawDeepSky(g, cam, skyA, act === 3 ? 1.25 : 1);

  const st = starAt(t);
  const gi = giantAt(t);
  if (gi) {
    const ring = { light: LIGHT, tilt: 0.19, rot: -0.3, span: 2.3, a: 0.85 * skyA, W, H };
    drawRings(g, RINGTEX, gi.x, gi.y, gi.r, { ...ring, half: 'back' });
    // The star's own light goes down *before* the disc, so the limb occludes
    // it and the crest reads as a sunrise rather than an overlay.
    drawFlare(g, st.x, st.y, W, H, { i: st.i, rays: st.rays, t, size: st.size ?? 1, part: 'source' });
    g.globalAlpha = gi.a;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(GIANT, gi.x - gi.r, gi.y - gi.r, gi.r * 2, gi.r * 2);
    g.globalAlpha = 1;
    drawAtmosphere(g, gi.x, gi.y, gi.r, LIGHT, [130, 180, 255], skyA);
    drawRings(g, RINGTEX, gi.x, gi.y, gi.r, { ...ring, half: 'front' });
  }

  // A moon, for the two hunter shots that need a second horizon.
  if (act === 4) {
    const mr = H * 0.62;
    const mx = W * 0.86;
    const my = H * 0.76;
    g.drawImage(MOON, mx - mr, my - mr, mr * 2, mr * 2);
    drawAtmosphere(g, mx, my, mr, LIGHT2, [90, 120, 180], 0.5);
  }

  // The graveyard, and the ruin that survives into the next act.
  if (act === 1) drawWrecks(g, WRECKS, cam, W, H, LIGHT, 1);
  if (act === 2) drawWrecks(g, WRECKS, cam, W, H, LIGHT, 0.85 * (1 - drain * 0.35));

  // The swarm waking among the dead.
  if (act === 1) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of WAKE) {
      const on = clamp01((t - s.at) / 0.5);
      if (on <= 0) continue;
      const z = s.z - cam.z;
      if (z < 200) continue;
      const k = cam.f / z;
      const sx = W * 0.5 + (s.x - cam.x) * k;
      const sy = H * 0.5 + (s.y - cam.y) * k;
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
      const fl = 0.55 + 0.45 * Math.sin(t * 3.2 + s.ph);
      // Small lights, not blobs — the near ones must not balloon as they pass.
      drawRadial(g, flareSprite(COL.mote, 0.9), sx, sy, clamp(s.r * k * 7, 4, 46), on * fl * 0.8);
    }
    g.restore();
  }

  drawFlare(g, st.x, st.y, W, H, {
    i: st.i * (1 - drain * 0.3), rays: st.rays, t, size: st.size ?? 1,
    part: gi ? 'ghosts' : 'all',
  });
  drawMotes(g, MOTES3, cam, W, H, 0.8 * skyA);
}

// ---------------------------------------------------------------- lettering
function advance(text, size, track) {
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a + track;
  return (w - track) * size;
}
function glyphPath(ctx, runs, ox, size, slant, baseY) {
  const X = (gx, gy) => ox + (gx + slant * (1 - gy)) * size;
  const Y = (gy) => baseY - (1 - gy) * size;
  for (const run of runs) {
    ctx.moveTo(X(run[0], run[1]), Y(run[1]));
    for (let i = 2; i < run.length; i += 2) ctx.lineTo(X(run[i], run[i + 1]), Y(run[i + 1]));
  }
}
function strokeLetters(ctx, text, cx, cyy, size, track, col, alphaAt, lwF = 0.12) {
  const w = advance(text, size, track);
  let x = cx - w * 0.5;
  const baseY = cyy + size * 0.5;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.lineWidth = lwF * size;
  let i = 0;
  for (const ch of text) {
    const a = alphaAt(i);
    if (a > 0.004) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = rgba(col, 1);
      ctx.beginPath();
      glyphPath(ctx, glyphFor(ch).p, x, size, 0.055, baseY);
      ctx.stroke();
    }
    x += (glyphFor(ch).a + track) * size;
    i++;
  }
}
function strokeWord(ctx, text, cx, y, size, col, alpha, track = 0.3) {
  strokeLetters(ctx, text, cx, y, size, track, col, () => alpha, 0.13);
}

for (const c of CARDS) {
  c.t1 = c.t0 + c.hold;
  const unit = advance(c.hot, 1, 0.46);
  c.hotSize = Math.min(c.cold ? 108 : 124, (W * 0.74) / unit);
  c.slam = c.t0 + (c.cold ? 0.72 : 0.16);
}
const SLAMS = CARDS.map((c) => c.slam);

function cardEnv(card, t) {
  if (t <= card.t0 || t >= card.t1) return 0;
  return easeOut(seg(t, card.t0, card.t0 + 0.4)) * (1 - smooth(seg(t, card.t1 - 0.34, card.t1)));
}

function strokeCard(ctx, card, t, alpha) {
  const u = t - card.t0;
  if (u <= 0 || t >= card.t1) return;
  const out = smooth(seg(t, card.t1 - 0.34, card.t1));
  const fade = (1 - out) ** 2;
  if (fade <= 0.004) return;
  const drift = 1 + 0.016 * clamp01(u / card.hold) + out * 0.05;

  ctx.save();
  ctx.translate(W * 0.5, card.cy);
  ctx.scale(drift, drift);

  if (card.cold) {
    const cu = clamp01(u / 0.62);
    const track = lerp(1.05, 0.52, easeOut(cu));
    strokeLetters(
      ctx, card.cold, 0, -card.hotSize * 0.66, 42, track, COL.ink,
      (i) => fade * alpha * 0.9 * clamp01((u - i * 0.028) / 0.22), 0.115,
    );
  }

  const hu = t - card.slam;
  if (hu > 0) {
    const e = easeOut(clamp01(hu / 0.3));
    const sc2 = 1.5 - 0.5 * e;
    const ha = clamp01(hu / 0.1) * fade * alpha;
    const flash = Math.exp(-hu * 5.5);
    const size = card.hotSize;
    const y = card.cold ? size * 0.28 : 0;
    const col = card.hc ?? COL.ink;
    ctx.save();
    ctx.translate(0, y);
    ctx.scale(sc2, sc2);
    strokeLetters(ctx, card.hot, 0, 0, size, 0.46, col, () => ha * 0.98, 0.12);
    if (flash > 0.02) {
      strokeLetters(
        ctx, card.hot, 0, 0, size, 0.46, COL.playerCore,
        () => ha * flash * 0.8, 0.12 * (1 + flash * 0.9),
      );
    }
    ctx.restore();
    const halfW = advance(card.hot, size * sc2, 0.46) * 0.5;
    const ext = 80 + 250 * e;
    ctx.globalAlpha = ha * (0.14 + flash * 0.5);
    ctx.strokeStyle = rgba(col, 1);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-halfW - 36 - ext, y);
    ctx.lineTo(-halfW - 36, y);
    ctx.moveTo(halfW + 36, y);
    ctx.lineTo(halfW + 36 + ext, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------- scene actors
const SHIP_P = { x: W * 0.34, y: H * 0.6 };
const LINE_ANG = -0.3;
const LDX = Math.cos(LINE_ANG);
const LDY = Math.sin(LINE_ANG);
const NOSE = 62;
const NX = SHIP_P.x + LDX * NOSE;
const NY = SHIP_P.y + LDY * NOSE;
const REACH = 880;

const RING = Array.from({ length: 8 }, (_, i) => ({
  a: (i / 8) * TAU + 0.3 + rr(-0.12, 0.12),
  bob: R4() * TAU,
  r: rr(17, 22),
  seed: R4() * 10,
  spd: rr(0.02, 0.05),
}));
const COLUMN = [320, 560, 800].map((d) => ({
  d, r: 19, seed: R4() * 10, bob: R4() * TAU, kill: REL + d / 4400,
}));
const EMBERS = Array.from({ length: 66 }, (_, i) => {
  const host = COLUMN[i % 3];
  const a = R4() * TAU;
  const sp = rr(10, 74);
  return {
    d: host.d, born: host.kill,
    vx: Math.cos(a) * sp + LDX * rr(26, 120),
    vy: Math.sin(a) * sp + LDY * rr(26, 120),
    r: rr(1.2, 3.6), life: rr(3.4, 6), ph: R4() * TAU,
  };
});
const STREAKS = Array.from({ length: 30 }, () => ({
  off: rr(-420, 420), ang: LINE_ANG + rr(-0.16, 0.16),
  spd: rr(2200, 4400), len: rr(80, 230), a: rr(0.15, 0.55), back: rr(-500, 200),
}));
const MSTREAKS = Array.from({ length: 20 }, () => ({
  y: rr(0.08, 0.92), spd: rr(2600, 5200), x0: rr(0, W), len: rr(120, 320), a: rr(0.1, 0.38),
}));

/** Two big hulls the adrift ship sits between — staged, not from the field. */
const BERTH = [
  { i: 2, x: W * 0.06, y: H * 0.52, s: 520, rot: 0.24 },
  { i: 5, x: W * 0.86, y: H * 0.78, s: 640, rot: -0.5 },
  { i: 8, x: W * 0.66, y: H * 0.2, s: 300, rot: 1.1 },
];

const WARD_P = { x: W * 0.6, y: H * 0.6, r: 124 };
const LAN_P = { x: W * 0.24, y: H * 0.66, r: 64, rot: -0.2 };
const SEED_P = { x: W * 0.5, y: H * 0.6, r: 90 };

function wardPos(t) {
  const u = t - A4;
  let x = WARD_P.x + 36 - u * 10;
  const y = WARD_P.y + Math.sin(t * 0.7) * 10;
  let a = smooth(clamp01(u / 1.0));
  const rq = t - (BLK + 0.6);
  if (rq > 0) {
    x += rq * rq * 240;
    a *= Math.max(0, 1 - rq / 1.2);
  }
  return { x, y, a };
}
function lancerState(t) {
  const markT = clamp01((t - A5) / (CHG - A5));
  const settle = smooth(markT);
  return {
    markT,
    sweep: LAN_P.rot + 0.05 * Math.sin((t - A5) * 0.9) * (1 - settle),
    y: LAN_P.y + Math.sin((t - A5) * 0.95 + 0.7) * 34 * (1 - settle * 0.75),
  };
}
const LAN_YC = lancerState(CHG).y;

// --------------------------------------------------------------- aim preview
function drawAimLine(ctx, t, alpha) {
  const grow = smooth(seg(t, SLOW + 0.7, SLOW + 2.2));
  if (grow <= 0) return;
  const gone = 1 - seg(t, REL + 0.5, REL + 1.0);
  if (gone <= 0) return;
  const focusA = 0.85 * grow * gone * (t > REL ? 0.45 : 1);
  const chgU = seg(t, REL - 1.1, REL);
  const dist = REACH * grow;
  const ex = NX + LDX * dist;
  const ey = NY + LDY * dist;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.globalAlpha = 1;

  ctx.strokeStyle = rgba(COL.strike, 0.07 * focusA * alpha);
  ctx.lineWidth = 46;
  ctx.beginPath();
  ctx.moveTo(NX, NY);
  ctx.lineTo(NX + LDX * 1500, NY + LDY * 1500);
  ctx.stroke();

  ctx.strokeStyle = rgba(COL.strike, (0.15 + chgU * 0.09) * focusA * alpha);
  ctx.lineWidth = 40;
  ctx.beginPath();
  ctx.moveTo(NX, NY);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = rgba(COL.strike, (0.5 + chgU * 0.3) * focusA * alpha);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(NX, NY);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  const gx = -LDY;
  const gy = LDX;
  ctx.strokeStyle = rgba(COL.strike, 0.32 * focusA * alpha);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let d = 80; d < dist - 24; d += 80) {
    const tx = NX + LDX * d;
    const ty = NY + LDY * d;
    ctx.moveTo(tx - gx * 6, ty - gy * 6);
    ctx.lineTo(tx + gx * 6, ty + gy * 6);
  }
  ctx.stroke();

  ctx.setLineDash([26, 20]);
  ctx.lineDashOffset = -(t * 150 + chgU * chgU * 420);
  ctx.strokeStyle = rgba(COL.playerCore, (0.7 + chgU * 0.3) * focusA * alpha);
  ctx.lineWidth = 3.4 + chgU * 1.4;
  ctx.beginPath();
  ctx.moveTo(NX, NY);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);

  COLUMN.forEach((m, i) => {
    if (m.d > dist) return;
    const tx = NX + LDX * m.d;
    const ty = NY + LDY * m.d;
    const cf = t - CONF[i];
    const lit = cf > 0;
    const fl = lit ? Math.exp(-cf * 4) : 0;
    const pulse = lit ? 1 + fl * 0.25 : 1 + Math.sin(t * 4 + m.bob) * 0.1;
    ctx.strokeStyle = rgba(COL.strike, ((lit ? 0.9 : 0.42) + fl * 0.4) * focusA * alpha);
    ctx.lineWidth = lit ? 2.8 : 2;
    ctx.beginPath();
    ctx.arc(tx, ty, 34 * pulse, 0, TAU);
    ctx.stroke();
    if (lit) {
      drawRadial(ctx, flareSprite(COL.strike, 0.9), tx, ty, 40, fl * focusA * alpha * 0.8);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx - gx * 15, ty - gy * 15);
      ctx.lineTo(tx - gx * 26, ty - gy * 26);
      ctx.moveTo(tx + gx * 15, ty + gy * 15);
      ctx.lineTo(tx + gx * 26, ty + gy * 26);
      ctx.stroke();
    }
  });

  if (grow >= 0.99) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(COL.playerCore, 0.85 * focusA * alpha);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex - gx * 15, ey - gy * 15);
    ctx.lineTo(ex + gx * 15, ey + gy * 15);
    ctx.stroke();
    drawRadial(ctx, flareSprite(COL.strike, 0.9), ex, ey, 26, focusA * alpha * 0.8);
    const n = CONF.reduce((k, c) => k + (t > c ? 1 : 0), 0);
    if (n > 0) {
      const popS = 1 + Math.exp(-(t - CONF[n - 1]) * 7) * 0.45;
      strokeWord(ctx, String(n), ex + LDX * 46, ey + LDY * 46 - 14, 30 * popS, COL.strike, focusA * alpha * 0.9);
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------- scene inking
function drawInk(ctx, t, alpha) {
  const act = actAt(t);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;

  // ---- Act III: adrift, the ring, the line, the release.
  if (act === 2) {
    const ignite = smooth(seg(t, IGN, IGN + 1.4));
    const bullet = smooth(seg(t, SLOW, SLOW + 1.0));
    const closed = smooth(seg(Math.min(t, SLOW + 1), A3 + 1.5, SLOW + 1));
    const ringR = 620 - 300 * closed;

    for (const m of RING) {
      const drift = lerp(1, 0.12, bullet);
      const a = m.a + t * m.spd * drift;
      let x = SHIP_P.x + Math.cos(a) * ringR * 1.2;
      let y = SHIP_P.y + Math.sin(a) * ringR * 0.78;
      let fade = 1;
      if (t > REL) {
        const q = t - REL;
        const side = (x - NX) * -LDY + (y - NY) * LDX > 0 ? 1 : -1;
        x += -LDY * side * q * q * 300 + LDX * q * 40;
        y += LDX * side * q * q * 300 + LDY * q * 40;
        fade = Math.max(0, 1 - q / 1.8);
      }
      if (fade <= 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawFoe(ctx, 'mote', x, y + Math.sin(t * 1.1 + m.bob) * 7 * lerp(1, 0.15, bullet), {
        r: m.r, clock: lerp(t, t * 0.15, bullet), seed: m.seed, alpha: alpha * fade,
        rot: t * 0.4 * lerp(1, 0.15, bullet) + m.bob,
        toP: Math.atan2(SHIP_P.y - y, SHIP_P.x - x),
      });
      ctx.globalCompositeOperation = 'lighter';
    }

    for (const m of COLUMN) {
      const x = NX + LDX * m.d;
      const y = NY + LDY * m.d;
      if (t < m.kill) {
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'source-over';
        drawFoe(ctx, 'mote', x, y + Math.sin(t * 0.9 + m.bob) * 5 * (1 - bullet), {
          r: m.r, clock: lerp(t, t * 0.15, bullet), seed: m.seed, alpha,
          rot: t * 0.3 + m.bob, toP: Math.atan2(NY - y, NX - x),
        });
        ctx.globalCompositeOperation = 'lighter';
      } else {
        burstFoe(ctx, 'mote', x, y, m.r, t - m.kill, alpha);
      }
    }

    // The aftermath: burning wrecks, embers, and the trail cooling.
    if (t > REL) {
      ctx.globalAlpha = alpha;
      for (const m of COLUMN) {
        const q = t - m.kill;
        if (q <= 0) continue;
        const f = Math.max(0, 1 - q / 3.2);
        drawRadial(
          ctx, flareSprite(mix(COL.warn, COL.mote, 0.5), 0.85),
          NX + LDX * m.d, NY + LDY * m.d, 90 + q * 40,
          alpha * f * f * (0.5 + 0.5 * Math.sin(t * 9 + m.bob)) * 0.55,
        );
      }
      for (const e of EMBERS) {
        const q = t - e.born;
        if (q <= 0 || q > e.life) continue;
        const f = 1 - q / e.life;
        const drag = 1 - q / (e.life * 2.6);
        drawRadial(
          ctx, flareSprite(mix(COL.warn, COL.mote, 0.4), 0.9),
          NX + LDX * e.d + e.vx * q * drag, NY + LDY * e.d + e.vy * q * drag,
          e.r * 16, alpha * f * (0.55 + 0.45 * Math.sin(t * 7 + e.ph)) * 0.9,
        );
      }
      const cool = Math.exp(-(t - REL) * 1.05);
      if (cool > 0.02) {
        const ex = NX + LDX * 1600;
        const ey = NY + LDY * 1600;
        const cg = ctx.createLinearGradient(NX, NY, ex, ey);
        cg.addColorStop(0, rgba(COL.strike, 0.13 * cool * alpha));
        cg.addColorStop(0.45, rgba(COL.strike, 0.05 * cool * alpha));
        cg.addColorStop(1, rgba(COL.strike, 0));
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = cg;
        ctx.lineWidth = 22 * (1 + (t - REL) * 0.35);
        ctx.beginPath();
        ctx.moveTo(NX, NY);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }

    drawAimLine(ctx, t, alpha);

    if (t >= REL) {
      const q = t - REL;
      const env = Math.min(1, q / 0.03) * Math.exp(-Math.max(0, q - 0.3) * 5);
      if (env > 0.01) {
        const len = Math.min(q * 4400 + 120, 2200);
        ctx.lineCap = 'round';
        for (const [w, col, a] of [
          [2.2, COL.strike, 0.2], [0.85, COL.strike, 0.55], [0.32, COL.playerCore, 0.95],
        ]) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(col, a * env * alpha);
          ctx.lineWidth = 44 * w;
          ctx.beginPath();
          ctx.moveTo(NX, NY);
          ctx.lineTo(NX + LDX * len, NY + LDY * len);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha;
        drawRadial(ctx, flareSprite(COL.strike, 1), NX, NY, 120 * env, env * alpha);
        ctx.save();
        ctx.translate(NX, NY);
        ctx.scale(9, 0.42);
        drawRadial(ctx, flareSprite(COL.playerCore, 0.9), 0, 0, 60 * (0.5 + env), alpha * env * 0.7);
        ctx.restore();
      }
      if (q < 0.9) {
        for (const [spd, wdt, aa] of [[2600, 4, 0.5], [1500, 2.2, 0.3]]) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(COL.playerCore, aa * Math.exp(-q * 3.2) * alpha);
          ctx.lineWidth = wdt;
          ctx.beginPath();
          ctx.arc(NX, NY, q * spd + 10, 0, TAU);
          ctx.stroke();
        }
      }
      if (q < 0.7) {
        const senv = 1 - q / 0.7;
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.6;
        for (const s of STREAKS) {
          const along = s.back + q * s.spd;
          const px0 = NX - LDY * s.off + LDX * along;
          const py0 = NY + LDX * s.off + LDY * along;
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(COL.playerCore, s.a * senv * alpha * 0.8);
          ctx.beginPath();
          ctx.moveTo(px0, py0);
          ctx.lineTo(px0 + Math.cos(s.ang) * s.len, py0 + Math.sin(s.ang) * s.len);
          ctx.stroke();
        }
      }
    }

    // The ship. Tiny — it has to look smaller than the things around it.
    const shipQ = t < REL ? 0 : (t - REL) * 4400;
    const sx = SHIP_P.x + LDX * shipQ;
    const sy = SHIP_P.y + LDY * shipQ;
    if (sx < W + 700) {
      const chgU = seg(t, REL - 1.1, REL);
      const wander = (1 - ignite) * Math.sin(t * 0.7) * 0.22;
      if (t > IGN && t < REL) {
        const iq = t - IGN;
        ctx.globalAlpha = alpha;
        drawRadial(
          ctx, flareSprite(COL.player, 0.9), sx - LDX * 34, sy - LDY * 34,
          54 * Math.exp(-iq * 2.2), alpha * Math.exp(-iq * 2.4),
        );
        if (iq < 1.1) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = rgba(COL.player, 0.4 * Math.exp(-iq * 2.6) * alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sx, sy, iq * 760 + 8, 0, TAU);
          ctx.stroke();
        }
      }
      if (t < IGN + 0.5) {
        ctx.globalAlpha = alpha;
        drawRadial(
          ctx, flareSprite(COL.danger, 0.8), sx + 6, sy - 12, 8,
          alpha * Math.exp(-((t * 0.833) % 1) * 5) * 0.5 * (1 - ignite),
        );
      }
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawShip(ctx, sx, sy + (1 - ignite) * Math.sin(t * 1.3) * 5, LINE_ANG + wander + 0.3 * (1 - ignite), 42, {
        thrust: t < REL ? 0.08 + ignite * 0.72 + 0.05 * Math.sin(t * 7) : 1,
        bank: 0, stretch: t < REL ? 0 : 1,
        charge: t < REL ? Math.min(1, bullet * 0.7 + chgU * 0.45) : 0,
        alpha: 1, clock: t,
      });
      ctx.globalCompositeOperation = 'lighter';
    }
  }

  // ---- Act IV a: the ward.
  if (act === 3) {
    const wp = wardPos(t);
    const lock = smooth(seg(t, A4 + 0.9, A4 + 2.6));
    const shield = Math.PI - 2.3 * (1 - lock) + Math.sin(t * 0.9) * 0.05;
    const flash = t > BLK ? Math.exp(-(t - BLK) * 5) : 0;
    const pu = seg(t, BLK - 2.6, BLK);
    const probe = pu * pu;
    if (probe > 0 && wp.a > 0.01) {
      const x0 = -80;
      const y0 = wp.y + 150;
      const ang = Math.atan2(wp.y - y0, wp.x - x0);
      const hitD = Math.hypot(wp.x - x0, wp.y - y0) - (WARD_P.r + 46);
      const d = hitD * probe;
      const ex = x0 + Math.cos(ang) * d;
      const ey = y0 + Math.sin(ang) * d;
      const fA = 0.6 * probe;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(COL.strike, 0.13 * fA * alpha);
      ctx.lineWidth = 34;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([26, 20]);
      ctx.lineDashOffset = -t * 150;
      ctx.strokeStyle = rgba(COL.playerCore, 0.6 * fA * alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      if (t > BLK) {
        ctx.setLineDash([9, 13]);
        ctx.strokeStyle = rgba(COL.danger, 0.5 * alpha);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(ang) * 210, ey + Math.sin(ang) * 210);
        ctx.stroke();
        ctx.setLineDash([]);
        const s = 15 + Math.sin(t * 12) * 2;
        ctx.strokeStyle = rgba(COL.danger, 0.95 * alpha);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(ex - s, ey - s);
        ctx.lineTo(ex + s, ey + s);
        ctx.moveTo(ex + s, ey - s);
        ctx.lineTo(ex - s, ey + s);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        strokeWord(ctx, 'SHIELDED', ex, ey - 52, 20, COL.danger, alpha * Math.min(1, flash * 2 + 0.55));
        ctx.globalCompositeOperation = 'lighter';
      }
    }
    if (wp.a > 0.01) {
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawFoe(ctx, 'ward', wp.x, wp.y, {
        r: WARD_P.r, hitR: (WARD_P.r + 46) * 1.26, clock: t, seed: 2.4,
        alpha: alpha * 0.92 * wp.a, rot: t * 0.25, toP: Math.PI, shield, flash,
      });
      ctx.globalCompositeOperation = 'lighter';
    }
  }

  // ---- Act IV b: the lancer.
  if (act === 4) {
    const ls = lancerState(t);
    const q = t - CHG;
    const chD = q > 0 ? q * q * (0.35 + 0.65 * Math.min(1, q / 0.5)) * 5200 : 0;
    const baseY = q > 0 ? LAN_YC : ls.y;
    const rot = q > 0 ? LAN_P.rot : ls.sweep;
    const lx = LAN_P.x + Math.cos(rot) * chD;
    const ly = baseY + Math.sin(rot) * chD;
    if (t < CHG + 0.8) {
      const lockFl = t > CHG - 0.55 ? Math.exp(-(t - (CHG - 0.55)) * 6) : 0;
      const x2 = LAN_P.x + Math.cos(ls.sweep) * 2600;
      const y2 = baseY + Math.sin(ls.sweep) * 2600;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(COL.lancer, (0.06 + ls.markT * 0.1 + lockFl * 0.1) * alpha);
      ctx.lineWidth = 40 * (1 - ls.markT * 0.62);
      ctx.beginPath();
      ctx.moveTo(LAN_P.x, baseY);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -t * 190;
      ctx.strokeStyle = rgba(COL.lancer, (0.35 + ls.markT * 0.5 + lockFl * 0.4) * alpha);
      ctx.lineWidth = 1.5 + ls.markT * 2.5;
      ctx.beginPath();
      ctx.moveTo(LAN_P.x, baseY);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (lx < W + 500) {
      if (q > 0) {
        ctx.globalAlpha = alpha;
        for (let k = 1; k <= 10; k++) {
          const qq = t - k * 0.014 - CHG;
          if (qq <= 0) break;
          const dd = qq * qq * (0.35 + 0.65 * Math.min(1, qq / 0.5)) * 5200;
          drawRadial(
            ctx, flareSprite(COL.lancer, 0.8),
            LAN_P.x + Math.cos(rot) * dd, LAN_YC + Math.sin(rot) * dd,
            LAN_P.r * 1.6 * (1 - k / 12), alpha * (1 - k / 11) ** 2 * 0.4,
          );
        }
      }
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawFoe(ctx, 'lancer', lx, ly, {
        r: LAN_P.r, clock: t, seed: 3.1, alpha: alpha * 0.95,
        rot, toP: rot + 2.6, state: q > 0 ? 2 : 1,
      });
      ctx.globalCompositeOperation = 'lighter';
    }
  }

  // ---- Act IV c: the seeder, opening. Cut before it finishes.
  if (act === 5 && t < BLACKT) {
    const grow = smooth(seg(t, A6, A6 + 4.2));
    const build = seg(t, BLACKT - 3.2, BLACKT);
    const dy = build * build * 17;
    const swell = 0.22 + grow * 0.62 + build * 0.5 + 0.05 * Math.sin(t * 2.3);
    const push = 1 + smooth(seg(t, A6, BLACKT)) * 0.26;
    ctx.save();
    ctx.translate(SEED_P.x, SEED_P.y);
    ctx.scale(push, push);
    ctx.translate(-SEED_P.x, -SEED_P.y);
    ctx.globalAlpha = alpha;
    for (let k = 0; k < 3; k++) {
      const oa = t * (1.1 + grow * 1.5) + (k * TAU) / 3;
      const orb = 320 - grow * 100;
      drawRadial(
        ctx, flareSprite(COL.mote, 0.8),
        SEED_P.x + Math.cos(oa) * orb, SEED_P.y + Math.sin(oa) * orb * 0.42,
        22 + grow * 14, alpha * (0.1 + 0.2 * grow + 0.3 * build) * (0.7 + 0.3 * Math.sin(t * 6 + k * 2)),
      );
    }
    if (build > 0.02) {
      const la = build * (0.8 + 0.2 * Math.sin(t * 13 + 1));
      const lg = ctx.createLinearGradient(SEED_P.x - 200, 0, SEED_P.x + 200, 0);
      lg.addColorStop(0, rgba(COL.mote, 0));
      lg.addColorStop(0.5, rgba(COL.mote, 0.5 * la * alpha));
      lg.addColorStop(1, rgba(COL.mote, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = lg;
      ctx.fillRect(SEED_P.x - 200, SEED_P.y - 2 - dy, 400, 4 + dy * 2);
      ctx.globalAlpha = alpha;
      drawRadial(ctx, flareSprite(COL.mote, 0.8), SEED_P.x, SEED_P.y, 135 * build, alpha * la * 0.7);
    }
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(SEED_P.x - 340, s < 0 ? SEED_P.y - 400 : SEED_P.y, 680, 400);
      ctx.clip();
      ctx.translate(0, s * dy);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawFoe(ctx, 'seeder', SEED_P.x, SEED_P.y, {
        r: SEED_P.r, clock: t, seed: 4.2, alpha: alpha * 0.75,
        rot: 0.1 * Math.sin(t * 0.3), toP: -1.2, age: t, swell,
      });
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
    }
    ctx.restore();
  }

  // ---- Act V: six kills, no setup on any of them.
  if (act === 6 && t >= MON) {
    const shot = MSHOT.reduce((k, m, i) => (t >= m ? i : k), 0);
    const q = t - MSHOT[shot];
    const wipe = Math.exp(-Math.max(0, q - 0.22) * 3.4);

    const beam = (x0, y0, ang, a) => {
      ctx.lineCap = 'round';
      for (const [w, col, aa] of [
        [2.2, COL.strike, 0.2], [0.85, COL.strike, 0.55], [0.32, COL.playerCore, 0.95],
      ]) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgba(col, aa * a * wipe * alpha);
        ctx.lineWidth = 32 * w;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(ang) * 2600, y0 + Math.sin(ang) * 2600);
        ctx.stroke();
      }
    };
    const smear = (x, y, s, a) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(s, s * 0.05);
      drawRadial(ctx, flareSprite(COL.playerCore, 0.9), 0, 0, 70, alpha * a * 0.75);
      ctx.restore();
    };
    const kill = (kind, x, y, r, at, pose) => {
      const kq = q - at;
      if (kq < 0) {
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'source-over';
        drawFoe(ctx, kind, x, y, { r, clock: t, alpha, ...pose });
        ctx.globalCompositeOperation = 'lighter';
      } else {
        burstFoe(ctx, kind, x, y, r, kq, alpha);
        smear(x, y, 7, Math.exp(-kq * 5));
      }
    };

    if (shot === 0) {
      const ang = -0.38;
      for (let i = 0; i < 4; i++) {
        const d = 300 + i * 300;
        kill('mote', W * 0.1 + Math.cos(ang) * d, H * 0.8 + Math.sin(ang) * d, 22,
          0.06 + i * 0.09, { seed: i * 2.3, rot: t + i, toP: 2.2 });
      }
      beam(W * 0.1, H * 0.8, ang, 0.95);
    } else if (shot === 1) {
      const p = q / 1.2;
      const sx = -320 + (W + 640) * p;
      const sy = H * 0.55 - p * 70;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.4;
      for (const s of MSTREAKS) {
        const span = W + 400;
        const x = ((((s.x0 - q * s.spd) % span) + span) % span) - 200;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rgba(COL.playerCore, s.a * alpha * 0.7);
        ctx.beginPath();
        ctx.moveTo(x, s.y * H);
        ctx.lineTo(x + s.len, s.y * H);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      drawShip(ctx, sx, sy, -0.06, 175, {
        thrust: 1, bank: 0.12, stretch: 0.5, charge: 0, alpha: 1, clock: t,
      });
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      drawRadial(ctx, flareSprite(COL.strike, 0.9), sx - 270, sy, 210, alpha * 0.7);
    } else if (shot === 2) {
      const cx = W * 0.46;
      const cy = H * 0.52;
      kill('seeder', cx, cy, 76, 0.2, { seed: 8.1, rot: 0.2, toP: 2.4, age: t, swell: 0.9 });
      const sq = q - 0.2;
      if (sq > 0) {
        ctx.globalAlpha = alpha;
        for (let k = 0; k < 3; k++) {
          const a = -0.9 + k * 1.15;
          const d = sq * 520;
          drawRadial(
            ctx, flareSprite(COL.mote, 0.9), cx + Math.cos(a) * d, cy + Math.sin(a) * d,
            60 * Math.max(0, 1 - sq * 0.8), alpha * Math.max(0, 1 - sq) * 0.9,
          );
        }
      }
      beam(W * 0.06, H * 0.74, -0.24, 1);
    } else if (shot === 3) {
      kill('ward', W * 0.56, H * 0.5, 72, 0.24,
        { seed: 5.3, hitR: 112 * 1.26, rot: t * 0.25, toP: 2.35, shield: 2.35 });
      beam(W * 0.1, H * 0.86, -0.5, 1);
    } else if (shot === 4) {
      const lx = W * 0.72 - q * 700;
      const ly = H * 0.44 + q * 130;
      ctx.globalAlpha = 1;
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -t * 190;
      ctx.strokeStyle = rgba(COL.lancer, 0.6 * wipe * alpha);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - 1400, ly + 260);
      ctx.stroke();
      ctx.setLineDash([]);
      kill('lancer', lx, ly, 52, 0.3, { seed: 3.1, rot: 2.95, toP: 2.95, state: 2 });
      beam(W * 0.28, H * 1.02, -0.86, 1);
    } else {
      const ang = -0.16;
      for (let i = 0; i < 9; i++) {
        const d = 180 + i * 210;
        kill('mote', W * 0.02 + Math.cos(ang) * d,
          H * 0.62 + Math.sin(ang) * d + Math.sin(i * 2.1) * 130,
          28, 0.24 + i * 0.035, { seed: i * 1.7, rot: t + i, toP: 3.0 });
      }
      beam(W * 0.02, H * 0.62, ang, 1);
    }
  }

  for (const card of CARDS) strokeCard(ctx, card, t, alpha);
  ctx.restore();
}

/** The staged hulls the adrift ship sits among — drawn opaque, not additive. */
function drawBerth(g, t) {
  const act = actAt(t);
  if (act !== 2) return;
  const a = (1 - seg(t, REL, REL + 0.8)) * smooth(seg(t, A3, A3 + 0.8));
  if (a <= 0.01) return;
  const push = 1 + seg(t, A3, A4) * 0.09;
  for (const b of BERTH) {
    const x = W * 0.5 + (b.x - W * 0.5) * push;
    const y = H * 0.5 + (b.y - H * 0.5) * push;
    drawHulk(g, b.i, x, y, b.s * push, b.rot + t * 0.006, LIGHT, a);
  }
}

// ------------------------------------------------------------------- camera
const SHOTS = [
  { z0: 1.02, z1: 1.09, x0: 20, x1: -24, y0: -8, y1: 8, r0: 0.004, r1: -0.003 },
  { z0: 1.05, z1: 1.14, x0: -26, x1: 22, y0: 10, y1: -10, r0: -0.006, r1: 0.004 },
  null,
  { z0: 1.06, z1: 1.2, x0: -34, x1: 22, y0: 12, y1: -12, r0: -0.01, r1: -0.002 },
  { z0: 1.04, z1: 1.18, x0: 30, x1: -26, y0: -8, y1: 12, r0: 0.017, r1: 0.007 },
  { z0: 1.03, z1: 1.26, x0: -12, x1: 10, y0: 6, y1: -10, r0: -0.006, r1: 0.003 },
  { z0: 1.06, z1: 1.1, x0: 0, x1: 0, y0: 0, y1: 0, r0: 0, r1: 0 },
];

function frameCam(t) {
  const act = actAt(t);
  let z;
  let x;
  let y;
  let rot;
  if (act === 2) {
    const p = seg(t, A3, A4);
    const chg = seg(t, REL - 1.1, REL);
    z = 1.02 + smooth(seg(t, SLOW, SLOW + 2.4)) * 0.05 + chg * chg * 0.06;
    if (t > REL) z = lerp(1.16, 1.04, smooth(seg(t, REL, REL + 1.2)));
    x = lerp(18, -16, p);
    y = lerp(8, -8, p);
    rot = 0.003 - p * 0.006;
  } else {
    const s = SHOTS[act];
    const p = smooth(seg(t, ACTS[act], ACTS[act + 1]));
    z = lerp(s.z0, s.z1, p);
    x = lerp(s.x0, s.x1, p);
    y = lerp(s.y0, s.y1, p);
    rot = lerp(s.r0, s.r1, p);
  }

  let kick = 0;
  for (const b of [A2, A3, A4, A5, A6, MON]) if (t > b) kick += Math.exp(-(t - b) * 6) * 0.022;
  for (const b of MSHOT) if (t > b) kick += Math.exp(-(t - b) * 8) * 0.028;
  for (const s of SLAMS) if (t > s) kick += Math.exp(-(t - s) * 8) * 0.014;
  for (const c of CONF) if (t > c) kick += Math.exp(-(t - c) * 10) * 0.008;
  if (t > IGN) kick += Math.exp(-(t - IGN) * 7) * 0.018;
  if (t > REL) kick += Math.exp(-(t - REL) * 6) * 0.05;
  if (t > BLK) kick += Math.exp(-(t - BLK) * 8) * 0.016;
  if (t > CHG) kick += Math.exp(-(t - CHG) * 7) * 0.03;
  if (t > MLAST + 0.24) kick += Math.exp(-(t - MLAST - 0.24) * 8) * 0.03;

  const wild = act === 6 ? 2.4 : 1;
  const hx = (Math.sin(t * 0.9 + 1.7) * 2.2 + Math.sin(t * 2.31) * 1.1 + Math.sin(t * 5.7) * 0.45) * wild;
  const hy = (Math.cos(t * 0.83 + 0.4) * 1.9 + Math.sin(t * 2.02 + 2) * 0.9 + Math.cos(t * 6.3) * 0.4) * wild;

  let sx = 0;
  let sy = 0;
  const rattle = (b, k, amp) => {
    if (t <= b) return;
    const e = Math.exp(-(t - b) * k);
    sx += Math.sin(t * 45 + b) * amp * e;
    sy += Math.cos(t * 39 + b) * amp * 0.7 * e;
  };
  rattle(REL, 4, 6);
  rattle(CHG, 5, 4);
  if (act === 6) for (const b of MSHOT) rattle(b, 5, 5);

  return {
    z: z + kick,
    x: x + hx + sx,
    y: y + hy + sy,
    rot: rot + 0.0032 * Math.sin(t * 0.21) +
      (t > REL ? Math.exp(-(t - REL) * 5) * 0.005 * Math.sin(t * 26) : 0) +
      (act === 6 ? 0.003 * Math.sin(t * 17) : 0),
  };
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
const world = makeCanvas(W, H);
const worldC = world.getContext('2d');

const GRAIN = [];
{
  const G5 = rng(0x6ea1a);
  for (let n = 0; n < 3; n++) {
    const c = makeCanvas(320, 320);
    const g = c.getContext('2d');
    const id = g.createImageData(320, 320);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 122 + (G5() - 0.5) * 40;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    GRAIN.push(c);
  }
}

const WASH = [COL.warn, COL.mote, COL.focus, COL.ward, COL.lancer, COL.seeder, COL.strike];

function actFrame(g, t) {
  const cam = frameCam(t);

  // The world — space, wrecks, staged hulls — drawn once, then flown by the
  // frame camera. Only the ink layer pays for shutter sub-sampling.
  worldC.setTransform(1, 0, 0, 1, 0, 0);
  worldC.globalCompositeOperation = 'source-over';
  worldC.globalAlpha = 1;
  worldC.filter = 'none';
  drawSpace(worldC, t);
  drawBerth(worldC, t);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  // Per-act exposure. The vista wants to be blinding; the acts with actors in
  // them want the room pulled down so the ship and the line are the brightest
  // things on screen. Stopping the world down is cheaper than lighting them.
  const EXPO = [1, 0.92, 0.58, 0.8, 0.8, 0.72, 0.78];
  g.save();
  g.globalAlpha = EXPO[actAt(t)];
  g.translate(W * 0.5 + cam.x * 0.5, H * 0.5 + cam.y * 0.5);
  g.rotate(cam.rot * 0.6);
  g.scale(cam.z, cam.z);
  g.translate(-W * 0.5, -H * 0.5);
  g.drawImage(world, 0, 0);
  g.restore();

  // A scrim under whichever card is up, so the words own the middle.
  let scrim = 0;
  let scrimY = H * 0.46;
  for (const c of CARDS) {
    const a = cardEnv(c, t);
    if (a > scrim) {
      scrim = a;
      scrimY = c.cy;
    }
  }
  if (scrim > 0.01) {
    const sg = g.createRadialGradient(W * 0.5, scrimY, 60, W * 0.5, scrimY, H * 0.66);
    sg.addColorStop(0, `rgba(0,0,0,${0.5 * scrim})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, W, H);
  }

  inkC.setTransform(1, 0, 0, 1, 0, 0);
  inkC.globalCompositeOperation = 'source-over';
  inkC.clearRect(0, 0, W, H);
  inkC.save();
  inkC.translate(W * 0.5 + cam.x, H * 0.5 + cam.y);
  inkC.rotate(cam.rot);
  inkC.scale(cam.z, cam.z);
  inkC.translate(-W * 0.5, -H * 0.5);
  for (let s = 0; s < SUB; s++) drawInk(inkC, t + (s / SUB) * SHUTTER, 1 / SUB);
  inkC.restore();

  const ca =
    1.4 +
    (t > REL ? Math.exp(-(t - REL) * 6.5) * 14 : 0) +
    (t > CHG ? Math.exp(-(t - CHG) * 7) * 9 : 0) +
    (t > MLAST + 0.24 ? Math.exp(-(t - MLAST - 0.24) * 6) * 12 : 0);
  for (const [dx, col] of [[-ca, [90, 200, 255]], [ca, [255, 96, 70]]]) {
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

  const heat = (t > REL ? Math.exp(-(t - REL) * 3) * 0.8 : 0) + (t > MON ? 0.4 : 0) + 0.2;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(9px)';
  g.globalAlpha = 0.7;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(30px)';
  g.globalAlpha = 0.5 + heat * 0.3;
  g.drawImage(ink, 0, 0);
  g.filter = 'blur(96px)';
  g.globalAlpha = 0.24 + heat * 0.1;
  g.drawImage(ink, 0, 0);
  g.restore();

  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 1;
  g.filter = 'none';
  g.fillStyle = rgba(WASH[actAt(t)], 0.022);
  g.fillRect(0, 0, W, H);

  const bullet = smooth(seg(t, SLOW, SLOW + 1.0)) * (1 - seg(t, REL, REL + 0.6));
  if (bullet > 0.02) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(2,6,12,${0.2 * bullet})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rgba(COL.focus, 0.03 * bullet);
    g.fillRect(0, 0, W, H);
  }

  let pop = 0;
  if (t > REL) pop += Math.exp(-(t - REL) * 14) * 0.5;
  if (t > IGN) pop += Math.exp(-(t - IGN) * 14) * 0.14;
  if (t > BLK) pop += Math.exp(-(t - BLK) * 16) * 0.12;
  if (t > CHG) pop += Math.exp(-(t - CHG) * 16) * 0.18;
  for (const s of SLAMS) if (t > s) pop += Math.exp(-(t - s) * 18) * 0.1;
  for (const c of CONF) if (t > c) pop += Math.exp(-(t - c) * 20) * 0.05;
  MSHOT.forEach((mt, i) => {
    if (t > mt) pop += Math.exp(-(t - mt) * 26) * (0.24 + i * 0.03);
  });
  if (t > MLAST + 0.24) pop += Math.exp(-(t - MLAST - 0.24) * 18) * 0.3;
  if (pop > 0.005) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    g.fillStyle = `rgba(255,255,255,${Math.min(1, pop)})`;
    g.fillRect(0, 0, W, H);
  }

  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const vg = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.56, W * 0.5, H * 0.5, H * 1.16);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.66)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  const fi = Math.floor(t * FPS);
  const gr = GRAIN[fi % 3];
  const gox = (fi * 97) % 320;
  const goy = (fi * 131) % 320;
  g.save();
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.05;
  for (let yy = -goy; yy < H; yy += 320) {
    for (let xx = -gox; xx < W; xx += 320) g.drawImage(gr, xx, yy);
  }
  g.restore();

  const wp = t > MLAST + 0.6 ? seg(t, MLAST + 0.6, CUT) : 0;
  const barH = BAR * easeOut(clamp01(t / 1.6)) * (1 - wp);
  if (barH > 0.5) {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, W, barH);
    g.fillRect(0, H - barH, W, barH);
  }

  let dark = 1 - clamp01(t / 1.6);
  for (const b of [A2, A3, A4, A5, A6]) {
    const d = 1 - Math.abs(t - b) / 0.14;
    if (d > 0) dark = Math.max(dark, smooth(clamp01(d)));
  }
  if (t >= BLACKT && t < MON) dark = Math.max(dark, Math.min(1, (t - BLACKT) / 0.05));
  if (dark > 0) {
    g.fillStyle = `rgba(0,0,0,${dark})`;
    g.fillRect(0, 0, W, H);
  }

  if (wp > 0) {
    g.fillStyle = `rgba(246,250,255,${wp * wp})`;
    g.fillRect(0, 0, W, H);
  }
}

// ------------------------------------------------------------------- frame
export function frame(g, t) {
  if (t < CUT) {
    actFrame(g, t);
    return;
  }
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
  A2, A3, IGN, SLOW, REL, A4, BLK, A5, CHG, A6, BLACKT, MON, MSHOT, CUT,
  seqLOCK: CUT + seq.marks.LOCK,
  frames: Math.round(DURATION * FPS),
  DURATION,
};
