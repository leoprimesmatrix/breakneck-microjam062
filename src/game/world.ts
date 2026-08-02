import {
  CALIBRATION_M,
  CELL_H,
  CELL_W,
  COLS,
  DENSITY_END,
  DENSITY_START,
  GATE_EVERY_M,
  HARD_RAMP_DEPTH,
  PX_PER_M,
  RAMP_DEPTH,
  ROW_GAP_END,
  ROW_GAP_START,
  VIEW_H,
} from '../config';
import { clamp, lerp, makeRng, randInt, smoothstep } from '../engine/math';

export interface Block {
  x: number; // left edge, world space
  y: number; // top edge, world space
  w: number;
  h: number;
  hardness: number;
  /** Hardness as generated. The gap from `hardness` is drawn as cracks. */
  maxHardness: number;
  gate: boolean;
  dead: boolean;
  /** A block only ever awards one GRAZE. */
  grazed: boolean;
}

/**
 * Rows are streamed in ahead of the camera and compacted away behind it.
 * Difficulty is a pure function of depth, so a run is always fair for its depth.
 *
 * The generator emits *formations* rather than independent rows. Filling each
 * column by an independent coin flip — which is what this used to do — produces
 * statistically correct mush: every row looks like every other row, nothing can
 * be read ahead, and the only skill expressed is reacting to noise. Named
 * shapes (a wall with one gap, a drifting corridor, a diagonal) give the player
 * something to recognise, plan against, and get better at.
 */
export class World {
  blocks: Block[] = [];

  private rng = makeRng(1);
  private nextRowY = 0;
  private nextGateM = GATE_EVERY_M;
  /** Index of the last formation, so the same shape never runs back to back. */
  private lastForm = -1;

  reset(seed: number) {
    this.blocks.length = 0;
    this.rng = makeRng(seed);
    this.nextRowY = 940; // open air while the intro card is up and speed builds
    this.nextGateM = GATE_EVERY_M;
    this.lastForm = -1;
  }

  /** Difficulty 0..1 from depth in metres. */
  private difficultyAt(metres: number) {
    return smoothstep(metres / RAMP_DEPTH);
  }

  /** Hardness ramp 0..1 — deliberately shorter than the density ramp. */
  private hardnessAt(metres: number) {
    return smoothstep(metres / HARD_RAMP_DEPTH);
  }

  /** Stream formations until we're generated well past the bottom of the view. */
  ensure(cameraBottomY: number) {
    let guard = 0;
    while (this.nextRowY < cameraBottomY + VIEW_H && guard++ < 48) {
      const metres = this.nextRowY / PX_PER_M;

      if (metres >= this.nextGateM) {
        this.emitGate(this.nextRowY);
        this.nextGateM += GATE_EVERY_M;
        // A gate earns a wider breather on the far side.
        this.nextRowY += this.gap(metres) * 1.7;
      } else if (metres < CALIBRATION_M) {
        this.nextRowY = this.emitCalibration(this.nextRowY, metres);
      } else {
        this.nextRowY = this.emitFormation(this.nextRowY, metres);
      }
    }
  }

  private gap(metres: number) {
    return lerp(ROW_GAP_START, ROW_GAP_END, this.difficultyAt(metres));
  }

  // -------------------------------------------------------------- primitive
  private put(col: number, y: number, hardness: number, h = CELL_H) {
    this.blocks.push({
      x: col * CELL_W,
      y,
      w: CELL_W,
      h,
      hardness,
      maxHardness: hardness,
      gate: false,
      dead: false,
      grazed: false,
    });
  }

  /** Hardness roll for the current depth, biased by `bias` in tier units. */
  private roll(metres: number, bias = 0) {
    const th = this.hardnessAt(metres);
    const hardMax = clamp(Math.round(lerp(3, 9, th)) + bias, 1, 9);
    // The floor rises with depth so early blocks stay smashable at low speed.
    const hardMin = clamp(Math.round(lerp(1, 3, th)) + bias, 1, hardMax);
    return randInt(this.rng, hardMin, hardMax);
  }

  /**
   * The on-ramp. Sparse, soft, and generous: everything here breaks at neutral
   * falling speed, so the first thing a new player ever does is smash through a
   * block by accident and get the entire premise for free. Real formations and
   * real threats start after CALIBRATION_M.
   */
  private emitCalibration(y: number, metres: number): number {
    const maxH = metres < 140 ? 1 : 2;
    const filled: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (this.rng() < 0.32) filled.push(c);
    }
    while (filled.length > COLS - 3) filled.pop();
    if (filled.length === 0) filled.push(randInt(this.rng, 1, COLS - 2));
    for (const c of filled) this.put(c, y, randInt(this.rng, 1, maxH));
    return y + ROW_GAP_START * 1.2;
  }

  // ------------------------------------------------------------ formations
  /**
   * Picks a shape appropriate to the depth and emits it. Returns the Y at which
   * the next thing should start.
   */
  private emitFormation(y: number, metres: number): number {
    const t = this.difficultyAt(metres);

    // Candidate shapes unlock with depth, so the opening minute stays legible
    // and the deep game gets the shapes that demand real steering.
    const pool: number[] = [0, 0]; // scatter is weighted; it is the connective tissue
    if (t > 0.06) pool.push(1); // wall with a gap
    if (t > 0.14) pool.push(2); // gauntlet (reward)
    if (t > 0.2) pool.push(3); // drifting corridor
    if (t > 0.3) pool.push(4); // diagonal
    if (t > 0.42) pool.push(5); // checker

    let pick = pool[randInt(this.rng, 0, pool.length - 1)];
    // Never the same shape twice running; repetition is what makes procedural
    // content read as a texture instead of as level design.
    if (pick === this.lastForm && pool.length > 1) {
      pick = pool[randInt(this.rng, 0, pool.length - 1)];
    }
    this.lastForm = pick;

    switch (pick) {
      case 1:
        return this.formWallGap(y, metres, t);
      case 2:
        return this.formGauntlet(y, metres, t);
      case 3:
        return this.formCorridor(y, metres, t);
      case 4:
        return this.formDiagonal(y, metres, t);
      case 5:
        return this.formChecker(y, metres, t);
      default:
        return this.formScatter(y, metres, t);
    }
  }

  /** The original behaviour: independent per-column fill. Still the baseline. */
  private formScatter(y: number, metres: number, t: number): number {
    const density = lerp(DENSITY_START, DENSITY_END, t);
    const filled: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (this.rng() < density) filled.push(c);
    }
    // Always leave at least one clean lane: weaving must remain an option.
    while (filled.length > COLS - 1) filled.pop();
    // ...and never emit a row that is entirely empty; it reads as a bug.
    if (filled.length === 0) filled.push(randInt(this.rng, 0, COLS - 1));

    for (const c of filled) this.put(c, y, this.roll(metres));
    return y + this.gap(metres);
  }

  /**
   * A solid row with one or two gaps. The purest expression of the core choice:
   * aim for the hole, or go fast enough that the hole stops mattering.
   */
  private formWallGap(y: number, metres: number, t: number): number {
    const rows = t > 0.5 ? 2 : 1;
    let cy = y;
    let gapCol = randInt(this.rng, 0, COLS - 1);

    for (let r = 0; r < rows; r++) {
      const wide = this.rng() < 0.35;
      for (let c = 0; c < COLS; c++) {
        const isGap = c === gapCol || (wide && c === gapCol + 1);
        if (!isGap) this.put(c, cy, this.roll(metres));
      }
      // On the second row the gap steps sideways, so it cannot be held straight.
      gapCol = clamp(gapCol + (this.rng() < 0.5 ? -2 : 2), 0, COLS - 1);
      cy += this.gap(metres);
    }
    return cy + this.gap(metres) * 0.5;
  }

  /**
   * Dense but soft: three rows of low-hardness blocks. This is the reward shape —
   * it exists to be ploughed at speed, and it is where chains and overdrive
   * charge actually come from. Without a formation like this the game is all
   * threat and never lets the player feel fast.
   */
  private formGauntlet(y: number, metres: number, t: number): number {
    const rows = t > 0.5 ? 4 : 3;
    let cy = y;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.rng() < 0.82) this.put(c, cy, this.roll(metres, -3));
      }
      cy += this.gap(metres) * 0.62; // tighter than normal: it should feel like a run
    }
    return cy + this.gap(metres);
  }

  /**
   * Two walls with a corridor between them that drifts sideways. Forces
   * sustained steering at exactly the speeds where steering is hardest.
   */
  private formCorridor(y: number, metres: number, t: number): number {
    const rows = 4 + randInt(this.rng, 0, 2);
    const width = t > 0.6 ? 2 : 3;
    let left = randInt(this.rng, 0, COLS - width);
    const drift = this.rng() < 0.5 ? -1 : 1;
    let cy = y;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c < left || c >= left + width) this.put(c, cy, this.roll(metres, 1));
      }
      // Bounce off the walls rather than clamping, so the corridor keeps moving.
      let next = left + drift;
      if (next < 0 || next + width > COLS) next = left - drift;
      left = clamp(next, 0, COLS - width);
      cy += this.gap(metres) * 0.72;
    }
    return cy + this.gap(metres);
  }

  /** A gap that walks one column per row: a continuous steering test. */
  private formDiagonal(y: number, metres: number, t: number): number {
    const rows = t > 0.6 ? 7 : 5;
    let col = randInt(this.rng, 1, COLS - 2);
    const dir = this.rng() < 0.5 ? -1 : 1;
    let cy = y;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        // Two-wide opening: one column is unfair at low steering authority.
        if (c !== col && c !== col + dir) this.put(c, cy, this.roll(metres));
      }
      const next = col + dir;
      col = next < 0 || next >= COLS ? col - dir : next;
      cy += this.gap(metres) * 0.78;
    }
    return cy + this.gap(metres);
  }

  /** Alternating fill. Cheap to read, and it punishes holding a straight line. */
  private formChecker(y: number, metres: number, t: number): number {
    const rows = t > 0.7 ? 6 : 4;
    let cy = y;
    let phase = randInt(this.rng, 0, 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((c + phase) % 2 === 0) this.put(c, cy, this.roll(metres));
      }
      phase ^= 1;
      cy += this.gap(metres) * 0.7;
    }
    return cy + this.gap(metres);
  }

  /** Full-width skill check: no gaps, one hardness, break it or bleed. */
  private emitGate(y: number) {
    const th = this.hardnessAt(y / PX_PER_M);
    const hardness = clamp(Math.round(lerp(2, 8, th)), 2, 9);
    for (let c = 0; c < COLS; c++) {
      this.blocks.push({
        x: c * CELL_W,
        y,
        w: CELL_W,
        h: CELL_H * 1.25,
        hardness,
        maxHardness: hardness,
        gate: true,
        dead: false,
        grazed: false,
      });
    }
  }

  /** Swap-remove dead and off-screen blocks without allocating. */
  prune(cameraTopY: number) {
    const cutoff = cameraTopY - 240;
    const arr = this.blocks;
    let w = 0;
    for (let r = 0; r < arr.length; r++) {
      const b = arr[r];
      if (b.dead || b.y + b.h < cutoff) continue;
      arr[w++] = b;
    }
    arr.length = w;
  }
}
