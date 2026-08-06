import { SPAWN_TELEGRAPH } from '../config';
import { randRange, type Rng } from '../engine/math';
import { view } from '../viewport';
import type { EnemyKind, Swarm } from './enemies';
import { terrain } from './terrain';

/**
 * The wave director.
 *
 * Hand-authored for the first twelve waves, procedural after that. The authored
 * stretch exists purely to control the *order in which ideas arrive*: one new
 * enemy at a time, each on its own wave, each with a breather before the wave
 * that combines it with everything before it. A random generator cannot teach.
 */

export interface WaveDef {
  /** Enemies to spawn, in the order they arrive. */
  groups: { kind: EnemyKind; count: number; at: number }[];
  /** Multiplies every enemy's base speed. */
  speedMul: number;
  /** Optional name shown on the wave card. */
  title?: string;
}

const SCRIPT: WaveDef[] = [
  {
    title: 'FIRST LIGHT',
    speedMul: 0.78,
    groups: [{ kind: 'mote', count: 3, at: 0 }, { kind: 'mote', count: 2, at: 3.2 }],
  },
  {
    title: 'SWARM',
    speedMul: 0.86,
    groups: [{ kind: 'mote', count: 4, at: 0 }, { kind: 'mote', count: 4, at: 2.6 }],
  },
  {
    title: 'BLOOM',
    speedMul: 0.9,
    groups: [
      { kind: 'seeder', count: 2, at: 0 },
      { kind: 'mote', count: 3, at: 1.8 },
      { kind: 'seeder', count: 1, at: 4.4 },
    ],
  },
  {
    title: 'THE WALL',
    speedMul: 0.94,
    groups: [
      { kind: 'ward', count: 2, at: 0 },
      { kind: 'mote', count: 4, at: 2.4 },
    ],
  },
  {
    title: 'CROSSFIRE',
    speedMul: 0.98,
    groups: [
      { kind: 'mote', count: 4, at: 0 },
      { kind: 'ward', count: 2, at: 1.6 },
      { kind: 'seeder', count: 2, at: 3.8 },
    ],
  },
  {
    title: 'THE LINE',
    speedMul: 1,
    groups: [
      { kind: 'lancer', count: 2, at: 0 },
      { kind: 'mote', count: 4, at: 2.6 },
    ],
  },
  {
    title: 'PINCER',
    speedMul: 1.04,
    groups: [
      { kind: 'lancer', count: 2, at: 0 },
      { kind: 'ward', count: 2, at: 1.4 },
      { kind: 'mote', count: 5, at: 3.4 },
    ],
  },
  {
    title: 'BATTERY',
    speedMul: 1.06,
    groups: [
      { kind: 'spine', count: 2, at: 0 },
      { kind: 'mote', count: 5, at: 2.2 },
      { kind: 'seeder', count: 2, at: 4.6 },
    ],
  },
  {
    title: 'HORNETS',
    speedMul: 1.1,
    groups: [
      { kind: 'mote', count: 6, at: 0 },
      { kind: 'lancer', count: 2, at: 2.2 },
      { kind: 'spine', count: 1, at: 3.8 },
      { kind: 'ward', count: 2, at: 5.2 },
    ],
  },
  {
    title: 'GAUNTLET',
    speedMul: 1.14,
    groups: [
      { kind: 'ward', count: 3, at: 0 },
      { kind: 'seeder', count: 3, at: 2 },
      { kind: 'lancer', count: 2, at: 4 },
      { kind: 'mote', count: 6, at: 5.6 },
    ],
  },
  {
    title: 'ARTILLERY',
    speedMul: 1.18,
    groups: [
      { kind: 'spine', count: 3, at: 0 },
      { kind: 'mote', count: 6, at: 1.8 },
      { kind: 'lancer', count: 3, at: 4 },
    ],
  },
  {
    title: 'MERIDIAN',
    speedMul: 1.22,
    groups: [
      { kind: 'mote', count: 8, at: 0 },
      { kind: 'ward', count: 3, at: 2.2 },
      { kind: 'seeder', count: 3, at: 4 },
      { kind: 'lancer', count: 3, at: 5.6 },
      { kind: 'spine', count: 2, at: 7 },
    ],
  },
];

/** Names for the endless stretch, so wave 27 still gets a title card. */
const ENDLESS_TITLES = [
  'OVERRUN', 'CASCADE', 'RIPTIDE', 'FURNACE', 'BLACKOUT',
  'THRESHOLD', 'MAELSTROM', 'ZENITH', 'EVENT HORIZON', 'NO QUARTER',
];

export function waveDef(wave: number, rng: Rng): WaveDef {
  if (wave <= SCRIPT.length) return SCRIPT[wave - 1];

  // Endless: a budget spent on progressively pricier enemies, still delivered
  // in timed groups so the arena fills in waves rather than all at once.
  const over = wave - SCRIPT.length;
  const budget = 16 + over * 3.1;
  const speedMul = Math.min(1.62, 1.22 + over * 0.022);

  const menu: { kind: EnemyKind; cost: number; max: number }[] = [
    { kind: 'mote', cost: 1, max: 12 },
    { kind: 'seeder', cost: 2, max: 5 },
    { kind: 'ward', cost: 3, max: 5 },
    { kind: 'lancer', cost: 3, max: 5 },
    { kind: 'spine', cost: 4, max: 3 },
    // One choir spawn is three bodies, which the cost already prices in.
    { kind: 'bulwark', cost: 4, max: 3 },
    { kind: 'choir', cost: 3, max: 3 },
  ];

  const counts = new Map<EnemyKind, number>();
  let left = budget;
  let guard = 0;
  while (left > 0 && guard++ < 80) {
    const pick = menu[Math.floor(rng() * menu.length)];
    const have = counts.get(pick.kind) ?? 0;
    if (have >= pick.max || pick.cost > left) continue;
    counts.set(pick.kind, have + 1);
    left -= pick.cost;
  }
  if (!counts.size) counts.set('mote', 6);

  const groups: WaveDef['groups'] = [];
  let at = 0;
  for (const [kind, count] of counts) {
    // Split anything numerous into two arrivals; a single dump of twelve motes
    // is a wall, two arrivals of six is a fight.
    if (count > 5) {
      groups.push({ kind, count: Math.ceil(count / 2), at });
      groups.push({ kind, count: Math.floor(count / 2), at: at + 2.4 });
    } else {
      groups.push({ kind, count, at });
    }
    at += 1.9;
  }

  return {
    groups,
    speedMul,
    title: ENDLESS_TITLES[(over - 1) % ENDLESS_TITLES.length],
  };
}

interface Pending {
  kind: EnemyKind;
  at: number;
}

/** Runs one wave: holds the spawn queue and reports when the field is clear. */
export class Director {
  wave = 0;
  private queue: Pending[] = [];
  private clock = 0;
  speedMul = 1;
  title = '';
  /** Total enemies this wave will ever produce, for the progress readout. */
  planned = 0;
  spawned = 0;

  reset() {
    this.wave = 0;
    this.queue.length = 0;
    this.clock = 0;
    this.planned = 0;
    this.spawned = 0;
  }

  begin(wave: number, rng: Rng) {
    const def = waveDef(wave, rng);
    this.wave = wave;
    this.speedMul = def.speedMul;
    this.title = def.title ?? '';
    this.queue.length = 0;
    this.clock = 0;
    this.spawned = 0;

    for (const g of def.groups) {
      for (let i = 0; i < g.count; i++) {
        // Stagger within a group so a burst of six reads as an arriving flock.
        this.queue.push({ kind: g.kind, at: g.at + i * 0.13 });
      }
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.planned = this.queue.length;
  }

  get emptied() {
    return this.queue.length === 0;
  }

  /**
   * Release anything due. Spawn points avoid the player, avoid each other's
   * general vicinity, and stay off the walls — nothing should ever materialise
   * on top of you, and nothing should materialise somewhere you cannot see.
   */
  update(dt: number, swarm: Swarm, rng: Rng, px: number, py: number) {
    this.clock += dt;
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const item = this.queue.shift()!;
      const p = pickSpawn(rng, px, py);
      swarm.spawn(item.kind, p.x, p.y, rng, SPAWN_TELEGRAPH, this.speedMul);
      this.spawned++;
    }
  }
}

const scratch = { x: 0, y: 0 };

function pickSpawn(rng: Rng, px: number, py: number) {
  const m = 74;
  let bestX = view.arenaW * 0.5;
  let bestY = view.arenaH * 0.5;
  let bestD = -1;
  // Rejection sampling with a "furthest of N" fallback: cheap, and it never
  // fails to produce a point the way a while-loop over a hard constraint can.
  for (let i = 0; i < 8; i++) {
    const x = randRange(rng, m, view.arenaW - m);
    const y = randRange(rng, m, view.arenaH - m);
    // Nothing arrives inside a slab. The loop was already written to tolerate
    // rejections, so this is one more reason to draw again rather than a new
    // failure mode — and the fallback below still cannot come up empty.
    if (terrain.contains(x, y, 40)) continue;
    const d = Math.hypot(x - px, y - py);
    if (d > 330) {
      scratch.x = x;
      scratch.y = y;
      return scratch;
    }
    if (d > bestD) {
      bestD = d;
      bestX = x;
      bestY = y;
    }
  }
  scratch.x = bestX;
  scratch.y = bestY;
  // The fallback is the furthest of whatever was drawn, which may still be a
  // slab if every sample landed in one. Evicting is cheaper than sampling
  // again and cannot loop.
  terrain.evict(scratch, 40);
  return scratch;
}
