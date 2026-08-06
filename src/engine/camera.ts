import { view } from '../viewport';

/**
 * Depth, for a game whose camera cannot move.
 *
 * The arena is always entirely on screen. That is the legibility contract, and
 * it is why `PostFX.begin` derives its transform from the window and nothing
 * else — a camera that followed the ship would take part of the board away at
 * exactly the moment the player is reading it. So this module never touches the
 * playfield transform. Not once.
 *
 * What it supplies instead is the *relative* motion a real camera would have
 * produced, for the only layers allowed to move: the background.
 *
 * The arithmetic is the honest version rather than a fudge. A follow camera
 * displaced by `c` puts a layer of depth `d` at screen offset `-c·d`, and the
 * playfield (`d = 1`) at `-c`. Pin the playfield — force its offset back to
 * zero — and every other layer inherits the difference:
 *
 *     offset(d) = -c·d - (-c) = c·(1 - d)
 *
 * Distant layers therefore slide *with* you, and further than near ones, which
 * is what distant things do when you move and the ground does not. Anything
 * with `d > 1` — the ash and embers drifting in front of the arena — slides
 * against you, because that is what foreground does. One expression, both
 * behaviours, no special cases.
 *
 * It lives in `engine/` beside `juice` for the same reason `juice` does: it is
 * presentation state that the simulation advances on real time and the renderer
 * only reads. It takes scalars rather than a `Game` so that stays true.
 */

/** Fraction of the player's displacement from arena centre that the camera takes. */
const FOLLOW = 0.1;
/** Extra push along the aim heading while holding, in arena units. */
const AIM_LEAD = 26;
/** Convergence rate. Damped, never snapping. */
const EASE = 3.2;

/** Idle drift, so a still frame is never a dead one. */
const SWAY_X = 7;
const SWAY_Y = 4.5;
const SWAY_RATE = 0.11;

class Camera {
  /** Camera displacement in arena units. Zero is the arena centre. */
  x = 0;
  y = 0;

  /**
   * One switch for the whole stage. Off, every accessor returns zero and each
   * background layer draws exactly where it drew before this module existed.
   */
  enabled = true;

  private t = 0;

  reset() {
    this.x = 0;
    this.y = 0;
    this.t = 0;
  }

  /**
   * Advanced on real time alongside `juice`, and deliberately not dilated: the
   * room should keep breathing while the world is held at `AIM_TIMESCALE`, and
   * the aim lead needs to arrive at the speed the player's hand moved rather
   * than the speed the simulation is being allowed to run at.
   */
  update(dtReal: number, px: number, py: number, aimBlend: number, aimAngle: number) {
    if (!this.enabled) {
      this.x = 0;
      this.y = 0;
      return;
    }
    this.t += dtReal;

    let tx = (px - view.arenaW * 0.5) * FOLLOW;
    let ty = (py - view.arenaH * 0.5) * FOLLOW;

    // Holding leans the room the way the shot is pointed. It is the only
    // anticipation in the game that costs the player nothing to read.
    if (aimBlend > 0.01) {
      tx += Math.cos(aimAngle) * AIM_LEAD * aimBlend;
      ty += Math.sin(aimAngle) * AIM_LEAD * aimBlend;
    }

    tx += Math.cos(this.t * SWAY_RATE) * SWAY_X;
    ty += Math.sin(this.t * SWAY_RATE * 1.37) * SWAY_Y;

    // Exponential convergence, framerate-independent.
    const k = 1 - Math.exp(-EASE * dtReal);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  /**
   * Screen offset for a layer at `depth`, in arena units. `depth` 0 is
   * infinitely far, 1 is the playfield (and returns zero, which is the point),
   * above 1 is in front of it.
   */
  offsetX(depth: number) {
    return this.enabled ? this.x * (1 - depth) : 0;
  }

  offsetY(depth: number) {
    return this.enabled ? this.y * (1 - depth) : 0;
  }

  /** Translate a context into a layer's frame. Pair with the caller's own save/restore. */
  applyLayer(ctx: CanvasRenderingContext2D, depth: number) {
    const ox = this.offsetX(depth);
    const oy = this.offsetY(depth);
    if (ox || oy) ctx.translate(ox, oy);
  }

  /**
   * How far a layer at `depth` can ever be pushed, so it can be drawn oversized
   * by exactly enough that its own edge never wanders into frame. Derived from
   * the configured maxima rather than the current offset: a margin that changed
   * every frame would cause the very seam it exists to prevent.
   */
  slack(depth: number) {
    const k = Math.abs(1 - depth);
    const maxX = (view.arenaW * 0.5 * FOLLOW + AIM_LEAD + SWAY_X) * k;
    const maxY = (view.arenaH * 0.5 * FOLLOW + AIM_LEAD + SWAY_Y) * k;
    return Math.max(maxX, maxY) + 2;
  }
}

export const camera = new Camera();
