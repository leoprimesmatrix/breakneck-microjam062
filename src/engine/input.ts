import { TAU, dampAngle } from './math';
import { screenToArena, view } from '../viewport';

/**
 * Input is polled, not evented, so the fixed-step simulation stays pure and
 * deterministic. The DOM handlers only ever *set* fields here.
 *
 * Three control schemes are supported and they are all the same two verbs —
 * "hold to aim", "release to strike":
 *
 *   mouse    aim at the cursor,      hold left button
 *   touch    aim at the finger,      hold anywhere
 *   keyboard steer aim with WASD,    hold space / shift
 *
 * The keyboard path exists because a surprising number of jam judges play on a
 * trackpad, where holding a button while moving precisely is genuinely awkward.
 */
export class Input {
  /** Pointer position in arena units. Tracked even when no button is down. */
  aimX = 0;
  aimY = 0;
  /** True when the pointer has ever moved — until then, keyboard aim leads. */
  pointerActive = false;

  /** True while the strike is being charged. */
  holding = false;
  /** True on the single frame the hold is released. */
  private releaseEdge = false;
  /** True on the single frame any confirm key/click begins. */
  private confirmEdge = false;
  private anyEdge = false;
  private pauseEdge = false;
  /**
   * True on the single frame a *pointer* press begins.
   *
   * Separate from `confirmEdge`, which a keypress also latches. Screen-space UI
   * hit-tests against the cursor, and a player pressing Space on the title
   * screen should not be treated as having clicked whatever the mouse happens
   * to be resting on.
   */
  private pointerEdge = false;

  /** Keyboard aim, in radians, integrated from the direction keys. */
  keyAngle = -Math.PI / 2;
  private keyAimActive = false;
  private up = false;
  private down = false;
  private left = false;
  private right = false;

  private canvas: HTMLCanvasElement;
  private held = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    addEventListener('keydown', this.onKeyDown, { passive: false });
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.releaseAll);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    addEventListener('pointerup', this.onPointerUp);
    addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------- keyboard
  private onKeyDown = (e: KeyboardEvent) => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;

    this.held.add(e.code);
    this.anyEdge = true;

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.up = true;
        this.keyAimActive = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.down = true;
        this.keyAimActive = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.left = true;
        this.keyAimActive = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.right = true;
        this.keyAimActive = true;
        break;
      case 'Space':
      case 'ShiftLeft':
      case 'ShiftRight':
        this.holding = true;
        this.keyAimActive = true;
        this.pointerActive = false;
        break;
      case 'Enter':
      case 'KeyR':
        this.confirmEdge = true;
        break;
      case 'Escape':
      case 'KeyP':
        this.pauseEdge = true;
        break;
    }
    if (e.code === 'Space' || e.code === 'Enter') this.confirmEdge = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.up = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.down = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.right = false;
        break;
      case 'Space':
      case 'ShiftLeft':
      case 'ShiftRight':
        if (this.holding) this.releaseEdge = true;
        this.holding = false;
        break;
    }
  };

  private releaseAll = () => {
    // A blur mid-charge must not leave the player frozen in slow motion forever.
    if (this.holding) this.releaseEdge = true;
    this.holding = false;
    this.up = this.down = this.left = this.right = false;
    this.held.clear();
  };

  // -------------------------------------------------------------- pointer
  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture is a nicety for drags that leave the canvas; a browser that
      // refuses the id must not take the whole input system down with it.
    }
    this.trackPointer(e);
    this.holding = true;
    this.pointerActive = true;
    this.keyAimActive = false;
    this.anyEdge = true;
    this.confirmEdge = true;
    this.pointerEdge = true;
  };

  private onPointerMove = (e: PointerEvent) => {
    this.trackPointer(e);
    this.pointerActive = true;
    this.keyAimActive = false;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.holding) this.releaseEdge = true;
    this.holding = false;
  };

  private trackPointer(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    // getBoundingClientRect is in CSS pixels of the *displayed* canvas, which is
    // exactly the space `screenToArena` expects — as long as the canvas is not
    // stretched, which the stylesheet guarantees.
    const p = screenToArena(e.clientX - r.left, e.clientY - r.top);
    this.aimX = p.x;
    this.aimY = p.y;
  }

  // ------------------------------------------------------------- per-frame
  /**
   * Advance keyboard aim. Called once per simulation step with *real* time, so
   * the reticle turns at the same rate whether or not the world is in slow
   * motion — aiming should never feel sluggish just because time is dilated.
   */
  update(dtReal: number) {
    const dx = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    const dy = (this.down ? 1 : 0) - (this.up ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      const target = Math.atan2(dy, dx);
      this.keyAngle = dampAngle(this.keyAngle, target, 15, dtReal);
    }
  }

  /**
   * Where the player is aiming, resolved to an angle from `(px, py)`.
   * Falls back to the keyboard angle when the pointer has not been used.
   */
  aimAngleFrom(px: number, py: number) {
    if (this.keyAimActive || !this.pointerActive) return this.keyAngle;
    const dx = this.aimX - px;
    const dy = this.aimY - py;
    if (dx * dx + dy * dy < 4) return this.keyAngle;
    return Math.atan2(dy, dx);
  }

  /** Keep the keyboard reticle in sync so switching devices never snaps. */
  syncKeyAngle(a: number) {
    this.keyAngle = ((a % TAU) + TAU) % TAU;
  }

  isDown(code: string) {
    return this.held.has(code);
  }

  takeRelease() {
    const v = this.releaseEdge;
    this.releaseEdge = false;
    return v;
  }

  takeConfirm() {
    const v = this.confirmEdge;
    this.confirmEdge = false;
    return v;
  }

  takePointerDown() {
    const v = this.pointerEdge;
    this.pointerEdge = false;
    return v;
  }

  takeAny() {
    const v = this.anyEdge;
    this.anyEdge = false;
    return v;
  }

  takePause() {
    const v = this.pauseEdge;
    this.pauseEdge = false;
    return v;
  }

  /** Screen-space cursor, for drawing the custom reticle. */
  cursorScreenX() {
    return this.aimX * view.scale + view.originX;
  }
  cursorScreenY() {
    return this.aimY * view.scale + view.originY;
  }
}

const SWALLOW = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Tab',
]);
