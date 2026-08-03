/**
 * Key-art composer for the itch.io page. Dev-only: loaded by hand in the
 * browser console, never imported by the game. It draws with the game's own
 * modules — the real ship, the real enemy portraits, the real display face —
 * so the thumbnail is the game, not an impression of it. Runs once, offline,
 * which is the one place ctx.filter blur is allowed: a real Gaussian bloom
 * costs nothing when there is no next frame.
 */
import { COL, rgba } from '/src/config.ts';
import { drawRadial, flareSprite, glowSprite } from '/src/render/glow.ts';
import { drawShip } from '/src/render/ship.ts';
import { drawEnemyPortrait } from '/src/render/bodies.ts';
import { silhouette } from '/src/game/enemies.ts';
import { drawVec, vecWidth, fitVec } from '/src/render/text.ts';

export const W = 1260;
export const H = 1000;

const TAU = Math.PI * 2;

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** Deterministic PRNG so every re-render of the art is the same art. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function compose(opts = {}) {
  const main = makeCanvas();
  const hot = makeCanvas();
  const g = main.getContext('2d');
  const h = hot.getContext('2d');
  const r1 = rng(62);

  const BEAM_Y = opts.beamY ?? 692;
  const SHIP_X = opts.shipX ?? 330;
  const HIT_X = opts.hitX ?? 1080;

  // ------------------------------------------------------------------ room
  g.fillStyle = '#04060b';
  g.fillRect(0, 0, W, H);

  // Machined floor plates, barely there: enough texture that the dark reads as
  // a place, not as empty PNG.
  const PLATE = 212;
  g.strokeStyle = rgba(COL.grid, 0.16);
  g.lineWidth = 1.6;
  for (let x = 14; x < W; x += PLATE) {
    for (let y = -40; y < H; y += PLATE) {
      g.strokeRect(x + 5, y + 5, PLATE - 10, PLATE - 10);
    }
  }
  g.strokeStyle = rgba(COL.grid, 0.09);
  for (let x = 14; x < W; x += PLATE / 2) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  // A few recessed panels.
  g.fillStyle = 'rgba(0,0,0,0.32)';
  for (const [px, py, pw, ph] of [[226, 160, 200, 200], [860, 580, 190, 190], [440, 800, 210, 160]]) {
    g.fillRect(px, py, pw, ph);
  }

  // Ambience: the room is warm where they are, cold where you are.
  g.globalCompositeOperation = 'lighter';
  drawRadial(g, glowSprite(COL.mote, 0.5), W * 0.86, H * 0.12, 560, 0.34);
  drawRadial(g, glowSprite(COL.seeder, 0.4), W * 0.12, H * 0.14, 470, 0.22);
  drawRadial(g, glowSprite(COL.strike, 0.5), SHIP_X - 60, BEAM_Y, 560, 0.4);
  g.globalCompositeOperation = 'source-over';

  // Dust.
  for (let i = 0; i < 110; i++) {
    const x = r1() * W;
    const y = r1() * H;
    g.fillStyle = `rgba(190,210,235,${0.02 + r1() * 0.07})`;
    g.fillRect(x, y, 1 + r1() * 2, 1 + r1() * 2);
  }

  // --------------------------------------------------------------- hostiles
  const foe = (kind, x, y, r, rot, clock = 0.0714) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    drawEnemyPortrait(g, kind, r, clock);
    g.restore();
  };
  foe('seeder', 205, 210, 46, -0.22);
  foe('ward', 1085, 225, 44, Math.PI * 0.94);
  foe('spine', 108, 900, 46, 0);
  foe('mote', 520, 122, 21, 0.6, 2.1);
  foe('mote', 628, 94, 15, 1.9, 3.4);
  foe('lancer', 398, 106, 33, 0.32);

  // ------------------------------------------------------------------ beam
  // Wide halo on the hot layer so the bloom pass turns it into light.
  const NOSE = SHIP_X + 128;
  const beamGrad = h.createLinearGradient(0, 0, HIT_X, 0);
  beamGrad.addColorStop(0, rgba(COL.strike, 0));
  beamGrad.addColorStop(0.25, rgba(COL.strike, 0.34));
  beamGrad.addColorStop(0.9, rgba(COL.strike, 0.5));
  beamGrad.addColorStop(1, rgba(COL.strike, 0.14));
  // The hot layer stays clear of the hull: everything on it comes back as a
  // 30px blur, and a blurred beam drawn under the ship re-lights the dark
  // plates from on top — which is exactly the wireframe look being avoided.
  h.fillStyle = beamGrad;
  h.fillRect(NOSE - 20, BEAM_Y - 60, HIT_X - NOSE + 20, 120);

  // The lance leaves the NOSE. Run it under the whole hull and the white core
  // reads as a skewer through the ship rather than as something it is firing.
  const core = (ctx) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(COL.strike, 0.85);
    ctx.lineWidth = 22;
    ctx.beginPath(); ctx.moveTo(NOSE - 8, BEAM_Y); ctx.lineTo(HIT_X - 8, BEAM_Y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.96)';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(NOSE, BEAM_Y); ctx.lineTo(HIT_X - 14, BEAM_Y); ctx.stroke();
  };
  g.globalCompositeOperation = 'lighter';
  core(g);
  core(h);

  // Speed streaks around the beam.
  for (let i = 0; i < 14; i++) {
    const yy = BEAM_Y + (r1() - 0.5) * 190;
    const len = 90 + r1() * 300;
    const x0 = r1() * (HIT_X - len);
    const a = 0.05 + r1() * 0.16;
    const grad = g.createLinearGradient(x0, 0, x0 + len, 0);
    grad.addColorStop(0, rgba(COL.strike, 0));
    grad.addColorStop(0.6, rgba(COL.strike, a));
    grad.addColorStop(1, rgba(COL.strike, 0));
    g.fillStyle = grad;
    g.fillRect(x0, yy - 1.6, len, 3.2);
  }
  g.globalCompositeOperation = 'source-over';

  // ------------------------------------------------------------------ ship
  // Afterimages first: light-only spindles, not hull copies.
  g.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 4; i++) {
    const ax = SHIP_X - i * 78;
    const al = 0.34 - i * 0.07;
    drawRadial(g, flareSprite(COL.strike, 0.8), ax, BEAM_Y, 54 - i * 8, al);
  }
  // Light BEHIND the hull. The airframe's plates are authored near-black, so
  // against a black room the ship is only its lit edges — a wireframe. A cold
  // backing glow lets the dark hull cut out of the light, which is how every
  // silhouetted hero shot works.
  drawRadial(g, glowSprite(COL.strike, 0.55), SHIP_X + 12, BEAM_Y, 250, 0.6);
  drawRadial(g, glowSprite(COL.strike, 0.4), SHIP_X - 130, BEAM_Y, 190, 0.5);
  g.globalCompositeOperation = 'source-over';
  // Solid hull — stretch sheds the airframe into the lance, which is right
  // mid-strike in the game and wrong on a poster, where the hero must be a ship.
  drawShip(g, SHIP_X, BEAM_Y, 0, 92, {
    thrust: 1, stretch: 0, bank: 0, charge: 0.5, clock: 1.3,
  });
  // Only the exhaust reaches the hot layer, small and behind the tail.
  drawRadial(h, flareSprite(COL.strike, 0.9), SHIP_X - 128, BEAM_Y, 54, 0.5);

  // ---------------------------------------------------------------- impact
  // Order tells the story: flash, then the mine half-consumed by it, then its
  // own edges flying. The victim has to be visible or the explosion is just a
  // sun with no reason.
  const shards = silhouette('mote', 34);
  g.save();
  g.translate(HIT_X, BEAM_Y);
  g.globalCompositeOperation = 'lighter';
  drawRadial(g, flareSprite(COL.mote, 1), 0, 0, 112, 0.95);
  drawRadial(h, flareSprite(COL.mote, 1), HIT_X, BEAM_Y, 140, 0.9);
  g.globalCompositeOperation = 'source-over';
  g.save();
  g.translate(74, -18);
  g.rotate(2.0);
  drawEnemyPortrait(g, 'mote', 30, 2.1);
  g.restore();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = rgba(COL.mote, 0.9);
  g.lineWidth = 5;
  g.lineCap = 'round';
  for (let i = 0; i < shards.length; i++) {
    const a2 = shards[i];
    const b2 = shards[(i + 1) % shards.length];
    const mx = (a2[0] + b2[0]) * 0.5;
    const my = (a2[1] + b2[1]) * 0.5;
    const d = Math.hypot(mx, my) || 1;
    const push = 34 + r1() * 62;
    const ox = (mx / d) * push;
    const oy = (my / d) * push;
    g.beginPath();
    g.moveTo(a2[0] * 1.35 + ox, a2[1] * 1.35 + oy);
    g.lineTo(b2[0] * 1.35 + ox, b2[1] * 1.35 + oy);
    g.stroke();
  }
  // Ring.
  g.strokeStyle = rgba(COL.mote, 0.35);
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 86, 0, TAU);
  g.stroke();
  g.restore();

  // ----------------------------------------------------------------- title
  const word = 'AFTERBURN';
  const track = 0.2;
  const size = fitVec(word, opts.titleW ?? 1130, 236, track);
  const wAll = vecWidth(word, { size, tracking: track });
  const w1 = vecWidth('AFTER', { size, tracking: track });
  const cx = W * 0.5;
  const wy = opts.titleY ?? 368;
  const x0 = cx - wAll * 0.5;

  const mark = (ctx, dx, tintA, tintB, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    drawVec(ctx, 'AFTER', x0 + dx, wy, {
      size, weight: 0.112, tracking: track, baseline: 'mid',
      color: tintA, glow: 0, slant: 0.1,
    });
    drawVec(ctx, 'BURN', x0 + dx + w1 + track * size, wy, {
      size, weight: 0.112, tracking: track, baseline: 'mid',
      color: tintB, glow: 0, slant: 0.1,
    });
    ctx.restore();
  };

  // Chromatic ghosts, then the mark itself, on both layers.
  g.globalCompositeOperation = 'lighter';
  mark(g, -6, rgba(COL.strike, 0.3), rgba(COL.strike, 0.26), 1);
  mark(g, 6, rgba([255, 90, 60], 0.24), rgba([255, 90, 60], 0.28), 1);
  g.globalCompositeOperation = 'source-over';
  mark(g, 0, rgba(COL.ink, 1), rgba(COL.warn, 1), 1);
  mark(h, 0, rgba(COL.strike, 0.65), rgba(COL.warn, 0.7), 1);

  // Tagline.
  const tag = 'SPEED IS THE ONLY WEAPON';
  const tagSize = fitVec(tag, 760, 34, 0.42);
  drawVec(g, tag, cx, opts.tagY ?? 512, {
    size: tagSize, weight: 0.13, tracking: 0.42, align: 'center', baseline: 'mid',
    color: rgba(COL.focus, 0.95), glow: 0,
  });
  drawVec(h, tag, cx, opts.tagY ?? 512, {
    size: tagSize, weight: 0.13, tracking: 0.42, align: 'center', baseline: 'mid',
    color: rgba(COL.focus, 0.5), glow: 0,
  });

  // Jam plate, small and quiet at the very bottom.
  drawVec(g, 'MICRO JAM 062 · THEME: SPEED', cx, H - 30, {
    size: 19, weight: 0.12, tracking: 0.3, align: 'center', baseline: 'mid',
    color: rgba(COL.dim, 0.85), glow: 0,
  });

  // ----------------------------------------------------------------- bloom
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.filter = 'blur(9px)';
  g.globalAlpha = 0.85;
  g.drawImage(hot, 0, 0);
  g.filter = 'blur(30px)';
  g.globalAlpha = 0.55;
  g.drawImage(hot, 0, 0);
  g.restore();

  // ----------------------------------------------------- frame + treatment
  // Corner brackets, the game's own frame language.
  g.strokeStyle = rgba(COL.wall, 0.55);
  g.lineWidth = 3;
  const B = 46;
  const M = 26;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const px = sx > 0 ? M : W - M;
    const py = sy > 0 ? M : H - M;
    g.beginPath();
    g.moveTo(px, py + sy * B);
    g.lineTo(px, py);
    g.lineTo(px + sx * B, py);
    g.stroke();
  }

  // Scanlines.
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.4);

  // Grain.
  for (let i = 0; i < 1500; i++) {
    const x = r1() * W;
    const y = r1() * H;
    const a = r1() * 0.05;
    g.fillStyle = r1() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
    g.fillRect(x, y, 1, 1);
  }

  // Vignette.
  const v = g.createRadialGradient(cx, H * 0.48, H * 0.3, cx, H * 0.48, H * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);

  // Preview onto the page.
  let prev = document.getElementById('thumbprev');
  if (!prev) {
    prev = document.createElement('canvas');
    prev.id = 'thumbprev';
    prev.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:756px;z-index:99999;outline:2px solid #333;background:#000';
    document.body.appendChild(prev);
  }
  prev.width = W;
  prev.height = H;
  prev.getContext('2d').drawImage(main, 0, 0);

  window.__thumbCanvas = main;
  return 'composed';
}

/** POST a canvas to the local receiver. Typeless blob: keeps the request
 *  CORS-simple so no preflight is needed. */
export function exportPng(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      fetch('http://127.0.0.1:8787/save?f=' + name, { method: 'POST', body: new Blob([b]) })
        .then((r) => r.text())
        .then((t) => resolve(name + ': ' + t + ' bytes'));
    }, 'image/png');
  });
}
