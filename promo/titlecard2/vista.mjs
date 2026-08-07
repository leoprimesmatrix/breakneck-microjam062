/**
 * The place the title card happens in.
 *
 * `space.mjs` already knew how to draw a gas giant with rings inside its own
 * shadow, a volumetric nebula, and a starfield with colour temperature — but
 * only `trailer.mjs` ever called it. The title sequence baked its own much
 * simpler sky: two flat nebula tiles, a small galaxy sticker and a spray of
 * dots. Side by side the difference is not subtle, and the title card is the
 * asset most people will ever see, so it should be the one staged best.
 *
 * This module is the staging, not new rendering: everything here is
 * `space.mjs` primitives arranged for a *title card* rather than for a shot.
 * That constraint is the whole design, and it comes down to one rule.
 *
 *   THE CORRIDOR.  The wordmark lives in a band roughly y 330-530, and it is
 *   two-tone — cold on AFTER, hot on BURN — so it cannot be read against
 *   anything bright, warm, or busy. Every staging below is built so that band
 *   falls across the *dark* part of the composition: the night side of the
 *   planet, or open sky between the planet and the nebula. Awe belongs above
 *   and below the corridor, never in it. A vista that eats the logo is a
 *   failed title card no matter how good the planet looks.
 *
 * Bakes happen once at module load and nothing here reads a wall clock, so a
 * re-render is byte-identical — the same contract the rest of the pipeline has.
 */
import {
  bakePlanet, drawAtmosphere, bakeRings, drawRings,
  makeStars, drawStars, bakeCloud, bakeDust,
  makeNebula, drawNebula, drawDust, drawFlare,
} from './space.mjs';
import { COL, rgba, TAU, clamp01 } from './lib.mjs';

const W = 1920;
const H = 1080;
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Stagings. Kept as data so they can be compared by rendering them rather
 * than argued about — which is how the one below got chosen.
 *
 *   eclipse   the mark against the night side of a close giant, its lit
 *             crescent arcing over the top of frame. Darkest corridor of the
 *             three by construction, because the corridor *is* the planet.
 *   companion a ringed world in the upper right, star low left, open sky
 *             through the middle.
 *   rise      a star cresting the limb of a world on the left, nebula right.
 */
export const STAGES = {
  eclipse: {
    planet: { x: 0.5, y: 0.44, r: 700, seed: 21 },
    // Light from behind and above: we mostly see the unlit face, which is what
    // makes this staging legible — a huge dark disc is a perfect backing for
    // bright type, and the crescent does all the drama around the outside.
    light: [-0.30, -0.86, -0.40],
    palette: { deep: [8, 9, 18], mid: [26, 30, 54], hot: [92, 104, 150], air: [150, 196, 255] },
    // Tilt matters more here than anywhere else. `drawRings` draws the front
    // half clipped at the ring plane, and when the rings are near edge-on
    // across a planet this large that clip line lands *on the disc* as a hard
    // straight edge — it reads as a rendering seam, not as a ring. Opening the
    // tilt separates the two halves so the boundary falls in open sky.
    rings: { tilt: 0.30, rot: -0.30, span: 1.85, a: 0.4 },
    star: { x: 0.30, y: 0.10, a: 0.5 },
    nebula: { a: 0.62 },
    ambient: 0.012,
  },
  companion: {
    // Cropped into the top-right corner rather than sitting whole in it. At
    // r=330/y=0.17 the disc reached y=514 and the mark's hot end ran straight
    // into it — BURN lost its silhouette at exactly the point it is brightest.
    // The bottom of the disc now stops at y≈316, a clear band above the type.
    planet: { x: 0.87, y: 0.075, r: 235, seed: 9 },
    light: [-0.66, 0.30, 0.69],
    palette: { deep: [22, 16, 40], mid: [86, 58, 104], hot: [226, 172, 148], air: [150, 200, 255] },
    rings: { tilt: 0.24, rot: -0.42, span: 2.9, a: 0.62 },
    star: { x: 0.13, y: 0.72, a: 0.62 },
    nebula: { a: 0.58 },
    ambient: 0.035,
  },
  rise: {
    planet: { x: 0.14, y: 0.62, r: 560, seed: 33 },
    light: [0.72, -0.36, 0.59],
    palette: { deep: [12, 14, 30], mid: [58, 62, 96], hot: [206, 178, 190], air: [140, 190, 255] },
    rings: { tilt: 0.34, rot: 0.36, span: 1.9, a: 0.32 },
    star: { x: 0.42, y: 0.30, a: 0.85 },
    nebula: { a: 0.66 },
    ambient: 0.02,
  },
};

/**
 * Default staging, chosen by rendering all three and looking at them.
 *
 * `companion` wins for the cards that are only type: it is the one that reads
 * unmistakably as *space* — a world small enough to be an object in a big room
 * rather than a wall behind the camera — and it has depth to spare, which the
 * other two spend on drama. `eclipse` and `rise` are kept and used, one per
 * ship variant, so the promo set does not open five files onto one sky.
 */
export const DEFAULT_STAGE = 'companion';

// ------------------------------------------------------------------ the bakes
const PLANETS = {};
const RINGS = bakeRings({ size: 1500, inner: 0.56, outer: 1.0, seed: 3, col: [214, 206, 196] });

function planetFor(key) {
  if (PLANETS[key]) return PLANETS[key];
  const S = STAGES[key];
  PLANETS[key] = bakePlanet({
    size: 900,
    seed: S.planet.seed,
    light: S.light,
    deep: S.palette.deep,
    mid: S.palette.mid,
    hot: S.palette.hot,
    air: S.palette.air,
    bands: 3.2,
    turb: 0.9,
    ambient: S.ambient,
  });
  return PLANETS[key];
}

/**
 * Two nebula ramps, cold and warm — the game's own two-sided palette, so the
 * sky belongs to the same world as the mark rather than to a stock space kit.
 */
// Three stops, deep -> body -> rim. `bakeCloud` mixes through them and carries
// its own alpha off the noise, so these are colours only.
const COLD_RAMP = [[18, 30, 62], [52, 86, 146], [156, 206, 255]];
const WARM_RAMP = [[46, 20, 16], [128, 58, 34], [255, 196, 138]];
const CLOUDS = [
  bakeCloud(11, COLD_RAMP, 512), bakeCloud(23, COLD_RAMP, 512),
  bakeCloud(37, WARM_RAMP, 512), bakeCloud(51, WARM_RAMP, 512),
];
const LANES = [bakeDust(5, 512), bakeDust(17, 512)];

const PUFFS = makeNebula(30, 0x51f7, { box: { x: 7600, y: 4000, z: 5000 }, rMin: 1000, rMax: 2900, tiles: 4 });
const DUSTP = makeNebula(9, 0x2c19, { box: { x: 6200, y: 3400, z: 4200 }, rMin: 900, rMax: 2100, tiles: 2 });
const STARS = makeStars(760, 0x9e31, { x: 5600, y: 3400, z: 4400 });

/**
 * Screen-space camera to the 3D one the space primitives project through.
 *
 * The multiplier is deliberately small. The sequence's own camera sway is a
 * few pixels, and a starfield that swings further than the foreground reads as
 * the sky being closer than the debris — which is exactly backwards.
 */
function cam3(t, cam) {
  return { x: cam.x * 26, y: cam.y * 26, z: t * 26, t, f: 900 };
}

/**
 * Draw the room. Called first thing in the sequence's background pass, so
 * everything it paints sits behind the wreckage, the mark and the deck.
 *
 * `flare` is the sequence's impact energy: the room brightens when the mark
 * detonates and when it locks, which is what ties the sky to the event instead
 * of leaving it playing behind one.
 */
export function drawVista(g, t, cam, opts = {}) {
  const key = opts.stage || DEFAULT_STAGE;
  const S = STAGES[key];
  const flare = opts.flare || 0;
  const c3 = cam3(t, cam);

  // A sky that is not quite black. Pure #000 behind a nebula makes the nebula
  // look like a decal; a few counts of colour give it something to sit in.
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, 'rgb(7,9,18)');
  sky.addColorStop(0.52, 'rgb(10,10,16)');
  sky.addColorStop(1, 'rgb(4,4,8)');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  drawNebula(g, PUFFS, CLOUDS, c3, W, H, S.nebula.a * (0.85 + flare * 0.5));
  drawStars(g, STARS, c3, W, H, 0.9 + flare * 0.35);
  // After the stars, so the lanes take the stars out with them — a dust lane
  // that only dims the gas is a grey smear, not something in front of it.
  drawDust(g, DUSTP, LANES, c3, W, H, 0.5);

  // ------------------------------------------------------------- the planet
  const px = W * S.planet.x + cam.x * 0.5;
  const py = H * S.planet.y + cam.y * 0.5;
  const pr = S.planet.r * (1 + 0.006 * Math.sin(t * 0.19));
  const tex = planetFor(key);

  drawRings(g, RINGS, px, py, pr, {
    tilt: S.rings.tilt, rot: S.rings.rot, span: S.rings.span,
    half: 'back', a: S.rings.a, light: S.light, W, H,
  });

  // The disc is drawn plainly — `source-over`, not `lighter`. A planet is an
  // object that *occludes*; additive would let the starfield shine through it
  // and it would stop being solid.
  g.save();
  g.globalAlpha = 1;
  g.drawImage(tex, px - pr, py - pr, pr * 2, pr * 2);
  g.restore();

  drawAtmosphere(g, px, py, pr, S.light, S.palette.air, 0.95 + flare * 0.4);

  drawRings(g, RINGS, px, py, pr, {
    tilt: S.rings.tilt, rot: S.rings.rot, span: S.rings.span,
    half: 'front', a: S.rings.a, light: S.light, W, H, shadow: true,
  });

  // --------------------------------------------------------------- the star
  const sx = W * S.star.x + cam.x * 0.8;
  const sy = H * S.star.y + cam.y * 0.8;
  drawFlare(g, sx, sy, W, H, {
    i: S.star.a * (0.8 + flare * 0.5),
    core: [255, 244, 224], streak: [150, 196, 255], ghost: [255, 186, 120],
    rays: 0.5, t, size: 0.85, ghosts: 1,
  });

  // -------------------------------------------------------- the corridor
  // The last word on legibility. Even a well-staged vista drifts, and the mark
  // is the one thing in frame that is not allowed to get harder to read — so
  // the band it lives in is pulled down a little, in a falloff wide enough
  // that nobody can see where it starts. Cheap insurance, invisible when the
  // staging was already right.
  const cg = g.createLinearGradient(0, 190, 0, 680);
  cg.addColorStop(0, 'rgba(0,0,0,0)');
  cg.addColorStop(0.45, 'rgba(3,4,9,0.34)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = cg;
  g.fillRect(0, 190, W, 490);
}

/** Mean luma and the corridor's own luma, for checking staging by number. */
export function probe(g) {
  const all = g.getImageData(0, 0, W, H).data;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  let s = 0, n = 0, cs = 0, cn = 0;
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * 4;
      const L = lum(all, i);
      s += L; n++;
      if (y >= 330 && y <= 530) { cs += L; cn++; }
    }
  }
  return { mean: +(s / n).toFixed(1), corridor: +(cs / Math.max(1, cn)).toFixed(1) };
}
