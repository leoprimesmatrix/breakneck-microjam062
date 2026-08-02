import {
  DRAG_BRAKE,
  DRAG_NEUTRAL,
  DRAG_SHIFT_RATE,
  DRAG_TUCK,
  GRAVITY,
  KMH_PER_PX,
  KMH_PER_TIER,
  LAT_ACCEL_FAST,
  LAT_ACCEL_SLOW,
  LAT_DAMP,
  LAT_MAX_FAST,
  LAT_MAX_SLOW,
  MAX_HEALTH,
  MAX_TIER,
  OD_GRAVITY_BONUS,
  PLAYER_R,
  V_BOUNCE_CAP,
  V_MAX,
  V_START,
  VIEW_W,
} from '../config';
import { clamp, damp, invLerp, lerp, smoothstep } from '../engine/math';
import type { Input } from '../engine/input';

export class Player {
  x = VIEW_W / 2;
  y = 0;
  vx = 0;
  vy = V_START;
  /** Current drag coefficient; eases between postures so shape changes read. */
  drag = DRAG_NEUTRAL;

  health = MAX_HEALTH;
  iframe = 0;

  /** Set for one step when a wall was struck, so the renderer can react. */
  hitWall = false;

  /** Mirrors Overdrive.active; the sim reads it, the renderer reads it. */
  overdriven = false;

  reset() {
    this.x = VIEW_W / 2;
    this.y = 0;
    this.vx = 0;
    this.vy = V_START;
    this.drag = DRAG_NEUTRAL;
    this.health = MAX_HEALTH;
    this.iframe = 0;
    this.hitWall = false;
    this.overdriven = false;
  }

  /**
   * -1..1 lean from lateral velocity. Purely for the renderer, but a hull that
   * banks into its turn is the difference between piloting something and
   * sliding a shape around.
   */
  get bank() {
    return clamp(this.vx / LAT_MAX_SLOW, -1, 1);
  }

  get kmh() {
    return Math.max(0, this.vy) * KMH_PER_PX;
  }

  /** The damage number. Blocks break when this reaches their hardness. */
  get tier() {
    return clamp(Math.floor(this.kmh / KMH_PER_TIER), 1, MAX_TIER);
  }

  /** 0 at rest, 1 at terminal velocity. Drives steering falloff and most effects. */
  get speedNorm() {
    return invLerp(0, V_MAX, this.vy);
  }

  /**
   * How much lateral control you have right now, 1 (full) .. ~0 (committed).
   * This is the whole game: speed is the weapon *and* the thing taking the wheel.
   */
  get authority() {
    return 1 - smoothstep(this.speedNorm);
  }

  /** Integrates velocity only. Collision is resolved by the caller against the world. */
  step(dt: number, input: Input) {
    if (this.iframe > 0) this.iframe -= dt;

    // --- vertical: constant gravity against posture-dependent drag.
    // Terminal velocity is sqrt(GRAVITY / drag), so the tuck is what buys tiers.
    const targetDrag = input.brake ? DRAG_BRAKE : input.tuck ? DRAG_TUCK : DRAG_NEUTRAL;
    this.drag = damp(this.drag, targetDrag, DRAG_SHIFT_RATE, dt);

    // Drag always opposes motion, including on the upward half of a bounce.
    // Overdrive adds pull rather than removing drag, so the acceleration is felt
    // as a shove in the back instead of the physics quietly changing rules.
    const dragAccel = this.drag * this.vy * Math.abs(this.vy);
    const g = GRAVITY + (this.overdriven ? OD_GRAVITY_BONUS : 0);
    this.vy += (g - dragAccel) * dt;
    this.vy = clamp(this.vy, V_BOUNCE_CAP, V_MAX);

    // --- lateral, with authority falling off as speed rises
    const k = smoothstep(this.speedNorm);
    const latAccel = lerp(LAT_ACCEL_SLOW, LAT_ACCEL_FAST, k);
    const latMax = lerp(LAT_MAX_SLOW, LAT_MAX_FAST, k);

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx = clamp(this.vx + dir * latAccel * dt, -latMax, latMax);
    } else {
      this.vx = damp(this.vx, 0, LAT_DAMP, dt);
    }

    this.x += this.vx * dt;

    // --- walls: hard boundaries that cost you momentum
    this.hitWall = false;
    if (this.x < PLAYER_R) {
      this.x = PLAYER_R;
      this.vx = Math.abs(this.vx) * 0.35;
      this.hitWall = true;
    } else if (this.x > VIEW_W - PLAYER_R) {
      this.x = VIEW_W - PLAYER_R;
      this.vx = -Math.abs(this.vx) * 0.35;
      this.hitWall = true;
    }
  }
}
