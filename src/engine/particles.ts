import { rgba, type RGB } from '../config';
import { TAU, randRange, type Rng } from './math';

/**
 * Additive particle pool.
 *
 * Fixed capacity, round-robin recycling, zero allocation during a run. Colour
 * is carried per particle rather than looked up from a palette, because the
 * whole readability scheme rests on debris being the colour of the thing that
 * produced it — magenta shards mean a ward died, orange means a lancer did.
 */

const enum Shape {
  Shard = 0,
  Streak = 1,
  Ring = 2,
  Bar = 4,
  /** An edge of a dead body: a thin bar that keeps its own tumble. */
  Frag = 5,
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  vrot: number;
  drag: number;
  col: RGB;
  shape: Shape;
  active: boolean;
  /** Ring only: how far it expands, and its starting width. */
  grow: number;
  width: number;
}

const CAPACITY = 1600;

export class Particles {
  private pool: P[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 0,
        rot: 0, vrot: 0, drag: 2, col: [255, 255, 255], shape: Shape.Shard,
        active: false, grow: 1, width: 2,
      });
    }
  }

  reset() {
    for (const p of this.pool) p.active = false;
  }

  private take(): P {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % CAPACITY;
    return p;
  }

  /** The main death effect: a hard radial spray of shards and streaks. */
  burst(x: number, y: number, col: RGB, count: number, power: number, rng: Rng) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      // Even angular spread with jitter reads as an explosion; pure random
      // clumps and reads as a puff.
      const a = (i / count) * TAU + randRange(rng, -0.35, 0.35);
      const spd = randRange(rng, 150, 720) * power;
      p.x = x + Math.cos(a) * randRange(rng, 0, 10);
      p.y = y + Math.sin(a) * randRange(rng, 0, 10);
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.maxLife = randRange(rng, 0.22, 0.66);
      p.life = p.maxLife;
      p.size = randRange(rng, 2.2, 6.4) * power;
      p.rot = rng() * TAU;
      p.vrot = randRange(rng, -18, 18);
      p.drag = randRange(rng, 2.4, 5);
      p.col = col;
      p.shape = rng() < 0.45 ? Shape.Streak : Shape.Shard;
      p.active = true;
    }
  }

  /** Expanding shockwave. One stroked arc does more than twenty more shards. */
  ring(x: number, y: number, col: RGB, radius: number, life = 0.42, width = 3) {
    const p = this.take();
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = life;
    p.life = life;
    p.size = radius * 0.25;
    p.grow = radius;
    p.width = width;
    p.col = col;
    p.shape = Shape.Ring;
    p.active = true;
  }

  /** A thin bar thrown along a direction — used for the strike's spall. */
  spall(x: number, y: number, ang: number, col: RGB, count: number, rng: Rng) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      const a = ang + randRange(rng, -0.5, 0.5) + (rng() < 0.5 ? Math.PI : 0);
      const spd = randRange(rng, 220, 900);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.maxLife = randRange(rng, 0.12, 0.34);
      p.life = p.maxLife;
      p.size = randRange(rng, 1.6, 4);
      p.drag = 5;
      p.col = col;
      p.shape = Shape.Streak;
      p.rot = 0;
      p.vrot = 0;
      p.active = true;
    }
  }

  /**
   * The body itself coming apart: one fragment per edge of the silhouette that
   * just died, thrown outward with the strike's momentum and left tumbling.
   *
   * This is the difference between "a thing exploded here" and "*that* thing
   * broke". Generic sparks say nothing; the outline of a ward scattering as six
   * hexagon edges says exactly what was lost, in its own colour, every time.
   */
  shatter(
    x: number,
    y: number,
    pts: readonly [number, number][],
    rot: number,
    col: RGB,
    kickX: number,
    kickY: number,
    rng: Rng,
  ) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mx = (a[0] + b[0]) * 0.5;
      const my = (a[1] + b[1]) * 0.5;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];

      const p = this.take();
      p.x = x + mx * cos - my * sin;
      p.y = y + mx * sin + my * cos;
      p.rot = rot + Math.atan2(ey, ex);
      p.size = Math.hypot(ex, ey);
      p.width = 2.4;
      // Fly apart from the centre, carried by whatever killed it.
      const d = Math.hypot(mx, my) || 1;
      const spd = randRange(rng, 90, 260);
      p.vx = ((mx * cos - my * sin) / d) * spd + kickX;
      p.vy = ((mx * sin + my * cos) / d) * spd + kickY;
      p.vrot = randRange(rng, -11, 11);
      p.drag = randRange(rng, 2.6, 4);
      p.maxLife = randRange(rng, 0.3, 0.6);
      p.life = p.maxLife;
      p.col = col;
      p.shape = Shape.Frag;
      p.active = true;
    }
  }

  /** A short, fat, fading bar — the "impact plate" under a kill. */
  plate(x: number, y: number, ang: number, col: RGB, len: number) {
    const p = this.take();
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.rot = ang;
    p.maxLife = 0.2;
    p.life = 0.2;
    p.size = len;
    p.width = 10;
    p.col = col;
    p.shape = Shape.Bar;
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
      if (p.shape === Shape.Ring || p.shape === Shape.Bar) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.rot += p.vrot * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;

      switch (p.shape) {
        case Shape.Ring: {
          const g = 1 - t;
          const r = p.size + (p.grow - p.size) * (1 - (1 - g) * (1 - g));
          ctx.strokeStyle = rgba(p.col, t * t * 0.95);
          ctx.lineWidth = Math.max(0.4, p.width * t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case Shape.Bar: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = rgba(p.col, t * 0.7);
          const h = p.width * t;
          ctx.fillRect(-p.size * 0.5, -h * 0.5, p.size, h);
          ctx.restore();
          break;
        }
        case Shape.Frag: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = rgba(p.col, t * 0.9);
          const th = Math.max(0.8, p.width * t);
          ctx.fillRect(-p.size * 0.5, -th * 0.5, p.size, th);
          ctx.restore();
          break;
        }
        case Shape.Streak: {
          const sp = Math.hypot(p.vx, p.vy);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = rgba(p.col, t);
          const len = Math.min(54, 3 + sp * 0.028);
          ctx.fillRect(-len * 0.5, -p.size * 0.18, len, p.size * 0.36);
          ctx.restore();
          break;
        }
        default: {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = rgba(p.col, t);
          const s = p.size * (0.4 + t * 0.6);
          ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
          ctx.restore();
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  }
}
