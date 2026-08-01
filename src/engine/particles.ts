import { COL } from '../config';
import { randRange } from './math';

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
  hot: boolean;
  active: boolean;
}

const CAPACITY = 900;

/** Fixed-capacity pool — no allocation during a run, no GC hitches at speed. */
export class Particles {
  private pool: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 0,
        rot: 0, vrot: 0, hot: false, active: false,
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
    hot = false,
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      const a = rng() * Math.PI * 2;
      const spd = randRange(rng, 120, 560);
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
      p.hot = hot;
      p.active = true;
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 1400 * dt; // shards fall away hard
      p.vx *= Math.exp(-2.6 * dt);
      p.rot += p.vrot * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camY: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      const sy = p.y - camY;
      if (sy < -60 || sy > 900) continue;

      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.hot ? COL.hot : COL.fg;
      ctx.save();
      ctx.translate(p.x, sy);
      ctx.rotate(p.rot);
      const s = p.size * (0.45 + a * 0.55);
      ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
