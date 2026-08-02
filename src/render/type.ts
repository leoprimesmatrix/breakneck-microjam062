/**
 * Typography.
 *
 * The old build drew everything in "Arial Narrow" and then *scaled it to fit* —
 * a condensed face squeezed further still, which is exactly why the wordmark
 * looked squashed. Here the face is a heavy grotesque at its natural width and
 * fit is achieved by choosing a smaller size and adjusting tracking, never by
 * distorting glyphs.
 */

/** Display face: heavy, wide, present at large sizes. */
export const heavy = (px: number) =>
  `900 ${px}px "Arial Black", "Helvetica Neue", Helvetica, Inter, system-ui, sans-serif`;

/** Body face for labels — same family, lighter, so the hierarchy is weight. */
export const body = (px: number) =>
  `700 ${px}px "Helvetica Neue", Helvetica, Inter, system-ui, sans-serif`;

/** Technical readouts. Tabular by nature, so numbers don't jitter as they count. */
export const mono = (px: number) =>
  `600 ${px}px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`;

/**
 * Manual letter-spacing. `ctx.letterSpacing` exists but is inconsistently
 * supported and silently ignored where it isn't, which would leave the lockups
 * subtly wrong on some machines rather than obviously wrong on all of them.
 */
export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return w - tracking;
}

export type Align = 'left' | 'center' | 'right';

export function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: Align = 'center',
) {
  const w = trackedWidth(ctx, text, tracking);
  let cx = align === 'center' ? x - w * 0.5 : align === 'right' ? x - w : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prev;
  return w;
}

/**
 * Pick the largest size at or below `px` whose tracked width fits `maxWidth`.
 * Shrinking the point size preserves letterform proportions; scaling the
 * transform does not, which is the bug this replaces.
 */
export function fitSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  px: number,
  tracking: number,
  font: (n: number) => string = heavy,
) {
  let size = px;
  for (let i = 0; i < 24; i++) {
    ctx.font = font(size);
    if (trackedWidth(ctx, text, tracking * (size / px)) <= maxWidth) break;
    size *= 0.94;
  }
  ctx.font = font(size);
  return size;
}
