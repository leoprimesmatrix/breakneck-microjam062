import { SPAWN_TELEGRAPH } from '../config';
import { randRange, type Rng } from '../engine/math';
import { SECTOR_WAVES, theme, type SectorId } from '../sectors';
import { view } from '../viewport';
import type { EnemyKind, Swarm } from './enemies';
import { terrain } from './terrain';

/**
 * The wave director.
 *
 * Hand-authored for the whole campaign — six sectors of four waves, every
 * fourth a warden — then procedural for endless laps beyond it. The authored
 * stretch exists purely to control the *order in which ideas arrive*: one new
 * enemy at a time, each introduced in the room that shows it off best, each
 * with a breather before the wave that combines it with everything before it.
 * A random generator cannot teach.
 */

export interface WaveDef {
  /** Enemies to spawn, in the order they arrive. */
  groups: { kind: EnemyKind; count: number; at: number }[];
  /** Multiplies every enemy's base speed. */
  speedMul: number;
  /** Optional name shown on the wave card. */
  title?: string;
}

const SCRIPT: Record<SectorId, WaveDef[]> = {
  // The survey range: the original opening, ending on the gentlest warden.
  range: [
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
      title: 'THE FIRST WARDEN',
      speedMul: 0.94,
      groups: [{ kind: 'warden', count: 1, at: 0 }, { kind: 'mote', count: 3, at: 7 }],
    },
  ],

  // The dark. The ward arrives here, where its shield arc is easiest to read
  // (it is the brightest thing near it), and the choir sings where it glows.
  blackout: [
    {
      title: 'LIGHTS OUT',
      speedMul: 0.9,
      groups: [{ kind: 'mote', count: 5, at: 0 }, { kind: 'mote', count: 3, at: 3 }],
    },
    {
      title: 'VOICES',
      speedMul: 0.95,
      groups: [
        { kind: 'choir', count: 1, at: 0 },
        { kind: 'mote', count: 4, at: 2.2 },
        { kind: 'seeder', count: 1, at: 4.6 },
      ],
    },
    {
      title: 'THE WALL',
      speedMul: 1,
      groups: [
        { kind: 'ward', count: 2, at: 0 },
        { kind: 'choir', count: 1, at: 2.4 },
        { kind: 'mote', count: 4, at: 4.2 },
      ],
    },
    {
      title: 'WARDEN IN THE DARK',
      speedMul: 1.02,
      groups: [{ kind: 'warden', count: 1, at: 0 }, { kind: 'choir', count: 1, at: 5.5 }],
    },
  ],

  // The foundry: everything that points and shoots, among the shutters that
  // block both their orbs and your line.
  foundry: [
    {
      title: 'THE LINE',
      speedMul: 1.02,
      groups: [{ kind: 'lancer', count: 2, at: 0 }, { kind: 'mote', count: 4, at: 2.6 }],
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
      title: 'SIEGE PLATE',
      speedMul: 1.08,
      groups: [
        { kind: 'bulwark', count: 1, at: 0 },
        { kind: 'lancer', count: 2, at: 2.2 },
        { kind: 'mote', count: 4, at: 4.4 },
      ],
    },
    {
      title: 'FORGE WARDEN',
      speedMul: 1.1,
      groups: [
        { kind: 'warden', count: 1, at: 0 },
        { kind: 'spine', count: 1, at: 4.5 },
        { kind: 'mote', count: 3, at: 8 },
      ],
    },
  ],

  // The lattice: the classic five, dense, in the room where the line is
  // forever being cut by pillars.
  lattice: [
    {
      title: 'CROSSFIRE',
      speedMul: 1.1,
      groups: [
        { kind: 'ward', count: 2, at: 0 },
        { kind: 'seeder', count: 2, at: 1.6 },
        { kind: 'mote', count: 4, at: 3.4 },
      ],
    },
    {
      title: 'PINCER',
      speedMul: 1.14,
      groups: [
        { kind: 'lancer', count: 3, at: 0 },
        { kind: 'spine', count: 1, at: 2 },
        { kind: 'mote', count: 5, at: 3.6 },
      ],
    },
    {
      title: 'THE GRID BITES',
      speedMul: 1.16,
      groups: [
        { kind: 'bulwark', count: 2, at: 0 },
        { kind: 'ward', count: 2, at: 2.4 },
        { kind: 'mote', count: 5, at: 4.2 },
      ],
    },
    {
      title: 'LATTICE WARDEN',
      speedMul: 1.18,
      groups: [{ kind: 'warden', count: 1, at: 0 }, { kind: 'lancer', count: 2, at: 5.5 }],
    },
  ],

  // The derelict: ambushes among the ghosts.
  derelict: [
    {
      title: 'SALVAGE CREW',
      speedMul: 1.18,
      groups: [{ kind: 'choir', count: 2, at: 0 }, { kind: 'mote', count: 5, at: 2.4 }],
    },
    {
      title: 'DEAD CARGO',
      speedMul: 1.2,
      groups: [
        { kind: 'bulwark', count: 1, at: 0 },
        { kind: 'seeder', count: 3, at: 1.8 },
        { kind: 'mote', count: 5, at: 4 },
      ],
    },
    {
      title: 'HAUNTS',
      speedMul: 1.24,
      groups: [
        { kind: 'choir', count: 2, at: 0 },
        { kind: 'ward', count: 2, at: 2 },
        { kind: 'lancer', count: 2, at: 4.2 },
      ],
    },
    {
      title: 'CONDEMNED WARDEN',
      speedMul: 1.26,
      groups: [{ kind: 'warden', count: 1, at: 0 }, { kind: 'bulwark', count: 1, at: 5 }],
    },
  ],

  // The crucible: everything, and then the last one.
  crucible: [
    {
      title: 'PROVING GROUND',
      speedMul: 1.26,
      groups: [
        { kind: 'mote', count: 8, at: 0 },
        { kind: 'ward', count: 2, at: 2.2 },
        { kind: 'seeder', count: 3, at: 4 },
      ],
    },
    {
      title: 'ALL LINES',
      speedMul: 1.3,
      groups: [
        { kind: 'lancer', count: 3, at: 0 },
        { kind: 'spine', count: 2, at: 1.8 },
        { kind: 'bulwark', count: 1, at: 4 },
        { kind: 'mote', count: 6, at: 5.6 },
      ],
    },
    {
      title: 'THE CHORUS',
      speedMul: 1.34,
      groups: [
        { kind: 'choir', count: 3, at: 0 },
        { kind: 'ward', count: 3, at: 2.4 },
        { kind: 'lancer', count: 2, at: 4.8 },
        { kind: 'mote', count: 6, at: 6.2 },
      ],
    },
    {
      title: 'THE LAST WARDEN',
      speedMul: 1.38,
      groups: [
        { kind: 'warden', count: 1, at: 0 },
        { kind: 'choir', count: 1, at: 4.5 },
        { kind: 'lancer', count: 2, at: 9 },
      ],
    },
  ],
};

/** Names for the endless laps, so lap three's waves still get title cards. */
const ENDLESS_TITLES = [
  'OVERRUN', 'CASCADE', 'RIPTIDE', 'FURNACE', 'UNDERTOW',
  'THRESHOLD', 'MAELSTROM', 'ZENITH', 'EVENT HORIZON', 'NO QUARTER',
];

/**
 * One wave, described. `heat` is how far past the authored campaign this run
 * has gone — 0 for every campaign wave, climbing by one per endless wave after
 * it. The heat scales a budget spent on the current sector's roster, so an
 * endless lap through the blackout still fights blackout things, just more of
 * them, faster.
 */
export function waveDef(sector: SectorId, waveIn: number, heat: number, rng: Rng): WaveDef {
  if (heat <= 0) return SCRIPT[sector][waveIn - 1];

  const budget = 15 + heat * 2.8;
  const speedMul = Math.min(1.66, 1.38 + heat * 0.016);

  const cost: Partial<Record<EnemyKind, { cost: number; max: number }>> = {
    mote: { cost: 1, max: 12 },
    seeder: { cost: 2, max: 5 },
    ward: { cost: 3, max: 5 },
    lancer: { cost: 3, max: 5 },
    spine: { cost: 4, max: 3 },
    bulwark: { cost: 4, max: 3 },
    // One choir spawn is three bodies, which the cost already prices in.
    choir: { cost: 3, max: 3 },
  };
  const menu = theme.roster
    .map((kind) => ({ kind, ...cost[kind]! }))
    .filter((m) => m.cost !== undefined);

  const counts = new Map<EnemyKind, number>();
  let left = budget;
  let guard = 0;
  while (left > 0 && guard++ < 80 && menu.length) {
    const pick = menu[Math.floor(rng() * menu.length)];
    const have = counts.get(pick.kind) ?? 0;
    if (have >= pick.max || pick.cost > left) continue;
    counts.set(pick.kind, have + 1);
    left -= pick.cost;
  }
  if (!counts.size) counts.set('mote', 6);

  const groups: WaveDef['groups'] = [];
  let at = 0;
  // A lap's fourth wave keeps its appointment: the sector's warden returns,
  // with the procedural spawns demoted to escort.
  if (waveIn === SECTOR_WAVES) {
    groups.push({ kind: 'warden', count: 1, at: 0 });
    at = 4;
  }
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
    title: ENDLESS_TITLES[(heat - 1) % ENDLESS_TITLES.length],
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

  begin(def: WaveDef, wave: number) {
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
