/**
 * A space that is actually a place.
 *
 * The first cut of the trailer used a black canvas with a few blurred blobs on
 * it, and that reads as "dark background", not as space. What sells space in a
 * trailer is the same handful of things every time:
 *
 *   - **Scale.** Something enormous and near — a planet whose limb runs off the
 *     side of frame — with something tiny in front of it for comparison.
 *   - **A light source.** One hard star, off-frame or on it, that rakes every
 *     surface, throws a terminator, lights a rim, and blows the lens out.
 *   - **Depth.** Volume you move *through*, not a backdrop you look *at*: the
 *     nebula and the stars are 3D and project, so the camera parallaxes them.
 *   - **Occlusion.** Real nebulae are mostly dust lanes eating light. Carving
 *     holes in the glow is what stops it looking like airbrush.
 *
 * Everything here is baked once from a seeded RNG and then drawn as sprites, so
 * the render stays deterministic and a frame stays cheap. No wall clock.
 */
import { COL, rgba, TAU, clamp01 } from './lib.mjs';

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (e0, e1, x) => smooth(clamp01((x - e0) / (e1 - e0)));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// --------------------------------------------------------------------- noise
/** 2D gradient noise. Output is roughly [-0.7, 0.7]. */
function makeNoise(seed) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = new Float32Array(512);
  for (let i = 0; i < 256; i++) {
    const a = r() * TAU;
    G[i * 2] = Math.cos(a);
    G[i * 2 + 1] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const X = fx & 255;
    const Y = fy & 255;
    const xf = x - fx;
    const yf = y - fy;
    const u = fade(xf);
    const v = fade(yf);
    const dot = (ix, iy, dx, dy) => {
      const g = (perm[(perm[ix & 255] + (iy & 255)) & 255] & 255) * 2;
      return G[g] * dx + G[g + 1] * dy;
    };
    const n00 = dot(X, Y, xf, yf);
    const n10 = dot(X + 1, Y, xf - 1, yf);
    const n01 = dot(X, Y + 1, xf, yf - 1);
    const n11 = dot(X + 1, Y + 1, xf - 1, yf - 1);
    const a = n00 + u * (n10 - n00);
    const b = n01 + u * (n11 - n01);
    return a + v * (b - a);
  };
}

function fbm(n, x, y, oct = 5, gain = 0.5, lac = 2.03) {
  let amp = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * n(x * f, y * f);
    f *= lac;
    amp *= gain;
  }
  return s;
}

/** Ridged fbm — the filaments that make a gas cloud look like a gas cloud. */
function ridge(n, x, y, oct = 5) {
  let amp = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(n(x * f, y * f) * 2.2);
    s += amp * v * v;
    f *= 2.07;
    amp *= 0.52;
  }
  return s;
}

// -------------------------------------------------------------------- planet
/**
 * A per-pixel shaded sphere: banded surface, wrapped terminator, limb
 * darkening, a Fresnel rim of atmosphere on the lit edge. Baked once — a
 * planet does not visibly turn in twenty seconds, so nothing here animates.
 *
 * `light` is a unit vector in view space; +x right, +y down, +z toward camera.
 */
export function bakePlanet(opts = {}) {
  const {
    size = 900,
    seed = 7,
    light = [-0.62, -0.42, 0.66],
    deep = [26, 18, 44],
    mid = [96, 62, 112],
    hot = [228, 176, 150],
    air = [150, 190, 255],
    bands = 3.0,
    turb = 0.85,
    ambient = 0.035,
    rough = 0,
  } = opts;

  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const D = img.data;
  const R = size / 2;
  const n = makeNoise(seed);
  const [Lx, Ly, Lz] = light;

  for (let py = 0; py < size; py++) {
    const ny = (py + 0.5 - R) / R;
    for (let px = 0; px < size; px++) {
      const nx = (px + 0.5 - R) / R;
      const d2 = nx * nx + ny * ny;
      const i = (py * size + px) * 4;
      if (d2 >= 1) {
        D[i + 3] = 0;
        continue;
      }
      const d = Math.sqrt(d2);
      const nz = Math.sqrt(1 - d2);

      // Surface: latitude bands warped by turbulence, plus fine mottling.
      const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
      const lon = Math.atan2(nx, nz);
      // Bands warped by turbulence, then curled by a second warp so the
      // shear between belts breaks into eddies instead of staying combed.
      const w1 = turb * fbm(n, lon * 1.25 + 4, lat * 2.4, 4);
      const w2 = turb * 0.5 * fbm(n, lon * 3.6 - 9, lat * 3.0 + 2, 3);
      let v = 0.5 + 0.5 * Math.sin(lat * bands * 3.1 + w1 * 3.4 + w2 * 1.9);
      v = clamp01(v * 0.74 + 0.26 * (0.5 + fbm(n, lon * 4.2, lat * 6.4 + 11, 5)));
      // Fine mottling, tightened toward the limb where the view foreshortens.
      v = clamp01(v + 0.09 * fbm(n, lon * 13 + 40, lat * 15, 3) * (0.5 + 0.5 * nz));
      if (rough > 0) {
        v = clamp01(v + rough * fbm(n, lon * 7 + 30, lat * 9, 3));
      }
      const base = v < 0.5 ? mix(deep, mid, v * 2) : mix(mid, hot, (v - 0.5) * 2);

      // Light: wrapped lambert so the terminator is a soft band, not a knife.
      const lam = nx * Lx + ny * Ly + nz * Lz;
      const li = smoothstep(-0.22, 0.62, lam);
      // Limb darkening, and a touch of forward scatter near the terminator.
      const limb = 0.55 + 0.45 * Math.pow(nz, 0.55);
      const scat = Math.exp(-Math.abs(lam) * 5.5) * 0.16 * clamp01(lam + 0.4);
      const k = ambient + li * limb + scat;

      // Fresnel: atmosphere piles up at the limb, and only where it is lit.
      const fres = Math.pow(1 - nz, 4.5);
      const rim = fres * clamp01(lam * 1.5 + 0.12) * 1.35;

      D[i] = Math.min(255, base[0] * k + air[0] * rim);
      D[i + 1] = Math.min(255, base[1] * k + air[1] * rim);
      D[i + 2] = Math.min(255, base[2] * k + air[2] * rim);
      D[i + 3] = 255 * clamp01((1 - d) * R * 0.9);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The air above the disc: a crescent of scattered light hugging the lit limb,
 * plus the wide halo it bleeds into. Drawn additively over the baked sphere.
 */
export function drawAtmosphere(ctx, cx, cy, r, light, col = [150, 200, 255], a = 1) {
  const lx = light[0];
  const ly = light[1];
  const len = Math.hypot(lx, ly) || 1;
  const ux = lx / len;
  const uy = ly / len;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // The halo: thin. Air is a scatter, not a shell — if you can see where it
  // ends, it has already stopped looking like a planet.
  const hg = ctx.createRadialGradient(cx, cy, r * 0.985, cx, cy, r * 1.1);
  hg.addColorStop(0, rgba(col, 0.16 * a));
  hg.addColorStop(0.3, rgba(col, 0.055 * a));
  hg.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.1, 0, TAU);
  ctx.fill();

  // The lit crescent, tapering to nothing at both ends.
  const base = Math.atan2(uy, ux);
  ctx.lineCap = 'round';
  for (const [span, wid, al] of [
    [1.15, 0.011, 0.3], [0.82, 0.006, 0.34], [0.5, 0.0032, 0.4],
  ]) {
    ctx.strokeStyle = rgba(col, al * a);
    ctx.lineWidth = Math.max(0.7, r * wid);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.998, base - span, base + span);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A ring system. Called twice per planet — `back` behind the disc, `front` in
 * front of it — so the planet sits inside its own rings, and the front pass
 * carries the shadow the planet throws across them.
 */
/**
 * Rings are baked flat and face-on at high resolution, then drawn squashed.
 * Stroking hundreds of thin ellipses live aliases into a scribble; letting the
 * GPU minify a big texture does not.
 */
export function bakeRings(opts = {}) {
  const {
    size = 1600, inner = 0.54, outer = 1.0, seed = 3, col = [226, 210, 190],
  } = opts;
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const R = size / 2;
  const r = rng(seed);
  const n = makeNoise(seed * 13 + 5);
  g.globalCompositeOperation = 'lighter';
  const N = 420;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const rad = R * lerp(inner, outer, u);
    // Density: broad Cassini-ish gaps carved out of fine banding.
    const fine = 0.5 + 0.5 * n(u * 46, 3.1);
    const broad = smoothstep(0.02, 0.14, Math.abs(Math.sin(u * 6.1 + 0.7)));
    const edge = smoothstep(0, 0.05, u) * (1 - smoothstep(0.86, 1, u));
    const dens = fine * broad * edge;
    if (dens < 0.03) continue;
    g.strokeStyle = rgba(mix(col, [255, 246, 228], r() * 0.6), 0.15 * dens);
    g.lineWidth = (R * (outer - inner)) / N * 2.3;
    g.beginPath();
    g.arc(R, R, rad, 0, TAU);
    g.stroke();
  }
  return c;
}

/**
 * Called twice per planet — `back` behind the disc, `front` in front of it —
 * so the planet sits inside its own rings. The front pass also carries the
 * shadow the planet throws across them.
 */
let ringLayer = null;

export function drawRings(ctx, tex, cx, cy, r, opts = {}) {
  const {
    tilt = 0.2, rot = -0.34, span = 2.4, half = 'front', a = 1,
    light = [-0.62, -0.42, 0.66], W = 1920, H = 1080, shadow = true,
  } = opts;
  const s = r * span;
  const wants = shadow && half === 'front';

  // The shadow is a destination-out wedge, so the pass that carries it has to
  // own its pixels — punching it straight into the frame would take the sky
  // out with it.
  let g = ctx;
  if (wants) {
    if (!ringLayer || ringLayer.width !== W || ringLayer.height !== H) {
      ringLayer = canvasOf(W, H);
    }
    g = ringLayer.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, H);
  }

  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(1, tilt);
  g.beginPath();
  if (half === 'back') g.rect(-s * 1.2, -s * 1.2, s * 2.4, s * 1.2);
  else g.rect(-s * 1.2, 0, s * 2.4, s * 1.2);
  g.clip();
  g.globalCompositeOperation = wants ? 'source-over' : 'lighter';
  g.globalAlpha = wants ? 1 : a;
  g.imageSmoothingEnabled = true;
  g.drawImage(tex, -s, -s, s * 2, s * 2);
  if (wants) {
    // The planet's shadow, thrown down-ring away from the light.
    g.globalCompositeOperation = 'destination-out';
    const sa = Math.atan2(-light[1] / Math.max(0.05, tilt), -light[0]) - rot;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, s * 1.3, sa - 0.24, sa + 0.24);
    g.closePath();
    g.fillStyle = 'rgba(0,0,0,0.82)';
    g.fill();
  }
  g.restore();

  if (wants) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(ringLayer, 0, 0);
    ctx.restore();
  }
}

// --------------------------------------------------------------------- stars
/**
 * A 3D starfield the camera flies through. Stars carry a colour temperature
 * and a magnitude, and the bright ones get a diffraction cross — that mix of
 * sizes and hues is most of what separates a sky from a spray of white dots.
 */
export function makeStars(n, seed, box = { x: 5200, y: 3200, z: 4200 }) {
  const r = rng(seed);
  const arr = [];
  for (let i = 0; i < n; i++) {
    // Magnitude: many faint, few brilliant.
    const m = Math.pow(r(), 2.6);
    const temp = r();
    const col =
      temp < 0.16 ? [172, 200, 255] :
      temp < 0.4 ? [214, 230, 255] :
      temp < 0.72 ? [255, 250, 238] :
      temp < 0.9 ? [255, 226, 178] : [255, 186, 150];
    arr.push({
      x: (r() - 0.5) * box.x,
      y: (r() - 0.5) * box.y,
      z: 240 + r() * box.z,
      m,
      col,
      tw: 0.4 + r() * 2.4,
      ph: r() * TAU,
      zSpan: box.z,
    });
  }
  return arr;
}

export function drawStars(ctx, stars, cam, W, H, a = 1) {
  const f = cam.f ?? 900;
  const cx = W * 0.5;
  const cy = H * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of stars) {
    let z = s.z - cam.z;
    // Wrap forward so the field never runs out.
    z = ((z % s.zSpan) + s.zSpan) % s.zSpan + 240;
    const k = f / z;
    const sx = cx + (s.x - cam.x) * k;
    const sy = cy + (s.y - cam.y) * k;
    if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
    const tw = 0.74 + 0.26 * Math.sin(cam.t * s.tw + s.ph);
    const br = s.m * k * 620 * tw * a;
    if (br < 0.012) continue;
    const rad = 0.55 + s.m * 2.4 * Math.min(1.6, k * 340);
    ctx.globalAlpha = Math.min(1, br);
    ctx.fillStyle = rgba(s.col, 1);
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, TAU);
    ctx.fill();
    // Only the genuinely bright ones bloom, and only a few of those spike —
    // a sky where every star wears a cross reads as a filter, not as a sky.
    if (s.m > 0.66) {
      const g = Math.min(1, br) * (s.m - 0.66) * 2.6;
      const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 6);
      hg.addColorStop(0, rgba(s.col, g * 0.34));
      hg.addColorStop(1, rgba(s.col, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = hg;
      ctx.fillRect(sx - rad * 6, sy - rad * 6, rad * 12, rad * 12);
      if (s.m > 0.87) {
        const L = rad * (7 + s.m * 5);
        ctx.globalAlpha = g * 0.3;
        ctx.strokeStyle = rgba(s.col, 1);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(sx - L, sy);
        ctx.lineTo(sx + L, sy);
        ctx.moveTo(sx, sy - L * 0.72);
        ctx.lineTo(sx, sy + L * 0.72);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// -------------------------------------------------------------------- nebula
/**
 * Cloud tiles. Each is ridged fbm shaded through its own colour ramp, so a
 * single puff already carries hue variation across it, and a field of them
 * reads as gas rather than as airbrush.
 */
export function bakeCloud(seed, ramp, size = 512, opts = {}) {
  const { scale = 2.4, contrast = 1.5, bias = 0.06 } = opts;
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const D = img.data;
  const n = makeNoise(seed);
  const R = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px / size) * scale;
      const v = (py / size) * scale;
      let d = ridge(n, u, v, 5) - bias;
      d = clamp01(d * contrast);
      // Feather to nothing at the tile edge so instances never show a seam.
      const dx = (px + 0.5 - R) / R;
      const dy = (py + 0.5 - R) / R;
      const fall = clamp01(1.22 - Math.hypot(dx, dy) * 1.22);
      const A = d * d * smooth(fall);
      const i = (py * size + px) * 4;
      if (A < 0.004) {
        D[i + 3] = 0;
        continue;
      }
      const t = clamp01(d * 1.25);
      const col = t < 0.5 ? mix(ramp[0], ramp[1], t * 2) : mix(ramp[1], ramp[2], (t - 0.5) * 2);
      D[i] = col[0];
      D[i + 1] = col[1];
      D[i + 2] = col[2];
      D[i + 3] = 255 * A;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Opaque dust: same shape language, used to eat light rather than add it. */
export function bakeDust(seed, size = 512) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const D = img.data;
  const n = makeNoise(seed);
  const R = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px / size) * 2.1;
      const v = (py / size) * 2.1;
      let d = Math.abs(fbm(n, u, v, 5)) * 2.6;
      d = clamp01(1 - d);
      const dx = (px + 0.5 - R) / R;
      const dy = (py + 0.5 - R) / R;
      const fall = clamp01(1.15 - Math.hypot(dx, dy) * 1.15);
      const i = (py * size + px) * 4;
      D[i] = D[i + 1] = D[i + 2] = 0;
      D[i + 3] = 255 * clamp01(d * d * smooth(fall));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Place puffs in a 3D volume so the camera parallaxes through them. */
export function makeNebula(n, seed, opts = {}) {
  const {
    box = { x: 7000, y: 4200, z: 5200 }, zMin = 700, rMin = 900, rMax = 2600, tiles = 4,
  } = opts;
  const r = rng(seed);
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      x: (r() - 0.5) * box.x,
      y: (r() - 0.5) * box.y,
      z: zMin + r() * box.z,
      r: rMin + r() * (rMax - rMin),
      rot: r() * TAU,
      spin: (r() - 0.5) * 0.012,
      a: 0.22 + r() * 0.5,
      tile: (r() * tiles) | 0,
      ph: r() * TAU,
    });
  }
  // Far first: additive does not need a sort, but the dust pass does.
  arr.sort((p, q) => q.z - p.z);
  return arr;
}

export function drawNebula(ctx, puffs, tilesArr, cam, W, H, a = 1) {
  const f = cam.f ?? 900;
  const cx = W * 0.5;
  const cy = H * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of puffs) {
    const z = p.z - cam.z;
    if (z < 180) continue;
    const k = f / z;
    const sx = cx + (p.x - cam.x) * k;
    const sy = cy + (p.y - cam.y) * k;
    const s = p.r * k;
    if (s < 12 || sx < -s * 1.4 || sx > W + s * 1.4 || sy < -s * 1.4 || sy > H + s * 1.4) continue;
    // Far puffs dim: aerial perspective, and it keeps the frame from flattening.
    const dep = clamp01(1.25 - z / 4200);
    ctx.globalAlpha = p.a * a * (0.35 + 0.65 * dep) * (0.86 + 0.14 * Math.sin(cam.t * 0.22 + p.ph));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(p.rot + cam.t * p.spin);
    ctx.drawImage(tilesArr[p.tile], -s, -s, s * 2, s * 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Dust lanes: destination-out, so they occlude the stars behind them too. */
export function drawDust(ctx, lanes, tilesArr, cam, W, H, a = 1) {
  const f = cam.f ?? 900;
  const cx = W * 0.5;
  const cy = H * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const p of lanes) {
    const z = p.z - cam.z;
    if (z < 180) continue;
    const k = f / z;
    const sx = cx + (p.x - cam.x) * k;
    const sy = cy + (p.y - cam.y) * k;
    const s = p.r * k;
    if (s < 20 || sx < -s * 1.4 || sx > W + s * 1.4 || sy < -s * 1.4 || sy > H + s * 1.4) continue;
    ctx.globalAlpha = p.a * a;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(p.rot + cam.t * p.spin);
    ctx.drawImage(tilesArr[p.tile], -s, -s, s * 2, s * 2);
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------- star
/**
 * The lens, not the light. A hard source plus everything a real anamorphic
 * lens does with it: a horizontal streak, a starburst, chromatic ghosts strung
 * along the line through the optical centre, and a halo out near unity.
 */
export function drawFlare(ctx, x, y, W, H, opts = {}) {
  const {
    i = 1, core = [255, 248, 232], streak = [140, 190, 255], ghost = [255, 190, 120],
    rays = 0, t = 0, size = 1, ghosts = 1, part = 'all',
  } = opts;
  if (i <= 0.001) return;
  const cx = W * 0.5;
  const cy = H * 0.5;
  // `part` exists so a star can rise from behind something: draw 'source'
  // before the occluder and 'ghosts' after, and the limb eats the light.
  const doSource = part !== 'ghosts';
  const doGhosts = part !== 'source' && ghosts > 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // God rays. Few, short, and faint — they are meant to be noticed second.
  if (rays > 0 && doSource) {
    ctx.save();
    ctx.translate(x, y);
    for (let k = 0; k < 22; k++) {
      const h = Math.sin(k * 12.9898) * 43758.5453;
      const j = h - Math.floor(h);
      const a = (k / 22) * TAU + j * 0.16 + t * 0.012;
      const len = (0.35 + 0.65 * j) * H * 0.85 * size;
      const wid = 0.004 + 0.012 * j;
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, rgba(core, 0.05 * i * rays));
      g.addColorStop(0.2, rgba(core, 0.018 * i * rays));
      g.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -len * wid);
      ctx.lineTo(len, len * wid);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // The source: a small hot centre, a tight bloom, and a wide faint one.
  if (doSource) {
    for (const [r, col, al] of [
      [230 * size, core, 0.1 * i],
      [64 * size, core, 0.3 * i],
      [15 * size, [255, 255, 255], 0.95 * i],
    ]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, al));
      g.addColorStop(0.3, rgba(col, al * 0.24));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Anamorphic streak: long, extremely thin, blue.
    for (const [w, h, col, al] of [
      [760 * size, 9 * size, streak, 0.11 * i],
      [430 * size, 2.4 * size, [215, 238, 255], 0.24 * i],
    ]) {
      const g = ctx.createLinearGradient(x - w, y, x + w, y);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.5, rgba(col, al));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - w, y - h, w * 2, h * 2);
    }
  }

  // Ghosts along the optical axis. Faint enough to read as glass, not as UI.
  if (doGhosts) {
    const dx = cx - x;
    const dy = cy - y;
    for (const [u, r, col, al] of [
      [-0.3, 26, ghost, 0.03], [0.24, 44, [255, 150, 90], 0.025],
      [0.55, 20, [120, 255, 200], 0.03], [0.86, 68, ghost, 0.02],
      [1.2, 36, [140, 190, 255], 0.028],
    ]) {
      const gx = x + dx * (1 + u);
      const gy = y + dy * (1 + u);
      const rr2 = r * size;
      const g = ctx.createRadialGradient(gx, gy, rr2 * 0.5, gx, gy, rr2);
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.8, rgba(col, al * i * ghosts));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, rr2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------- wrecks
/**
 * Dead hulls, as near-black silhouettes with one lit edge. Against a planet or
 * a nebula this is the cheapest expensive-looking thing in the toolbox: the
 * shape reads, the scale reads, and the eye fills in detail that is not there.
 */
function hulkShape(seed) {
  const r = rng(seed);
  const kind = r();
  const pts = [];
  if (kind < 0.4) {
    // A spine with the ribs still on it.
    const L = 1;
    const segs = 5 + ((r() * 4) | 0);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      pts.push([-L + u * 2 * L, -0.06 - 0.16 * Math.sin(u * Math.PI) * (0.5 + r())]);
    }
    for (let i = segs; i >= 0; i--) {
      const u = i / segs;
      pts.push([-L + u * 2 * L, 0.06 + 0.2 * Math.sin(u * Math.PI) * (0.4 + r() * 1.1)]);
    }
  } else if (kind < 0.75) {
    // A torn plate: convex-ish, with a bite out of one side.
    const n = 9 + ((r() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const bite = i > n * 0.45 && i < n * 0.7 ? 0.35 : 1;
      const rad = (0.55 + r() * 0.45) * bite;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.62]);
    }
  } else {
    // A blunt fragment.
    const n = 6 + ((r() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r() * 0.3;
      const rad = 0.4 + r() * 0.6;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.8]);
    }
  }
  return pts;
}

const HULKS = Array.from({ length: 10 }, (_, i) => hulkShape(400 + i * 37));

export function drawHulk(ctx, idx, x, y, s, rot, light, a = 1, rim = [214, 226, 255]) {
  const pts = HULKS[idx % HULKS.length];
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  // The light direction expressed in the hull's own frame, so the rim stays
  // on the lit side however the piece is tumbling.
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const lx = c * light[0] + sn * light[1];
  const ly = -sn * light[0] + c * light[1];
  const len = Math.hypot(lx, ly) || 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  path();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(3,4,8,0.98)';
  ctx.fill();
  // Clip to the hull, then stroke the outline nudged toward the light: only
  // the lit edge survives the clip, which is what a rim light is.
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate((lx / len) * 0.05, (ly / len) * 0.05);
  path();
  ctx.globalAlpha = a * 0.55;
  ctx.strokeStyle = rgba(rim, 1);
  // The context is scaled by s, so a line width here is in hull units. Pick
  // the width on screen and divide back, or a big piece grows a grey shell.
  ctx.lineWidth = Math.min(3.2, Math.max(0.9, s * 0.045)) / s;
  ctx.stroke();
  ctx.restore();
}

/** A field of them, in 3D, so the camera moves through the graveyard. */
export function makeWrecks(n, seed, opts = {}) {
  const { box = { x: 6000, y: 3000, z: 4600 }, zMin = 420, sMin = 40, sMax = 420 } = opts;
  const r = rng(seed);
  const arr = Array.from({ length: n }, (_, i) => ({
    x: (r() - 0.5) * box.x,
    y: (r() - 0.5) * box.y,
    z: zMin + r() * box.z,
    s: sMin + Math.pow(r(), 1.7) * (sMax - sMin),
    rot: r() * TAU,
    spin: (r() - 0.5) * 0.05,
    idx: i % 10,
  }));
  arr.sort((p, q) => q.z - p.z);
  return arr;
}

export function drawWrecks(ctx, wrecks, cam, W, H, light, a = 1) {
  const f = cam.f ?? 900;
  const cx = W * 0.5;
  const cy = H * 0.5;
  for (const w of wrecks) {
    const z = w.z - cam.z;
    if (z < 140) continue;
    const k = f / z;
    const sx = cx + (w.x - cam.x) * k;
    const sy = cy + (w.y - cam.y) * k;
    const s = w.s * k;
    if (s < 2 || sx < -s * 2 || sx > W + s * 2 || sy < -s * 2 || sy > H + s * 2) continue;
    drawHulk(ctx, w.idx, sx, sy, s, w.rot + cam.t * w.spin, light, a * clamp01(1.3 - z / 4200));
  }
}

// --------------------------------------------------------------------- misc
/** Drifting motes close to the lens — cheap, and it sells "we are inside it". */
export function makeMotes(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    x: (r() - 0.5) * 2600,
    y: (r() - 0.5) * 1600,
    z: 200 + r() * 700,
    r: 1 + r() * 5,
    a: 0.05 + r() * 0.35,
    ph: r() * TAU,
    sp: 0.2 + r() * 0.9,
  }));
}

export function drawMotes(ctx, motes, cam, W, H, a = 1, col = [190, 214, 255]) {
  const f = cam.f ?? 900;
  const cx = W * 0.5;
  const cy = H * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    let z = m.z - cam.z * 1.5;
    z = ((z % 900) + 900) % 900 + 200;
    const k = f / z;
    const sx = cx + (m.x - cam.x * 1.4 + Math.sin(cam.t * m.sp + m.ph) * 40) * k;
    const sy = cy + (m.y - cam.y * 1.4 + Math.cos(cam.t * m.sp * 0.8 + m.ph) * 30) * k;
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
    const s = m.r * k * 14;
    ctx.globalAlpha = m.a * a * clamp01(1 - z / 900) * 0.7;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, s);
    g.addColorStop(0, rgba(col, 1));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
  }
  ctx.restore();
}

export { makeNoise, fbm, ridge, rng as spaceRng, canvasOf, mix as mixCol };
