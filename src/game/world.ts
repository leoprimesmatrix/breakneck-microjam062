import {
  CALIBRATION_M,
  CELL_H,
  CORE,
  DENSITY_END,
  DENSITY_START,
  GATE_EVERY_M,
  GLASS,
  GRATE,
  MATERIAL_RAMP_DEPTH,
  PX_PER_M,
  RAMP_DEPTH,
  ROW_GAP_END,
  ROW_GAP_START,
  type Material,
} from '../config';
import { clamp, lerp, makeRng, randInt, smoothstep } from '../engine/math';
import { view } from '../viewport';

export interface Block {
  x: number; // left edge, world space
  y: number; // top edge, world space
  w: number;
  h: number;
  material: Material;
  /** Bounces chip a barrier; enough chips soften it a grade. Drawn as cracks. */
  chips: number;
  gate: boolean;
  dead: boolean;
}

/** Chips needed to soften a barrier one material grade. */
const CHIPS_PER_GRADE = 2;

/**
 * Rows are streamed in ahead of the camera and compacted away behind it.
 * Difficulty is a pure function of depth, so a run is always fair for its depth.
 *
 * The generator emits *formations* rather than independent per-column coin
 * flips, which produce statistically correct mush — every row looks like every
 * other one and nothing can be read ahead.
 *
 * Every lane count here is a FRACTION of `view.cols`, never an absolute. The
 * field is 7 lanes on a phone and up to 26 on a monitor; a gap hard-coded at
 * "2 lanes" would be a comfortable doorway on one and an impossible needle on
 * the other.
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

  /** Difficulty 0..1 from depth in metres — density, spacing, shape unlocks. */
  private difficultyAt(metres: number) {
    return smoothstep(metres / RAMP_DEPTH);
  }

  /** Material toughness ramp 0..1 — deliberately shorter than the density ramp. */
  private toughnessAt(metres: number) {
    return smoothstep(metres / MATERIAL_RAMP_DEPTH);
  }

  /** Stream formations until we're generated well past the bottom of the view. */
  ensure(cameraBottomY: number) {
    let guard = 0;
    while (this.nextRowY < cameraBottomY + view.logicalH && guard++ < 48) {
      const metres = this.nextRowY / PX_PER_M;

      if (metres >= this.nextGateM) {
        this.emitGate(this.nextRowY);
        this.nextGateM += GATE_EVERY_M;
        this.nextRowY += this.gap(metres) * 1.7;
      } else if (metres < CALIBRATION_M) {
        this.nextRowY = this.emitCalibration(this.nextRowY);
      } else {
        this.nextRowY = this.emitFormation(this.nextRowY, metres);
      }
    }
  }

  private gap(metres: number) {
    return lerp(ROW_GAP_START, ROW_GAP_END, this.difficultyAt(metres));
  }

  /** Lane count as a fraction of the field, floored so it never degenerates. */
  private lanes(fraction: number, min: number) {
    return Math.max(min, Math.round(view.cols * fraction));
  }

  // -------------------------------------------------------------- primitive
  private put(col: number, y: number, material: Material, h = CELL_H) {
    this.blocks.push({
      x: col * view.cellW,
      y,
      w: view.cellW,
      h,
      material,
      chips: 0,
      gate: false,
      dead: false,
    });
  }

  /**
   * Material roll for the current depth.
   *
   * CORE appears as a scattered obstacle deep down, not only as gates. That is
   * deliberate and load-bearing: CORE cannot be melted without a meltdown, so it
   * is the only thing in the game that *must* be steered around. Without it,
   * enough heat trivialises the whole field and the dive becomes mindless again.
   */
  private roll(metres: number, bias = 0): Material {
    const t = this.toughnessAt(metres);
    // CORE frequency is what forces steering to exist at all. At 16% a player
    // sitting on high heat could plough almost everything and simply eat the
    // occasional bounce; at 28% there is a cold obstacle in most rows, so a
    // line has to be chosen even when hot.
    if (bias >= 0 && this.rng() < lerp(0, 0.28, t)) return CORE;
    const max = clamp(Math.round(lerp(0, 2, t)) + bias, 0, 2);
    const min = clamp(Math.round(lerp(0, 1, t)) + bias, 0, max);
    return randInt(this.rng, min, max) as Material;
  }

  /**
   * The on-ramp. Sparse GLASS only: everything here melts at zero heat, so the
   * first thing a new player does is go through a barrier by accident and get
   * the entire premise for free, before anything can hurt them.
   */
  private emitCalibration(y: number): number {
    const clear = this.lanes(0.33, 3);
    const filled: number[] = [];
    for (let c = 0; c < view.cols; c++) {
      if (this.rng() < 0.32) filled.push(c);
    }
    while (filled.length > view.cols - clear) filled.pop();
    if (filled.length === 0) filled.push(randInt(this.rng, 1, view.cols - 2));
    for (const c of filled) this.put(c, y, GLASS);
    return y + ROW_GAP_START * 1.2;
  }

  // ------------------------------------------------------------ formations
  private emitFormation(y: number, metres: number): number {
    const t = this.difficultyAt(metres);

    const pool: number[] = [0, 0]; // scatter is the connective tissue
    if (t > 0.06) pool.push(1); // wall with a gap
    if (t > 0.14) pool.push(2); // gauntlet (the heat-building reward)
    if (t > 0.2) pool.push(3); // drifting corridor
    if (t > 0.3) pool.push(4); // diagonal
    if (t > 0.42) pool.push(5); // checker

    let pick = pool[randInt(this.rng, 0, pool.length - 1)];
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

  /** Independent per-column fill. The baseline texture between set pieces. */
  private formScatter(y: number, metres: number, t: number): number {
    const density = lerp(DENSITY_START, DENSITY_END, t);
    const filled: number[] = [];
    for (let c = 0; c < view.cols; c++) {
      if (this.rng() < density) filled.push(c);
    }
    while (filled.length > view.cols - 1) filled.pop();
    if (filled.length === 0) filled.push(randInt(this.rng, 0, view.cols - 1));
    for (const c of filled) this.put(c, y, this.roll(metres));
    return y + this.gap(metres);
  }

  /**
   * A solid row with one opening. The purest expression of the choice: aim for
   * the hole, or be hot enough that the hole stops mattering.
   */
  private formWallGap(y: number, metres: number, t: number): number {
    const rows = t > 0.5 ? 2 : 1;
    const width = this.lanes(0.18, 2);
    const step = this.lanes(0.22, 2);
    let cy = y;
    let gapCol = randInt(this.rng, 0, view.cols - width);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (c < gapCol || c >= gapCol + width) this.put(c, cy, this.roll(metres));
      }
      // The opening steps sideways, so it cannot be held straight.
      gapCol = clamp(
        gapCol + (this.rng() < 0.5 ? -step : step),
        0,
        view.cols - width,
      );
      cy += this.gap(metres);
    }
    return cy + this.gap(metres) * 0.5;
  }

  /**
   * Dense but soft: rows of GLASS and GRATE meant to be ploughed. This is where
   * heat comes from — and therefore where the redline comes from. It reads as a
   * reward and functions as a fuse.
   */
  private formGauntlet(y: number, metres: number, t: number): number {
    const rows = t > 0.5 ? 4 : 3;
    let cy = y;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (this.rng() < 0.82) {
          this.put(c, cy, (this.rng() < 0.65 ? GLASS : GRATE) as Material);
        }
      }
      cy += this.gap(metres) * 0.62;
    }
    return cy + this.gap(metres);
  }

  /** Two walls with a corridor between them that drifts sideways. */
  private formCorridor(y: number, metres: number, t: number): number {
    const rows = 4 + randInt(this.rng, 0, 2);
    const width = this.lanes(t > 0.6 ? 0.24 : 0.32, 2);
    let left = randInt(this.rng, 0, view.cols - width);
    const drift = this.rng() < 0.5 ? -1 : 1;
    let cy = y;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (c < left || c >= left + width) this.put(c, cy, this.roll(metres, 1));
      }
      let next = left + drift;
      if (next < 0 || next + width > view.cols) next = left - drift;
      left = clamp(next, 0, view.cols - width);
      cy += this.gap(metres) * 0.72;
    }
    return cy + this.gap(metres);
  }

  /** An opening that walks sideways one lane per row: sustained steering. */
  private formDiagonal(y: number, metres: number, t: number): number {
    const rows = t > 0.6 ? 7 : 5;
    const width = this.lanes(0.22, 2);
    let col = randInt(this.rng, 1, Math.max(1, view.cols - width - 1));
    const dir = this.rng() < 0.5 ? -1 : 1;
    let cy = y;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (c < col || c >= col + width) this.put(c, cy, this.roll(metres));
      }
      const next = col + dir;
      col = next < 0 || next + width > view.cols ? col - dir : next;
      cy += this.gap(metres) * 0.78;
    }
    return cy + this.gap(metres);
  }

  /** Alternating fill. Cheap to read, punishes holding a straight line. */
  private formChecker(y: number, metres: number, t: number): number {
    const rows = t > 0.7 ? 6 : 4;
    let cy = y;
    let phase = randInt(this.rng, 0, 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if ((c + phase) % 2 === 0) this.put(c, cy, this.roll(metres));
      }
      phase ^= 1;
      cy += this.gap(metres) * 0.72;
    }
    return cy + this.gap(metres);
  }

  /**
   * Full-width CORE. No gaps, nothing to aim at, and nothing but a meltdown gets
   * through it — so it needs no warning text and no number. A banded wall with
   * glowing seams says "you are not hot enough for this" on sight.
   */
  private emitGate(y: number) {
    for (let c = 0; c < view.cols; c++) {
      this.blocks.push({
        x: c * view.cellW,
        y,
        w: view.cellW,
        h: CELL_H * 1.25,
        material: CORE,
        chips: 0,
        gate: true,
        dead: false,
      });
    }
  }

  /**
   * Chip a barrier you failed to melt. Enough chips soften it a grade, so a run
   * can never deadlock against a wall — you always have a way through, it just
   * costs hull to buy it.
   */
  static chip(b: Block) {
    b.chips++;
    if (b.chips >= CHIPS_PER_GRADE && b.material > GLASS) {
      b.chips = 0;
      b.material = (b.material - 1) as Material;
      return true;
    }
    return false;
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

  /**
   * Re-lay existing blocks onto a new lane grid. The window can be resized
   * mid-run, which changes `cols` and `cellW`; without this, blocks generated
   * under the old grid would hang in the air at stale x positions.
   */
  regrid(prevCellW: number, prevCols: number) {
    if (prevCellW <= 0 || prevCols <= 0) return;
    for (const b of this.blocks) {
      const col = Math.round(b.x / prevCellW);
      const scaled = Math.round((col / prevCols) * view.cols);
      b.x = clamp(scaled, 0, view.cols - 1) * view.cellW;
      b.w = view.cellW;
    }
  }
}
