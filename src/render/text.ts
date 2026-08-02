import { CAN_BLUR, glowLayer } from './glow';
import { glyphFor } from './glyphs';
import { quality } from './quality';

/**
 * Two typographic systems, used for different jobs.
 *
 *  - `drawVec` renders the bespoke display face from `glyphs.ts`. Everything
 *    structural — the wordmark, wave cards, score, headings — is set in it, so
 *    the game has one voice that belongs to it alone.
 *  - `drawUI` renders small running text in a neutral grotesque, tracked out by
 *    hand. Below about 15px the vector face's chamfers stop resolving, and a
 *    real hinted system font is simply more legible.
 *
 * The pairing is the usual display/text split, and it is what keeps the
 * interface from looking like one novelty face applied to everything.
 */

export type Align = 'left' | 'center' | 'right';
export type VBase = 'cap' | 'base' | 'mid';

export interface VecStyle {
  /** Cap height in pixels. */
  size: number;
  /** Extra advance between glyphs, in em. */
  tracking?: number;
  /** Stroke width in em. */
  weight?: number;
  align?: Align;
  baseline?: VBase;
  /** Horizontal shear at the cap line, in em. Positive leans forward. */
  slant?: number;
  color?: string;
  /** Additive halo passes. 0 = none. */
  glow?: number;
  glowColor?: string;
  /** 0..1 pen draw-on across the whole string. */
  progress?: number;
  alpha?: number;
}

const DEFAULT_TRACK = 0.09;
const DEFAULT_WEIGHT = 0.115;

/**
 * How far glyph ink can stray outside the box implied by the cap height and the
 * advance width, in em. `Q` and `,` hang below the baseline, and several glyphs
 * are drawn wider than they advance so that tracked text sets tightly. The halo
 * buffer is sized from these: get them wrong and a comma's tail loses its glow.
 */
const INK_DESCENT = 0.12;
const INK_OVERHANG = 0.13;

/**
 * Whether the primary input is a finger. Used only to choose wording — "TAP"
 * versus "CLICK" — but getting that wrong is the fastest way to make a game
 * feel like it was never tested on the device you are holding.
 */
export const IS_TOUCH = (() => {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
})();

export function vecWidth(text: string, style: Pick<VecStyle, 'size' | 'tracking'>) {
  const track = style.tracking ?? DEFAULT_TRACK;
  let w = 0;
  for (const ch of text) w += glyphFor(ch).a + track;
  return (w - track) * style.size;
}

/** Total pen length of a string, in pixels — the budget a draw-on spends. */
function penLength(text: string, size: number) {
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

/**
 * Draw a run of the display face. Returns the advance width so callers can
 * chain lockups without measuring twice.
 */
export function drawVec(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: VecStyle,
): number {
  const size = style.size;
  const track = style.tracking ?? DEFAULT_TRACK;
  const weight = (style.weight ?? DEFAULT_WEIGHT) * size;
  const slant = style.slant ?? 0;
  const width = vecWidth(text, style);
  const progress = style.progress ?? 1;
  if (progress <= 0 || size <= 0) return width;

  let px = x;
  if (style.align === 'center') px -= width * 0.5;
  else if (style.align === 'right') px -= width;

  let py = y;
  if (style.baseline === 'cap') py += size;
  else if (style.baseline === 'mid') py += size * 0.5;

  const budget = progress >= 1 ? Infinity : penLength(text, size) * progress;
  // The caller's fade is a multiplier, not something to overwrite: a popup that
  // sets globalAlpha on its way out has to actually go out.
  const baseA = ctx.globalAlpha * (style.alpha ?? 1);
  const glow = style.glow ?? 0;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;

  /**
   * The halo is a genuine blur of the letterforms, not a fatter stroke behind
   * them. A fat stroke on a mitred monoline face grows spikes at every corner
   * and turns a word into a blob at exactly the sizes — headlines — where the
   * glow is wanted most.
   *
   * It is blurred inside a small buffer rather than on this canvas; see
   * `glow.ts` for why that distinction is worth four frames a second each.
   */
  if (glow > 0 && quality.current.textGlow) {
    const gc = style.glowColor ?? style.color ?? '#fff';
    // Radius in *user* units. Canvas filters count device pixels, so leaving it
    // in those would make the halo tighten as the display gets sharper.
    const rad = size * 0.11 * glow;
    const left = px - weight;
    const top = py - size - weight;
    const w = width + (Math.max(0, slant) + INK_OVERHANG) * size + weight * 2;
    const h = size * (1 + INK_DESCENT) + weight * 2;

    const drawn =
      CAN_BLUR &&
      glowLayer(ctx, left, top, w, h, rad * 3.2 + 2, baseA, (g, k) => {
        g.lineCap = 'butt';
        g.lineJoin = 'miter';
        g.miterLimit = 3;
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = gc;
        // A wide soft bed and a tight bright core: two radii read as a real
        // falloff where one reads as a smudge.
        for (const [wm, a, rm] of [[1.1, 0.4, 1], [1.05, 0.34, 0.32]] as const) {
          g.filter = `blur(${Math.max(0.4, rad * rm * k).toFixed(2)}px)`;
          g.globalAlpha = a * Math.min(1, glow);
          g.lineWidth = weight * wm;
          strokeRun(g, text, px, py, size, track, slant, budget);
        }
      });

    if (!drawn) {
      // No canvas filter, or a transform the buffer cannot represent. Fatter
      // strokes at low alpha are not as good, but they are still a glow.
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = gc;
      for (const [wm, a] of [[1 + 1.3 * glow, 0.07], [1 + 0.5 * glow, 0.1]] as const) {
        ctx.globalAlpha = baseA * a * glow;
        ctx.lineWidth = weight * wm;
        strokeRun(ctx, text, px, py, size, track, slant, budget);
      }
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = baseA;
  ctx.strokeStyle = style.color ?? '#fff';
  ctx.lineWidth = weight;
  strokeRun(ctx, text, px, py, size, track, slant, budget);

  ctx.restore();
  return width;
}

/** Stroke a whole string, spending at most `budget` pixels of pen across it. */
function strokeRun(
  ctx: CanvasRenderingContext2D,
  text: string,
  px: number,
  py: number,
  size: number,
  track: number,
  slant: number,
  budget: number,
) {
  let cx = px;
  let left = budget;
  for (const ch of text) {
    const gl = glyphFor(ch);
    if (left > 0) strokeGlyph(ctx, gl.p, cx, py, size, slant, left, (used) => (left -= used));
    cx += (gl.a + track) * size;
  }
}

/**
 * Stroke one glyph, spending at most `budget` pixels of pen. `spend` reports
 * how much was actually used so the caller can carry the remainder forward.
 */
function strokeGlyph(
  ctx: CanvasRenderingContext2D,
  runs: number[][],
  ox: number,
  oy: number,
  size: number,
  slant: number,
  budget: number,
  spend: (used: number) => void,
) {
  const X = (gx: number, gy: number) => ox + (gx + slant * (1 - gy)) * size;
  const Y = (gy: number) => oy - (1 - gy) * size;

  let used = 0;
  ctx.beginPath();
  for (const run of runs) {
    if (budget - used <= 0) break;
    ctx.moveTo(X(run[0], run[1]), Y(run[1]));
    for (let i = 2; i < run.length; i += 2) {
      const px0 = run[i - 2];
      const py0 = run[i - 1];
      const px1 = run[i];
      const py1 = run[i + 1];
      const seg = Math.hypot(px1 - px0, py1 - py0) * size;
      const left = budget - used;
      if (seg <= left) {
        ctx.lineTo(X(px1, py1), Y(py1));
        used += seg;
      } else {
        const t = left / seg;
        const mx = px0 + (px1 - px0) * t;
        const my = py0 + (py1 - py0) * t;
        ctx.lineTo(X(mx, my), Y(my));
        used = budget;
        break;
      }
    }
  }
  ctx.stroke();
  spend(used);
}

// ------------------------------------------------------------------ UI face
/**
 * Neutral grotesque for running text. The stack is ordered so that machines
 * with a proper geometric sans use it, and everything else lands on a
 * respectable default rather than on Times.
 */
export const ui = (px: number, weight = 600) =>
  `${weight} ${px}px "Inter", "SF Pro Text", -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

export const mono = (px: number, weight = 600) =>
  `${weight} ${px}px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`;

export interface UIStyle {
  size: number;
  weight?: number;
  /** Letter spacing in px. */
  tracking?: number;
  align?: Align;
  color?: string;
  alpha?: number;
  font?: (px: number, weight: number) => string;
  /**
   * Shrink size and tracking together until the run fits. Text that runs off
   * the edge of a phone is the single most common way a canvas UI breaks, and
   * the fix belongs in the text layer rather than at forty call sites.
   */
  maxWidth?: number;
}

/** Apply `maxWidth` by scaling the style down; returns the style to draw with. */
function fitStyle(ctx: CanvasRenderingContext2D, text: string, style: UIStyle): UIStyle {
  if (!style.maxWidth) return style;
  const w = uiWidth(ctx, text, style);
  if (w <= style.maxWidth || w <= 0) return style;
  const k = style.maxWidth / w;
  return { ...style, size: style.size * k, tracking: (style.tracking ?? 0) * k };
}

/**
 * Character advances, cached per font string.
 *
 * `measureText` shapes the run, and hand-tracked text needs every character
 * measured twice — once to lay the line out, once while drawing it. Six short
 * HUD labels were costing nearly two hundred shaping calls a frame. The faces
 * are fixed, so an advance measured once is an advance forever.
 */
const advances = new Map<string, Map<string, number>>();

/** Advance of one character in `font`, which must already be set on `ctx`. */
function advance(ctx: CanvasRenderingContext2D, font: string, ch: string) {
  let m = advances.get(font);
  if (!m) {
    // Sizes are continuous under a window resize, so the key space is not
    // bounded on its own. Dropping the lot occasionally costs one frame of
    // measuring and keeps this from growing without limit.
    if (advances.size > 48) advances.clear();
    m = new Map();
    advances.set(font, m);
  }
  let w = m.get(ch);
  if (w === undefined) {
    w = ctx.measureText(ch).width;
    m.set(ch, w);
  }
  return w;
}

export function uiWidth(ctx: CanvasRenderingContext2D, text: string, style: UIStyle) {
  const font = (style.font ?? ui)(style.size, style.weight ?? 600);
  ctx.font = font;
  const track = style.tracking ?? 0;
  if (!track) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += advance(ctx, font, ch) + track;
  return w - track;
}

/**
 * `ctx.letterSpacing` exists but is silently ignored on several engines, which
 * would leave lockups subtly wrong on some machines instead of obviously wrong
 * on all of them. Spacing is applied by hand.
 */
export function drawUI(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  raw: UIStyle,
) {
  const style = fitStyle(ctx, text, raw);
  const track = style.tracking ?? 0;
  const font = (style.font ?? ui)(style.size, style.weight ?? 600);
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = style.color ?? '#fff';
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha;
  ctx.textBaseline = 'alphabetic';

  const w = uiWidth(ctx, text, style);
  let cx = style.align === 'center' ? x - w * 0.5 : style.align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  if (!track) {
    ctx.fillText(text, cx, y);
  } else {
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += advance(ctx, font, ch) + track;
    }
  }
  ctx.restore();
  return w;
}

/** Largest size at or below `px` whose tracked width fits. Never distorts. */
export function fitVec(text: string, maxWidth: number, px: number, tracking: number) {
  let size = px;
  for (let i = 0; i < 40; i++) {
    if (vecWidth(text, { size, tracking }) <= maxWidth) break;
    size *= 0.955;
  }
  return size;
}
