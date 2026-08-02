import {
  DRIFT_DRAG,
  DRIFT_KEEP,
  FOCUS_MAX,
  MAX_HULL,
  PLAYER_R,
  STRIKE_COOLDOWN,
  STRIKE_SPEED,
} from '../config';
import { dampAngle } from '../engine/math';
import { view } from '../viewport';
import type { StrikePlan } from './strike';

export interface Afterimage {
  x: number;
  y: number;
  a: number;
  life: number;
  max: number;
}

/**
 * The player is a two-state machine and nothing else.
 *
 *   DRIFT   you coast on whatever momentum the last strike left you, you can be
 *           hit, and you can aim.
 *   STRIKE  you travel a solved path at absurd speed, you cannot be hit, and
 *           everything you touch dies.
 *
 * Keeping it to two states is what makes the game legible at a glance: the ship
 * is either a dim little chevron or a screaming white line, and the player never
 * has to wonder which mode they are in.
 */
export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;

  /** Visual facing. Follows the aim while drifting, locks during a strike. */
  angle = -Math.PI / 2;

  hull = MAX_HULL;
  iframe = 0;
  focus = FOCUS_MAX;

  striking = false;
  plan: StrikePlan | null = null;
  travelled = 0;
  private hitCursor = 0;
  /** Kills banked during the strike in flight — drives the chain readout. */
  strikeKills = 0;
  cooldown = 0;
  /** Set when a ward shield stops you: a beat where you cannot strike again. */
  stun = 0;

  /** 0..1 stretch driven by state; the whole ship elongates into a strike. */
  stretch = 0;
  /** 0..1 charge-up while aiming, purely visual. */
  charge = 0;

  readonly trail: Afterimage[] = [];
  private trailClock = 0;

  reset() {
    this.x = view.arenaW * 0.5;
    this.y = view.arenaH * 0.5;
    this.vx = 0;
    this.vy = 0;
    this.angle = -Math.PI / 2;
    this.hull = MAX_HULL;
    this.iframe = 0;
    this.focus = FOCUS_MAX;
    this.striking = false;
    this.plan = null;
    this.travelled = 0;
    this.hitCursor = 0;
    this.strikeKills = 0;
    this.cooldown = 0;
    this.stun = 0;
    this.stretch = 0;
    this.charge = 0;
    this.trail.length = 0;
  }

  get canStrike() {
    return !this.striking && this.cooldown <= 0 && this.stun <= 0;
  }

  get speed() {
    return this.striking ? STRIKE_SPEED : Math.hypot(this.vx, this.vy);
  }

  /** 0..1, for post-processing and audio. */
  get speedNorm() {
    return Math.min(1, this.speed / STRIKE_SPEED);
  }

  begin(plan: StrikePlan) {
    this.plan = plan;
    this.striking = true;
    this.travelled = 0;
    this.hitCursor = 0;
    this.strikeKills = 0;
    this.angle = Math.atan2(plan.dy, plan.dx);
    this.x = plan.x0;
    this.y = plan.y0;
    this.stretch = 1;
    this.charge = 0;
  }

  /**
   * Advance the strike. Appends the indices of hits crossed this step, in
   * order, so the game can spend them on score, particles and audio without the
   * player knowing anything about those systems.
   */
  advanceStrike(dt: number, out: number[]): boolean {
    out.length = 0;
    const plan = this.plan;
    if (!plan) return true;

    this.travelled = Math.min(plan.dist, this.travelled + STRIKE_SPEED * dt);
    this.x = plan.x0 + plan.dx * this.travelled;
    this.y = plan.y0 + plan.dy * this.travelled;

    while (this.hitCursor < plan.hits.length && plan.hits[this.hitCursor].d <= this.travelled) {
      out.push(this.hitCursor);
      this.hitCursor++;
    }

    return this.travelled >= plan.dist - 1e-4;
  }

  endStrike() {
    const plan = this.plan;
    this.striking = false;
    this.cooldown = STRIKE_COOLDOWN;
    if (plan) {
      this.vx = plan.dx * STRIKE_SPEED * DRIFT_KEEP;
      this.vy = plan.dy * STRIKE_SPEED * DRIFT_KEEP;
    }
    this.plan = null;
  }

  /** Drift physics. Only ever runs when not striking. */
  drift(dt: number, aimAngle: number) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const k = Math.exp(-DRIFT_DRAG * dt);
    this.vx *= k;
    this.vy *= k;

    const m = PLAYER_R;
    if (this.x < m) {
      this.x = m;
      this.vx = Math.abs(this.vx) * 0.3;
    } else if (this.x > view.arenaW - m) {
      this.x = view.arenaW - m;
      this.vx = -Math.abs(this.vx) * 0.3;
    }
    if (this.y < m) {
      this.y = m;
      this.vy = Math.abs(this.vy) * 0.3;
    } else if (this.y > view.arenaH - m) {
      this.y = view.arenaH - m;
      this.vy = -Math.abs(this.vy) * 0.3;
    }

    this.angle = dampAngle(this.angle, aimAngle, 16, dt);
  }

  /** Real-time bookkeeping: timers and the afterimage trail. */
  tick(dtReal: number, aiming: boolean) {
    if (this.cooldown > 0) this.cooldown -= dtReal;
    if (this.stun > 0) this.stun -= dtReal;
    if (this.iframe > 0) this.iframe -= dtReal;

    // The ship stretches hard into a strike and springs back after it.
    const target = this.striking ? 1 : 0;
    const rate = this.striking ? 40 : 11;
    this.stretch += (target - this.stretch) * (1 - Math.exp(-rate * dtReal));
    this.charge += ((aiming ? 1 : 0) - this.charge) * (1 - Math.exp(-9 * dtReal));

    // Afterimages are sampled on a timer rather than per frame so the trail has
    // the same density on a 60Hz laptop and a 240Hz monitor.
    this.trailClock += dtReal;
    const step = this.striking ? 0.008 : 0.03;
    while (this.trailClock >= step) {
      this.trailClock -= step;
      if (this.striking || this.speed > 260) {
        const max = this.striking ? 0.34 : 0.18;
        if (this.trail.length > 110) this.trail.shift();
        this.trail.push({ x: this.x, y: this.y, a: this.angle, life: max, max });
      }
    }

    for (let i = this.trail.length - 1; i >= 0; i--) {
      const t = this.trail[i];
      t.life -= dtReal;
      if (t.life <= 0) this.trail.splice(i, 1);
    }
  }
}
