import {
  DRAG_BRAKE,
  DRAG_NEUTRAL,
  DRAG_SHIFT_RATE,
  DRAG_TUCK,
  GRAVITY,
  KMH_PER_PX,
  LAT_ACCEL_LANES_FAST,
  LAT_ACCEL_LANES_SLOW,
  LAT_DAMP,
  LAT_LANES_FAST,
  LAT_LANES_SLOW,
  MAX_HEALTH,
  MELTDOWN_GRAVITY,
  V_BOUNCE_CAP,
  V_MAX,
  V_START,
} from '../config';
import { clamp, damp, invLerp, lerp, smoothstep } from '../engine/math';
import type { Input } from '../engine/input';
import { lanesToPx, midX, view } from '../viewport';

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = V_START;
  /** Current drag coefficient; eases between postures so shape changes read. */
  drag = DRAG_NEUTRAL;

  health = MAX_HEALTH;
  iframe = 0;

  /** Mirrors Heat.melting; the sim reads it, the renderer reads it. */
  melting = false;

  reset() {
    this.x = midX();
    this.y = 0;
    this.vx = 0;
    this.vy = V_START;
    this.drag = DRAG_NEUTRAL;
    this.health = MAX_HEALTH;
    this.iframe = 0;
    this.melting = false;
  }

  /** Flavour readout. No longer decides anything — heat does. */
  get kmh() {
    return Math.max(0, this.vy) * KMH_PER_PX;
  }

  /** 0 at rest, 1 at terminal velocity. Drives heating, steering falloff, effects. */
  get speedNorm() {
    return invLerp(0, V_MAX, this.vy);
  }

  /**
   * -1..1 lean from lateral velocity. Purely for the renderer, but a hull that
   * banks into its turn is the difference between piloting something and sliding
   * a shape around.
   */
  get bank() {
    const max = lanesToPx(LAT_LANES_SLOW);
    return clamp(this.vx / max, -1, 1);
  }

  /** Integrates velocity only. Collision is resolved by the caller. */
  step(dt: number, input: Input) {
    if (this.iframe > 0) this.iframe -= dt;

    // --- vertical: constant gravity against posture-dependent drag.
    const targetDrag = input.brake ? DRAG_BRAKE : input.tuck ? DRAG_TUCK : DRAG_NEUTRAL;
    this.drag = damp(this.drag, targetDrag, DRAG_SHIFT_RATE, dt);

    // Drag always opposes motion, including on the upward half of a bounce.
    // Meltdown adds pull rather than removing drag, so the acceleration is felt
    // as a shove in the back instead of the physics quietly changing rules.
    const dragAccel = this.drag * this.vy * Math.abs(this.vy);
    const g = GRAVITY + (this.melting ? MELTDOWN_GRAVITY : 0);
    this.vy += (g - dragAccel) * dt;
    this.vy = clamp(this.vy, V_BOUNCE_CAP, V_MAX);

    // --- lateral, with authority falling off as speed rises.
    // Authored in lanes/sec and converted here: the field is 7 lanes wide on a
    // phone and 26 on a monitor, and what must stay constant is how quickly you
    // reach the NEXT lane, because dodging is always a local decision.
    const k = smoothstep(this.speedNorm);
    const latAccel = lanesToPx(lerp(LAT_ACCEL_LANES_SLOW, LAT_ACCEL_LANES_FAST, k));
    const latMax = lanesToPx(lerp(LAT_LANES_SLOW, LAT_LANES_FAST, k));

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx = clamp(this.vx + dir * latAccel * dt, -latMax, latMax);
    } else {
      this.vx = damp(this.vx, 0, LAT_DAMP, dt);
    }

    this.x += this.vx * dt;

    // --- walls: hard boundaries that cost you momentum
    if (this.x < view.playerR) {
      this.x = view.playerR;
      this.vx = Math.abs(this.vx) * 0.35;
    } else if (this.x > view.logicalW - view.playerR) {
      this.x = view.logicalW - view.playerR;
      this.vx = -Math.abs(this.vx) * 0.35;
    }
  }
}
