/**
 * Keyboard + touch. Reads as a simple polled state so the sim stays pure.
 * Touch: left/right thirds steer, bottom band brakes, everything else tucks.
 */
export class Input {
  left = false;
  right = false;
  tuck = false;
  brake = false;

  /** True only on the frame a "confirm/restart" press begins. */
  private confirmEdge = false;
  private anyKeyEdge = false;

  private canvas: HTMLCanvasElement;
  private touches = new Map<number, { x: number; y: number }>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    addEventListener('keydown', this.onKeyDown, { passive: false });
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.releaseAll);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) {
      // Still swallow scroll keys on repeat, but don't re-fire edges.
      if (SCROLL_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();

    this.anyKeyEdge = true;
    switch (e.code) {
      case 'KeyA':
      case 'ArrowLeft':
        this.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.right = true;
        break;
      case 'KeyW':
      case 'ArrowUp':
        this.tuck = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.brake = true;
        break;
      case 'KeyR':
      case 'Space':
      case 'Enter':
        this.confirmEdge = true;
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyA':
      case 'ArrowLeft':
        this.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.right = false;
        break;
      case 'KeyW':
      case 'ArrowUp':
        this.tuck = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.brake = false;
        break;
    }
  };

  private releaseAll = () => {
    this.left = this.right = this.tuck = this.brake = false;
    this.touches.clear();
  };

  // ------------------------------------------------------------ touch
  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.touches.set(e.pointerId, this.localPoint(e));
    this.anyKeyEdge = true;
    this.confirmEdge = true;
    this.applyTouches();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, this.localPoint(e));
    this.applyTouches();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    this.applyTouches();
  };

  private localPoint(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  private applyTouches() {
    let left = false;
    let right = false;
    let tuck = false;
    let brake = false;

    for (const p of this.touches.values()) {
      if (p.y > 0.78) brake = true;
      else if (p.x < 0.33) left = true;
      else if (p.x > 0.67) right = true;
      else tuck = true;
    }

    this.left = left;
    this.right = right;
    this.tuck = tuck;
    this.brake = brake;
  }

  // ------------------------------------------------------------ edges
  /** Consume the confirm edge (restart / start). */
  takeConfirm() {
    const v = this.confirmEdge;
    this.confirmEdge = false;
    return v;
  }

  /** Consume the "any input happened" edge. */
  takeAnyKey() {
    const v = this.anyKeyEdge;
    this.anyKeyEdge = false;
    return v;
  }
}

const SCROLL_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
