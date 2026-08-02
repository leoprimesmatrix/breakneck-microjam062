import { clamp } from '../engine/math';

/**
 * Adaptive quality.
 *
 * The game has to look the same on a desktop with a discrete GPU and stay
 * playable on a five-year-old tablet, and there is no way to know which one it
 * is from the user agent — the string lies, and the same phone throttles to
 * half speed when it gets warm anyway. So it is measured instead: the loop
 * reports how long frames are actually taking, and this decides what the
 * machine can afford.
 *
 * Two rules shape the ladder below.
 *
 *  - **Nothing is given up while the frame budget is being met.** A machine
 *    that can hold 60 never drops a single effect, so the intended look is the
 *    default rather than a reward.
 *  - **What goes first is what is least missed.** The chromatic fringe only
 *    appears during a strike; the grain is a texture nobody would name. The
 *    silhouettes, the aim line and the crisp HUD are the last things to bend,
 *    because those are the ones the game is actually played with.
 *
 * Recovery is deliberately slower than degradation: dropping a tier the instant
 * the frame budget slips is right, but climbing back the instant it recovers
 * makes the picture flicker between two looks, which is worse than either.
 */

export interface QualityLevel {
  /** Multiplier on the offscreen world buffer's resolution. */
  sceneScale: number;
  /** Bloom passes: 2 = soft halo + bright core, 1 = halo only, 0 = none. */
  bloom: 0 | 1 | 2;
  /** Downscale divisor for the bloom buffer. Bigger is cheaper and softer. */
  bloomDiv: number;
  /** The lens fringe on fast movement. */
  chroma: boolean;
  /** Film grain and scanlines. */
  grain: boolean;
  /** Blurred halos behind display type. */
  textGlow: boolean;
  /**
   * Environment detail. 2 = the whole room (substructure plates, recorder
   * sweep, drifting haze, lit grid nodes); 1 = plates and nodes only; 0 = the
   * grid and nothing else. None of it is information — it is the set the fight
   * happens in — which is exactly why it can be given up before anything else
   * that is drawn *inside* the arena.
   */
  deco: 0 | 1 | 2;
  /** Ceiling on the device pixel ratio of the visible canvas. */
  dprCap: number;
}

/**
 * Ordered best to worst. The top of the list is what the game is designed to
 * look like; every machine that can hold a frame stays there.
 *
 * The order is by cost-per-regret, not by cost alone. Grain goes first because
 * it is a texture nobody could describe from memory and it is paid on every
 * single frame — including the quiet ones. The chromatic fringe is louder, but
 * it only fires while the ship is moving fast, so it survives one step longer.
 * Resolution and bloom come next because they soften the picture without
 * removing anything from it. The aim line, the silhouettes and the crisp HUD
 * are never touched at all: those are what the game is played with, and a game
 * that sheds the information it is made of has not degraded gracefully.
 */
const LADDER: QualityLevel[] = [
  { sceneScale: 1.0, bloom: 2, bloomDiv: 3, chroma: true, grain: true, textGlow: true, deco: 2, dprCap: 2 },
  { sceneScale: 1.0, bloom: 2, bloomDiv: 3, chroma: true, grain: false, textGlow: true, deco: 2, dprCap: 2 },
  { sceneScale: 0.85, bloom: 2, bloomDiv: 4, chroma: false, grain: false, textGlow: true, deco: 2, dprCap: 2 },
  { sceneScale: 0.72, bloom: 1, bloomDiv: 4, chroma: false, grain: false, textGlow: true, deco: 1, dprCap: 1.6 },
  { sceneScale: 0.6, bloom: 1, bloomDiv: 5, chroma: false, grain: false, textGlow: false, deco: 1, dprCap: 1.35 },
  { sceneScale: 0.5, bloom: 0, bloomDiv: 5, chroma: false, grain: false, textGlow: false, deco: 0, dprCap: 1.1 },
];

/**
 * The two thresholds are set around a 60Hz frame, which is 16.7ms, and the gap
 * between them is what stops the tier from oscillating.
 *
 * `FAST_MS` has to sit *above* 16.7 or a machine holding a perfect 60 would
 * never be judged comfortable and could never climb back after one bad patch —
 * it would limp along at a reduced tier forever having done nothing wrong. A
 * 120Hz machine reports about 8ms and is never asked to give anything up.
 */
const SLOW_MS = 20;
const FAST_MS = 18;

/**
 * Frames per decision.
 *
 * The first window is short on purpose. A machine that cannot run this needs to
 * find that out in the first second, not the first minute — with a long window
 * and a settling delay after each step, falling five tiers took over half a
 * minute, which is thirty seconds of a first-time player deciding the game is
 * broken. Once a tier holds, the window lengthens and decisions get calmer.
 */
const WINDOW_FAST = 12;
const WINDOW = 45;
/** Consecutive comfortable windows before climbing back a tier. */
const RECOVER_WINDOWS = 6;
/**
 * Frame time past which one step down is obviously not enough. Below 20fps,
 * stepping a tier at a time just draws out the stutter; take two.
 */
const DIRE_MS = 50;

/**
 * A hard ceiling on the visible canvas, independent of how fast the machine is.
 * Beyond roughly six megapixels every fullscreen pass costs more than the image
 * gains — a 4K panel does not need four times the fill rate to show the same
 * picture at the same physical size. Retina laptops sit just under this and
 * stay perfectly sharp.
 */
const MAX_CANVAS_PIXELS = 6_000_000;

class Quality {
  /** Index into `LADDER`. 0 is everything. */
  level = 0;
  /** Set true by the loop once a real frame has been measured. */
  private samples: number[] = [];
  private goodWindows = 0;
  /** False until a tier has held the budget once; keeps early windows short. */
  private settled = false;
  /** Frames to ignore — start-up, and the frame after any long stall. */
  private settle = 30;
  /** Pinned by the debug overlay so a tier can be inspected on purpose. */
  locked = false;

  get current(): QualityLevel {
    return LADDER[clamp(this.level, 0, LADDER.length - 1)];
  }

  get tiers() {
    return LADDER.length;
  }

  /** Median of the current window; 0 before the first decision. */
  medianMs = 0;
  /** Exponentially smoothed frame time. For display only — decisions use the median. */
  smoothMs = 16.7;

  /**
   * The device pixel ratio to render at, given the window size. Combines the
   * measured tier's cap with the absolute pixel budget.
   */
  dprFor(cssW: number, cssH: number, deviceDpr: number) {
    let dpr = Math.min(deviceDpr || 1, this.current.dprCap);
    const px = cssW * cssH;
    if (px > 0 && px * dpr * dpr > MAX_CANVAS_PIXELS) {
      dpr = Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / px));
    }
    // Below 1 the canvas is being upscaled, which looks worse than anything
    // else on this ladder; the tiers above handle that case properly.
    return clamp(dpr, 1, 2);
  }

  /** One frame's wall-clock delta, in seconds, straight from the loop. */
  sample(dt: number) {
    const ms = dt * 1000;
    // A tab that was backgrounded, a garbage collection, an alt-tab: these are
    // not evidence about the hardware and must not cost the player their fringe.
    if (ms > 200 || ms <= 0) {
      this.settle = 20;
      this.samples.length = 0;
      return;
    }
    this.smoothMs += (ms - this.smoothMs) * 0.08;
    if (this.settle > 0) {
      this.settle--;
      return;
    }

    this.samples.push(ms);
    // Short windows until a tier has proved itself, long ones after.
    const need = this.settled ? WINDOW : WINDOW_FAST;
    if (this.samples.length < need) return;

    const sorted = this.samples.slice().sort((a, b) => a - b);
    this.medianMs = sorted[sorted.length >> 1];
    this.samples.length = 0;
    if (this.locked) return;

    if (this.medianMs > SLOW_MS && this.level < LADDER.length - 1) {
      // Two steps when the frame is nowhere near the budget; one when it is close.
      this.level = Math.min(LADDER.length - 1, this.level + (this.medianMs > DIRE_MS ? 2 : 1));
      this.goodWindows = 0;
      this.settled = false;
      // Give the new tier a moment before judging it.
      this.settle = 8;
    } else if (this.medianMs < FAST_MS && this.level > 0) {
      this.settled = true;
      if (++this.goodWindows >= RECOVER_WINDOWS) {
        this.level--;
        this.goodWindows = 0;
        this.settle = 20;
      }
    } else {
      // Holding the budget at this tier: stop reacting on a hair trigger.
      this.settled = true;
      this.goodWindows = 0;
    }
  }
}

export const quality = new Quality();
