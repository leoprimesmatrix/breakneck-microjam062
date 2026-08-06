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
  /**
   * The substructure under the grid. `panel` is the machined bay the range is
   * built from; `grate` swaps its chamfer for parallel bars, which reads as a
   * floor you could drop something through; `tile` is small uniform squares
   * with no recesses, a clean-room floor; `none` removes the pass and takes
   * the room's second scale with it.
   */
  plates: 'panel' | 'grate' | 'tile' | 'none';
  /**
   * Painted floor markings. `range` is the survey court — centre circle,
   * registration crosses, an arena ID. `derelict` is what a working bay
   * paints: keep-clear chevrons and a stencilled bay number. `none` is bare.
   */
  etch: 'range' | 'derelict' | 'none';
  /** The text stencilled bottom-right. The floor names the place. */
  stamp: string;
  /** 1 = the 62-unit survey grid; 2 doubles it, and the room changes rhythm. */
  gridStep: 1 | 2;
  /** The radar sweep. Diegetic — the floor says AFB RECORDER LIVE. */
  sweep: boolean;
  /** Mote density, as a multiple of the 66 the range carries. */
  dust: number;
  /** Dust falls by default. Rising dust reads as heat coming off the floor. */
  dustRise: boolean;
  /**
   * The surround beyond the arena. `strata` is the range's two families of
   * drifting hairline; `lattice` trades the diagonals for a slow orthogonal
   * wireframe; `stormfront` is soft masses of the room's own light drifting
   * past; `void` is nothing at all, which is not laziness — a dark room whose
   * surround still has visible structure reads as a lit room someone turned
   * the brightness down on.
   */
  backdrop: 'strata' | 'lattice' | 'stormfront' | 'void';
  /**
   * 0..1: how badly the room's lighting is failing. A flickering grid is the
   * cheapest cinematography there is — it turns a floor into a place with an
   * electrical system, and an electrical system into a thing that is wrong.
   */
  flicker: number;
  /** 0..1: the room's light breathing on a slow cycle. The finale wears this. */
  pulse: number;

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
  /**
   * How much a hostile dims for being outside the ship's pool of light. 0 keeps
   * every body at full strength, which is the lit-room behaviour.
   *
   * This is the one field here that changes what the player can *see*, so it
   * has a hard floor: a body never falls below the alpha at which its halo and
   * its silhouette still read. Something you cannot see coming is atmosphere;
   * something you cannot see at all is a hull point you were never offered a
   * chance to keep.
   */
  bodyFalloff: number;

  // ---------------------------------------------------------------- fight
  /**
   * Furniture the strike cannot pass through. `pillars` scatters fixed slabs;
   * `shutters` puts bars on offset cycles that open and close.
   *
   * This is the only field in the theme that changes what the room *does*
   * rather than what it looks like, which is why it is the only one that has
   * to be set with the fight in mind rather than the photograph.
   */
  terrain: 'none' | 'pillars' | 'shutters';
}

/**
 * One id per room that exists. Deliberately not a list of rooms that are
 * planned: `SECTORS` is an exhaustive `Record`, so widening this union is a
 * compile error until the room it names has actually been built — the same
 * pressure `Record<EnemyKind, T>` applies eight times over in the game.
 */
export type SectorId = 'range' | 'blackout' | 'foundry' | 'lattice' | 'derelict' | 'crucible';

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
    plates: 'panel',
    etch: 'range',
    stamp: 'ARENA 062',
    gridStep: 1,
    sweep: true,
    dust: 1,
    dustRise: false,
    backdrop: 'strata',
    flicker: 0,
    pulse: 0,
    ambient: 1,
    lightR: 1,
    hazeCol: COL.grid,
    hazeAmt: 1,
    bodyFalloff: 0,
    terrain: 'none',
  },

  /**
   * The lights are off.
   *
   * Built entirely by subtraction — four passes decline to run and one
   * multiplier takes the rest down to a tenth — which makes it both the
   * cheapest room in the game to draw and the one that looks least like the
   * others. The floor's light pool stops being a flourish on top of a lit
   * room and becomes the *only* lit thing, so the image is whatever the ship
   * is currently standing near, and the arena you have to fight across is
   * something you know about rather than something you can see.
   *
   * `gridHot` stays the range's blue on purpose. It is the colour of the pool
   * the ship carries, and the one warm thing in here should be whatever is
   * trying to kill you.
   */
  blackout: {
    id: 'blackout',
    name: 'BLACKOUT',
    brief: 'Power is out. The recorder is not.',
    void: [2, 3, 6],
    floor: [4, 5, 9],
    grid: [26, 32, 48],
    gridHot: COL.gridHot,
    wall: [74, 90, 120],
    plateSeed: 11,
    plates: 'none',
    etch: 'none',
    stamp: 'AUX POWER ONLY',
    gridStep: 1,
    sweep: false,
    dust: 0.3,
    dustRise: false,
    backdrop: 'void',
    flicker: 0,
    pulse: 0,
    ambient: 0.12,
    lightR: 1.35,
    hazeCol: COL.grid,
    hazeAmt: 0,
    bodyFalloff: 1,
    // Pillars in the dark, which is the pairing that makes both features
    // sharper: cover you cannot see until you are beside it, and a preview
    // line that is the only thing telling you it is there.
    terrain: 'pillars',
  },

  /**
   * Very warm, and deliberately so.
   *
   * The palette's whole argument is that the player is the only cold light in
   * the room. Every other sector states that quietly; this one shouts it, by
   * making the room itself the same family as the things trying to kill you.
   * The ship has never looked colder than it does in here, and it did not
   * change colour to do it.
   */
  foundry: {
    id: 'foundry',
    name: 'THE FOUNDRY',
    brief: 'Something down here is still running.',
    void: [11, 6, 4],
    floor: [22, 12, 9],
    grid: [96, 46, 27],
    gridHot: [255, 150, 70],
    wall: [222, 152, 98],
    plateSeed: 3,
    plates: 'grate',
    etch: 'range',
    stamp: 'PROCESS DECK 3',
    gridStep: 1,
    sweep: false,
    dust: 1.6,
    dustRise: true,
    backdrop: 'strata',
    flicker: 0,
    pulse: 0,
    ambient: 0.86,
    lightR: 1,
    // Deep red rather than the obvious furnace orange, and turned well down
    // from where it started. Two saturated oranges — the room's haze and a
    // mote — sitting on top of each other is the exact failure the palette
    // rule in `config.ts` exists to prevent, and the first pass at this room
    // committed it: the most common enemy in the game went missing against
    // the floor. Pushing the haze red and dim leaves the ember-to-gold band
    // free for the things that are trying to kill you.
    hazeCol: [220, 62, 22],
    hazeAmt: 1.05,
    bodyFalloff: 0,
    terrain: 'shutters',
  },

  /**
   * Cold, precise, and at double scale.
   *
   * The doubled grid is the whole trick. Every other dial here is a shade of
   * blue, but a survey grid at twice the pitch changes the room's rhythm the
   * way a change of time signature changes a piece — same materials, and you
   * would never mistake one for the other. Dense pillars because this is the
   * sector about the line being cut: a lattice you strike through, in a room
   * that is itself a lattice.
   */
  lattice: {
    id: 'lattice',
    name: 'THE LATTICE',
    brief: 'Calibration architecture. Still calibrating.',
    void: [5, 7, 15],
    floor: [10, 14, 27],
    grid: [58, 92, 190],
    gridHot: [122, 170, 255],
    wall: [156, 186, 240],
    plateSeed: 7,
    plates: 'tile',
    etch: 'none',
    stamp: 'GRID REF 2X',
    gridStep: 2,
    sweep: true,
    dust: 0.7,
    dustRise: false,
    backdrop: 'lattice',
    flicker: 0,
    pulse: 0,
    ambient: 1,
    lightR: 1,
    hazeCol: [58, 92, 190],
    hazeAmt: 0.8,
    bodyFalloff: 0,
    terrain: 'pillars',
  },

  /**
   * Nothing here has been maintained in a long time.
   *
   * Desaturated to the edge of monochrome, with one amber exception, and lit
   * by a supply that is failing: the grid drops out for a frame or two at a
   * time on a deterministic stutter. A flickering room is the cheapest
   * cinematography in the catalogue — it says *electrical system*, and then
   * it says *wrong* — and it costs a hash and a multiply.
   */
  derelict: {
    id: 'derelict',
    name: 'THE DERELICT',
    brief: 'Decommissioned. Incompletely.',
    void: [7, 8, 10],
    floor: [15, 16, 19],
    grid: [52, 56, 63],
    gridHot: [216, 160, 72],
    wall: [140, 146, 156],
    plateSeed: 19,
    plates: 'panel',
    etch: 'derelict',
    stamp: 'BAY 07 CONDEMNED',
    gridStep: 1,
    sweep: false,
    dust: 0.8,
    dustRise: false,
    backdrop: 'void',
    flicker: 0.7,
    pulse: 0,
    ambient: 0.55,
    lightR: 1.1,
    hazeCol: [90, 100, 120],
    hazeAmt: 0.8,
    bodyFalloff: 0,
    terrain: 'none',
  },

  /**
   * The finale. The room breathes.
   *
   * Everything is red and the light swells and dies on a slow cycle, which is
   * the one trick in this file that is pure theatre — it changes nothing about
   * the fight and everything about how the fight photographs. No terrain: the
   * last room is a clean duel floor, because by now the player has earned a
   * fight where the only thing in the way is the thing they came to kill.
   */
  crucible: {
    id: 'crucible',
    name: 'THE CRUCIBLE',
    brief: 'This is where they test what survives.',
    void: [13, 4, 6],
    floor: [27, 9, 12],
    grid: [112, 36, 42],
    gridHot: [255, 96, 84],
    wall: [235, 122, 112],
    plateSeed: 23,
    plates: 'panel',
    etch: 'range',
    stamp: 'PROVING GROUND',
    gridStep: 1,
    sweep: true,
    dust: 1.2,
    dustRise: true,
    backdrop: 'stormfront',
    flicker: 0,
    pulse: 0.6,
    ambient: 0.92,
    lightR: 1,
    hazeCol: [220, 52, 40],
    hazeAmt: 1.1,
    bodyFalloff: 0,
    terrain: 'none',
  },
};

/**
 * Each sector's warden: how many armour plates its ring carries and how fast
 * the ring turns. One enemy kind, six fights — the `speedMul` pattern applied
 * to a boss. Sign of `spin` is the opening direction of the dance; magnitude
 * climbs across the campaign, and plate count with it, so the final keyhole is
 * the narrowest and the fastest.
 */
export const WARDEN_DEF: Record<SectorId, { plates: number; spin: number; r: number }> = {
  range: { plates: 10, spin: 0.55, r: 54 },
  blackout: { plates: 12, spin: 0.7, r: 56 },
  foundry: { plates: 12, spin: -0.75, r: 58 },
  lattice: { plates: 14, spin: 0.8, r: 58 },
  derelict: { plates: 14, spin: -0.88, r: 60 },
  crucible: { plates: 16, spin: 0.98, r: 64 },
};

/** The room being drawn. Read by `render/`; written only by `setSector`. */
export const theme: SectorTheme = { ...SECTORS.range };

export function setSector(id: SectorId) {
  Object.assign(theme, SECTORS[id]);
}
