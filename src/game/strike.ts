import {
  PLAYER_R,
  STRIKE_RANGE,
  STRIKE_RANGE_MAX,
  STRIKE_RANGE_PER_KILL,
} from '../config';
import { view } from '../viewport';
import { ORB_R, Swarm, type Enemy, type Orb } from './enemies';

/**
 * The strike solver.
 *
 * One function decides what a strike does, and it is run twice: once every
 * frame while aiming, to draw the preview, and once on release, to commit. Two
 * separate implementations would eventually disagree, and the moment a player
 * is shown three kills and dealt two is the moment they stop trusting the aim
 * line — which is the only thing this game asks them to trust.
 */

export interface StrikeHit {
  /** Exactly one of these is set. */
  enemy: Enemy | null;
  orb: Orb | null;
  /** Distance along the ray at which contact happens. */
  d: number;
  x: number;
  y: number;
  /** A ward shield: this one stops the strike instead of dying to it. */
  blocked: boolean;
}

export interface StrikePlan {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  /** Distance actually travelled. */
  dist: number;
  /** Distance the strike *could* have reached, for drawing the spent tail. */
  reach: number;
  hits: StrikeHit[];
  kills: number;
  blocked: boolean;
  hitWall: boolean;
}

/** Reused between frames — the aim preview runs this every single frame. */
const plan: StrikePlan = {
  x0: 0, y0: 0, dx: 1, dy: 0, dist: 0, reach: 0,
  hits: [], kills: 0, blocked: false, hitWall: false,
};

interface Candidate {
  enemy: Enemy | null;
  orb: Orb | null;
  d: number;
}
const candidates: Candidate[] = [];
let candCount = 0;

function pushCandidate(enemy: Enemy | null, orb: Orb | null, d: number) {
  if (candCount === candidates.length) candidates.push({ enemy: null, orb: null, d: 0 });
  const c = candidates[candCount++];
  c.enemy = enemy;
  c.orb = orb;
  c.d = d;
}

/**
 * Distance along a unit ray at which it first touches a circle, or -1.
 * Returns 0 when the origin is already inside — striking out of a body you are
 * standing in should still shred it.
 */
function rayCircle(
  ox: number, oy: number, dx: number, dy: number,
  cx: number, cy: number, r: number,
): number {
  const mx = cx - ox;
  const my = cy - oy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - r * r;
  if (c <= 0) return 0;
  if (b <= 0) return -1; // circle is behind
  const disc = b * b - c;
  if (disc < 0) return -1;
  return b - Math.sqrt(disc);
}

/** How far the centre can travel before it leaves the arena. */
function wallDistance(ox: number, oy: number, dx: number, dy: number) {
  const lo = PLAYER_R;
  let best = STRIKE_RANGE_MAX;
  if (dx > 1e-6) best = Math.min(best, (view.arenaW - lo - ox) / dx);
  else if (dx < -1e-6) best = Math.min(best, (lo - ox) / dx);
  if (dy > 1e-6) best = Math.min(best, (view.arenaH - lo - oy) / dy);
  else if (dy < -1e-6) best = Math.min(best, (lo - oy) / dy);
  return Math.max(0, best);
}

export function solveStrike(
  swarm: Swarm,
  x0: number,
  y0: number,
  angle: number,
  rangeBonus = 0,
): StrikePlan {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  plan.x0 = x0;
  plan.y0 = y0;
  plan.dx = dx;
  plan.dy = dy;
  plan.hits.length = 0;
  plan.kills = 0;
  plan.blocked = false;
  plan.hitWall = false;
  candCount = 0;

  for (const e of swarm.list) {
    if (!e.alive || e.spawn > 0) continue;
    const d = rayCircle(x0, y0, dx, dy, e.x, e.y, Swarm.hitR(e));
    if (d >= 0 && d <= STRIKE_RANGE_MAX) pushCandidate(e, null, d);
  }
  for (const o of swarm.orbs) {
    if (!o.alive) continue;
    const d = rayCircle(x0, y0, dx, dy, o.x, o.y, ORB_R + PLAYER_R * 0.7);
    if (d >= 0 && d <= STRIKE_RANGE_MAX) pushCandidate(null, o, d);
  }

  // Insertion sort: candCount is tiny (only bodies the ray actually touches)
  // and it beats allocating a sorted array sixty times a second.
  for (let i = 1; i < candCount; i++) {
    const c = candidates[i];
    let j = i - 1;
    while (j >= 0 && candidates[j].d > c.d) {
      candidates[j + 1] = candidates[j];
      j--;
    }
    candidates[j + 1] = c;
  }

  const wall = wallDistance(x0, y0, dx, dy);
  let range = Math.min(STRIKE_RANGE + rangeBonus, STRIKE_RANGE_MAX);
  let dist = Math.min(range, wall);

  for (let i = 0; i < candCount; i++) {
    const c = candidates[i];
    if (c.d > range) break;

    const cx = x0 + dx * c.d;
    const cy = y0 + dy * c.d;

    if (c.enemy && Swarm.blocks(c.enemy, cx, cy)) {
      plan.hits.push({ enemy: c.enemy, orb: null, d: c.d, x: cx, y: cy, blocked: true });
      plan.blocked = true;
      dist = Math.max(0, c.d - 2);
      break;
    }

    plan.hits.push({ enemy: c.enemy, orb: c.orb, d: c.d, x: cx, y: cy, blocked: false });
    plan.kills++;
    range = Math.min(range + STRIKE_RANGE_PER_KILL, STRIKE_RANGE_MAX);
    dist = Math.min(range, wall);
  }

  if (!plan.blocked && dist >= wall - 0.01) plan.hitWall = true;

  plan.reach = range;
  plan.dist = dist;
  return plan;
}

/** A stable copy, because the shared plan is overwritten on the next frame. */
export function clonePlan(p: StrikePlan): StrikePlan {
  return {
    x0: p.x0, y0: p.y0, dx: p.dx, dy: p.dy,
    dist: p.dist, reach: p.reach,
    hits: p.hits.map((h) => ({ ...h })),
    kills: p.kills, blocked: p.blocked, hitWall: p.hitWall,
  };
}
