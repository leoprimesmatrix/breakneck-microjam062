import {
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
  gate: boolean;
  dead: boolean;
  /** A block only ever awards one GRAZE. */
  grazed: boolean;
}

/**
 * Rows are streamed in ahead of the camera and compacted away behind it.
 * Difficulty is a pure function of depth, so a run is always fair for its depth.
 */
export class World {
  blocks: Block[] = [];

  private rng = makeRng(1);
  private nextRowY = 0;
  private nextGateM = GATE_EVERY_M;

  reset(seed: number) {
    this.blocks.length = 0;
    this.rng = makeRng(seed);
    this.nextRowY = 620; // a beat of open air before the first row
    this.nextGateM = GATE_EVERY_M;
  }

  /** Difficulty 0..1 from depth in metres. */
  private difficultyAt(metres: number) {
    return smoothstep(metres / RAMP_DEPTH);
  }

  /** Stream rows until we're generated well past the bottom of the view. */
  ensure(cameraBottomY: number) {
    let guard = 0;
    while (this.nextRowY < cameraBottomY + VIEW_H && guard++ < 64) {
      const metres = this.nextRowY / PX_PER_M;
      const t = this.difficultyAt(metres);

      if (metres >= this.nextGateM) {
        this.emitGate(this.nextRowY);
        this.nextGateM += GATE_EVERY_M;
        // A gate earns a wider breather on the far side.
        this.nextRowY += lerp(ROW_GAP_START, ROW_GAP_END, t) * 1.6;
      } else {
        this.emitRow(this.nextRowY, t);
        this.nextRowY += lerp(ROW_GAP_START, ROW_GAP_END, t);
      }
    }
  }

  private emitRow(y: number, t: number) {
    const th = smoothstep(y / PX_PER_M / HARD_RAMP_DEPTH);
    const density = lerp(DENSITY_START, DENSITY_END, t);
    const hardMax = clamp(Math.round(lerp(3, 9, th)), 3, 9);
    // The floor rises with depth so early blocks stay smashable at low speed.
    const hardMin = clamp(Math.round(lerp(1, 3, th)), 1, hardMax);

    const filled: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (this.rng() < density) filled.push(c);
    }

    // Always leave at least one clean lane: weaving must remain an option.
    while (filled.length > COLS - 1) filled.pop();
    // ...and never emit a row that is entirely empty; it reads as a bug.
    if (filled.length === 0) filled.push(randInt(this.rng, 0, COLS - 1));

    for (const c of filled) {
      this.blocks.push({
        x: c * CELL_W,
        y,
        w: CELL_W,
        h: CELL_H,
        hardness: randInt(this.rng, hardMin, hardMax),
        gate: false,
        dead: false,
        grazed: false,
      });
    }
  }

  /** Full-width skill check: no gaps, one hardness, break it or bleed. */
  private emitGate(y: number) {
    const th = smoothstep(y / PX_PER_M / HARD_RAMP_DEPTH);
    const hardness = clamp(Math.round(lerp(2, 8, th)), 2, 9);
    for (let c = 0; c < COLS; c++) {
      this.blocks.push({
        x: c * CELL_W,
        y,
        w: CELL_W,
        h: CELL_H * 1.25,
        hardness,
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
