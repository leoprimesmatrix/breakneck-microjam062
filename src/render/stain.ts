import { rgba, type RGB } from '../config';
import { theme } from '../sectors';
import { view } from '../viewport';

/**
 * The floor's memory.
 *
 * Scars live about six seconds and scorch about thirty, so the arena used to
 * reset itself within a minute of the last kill — wave nine looked exactly
 * like wave one, and a screenshot could not tell you whether anything had
 * happened in this room. This canvas is where the marks go when they die:
 * every burn is stamped here once, faintly, and stays for the rest of the
 * sector.
 *
 * The whole feature costs one `drawImage` a frame. Marks are stamped at a
 * third of arena resolution — a stain is low-frequency by definition, the same
 * argument `glow.ts` makes for blurring small — and accumulate in place, so a
 * hundred waves of history costs exactly what one does.
 *
 * It lives entirely on the render side, and resets itself by watching the two
 * things it depends on: the arena size and the sector. The game never has to
 * know it exists, which is also why it cannot break anything.
 */

const SCALE = 0.35;
/** Alpha of one stamped mark. History should accumulate, not arrive. */
const STAMP = 0.16;

let canvas: HTMLCanvasElement | null = null;
let g: CanvasRenderingContext2D | null = null;
let key = '';

/** Marks already stamped, so a burn leaves exactly one print. */
let stamped = new WeakSet<object>();

function ensure() {
  const k = `${Math.round(view.arenaW)}x${Math.round(view.arenaH)}:${theme.id}`;
  if (key === k && canvas && g) return g;
  if (!canvas) {
    canvas = document.createElement('canvas');
    g = canvas.getContext('2d')!;
  }
  canvas.width = Math.max(1, Math.round(view.arenaW * SCALE));
  canvas.height = Math.max(1, Math.round(view.arenaH * SCALE));
  key = k;
  stamped = new WeakSet();
  return g!;
}

/**
 * Leave a permanent print of a mark. Idempotent per object: callers stamp the
 * live marks they are already iterating, and this remembers which ones it has
 * seen — which handles every way a mark can die, including being pushed out of
 * the cap early, without anyone tracking deaths.
 */
export function stainMark(mark: object, x: number, y: number, r: number, col: RGB) {
  const ctx = ensure();
  if (stamped.has(mark)) return;
  stamped.add(mark);

  const sx = x * SCALE;
  const sy = y * SCALE;
  const sr = Math.max(2, r * SCALE);
  // Two soft discs: a dark char with a whisper of the kill's colour inside it.
  // The dark one is what builds into a fought-in floor; the colour is what
  // keeps a corner where seeders died looking different from a lancer's lane.
  const dark = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  dark.addColorStop(0, `rgba(0,0,0,${STAMP})`);
  dark.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dark;
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);

  const tint = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 0.6);
  tint.addColorStop(0, rgba(col, STAMP * 0.4));
  tint.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = tint;
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
}

/** Blit the whole history in one call. Sits under the grid, over the plates. */
export function drawStain(ctx: CanvasRenderingContext2D) {
  ensure();
  if (!canvas) return;
  ctx.drawImage(canvas, 0, 0, view.arenaW, view.arenaH);
}
