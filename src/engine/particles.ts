import type { Palette } from '../game/biomes';
import { MOLTEN, rgba } from '../game/biomes';
import { randRange } from './math';

export type ParticleTint = 'cool' | 'hot' | 'molten';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  tint: ParticleTint;
  /** Shards tumble; streaks stretch along their velocity; rings expand. */
  shape: 0 | 1 | 2;
  active: boolean;
}

const CAPACITY = 1100;

/** Fixed-capacity pool — no allocation during a run, no GC hitches at speed. */
export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 0,
        rot: 0, vrot: 0, tint: 'cool', shape: 0, active: false,
      });
    }
  }

  reset() {
    for (const p of this.pool) p.active = false;
  }

  private take(): Particle {
    // Round-robin: oldest slots get recycled first under pressure.
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % CAPACITY;
    return p;
  }

  /** Shards thrown from a shattered block, inheriting the player's momentum. */
  shards(
    cx: number,
    cy: number,
    inheritVy: number,
    count: number,
    rng: () => number,
    tint: ParticleTint = 'cool',
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      const a = rng() * Math.PI * 2;
      const spd = randRange(rng, 120, 620);
      p.x = cx + randRange(rng, -26, 26);
      p.y = cy + randRange(rng, -14, 14);
      p.vx = Math.cos(a) * spd;
      // Shards keep a fraction of your speed, which is what sells the impact.
      p.vy = Math.sin(a) * spd + inheritVy * 0.42;
      p.maxLife = randRange(rng, 0.26, 0.62);
      p.life = p.maxLife;
      p.size = randRange(rng, 2.5, 7.5);
      p.rot = rng() * Math.PI;
      p.vrot = randRange(rng, -14, 14);
      p.tint = tint;
      // A third of the debris streaks instead of tumbling; mixing the two reads
      // as "material shattering" rather than "squares appeared".
      p.shape = rng() < 0.34 ? 1 : 0;
      p.active = true;
    }
  }

  /**
   * Expanding shockwave. One ring costs a single stroked arc and does more for
   * the weight of an impact than another twenty shards would.
   */
  ring(cx: number, cy: number, power: number) {
    const p = this.take();
    p.x = cx;
    p.y = cy;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = 0.28 + power * 0.34;
    p.life = p.maxLife;
    p.size = 12 + power * 26;
    p.rot = 0;
    p.vrot = 0;
    p.tint = power > 1 ? 'molten' : 'cool';
    p.shape = 2;
    p.active = true;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (p.shape === 2) continue; // rings are pure animation
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 1400 * dt; // shards fall away hard
      p.vx *= Math.exp(-2.6 * dt);
      p.rot += p.vrot * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camY: number, pal: Palette) {
    // Debris is emissive: additive blending is what makes a burst read as light
    // coming off a break rather than confetti drifting over the art.
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.pool) {
      if (!p.active) continue;
      const sy = p.y - camY;
      if (sy < -120 || sy > 980) continue;

      const a = p.life / p.maxLife;
      const col = p.tint === 'hot' ? pal.hot : p.tint === 'molten' ? MOLTEN : pal.fg;

      if (p.shape === 2) {
        const grow = 1 - a;
        ctx.strokeStyle = rgba(col, a * a * 0.85);
        ctx.lineWidth = 1 + a * 3.5;
        ctx.beginPath();
        ctx.arc(p.x, sy, p.size * (0.4 + grow * 2.6), 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      ctx.fillStyle = rgba(col, a);
      ctx.save();
      ctx.translate(p.x, sy);

      if (p.shape === 1) {
        // Streak: oriented along travel, length scaled by speed.
        const sp = Math.hypot(p.vx, p.vy);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        const len = Math.min(38, 4 + sp * 0.03);
        ctx.fillRect(0, -p.size * 0.16, len, p.size * 0.32);
      } else {
        ctx.rotate(p.rot);
        const s = p.size * (0.45 + a * 0.55);
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
      }
      ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }
}
