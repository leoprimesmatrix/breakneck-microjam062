import { glyphFor } from './glyphs';

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

/** Canvas `filter` is near-universal but not guaranteed; probe it once. */
const CAN_BLUR = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return false;
    c.filter = 'blur(1px)';
    return c.filter !== 'none' && c.filter !== '';
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

  let budget = progress >= 1 ? Infinity : penLength(text, size) * progress;

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  if (style.alpha !== undefined) ctx.globalAlpha = style.alpha;

  /**
   * The halo is a genuine blur of the letterforms, not a fatter stroke behind
   * them. A fat stroke on a mitred monoline face grows spikes at every corner
   * and turns a word into a blob at exactly the sizes — headlines — where the
   * glow is wanted most.
   */
  const passes: { w: number; a: number; c: string; blur: number }[] = [];
  const glow = style.glow ?? 0;
  if (glow > 0) {
    const gc = style.glowColor ?? style.color ?? '#fff';
    if (CAN_BLUR) {
      passes.push({ w: weight * 1.1, a: 0.4 * Math.min(1, glow), c: gc, blur: size * 0.22 * glow });
      passes.push({ w: weight * 1.05, a: 0.34 * Math.min(1, glow), c: gc, blur: size * 0.07 * glow });
    } else {
      passes.push({ w: weight * (1 + 1.3 * glow), a: 0.07 * glow, c: gc, blur: 0 });
      passes.push({ w: weight * (1 + 0.5 * glow), a: 0.1 * glow, c: gc, blur: 0 });
    }
  }
  passes.push({ w: weight, a: 1, c: style.color ?? '#fff', blur: 0 });

  for (let pass = 0; pass < passes.length; pass++) {
    const P = passes[pass];
    ctx.globalCompositeOperation = pass < passes.length - 1 ? 'lighter' : 'source-over';
    ctx.filter = P.blur > 0.05 ? `blur(${P.blur.toFixed(2)}px)` : 'none';
    ctx.strokeStyle = P.c;
    ctx.lineWidth = P.w;
    ctx.globalAlpha = (style.alpha ?? 1) * P.a;

    let cx = px;
    let left = budget;
    for (const ch of text) {
      const gl = glyphFor(ch);
      if (left > 0) strokeGlyph(ctx, gl.p, cx, py, size, slant, left, (used) => (left -= used));
      cx += (gl.a + track) * size;
    }
  }
  ctx.filter = 'none';

  ctx.restore();
  return width;
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

export function uiWidth(ctx: CanvasRenderingContext2D, text: string, style: UIStyle) {
  ctx.font = (style.font ?? ui)(style.size, style.weight ?? 600);
  const track = style.tracking ?? 0;
  if (!track) return ctx.measureText(text).width;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
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
  ctx.save();
  ctx.font = (style.font ?? ui)(style.size, style.weight ?? 600);
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
      cx += ctx.measureText(ch).width + track;
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
