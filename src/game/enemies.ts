import { PLAYER_R } from '../config';
import { TAU, angleDelta, clamp, randRange, type Rng } from '../engine/math';
import { WARDEN_DEF, theme, wardenPlates, wardenSpin } from '../sectors';
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

export type EnemyKind =
  | 'mote' | 'seeder' | 'ward' | 'lancer' | 'spine' | 'bulwark' | 'choir' | 'warden';

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
  bulwark: {
    kind: 'bulwark',
    name: 'BULWARK',
    rule: 'Its armour turns on its own. The gap is the shot.',
    r: 30,
    speed: 34,
    score: 350,
  },
  choir: {
    kind: 'choir',
    name: 'CHOIR',
    rule: 'Three bodies, one mind. They only line up for a moment.',
    r: 11,
    speed: 42,
    score: 120,
  },
  warden: {
    kind: 'warden',
    name: 'WARDEN',
    rule: 'Every plate breaks in one hit. So does the thing inside.',
    r: 56,
    speed: 26,
    score: 2000,
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
    // The armour band itself: a C of plate, outer face and inner face, with the
    // bite at +X. The only concave outline in the game, and it has to be — the
    // shatter breaks a dead bulwark into curved slabs of wall, which is what it
    // was, and a convex stand-in would shatter into pieces of something else.
    case 'bulwark': {
      const pts: [number, number][] = [];
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = BULWARK_GAP + (i / n) * (TAU - BULWARK_GAP * 2);
        pts.push([Math.cos(a) * r * 1.04, Math.sin(a) * r * 1.04]);
      }
      for (let i = n; i >= 0; i--) {
        const a = BULWARK_GAP + (i / n) * (TAU - BULWARK_GAP * 2);
        pts.push([Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6]);
      }
      return pts;
    }
    // The warden's shatter shape: a heavier arc of wall than the bulwark's,
    // because what dies at the end is the core and its last ring together.
    // (Individual plate breaks shatter a single-plate arc built at the kill
    // site, not this.)
    case 'warden': {
      const pts: [number, number][] = [];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const a = 0.4 + (i / n) * (TAU - 0.8);
        pts.push([Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02]);
      }
      for (let i = n; i >= 0; i--) {
        const a = 0.4 + (i / n) * (TAU - 0.8);
        pts.push([Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5]);
      }
      return pts;
    }
    // A bell. Small, rounded crown, flared mouth — an object that sings, at a
    // size where anything more detailed would collapse into a blob. The flare
    // matters: straight sides make a gem, and a gem reads as a pickup.
    case 'choir':
      return [
        [0, -r * 1.1], [r * 0.42, -r * 0.82], [r * 0.52, -r * 0.1], [r * 0.66, r * 0.62],
        [r * 0.94, r * 0.94], [r * 0.5, r * 1.02], [0, r * 1.06], [-r * 0.5, r * 1.02],
        [-r * 0.94, r * 0.94], [-r * 0.66, r * 0.62], [-r * 0.52, -r * 0.1], [-r * 0.42, -r * 0.82],
      ];
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

/**
 * Half-width of the bulwark's opening. Wider than it looks like it should be:
 * the fair version of a moving keyhole errs toward the key.
 */
export const BULWARK_GAP = 0.62;
/** How fast the armour turns. Constant, and never toward you — that is the ward. */
const BULWARK_SPIN = 0.8;

/** Orbit radius and angular rate of a choir trio. */
export const CHOIR_R = 54;
const CHOIR_RATE = 1.45;

/**
 * The warden's ring lives in the five scalars every enemy already has:
 * `state` is the armour bitmask, `shield` the ring angle, `spin` the signed
 * rate, `timer` the orb/charge cadence, `markX/markY` the charge vector. Not
 * one field was added for it, which is the entire scope discipline of the
 * boss in a sentence. The one non-plate bit:
 */
const W_CHARGING = 1 << 28;
/** One-shot phase markers, so a reversal fires exactly once per threshold. */
const W_P2 = 1 << 29;
const W_P3 = 1 << 30;
/** Everything below the flag bits is plate state. */
const W_PLATES = (1 << 24) - 1;
const WARDEN_ORB_PERIOD = 1.2;
const WARDEN_REST = 1.5;
const WARDEN_CHARGE_TIME = 0.66;
const WARDEN_CHARGE_SPEED = 920;
/**
 * How much each broken plate grows the ring rate. Growth only — the first
 * draft also flipped the sign per break, which boomeranged every fresh hole
 * straight back to the angle it was made from and let a fixed-position player
 * kill the boss in three strikes. Reversals are phase events now: they happen
 * twice, at the ⅔ and ⅓ thresholds, where a surprise is an act break instead
 * of a metronome.
 */
const WARDEN_RAGE = 1.13;
const WARDEN_SPIN_CAP = 2.2;

const popcount = (v: number) => {
  let n = 0;
  for (let b = v & W_PLATES; b; b &= b - 1) n++;
  return n;
};

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

  private alloc(kind: EnemyKind, x: number, y: number, rng: Rng, telegraph: number, speedMul: number) {
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

  spawn(kind: EnemyKind, x: number, y: number, rng: Rng, telegraph: number, speedMul: number) {
    const e = this.alloc(kind, x, y, rng, telegraph, speedMul);

    // A bulwark's armour turns at a constant rate, never toward you — that is
    // the ward's move, and the two must not blur. Direction is rolled once.
    if (kind === 'bulwark') e.spin = rng() < 0.5 ? -BULWARK_SPIN : BULWARK_SPIN;

    // The warden arrives wearing its sector's ring. Same override pattern as
    // `speedMul`: the base is a table lookup, so the sector multiplying it
    // costs nothing and lives in data.
    if (kind === 'warden') {
      e.r = WARDEN_DEF[theme.id].r;
      e.spin = wardenSpin();
      e.state = (1 << wardenPlates()) - 1;
      e.timer = 2;
    }

    // A choir is one spawn that is three bodies. The trio shares an orbit
    // centre carried in `markX/markY` — free on non-lancers — and each body
    // knows only its index; everything else about the formation is derived
    // identically by all three, which is what keeps them one organism without
    // any of them holding a pointer to another.
    if (kind === 'choir') {
      e.markX = x;
      e.markY = y;
      for (let i = 1; i < 3; i++) {
        const s = this.alloc('choir', x, y, rng, telegraph, speedMul);
        s.state = i;
        s.markX = x;
        s.markY = y;
        s.seed = e.seed;
        const ph = i * (TAU / 3);
        s.x = x + Math.cos(ph) * CHOIR_R;
        s.y = y + Math.sin(ph) * CHOIR_R;
      }
      e.x = x + CHOIR_R;
    }

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

        case 'bulwark': {
          // Slow advance, indifferent armour. The gap's angle is `shield`, and
          // it turns at the constant rate set at spawn: the whole species is
          // the difference between a wall that reacts to you and a wall that
          // simply has a schedule. You cannot outflank a schedule; you read it.
          e.vx += (nx * spd - e.vx) * (1 - Math.exp(-1.4 * dt));
          e.vy += (ny * spd - e.vy) * (1 - Math.exp(-1.4 * dt));
          e.shield += e.spin * dt;
          e.rot = e.shield;
          break;
        }

        case 'warden': {
          // Phases fall out of how much armour is left — no phase machine,
          // just popcount read against the plate total the ring started with.
          const total = wardenPlates();
          const left = popcount(e.state);
          const p3 = left <= total / 3;
          const p2 = left <= (total * 2) / 3;

          // The act breaks: entering each phase reverses the ring once, and
          // hard. A reversal is the one thing a player tracking the schedule
          // cannot extrapolate, so it is rationed to the two moments the fight
          // is supposed to escalate.
          if (p2 && !(e.state & W_P2)) {
            e.state |= W_P2;
            e.spin = clamp(-e.spin * 1.22, -WARDEN_SPIN_CAP, WARDEN_SPIN_CAP);
          }
          if (p3 && !(e.state & W_P3)) {
            e.state |= W_P3;
            e.spin = clamp(-e.spin * 1.18, -WARDEN_SPIN_CAP, WARDEN_SPIN_CAP);
          }

          e.shield += e.spin * dt;
          e.rot = e.shield;
          e.timer -= dt;

          if (p3) {
            // Endgame: the ring is mostly holes, so it stops relying on the
            // wall and starts using the lancer's answer — mark and charge.
            if (e.state & W_CHARGING) {
              e.vx *= Math.exp(-1.3 * dt);
              e.vy *= Math.exp(-1.3 * dt);
              if (e.timer <= 0) {
                e.state &= ~W_CHARGING;
                e.timer = WARDEN_REST;
              }
            } else {
              e.vx += (nx * spd * 0.6 - e.vx) * (1 - Math.exp(-1.4 * dt));
              e.vy += (ny * spd * 0.6 - e.vy) * (1 - Math.exp(-1.4 * dt));
              e.markX = nx;
              e.markY = ny;
              if (e.timer <= 0) {
                e.state |= W_CHARGING;
                e.timer = WARDEN_CHARGE_TIME;
                e.vx = e.markX * WARDEN_CHARGE_SPEED;
                e.vy = e.markY * WARDEN_CHARGE_SPEED;
                this.lancerCharges++;
              }
            }
          } else {
            e.vx += (nx * spd - e.vx) * (1 - Math.exp(-1.6 * dt));
            e.vy += (ny * spd - e.vy) * (1 - Math.exp(-1.6 * dt));
            if (p2 && e.timer <= 0) {
              // The holes shoot. Every dead plate is both the way in and a
              // muzzle, which is the whole fight stated as one fact.
              const total2 = total;
              const dead: number[] = [];
              for (let i = 0; i < total2; i++) if (!(e.state & (1 << i))) dead.push(i);
              if (dead.length) {
                const slice = TAU / total2;
                const a = e.shield + (dead[(Math.abs(e.seed * 997 + e.age * 13) | 0) % dead.length] + 0.5) * slice;
                this.fireOrb(
                  e.x + Math.cos(a) * e.r * 0.9,
                  e.y + Math.sin(a) * e.r * 0.9,
                  Math.cos(a),
                  Math.sin(a),
                );
              }
              e.timer = WARDEN_ORB_PERIOD;
            } else if (!p2 && e.timer <= 0) {
              e.timer = WARDEN_ORB_PERIOD;
            }
          }
          break;
        }

        case 'choir': {
          // The trio's shared centre drifts toward you; each body carries its
          // own copy and advances it with identical arithmetic, so the copies
          // can never disagree. Clamped so the orbit itself cannot press a
          // body into a wall.
          const cdx = this.targetX - e.markX;
          const cdy = this.targetY - e.markY;
          const cd = Math.hypot(cdx, cdy) || 1;
          const m = CHOIR_R + e.r + 10;
          e.markX = clamp(e.markX + (cdx / cd) * spd * dt, m, W - m);
          e.markY = clamp(e.markY + (cdy / cd) * spd * dt, m, H - m);
          const ph = e.state * (TAU / 3) + e.age * CHOIR_RATE + e.seed;
          const px = e.markX + Math.cos(ph) * CHOIR_R;
          const py = e.markY + Math.sin(ph) * CHOIR_R;
          // Velocity is set so the shared integration below lands exactly on
          // the orbit point — the body still *has* a velocity, which is what
          // keeps the drift lean and the shatter direction honest.
          e.vx = (px - e.x) / Math.max(dt, 1e-4);
          e.vy = (py - e.y) / Math.max(dt, 1e-4);
          e.rot = ph + Math.PI * 0.5;
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
    if (e.kind === 'ward') {
      const a = Math.atan2(fromY - e.y, fromX - e.x);
      return Math.abs(angleDelta(e.shield, a)) <= WARD_ARC;
    }
    // The bulwark is the ward inverted: armoured everywhere *except* an arc,
    // and the arc belongs to a schedule rather than to you. Same pure function
    // of (enemy, point), same single caller, same guarantee that the preview
    // and the strike cannot disagree about it.
    if (e.kind === 'bulwark') {
      const a = Math.atan2(fromY - e.y, fromX - e.x);
      return Math.abs(angleDelta(e.shield, a)) > BULWARK_GAP;
    }
    // The warden blocks wherever a plate still stands. Same function shape a
    // third time; the exposed angles are the plates the player has already
    // broken, carried around by the turning ring.
    if (e.kind === 'warden') {
      const i = Swarm.plateAt(e, fromX, fromY);
      return (e.state & (1 << i)) !== 0;
    }
    return false;
  }

  /** Which armour plate a contact point lands on. Shared by block test and break. */
  static plateAt(e: Enemy, x: number, y: number) {
    const total = wardenPlates();
    const a = Math.atan2(y - e.y, x - e.x);
    let rel = (a - e.shield) % TAU;
    if (rel < 0) rel += TAU;
    return Math.min(total - 1, Math.floor((rel / TAU) * total));
  }

  /** Live plates on a warden, for the HUD pips and the phase logic. */
  static platesLeft(e: Enemy) {
    return popcount(e.state);
  }

  /**
   * How far into its charge telegraph a warden is, 0..1 — 0 when it is not
   * telegraphing at all. Exists so the renderer can share the lancer's mark
   * pass without learning the warden's flag bits: `state` holds an armour
   * bitmask here, and the one place that knows the bit layout should stay the
   * one place.
   */
  static wardenMark(e: Enemy) {
    if (e.kind !== 'warden' || e.state & W_CHARGING) return 0;
    const total = wardenPlates();
    if (popcount(e.state) > total / 3) return 0;
    return clamp(1 - e.timer / 0.5, 0, 1);
  }

  /**
   * Break one plate. True if it was standing. Every break flips the ring and
   * turns it a little faster — killing armour makes the thing more dangerous,
   * which is the only way a fight against a schedule stays a fight instead of
   * becoming a metronome the player waits out.
   */
  static breakPlate(e: Enemy, i: number) {
    const bit = 1 << i;
    if (!(e.state & bit)) return false;
    e.state &= ~bit;
    e.spin = clamp(e.spin * WARDEN_RAGE, -WARDEN_SPIN_CAP, WARDEN_SPIN_CAP);
    // The ring answers: it lurches a plate and a half along its own direction,
    // slamming fresh armour over the wound. Without this the fight is two
    // strikes long — break a plate, then put a second strike through the hole
    // before the ring has moved it. With it, the hole you made is never where
    // you made it, and the fight becomes what it was designed to be: reading a
    // turning schedule for the moment a gap you paid for comes back around.
    const slice = TAU / wardenPlates();
    e.shield += slice * 1.6 * (e.spin >= 0 ? 1 : -1);
    return true;
  }

  /** Body radius as it should be tested against the player. */
  static hitR(e: Enemy) {
    return e.r + PLAYER_R * 0.72;
  }
}
