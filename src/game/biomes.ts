import { ZONE_DEPTH } from '../config';
import { clamp, lerp } from '../engine/math';

/**
 * The shaft has chapters.
 *
 * Depth alone is an abstraction — "1400" means nothing to a player on their
 * third run. A named zone that looks and sounds different means they can *feel*
 * how far they got, and it gives the run a shape: arrive somewhere new, survive
 * it, push for the next one. Every zone boundary is a small "again" hook.
 *
 * Colours are RGB triples rather than CSS strings because the renderer crossfades
 * between adjacent zones over the boundary; you cannot lerp '#ff2e4c'.
 */
export type RGB = readonly [number, number, number];

export interface Biome {
  name: string;
  /** One evocative line under the name card. */
  sub: string;
  /** Deep background, at the bottom of the screen. */
  bg: RGB;
  /** Background at the top — the light you are falling away from. */
  bgFar: RGB;
  /** Breakable blocks, player, primary ink. */
  fg: RGB;
  /** Blocks that will wreck you. */
  hot: RGB;
  /** Bloom / accent tint for this zone's atmosphere. */
  glow: RGB;
  /** Background motif drawn in the surround and behind the shaft. */
  motif: 'struts' | 'embers' | 'crystal' | 'coils' | 'stars';
}

export const BIOMES: Biome[] = [
  {
    name: 'THE APPROACH',
    sub: 'cold steel · the shaft opens',
    bg: [8, 11, 20],
    bgFar: [24, 40, 64],
    fg: [238, 246, 255],
    hot: [255, 46, 76],
    glow: [90, 180, 255],
    motif: 'struts',
  },
  {
    name: 'THE FOUNDRY',
    sub: 'it gets hot on the way down',
    bg: [20, 8, 6],
    bgFar: [92, 34, 10],
    fg: [255, 240, 214],
    hot: [255, 74, 40],
    glow: [255, 138, 40],
    motif: 'embers',
  },
  {
    name: 'CRYOSHAFT',
    sub: 'everything here is brittle',
    bg: [6, 16, 24],
    bgFar: [30, 78, 102],
    fg: [235, 252, 255],
    hot: [255, 68, 122],
    glow: [120, 232, 255],
    motif: 'crystal',
  },
  {
    name: 'THE REACTOR',
    sub: 'do not slow down here',
    bg: [6, 18, 10],
    bgFar: [26, 84, 42],
    fg: [236, 255, 232],
    hot: [255, 60, 60],
    glow: [124, 255, 128],
    motif: 'coils',
  },
  {
    name: 'DEEP VOID',
    sub: 'nothing below but further',
    bg: [10, 6, 20],
    bgFar: [58, 24, 92],
    fg: [244, 236, 255],
    hot: [255, 46, 138],
    glow: [188, 120, 255],
    motif: 'stars',
  },
];

/** Roman-ish suffix for laps past the last zone, so depth keeps announcing itself. */
const LAP = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

export function zoneIndexAt(metres: number) {
  return Math.max(0, Math.floor(metres / ZONE_DEPTH));
}

export function biomeAt(zoneIndex: number): Biome {
  return BIOMES[zoneIndex % BIOMES.length];
}

/** Display name including the lap suffix once the zones start repeating. */
export function zoneName(zoneIndex: number) {
  const b = biomeAt(zoneIndex);
  const lap = Math.floor(zoneIndex / BIOMES.length);
  return b.name + (LAP[lap] ?? ` x${lap + 1}`);
}

export function zoneNumber(zoneIndex: number) {
  return zoneIndex + 1;
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * The live palette at a given depth, crossfaded across the last stretch of each
 * zone so the world *becomes* the next place rather than cutting to it. A hard
 * swap mid-fall reads as a rendering glitch, not as travel.
 */
const BLEND_M = 130;

export interface Palette {
  bg: RGB;
  bgFar: RGB;
  fg: RGB;
  hot: RGB;
  glow: RGB;
  /** Motif of the zone we are mostly in, plus the incoming one and its weight. */
  motif: Biome['motif'];
  nextMotif: Biome['motif'];
  motifBlend: number;
}

export function paletteAt(metres: number): Palette {
  const i = zoneIndexAt(metres);
  const cur = biomeAt(i);
  const next = biomeAt(i + 1);

  const into = metres - i * ZONE_DEPTH;
  const t = clamp((into - (ZONE_DEPTH - BLEND_M)) / BLEND_M, 0, 1);

  return {
    bg: mixRGB(cur.bg, next.bg, t),
    bgFar: mixRGB(cur.bgFar, next.bgFar, t),
    fg: mixRGB(cur.fg, next.fg, t),
    hot: mixRGB(cur.hot, next.hot, t),
    glow: mixRGB(cur.glow, next.glow, t),
    motif: cur.motif,
    nextMotif: next.motif,
    motifBlend: t,
  };
}

// ------------------------------------------------------------------ css helpers
export const rgb = (c: RGB) =>
  `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

export const rgba = (c: RGB, a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

/** Push a colour toward white; used for hot cores and overdrive. */
export const brighten = (c: RGB, t: number): RGB => mixRGB(c, [255, 255, 255], t);

/** Pull a colour toward black; used for bevels and shadow faces. */
export const darken = (c: RGB, t: number): RGB => mixRGB(c, [0, 0, 0], t);

export { mixRGB };
