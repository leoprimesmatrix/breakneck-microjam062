import { PLAYER_R } from '../config';
import { TAU, angleDelta, clamp, randRange, type Rng } from '../engine/math';
import { view } from '../viewport';
import { terrain } from './terrain';

/**
 * Enemies.
 *
 * Every type obeys one rule the player learns in the first ten seconds —
 * *anything on your line dies* — and exactly one type bends it: the WARD, whose
 * shield turns to face you, so it has to be flanked. Keeping the exception
 * singular is deliberate. A game is confusing when it has five rules; it is
 * deep when it has one rule and one exception.
 */

export type EnemyKind = 'mote' | 'seeder' | 'ward' | 'lancer' | 'spine';

export interface EnemySpec {
  kind: EnemyKind;
  name: string;
  /** One line, shown once, the first time this type ever appears. */
  rule: string;
  r: number;
  speed: number;
  score: number;
}

export const SPECS: Record<EnemyKind, EnemySpec> = {
  mote: {
    kind: 'mote',
    name: 'MOTE',
    rule: 'Drifts toward you. Anything on your line dies.',
    r: 14,
    speed: 74,
    score: 100,
  },
  seeder: {
    kind: 'seeder',
    name: 'SEEDER',
    rule: 'Bursts into three Motes when it dies.',
    r: 23,
    speed: 46,
    score: 150,
  },
  ward: {
    kind: 'ward',
    name: 'WARD',
    rule: 'Its shield turns to face you. Strike the flank.',
    r: 22,
    speed: 58,
    score: 250,
  },
  lancer: {
    kind: 'lancer',
    name: 'LANCER',
    rule: 'Marks a line, then charges down it. Get off the line.',
    r: 18,
    speed: 60,
    score: 200,
  },
  spine: {
    kind: 'spine',
    name: 'SPINE',
    rule: 'Rooted gun. Its orbs sit on your line like anything else.',
    r: 26,
    speed: 0,
    score: 300,
  },
};

/**
 * The body outline of each species, unrotated, in its own local space.
 *
 * One source of truth shared by the renderer (which strokes and lights it) and
 * the death effect (which breaks it apart edge by edge). If these diverged, an
 * enemy would visibly shatter into pieces of a shape it never was.
 *
 * None of these are regular polygons, and that is the point. A perfect diamond,
 * a perfect square and a perfect twelve-point star are what a shape generator
 * reaches for; they read as placeholder because every vertex is where the
 * formula put it rather than where a designer did. Each outline below is
 * asymmetric or chamfered in a way that states what the thing is — a chipped
 * ember, a sealed pod, an armoured prow, a swept interceptor, a bolted gun
 * housing — and the shatter inherits all of it for free.
 */
/**
 * Silhouette is the whole identity, and identity means *a thing you have seen
 * before*.
 *
 * Two rewrites of these went by before the real problem surfaced. The first set
 * were five convex lumps in five colours; the second set fixed the aspect ratios
 * and hung fittings off them, which was necessary but not sufficient, because
 * the shapes still did not depict anything. "Burning shrapnel", "a pod in a
 * cradle", "an armoured prow" are descriptions of a *mood*, and a mood has no
 * outline. Asked what any of them was, a player could only answer "a small
 * object", which is exactly what they said.
 *
 * So every one of these is now a real object that a person can name on sight,
 * chosen so that its everyday meaning happens to be its game rule:
 *
 *  - MOTE   — a **naval mine**. Round body, blunt horns, one fuze eye. Everyone
 *             on earth knows a mine drifts at you and kills you if you touch it,
 *             which is the entire behaviour, learned for free.
 *  - SEEDER — a **brood pod**, split-seamed, with three mines visibly loaded
 *             inside it. You can see what it will spill before it spills it.
 *  - WARD   — a **shield bearer**: one big eye behind a plated barricade held
 *             out on struts, with daylight between the two.
 *  - LANCER — a **missile**: long nose, two swept deltas, an engine. It points.
 *  - SPINE  — a **turret**: a drum bolted to the floor with one heavy barrel.
 *
 * A cue the previous drafts had backwards, worth stating once: the horns, the
 * spikes and the wing tips must stay *short relative to the body*. Long even
 * spikes make a star, and a star reads as something you collect.
 */
export function silhouette(kind: EnemyKind, r: number): [number, number][] {
  switch (kind) {
    // A mine: a round body carrying six horns. Two proportions decide whether
    // this reads as a mine or as a star, and neither is obvious. The horns have
    // to be **narrow** — a wide-based spike is a star point — and the core has to
    // stay **round**, which needs a vertex in the middle of every gap, or six
    // chords turn it into a hexagon and the horns become its corners.
    case 'mote': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        pts.push([Math.cos(a - 0.17) * r * 0.62, Math.sin(a - 0.17) * r * 0.62]);
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        pts.push([Math.cos(a + 0.17) * r * 0.62, Math.sin(a + 0.17) * r * 0.62]);
        pts.push([Math.cos(a + 0.52) * r * 0.67, Math.sin(a + 0.52) * r * 0.67]);
      }
      return pts;
    }
    // A tall sealed ovoid — the only shape here noticeably taller than it is wide,
    // and the only one with no straight edge at all. It is an egg, and it should
    // be read as an egg before any of the detail resolves.
    case 'seeder':
      return [
        [0, -r * 1.12], [r * 0.52, -r * 0.86], [r * 0.72, -r * 0.24], [r * 0.66, r * 0.42],
        [r * 0.34, r * 0.98], [0, r * 1.16], [-r * 0.34, r * 0.98], [-r * 0.66, r * 0.42],
        [-r * 0.72, -r * 0.24], [-r * 0.52, -r * 0.86],
      ];
    // Compact and rounded on purpose: a head, not a hull. The ward's silhouette
    // is mostly *shield*, and the body has to be visibly smaller than the slab it
    // hides behind or the read — something cowering behind a wall — collapses.
    case 'ward':
      return [
        [r * 0.84, -r * 0.26], [r * 0.5, -r * 0.72], [-r * 0.14, -r * 0.86],
        [-r * 0.72, -r * 0.5], [-r * 0.86, r * 0.12], [-r * 0.5, r * 0.7],
        [r * 0.14, r * 0.84], [r * 0.72, r * 0.44],
      ];
    // A missile. Long nose, two big swept deltas, a blunt tail — and nothing
    // else. The previous draft had canards, tail fins and seventeen vertices, and
    // at forty pixels all seventeen collapsed into one blob with flaps; the read
    // came back the moment the small features were deleted rather than tuned.
    case 'lancer':
      return [
        [r * 1.75, 0], [r * 0.7, -r * 0.28], [r * 0.05, -r * 0.36],
        [-r * 0.7, -r * 1.06], [-r * 1.08, -r * 0.92], [-r * 0.58, -r * 0.34],
        [-r * 1.1, -r * 0.24], [-r * 1.1, r * 0.24], [-r * 0.58, r * 0.34],
        [-r * 1.08, r * 0.92], [-r * 0.7, r * 1.06], [r * 0.05, r * 0.36],
        [r * 0.7, r * 0.28],
      ];
    // A wide, squat drum: heavy, flat-sided, and shorter than it is broad. It is
    // the only body that reads as *installed* rather than as flying, which is the
    // whole point of the species.
    case 'spine': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8;
        pts.push([Math.cos(a) * r * 1.08, Math.sin(a) * r * 0.84]);
      }
      return pts;
    }
  }
}

/** Half-width of a ward's shield arc, radians. */
export const WARD_ARC = 1.16;
/** How fast that shield can swing toward you. Slower than you can flank. */
const WARD_TURN = 1.95;

export const LANCER_MARK = 1.05;
const LANCER_CHARGE_SPEED = 1180;
export const LANCER_CHARGE_TIME = 0.62;
const LANCER_REST = 1.5;

export const SPINE_PERIOD = 2.3;
const ORB_SPEED = 205;
export const ORB_R = 10;

export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alive: boolean;
  /** Counts down while the spawn ring is still growing; not solid until 0. */
  spawn: number;
  age: number;
  seed: number;
  /** Body rotation, purely cosmetic for most types. */
  rot: number;
  spin: number;
  /** WARD: the direction its shield currently faces. */
  shield: number;
  /** LANCER: 0 resting, 1 marking, 2 charging. */
  state: number;
  timer: number;
  /** LANCER: the marked line, unit vector. */
  markX: number;
  markY: number;
  /** Flash on near-miss / spawn, purely cosmetic. */
  flash: number;
  speedMul: number;
}

export interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  age: number;
  life: number;
}

function blank(): Enemy {
  return {
    kind: 'mote',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 14,
    alive: false,
    spawn: 0,
    age: 0,
    seed: 0,
    rot: 0,
    spin: 0,
    shield: 0,
    state: 0,
    timer: 0,
    markX: 1,
    markY: 0,
    flash: 0,
    speedMul: 1,
  };
}

export class Swarm {
  readonly list: Enemy[] = [];
  readonly orbs: Orb[] = [];

  /** Set by the game each step so behaviours can chase without a back-pointer. */
  targetX = 0;
  targetY = 0;

  /** Filled during `update` so the game can react to what happened. */
  firedOrbs = 0;
  lancerMarks = 0;
  lancerCharges = 0;

  reset() {
    this.list.length = 0;
    this.orbs.length = 0;
  }

  get liveCount() {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  spawn(kind: EnemyKind, x: number, y: number, rng: Rng, telegraph: number, speedMul: number) {
    const spec = SPECS[kind];
    const e = this.list.find((o) => !o.alive) ?? (this.list.push(blank()), this.list[this.list.length - 1]);
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.r = spec.r;
    e.alive = true;
    e.spawn = telegraph;
    e.age = 0;
    e.seed = rng() * TAU;
    e.rot = rng() * TAU;
    e.spin = randRange(rng, -1.4, 1.4);
    e.shield = rng() * TAU;
    e.state = 0;
    e.timer = randRange(rng, 0.4, 1.6);
    e.markX = 1;
    e.markY = 0;
    e.flash = 0;
    e.speedMul = speedMul;
    return e;
  }

  /** Three motes flung outward — the seeder's parting gift. */
  burst(e: Enemy, rng: Rng) {
    const base = rng() * TAU;
    for (let i = 0; i < 3; i++) {
      const a = base + (i / 3) * TAU;
      const child = this.spawn(
        'mote',
        e.x + Math.cos(a) * 26,
        e.y + Math.sin(a) * 26,
        rng,
        0,
        e.speedMul,
      );
      const s = randRange(rng, 240, 340);
      child.vx = Math.cos(a) * s;
      child.vy = Math.sin(a) * s;
      // Brief grace so a burst can never kill you the instant you earned it.
      child.spawn = 0.28;
    }
  }

  fireOrb(x: number, y: number, dirX: number, dirY: number) {
    const o = this.orbs.find((p) => !p.alive) ?? (this.orbs.push({
      x: 0, y: 0, vx: 0, vy: 0, alive: false, age: 0, life: 0,
    }), this.orbs[this.orbs.length - 1]);
    o.x = x;
    o.y = y;
    o.vx = dirX * ORB_SPEED;
    o.vy = dirY * ORB_SPEED;
    o.alive = true;
    o.age = 0;
    o.life = 9;
    this.firedOrbs++;
  }

  // ------------------------------------------------------------------ tick
  update(dt: number) {
    const W = view.arenaW;
    const H = view.arenaH;

    for (const e of this.list) {
      if (!e.alive) continue;
      e.age += dt;
      e.flash *= Math.exp(-9 * dt);

      if (e.spawn > 0) {
        e.spawn -= dt;
        // Materialising enemies still drift, so a wave never appears static.
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.vx *= Math.exp(-3 * dt);
        e.vy *= Math.exp(-3 * dt);
        e.rot += e.spin * dt;
        continue;
      }

      const dx = this.targetX - e.x;
      const dy = this.targetY - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      const spd = SPECS[e.kind].speed * e.speedMul;

      switch (e.kind) {
        case 'mote': {
          // A sine offset perpendicular to the approach: the swarm reads as
          // alive rather than as a crowd of homing missiles, and it makes lines
          // through three of them a genuinely timed shot.
          const wob = Math.sin(e.age * 2.4 + e.seed) * 0.42;
          const ax = nx - ny * wob;
          const ay = ny + nx * wob;
          e.vx += (ax * spd - e.vx) * (1 - Math.exp(-2.6 * dt));
          e.vy += (ay * spd - e.vy) * (1 - Math.exp(-2.6 * dt));
          e.rot += e.spin * dt;
          break;
        }

        case 'seeder': {
          e.vx += (nx * spd - e.vx) * (1 - Math.exp(-1.6 * dt));
          e.vy += (ny * spd - e.vy) * (1 - Math.exp(-1.6 * dt));
          e.rot += 0.7 * dt;
          break;
        }

        case 'ward': {
          // Keeps its distance a little: it wants you to come to the shield.
          const want = d < 210 ? -0.5 : 1;
          e.vx += (nx * spd * want - e.vx) * (1 - Math.exp(-2 * dt));
          e.vy += (ny * spd * want - e.vy) * (1 - Math.exp(-2 * dt));
          const to = Math.atan2(dy, dx);
          const turn = WARD_TURN * dt;
          const delta = angleDelta(e.shield, to);
          e.shield += clamp(delta, -turn, turn);
          e.rot += e.spin * 0.3 * dt;
          break;
        }

        case 'lancer': {
          e.timer -= dt;
          if (e.state === 0) {
            e.vx += (nx * spd - e.vx) * (1 - Math.exp(-1.4 * dt));
            e.vy += (ny * spd - e.vy) * (1 - Math.exp(-1.4 * dt));
            e.rot = Math.atan2(e.vy, e.vx);
            if (e.timer <= 0) {
              e.state = 1;
              e.timer = LANCER_MARK;
              this.lancerMarks++;
            }
          } else if (e.state === 1) {
            // Bleed off speed while marking, and keep re-aiming for the first
            // half so a standing target cannot be dodged by simply waiting.
            e.vx *= Math.exp(-5 * dt);
            e.vy *= Math.exp(-5 * dt);
            if (e.timer > LANCER_MARK * 0.42) {
              e.markX = nx;
              e.markY = ny;
              e.rot = Math.atan2(ny, nx);
            }
            if (e.timer <= 0) {
              e.state = 2;
              e.timer = LANCER_CHARGE_TIME;
              e.vx = e.markX * LANCER_CHARGE_SPEED;
              e.vy = e.markY * LANCER_CHARGE_SPEED;
              this.lancerCharges++;
            }
          } else {
            e.vx *= Math.exp(-1.1 * dt);
            e.vy *= Math.exp(-1.1 * dt);
            e.rot = Math.atan2(e.vy, e.vx);
            if (e.timer <= 0) {
              e.state = 0;
              e.timer = LANCER_REST;
            }
          }
          break;
        }

        case 'spine': {
          e.rot += 0.55 * dt;
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = SPINE_PERIOD;
            this.fireOrb(e.x, e.y, nx, ny);
          }
          break;
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Walls. Chargers bounce (which is what makes them a hazard for two full
      // seconds instead of one); everything else is simply pushed back inside.
      const m = e.r;
      if (e.x < m) {
        e.x = m;
        e.vx = e.kind === 'lancer' && e.state === 2 ? Math.abs(e.vx) : 0;
      } else if (e.x > W - m) {
        e.x = W - m;
        e.vx = e.kind === 'lancer' && e.state === 2 ? -Math.abs(e.vx) : 0;
      }
      if (e.y < m) {
        e.y = m;
        e.vy = e.kind === 'lancer' && e.state === 2 ? Math.abs(e.vy) : 0;
      } else if (e.y > H - m) {
        e.y = H - m;
        e.vy = e.kind === 'lancer' && e.state === 2 ? -Math.abs(e.vy) : 0;
      }

      // And the interior ones. Three lines, and they are what make the room
      // read as solid rather than as painted on: a mote that walks through a
      // pillar tells the player the pillar is scenery, one frame before they
      // find out the hard way that it is not.
      const axis = terrain.evict(e, m);
      const charging = e.kind === 'lancer' && e.state === 2;
      if (axis === 'x') e.vx = charging ? -e.vx : 0;
      else if (axis === 'y') e.vy = charging ? -e.vy : 0;
    }

    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.age += dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      // Orbs bounce once off each wall rather than dying there, so the arena
      // edge is never a safe corner to sit in.
      if (o.x < ORB_R) {
        o.x = ORB_R;
        o.vx = Math.abs(o.vx);
      } else if (o.x > W - ORB_R) {
        o.x = W - ORB_R;
        o.vx = -Math.abs(o.vx);
      }
      if (o.y < ORB_R) {
        o.y = ORB_R;
        o.vy = Math.abs(o.vy);
      } else if (o.y > H - ORB_R) {
        o.y = H - ORB_R;
        o.vy = -Math.abs(o.vy);
      }
      // Slabs absorb orbs rather than bouncing them. Cheaper, and it turns
      // every pillar into cover — which is a real gift in the spine fight, and
      // most of why terrain makes the room better to play in rather than just
      // harder to cross.
      if (terrain.contains(o.x, o.y, ORB_R)) o.alive = false;
      if (o.age > o.life) o.alive = false;
    }
  }

  /**
   * Is this contact point on the shielded side? Used identically by the aim
   * preview and by the strike itself — the player must never be shown one
   * outcome and dealt another.
   */
  static blocks(e: Enemy, fromX: number, fromY: number) {
    if (e.kind !== 'ward') return false;
    const a = Math.atan2(fromY - e.y, fromX - e.x);
    return Math.abs(angleDelta(e.shield, a)) <= WARD_ARC;
  }

  /** Body radius as it should be tested against the player. */
  static hitR(e: Enemy) {
    return e.r + PLAYER_R * 0.72;
  }
}
