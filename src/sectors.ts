import { COL, type RGB } from './config';

/**
 * The room, as data.
 *
 * The game shipped with one arena and no way to say so — `drawScene` reads the
 * clock, the player and the entity lists, and nothing below it takes a
 * parameter that could mean *where*. So every wave from the first to the
 * thousandth renders the identical floor, and the only environment colour that
 * ever changes is the bezel going red at one hull.
 *
 * This is the missing parameter. A sector is a palette, a floor treatment and a
 * lighting rig — no logic, no behaviour, nothing the renderer has to interpret
 * beyond multiplying by it. `render/` still never learns what wave it is; it
 * reads `theme`, and `game/` is the only thing that ever writes one.
 *
 * The singleton is mutated in place rather than replaced, exactly as `view` is
 * in `viewport.ts`. Every consumer captures it once at module scope and reads
 * through it forever, so a sector change costs one `Object.assign` and reaches
 * twenty-five draw calls without any of them subscribing to anything.
 */
export interface SectorTheme {
  id: SectorId;
  /** Shown on the wave card and stencilled into the floor. */
  name: string;
  /** One line, for the chapter card. */
  brief: string;

  // ------------------------------------------------------------- palette
  // The *room* only. Actor colours — the player, the five hostiles, the strike,
  // the danger red — never theme, and that is not an oversight. The rule the
  // palette in `config.ts` is built on is that the player is cold, the hostiles
  // are warm and the room is nearly monochrome behind both; repaint the actors
  // too and a sector stops being a place the fight happens in and starts being
  // a filter over the fight.
  void: RGB;
  floor: RGB;
  grid: RGB;
  gridHot: RGB;
  wall: RGB;

  // ------------------------------------------------------ floor treatment
  /**
   * Folded into the plate hash. The layout is deterministic from the cell index
   * and must stay that way — a floor that reshuffles between frames flickers —
   * but deterministic per *sector* is what makes two rooms different rooms
   * rather than the same room in two colours.
   */
  plateSeed: number;
  /** 1 = the 62-unit survey grid; 2 doubles it, and the room changes rhythm. */
  gridStep: 1 | 2;
  /** The radar sweep. Diegetic — the floor says AFB RECORDER LIVE. */
  sweep: boolean;
  /** Mote density, as a multiple of the 66 the range carries. */
  dust: number;
  /** Dust falls by default. Rising dust reads as heat coming off the floor. */
  dustRise: boolean;

  // ------------------------------------------------------------ lighting
  /**
   * A single multiplier on every floor and grid alpha. This is the dial that
   * does the most for the least: at 1 the room is lit, at 0.12 the only thing
   * on screen is what the ship is carrying a light over.
   */
  ambient: number;
  /** Multiplies the radius of the pool of light the ship carries. */
  lightR: number;
  hazeCol: RGB;
  /** 0 skips the haze pass entirely. */
  hazeAmt: number;
}

/**
 * One id per room that exists. Deliberately not a list of rooms that are
 * planned: `SECTORS` is an exhaustive `Record`, so widening this union is a
 * compile error until the room it names has actually been built — the same
 * pressure `Record<EnemyKind, T>` applies eight times over in the game.
 */
export type SectorId = 'range';

export const SECTORS: Record<SectorId, SectorTheme> = {
  /**
   * Arena 062, and the reason every field above has an identity value: this is
   * the room the game shipped with, to the pixel. It is the control. If a
   * change to the theme plumbing makes the range render differently, the
   * plumbing is wrong, and that is a thing you can screenshot rather than
   * argue about.
   */
  range: {
    id: 'range',
    name: 'THE RANGE',
    brief: 'Instrumented. Surveyed. Watched.',
    void: COL.void,
    floor: COL.floor,
    grid: COL.grid,
    gridHot: COL.gridHot,
    wall: COL.wall,
    plateSeed: 0,
    gridStep: 1,
    sweep: true,
    dust: 1,
    dustRise: false,
    ambient: 1,
    lightR: 1,
    hazeCol: COL.grid,
    hazeAmt: 1,
  },
};

/** The room being drawn. Read by `render/`; written only by `setSector`. */
export const theme: SectorTheme = { ...SECTORS.range };

export function setSector(id: SectorId) {
  Object.assign(theme, SECTORS[id]);
}
