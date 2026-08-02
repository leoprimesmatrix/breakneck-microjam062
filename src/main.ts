import { Input } from './engine/input';
import { Game } from './game/game';
import { render } from './render/renderer';
import { updateViewport, view } from './viewport';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

const input = new Input(canvas);
const game = new Game(input);

if (import.meta.env.DEV) {
  // Silent during development. Guarded by DEV so the shipped build is unaffected;
  // press M in the dev tab to hear it.
  game.audio.setMuted(true);

  // Dev-only handles so the sim can be driven and asserted on without a display.
  // Headless browsers and backgrounded tabs never fire requestAnimationFrame, so
  // verifying a change needs a way to advance and draw on demand.
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__input = input;
  w.__render = () => render(ctx, game);
  w.__advance = (seconds: number) => {
    const n = Math.round(seconds * 120);
    for (let k = 0; k < n; k++) game.step(FIXED_DT);
  };
}

/**
 * The sim runs at a fixed 120Hz regardless of display refresh, so collision
 * thresholds and feel are identical on a 60Hz laptop and a 144Hz monitor.
 */
const FIXED_DT = 1 / 120;
const MAX_STEPS = 8;

/**
 * The playfield fills the window. `updateViewport` derives the logical field
 * size and lane count from the canvas; everything downstream reads `view`.
 *
 * Called every frame rather than only on the `resize` event: itch.io embeds the
 * game in an iframe that is commonly hidden behind a "click to play" splash. The
 * page then lays out at 0x0, and no resize event fires when it is later
 * revealed — so a one-shot resize leaves a zero-sized canvas and the game
 * renders nothing at all. Bailing on a zero measurement and re-checking each
 * frame is what makes it come back.
 */
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const availW = innerWidth || document.documentElement.clientWidth || 0;
  const availH = innerHeight || document.documentElement.clientHeight || 0;
  if (availW <= 0 || availH <= 0) return;

  const prevCellW = view.cellW;
  const prevCols = view.cols;
  if (!updateViewport(availW, availH, dpr)) return;

  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);

  // A mid-run resize changes the lane grid. Existing blocks were generated
  // against the old one, so re-lay them or they hang in the air at stale
  // positions the player can no longer reach.
  if (prevCols !== view.cols || Math.abs(prevCellW - view.cellW) > 0.01) {
    game.world.regrid(prevCellW, prevCols);
  }
}

addEventListener('resize', resize);
resize();

// Browsers start every AudioContext suspended; it can only be created or resumed
// inside a real user gesture, so hang it off the first one we see.
const unlockAudio = () => game.audio.ensure();
addEventListener('keydown', unlockAudio);
addEventListener('pointerdown', unlockAudio);

// M mutes. Judges often play with a stream or music running.
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') game.audio.toggleMute();
});

let last = performance.now();
let acc = 0;

function frame(now: number) {
  requestAnimationFrame(frame);

  resize();
  if (view.w <= 0 || view.h <= 0) return;

  // Clamp so an alt-tab or a stalled tab never fast-forwards the run.
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;

  acc += elapsed;
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS) {
    game.step(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0; // gave up catching up; drop the backlog

  // Music is scheduled against the audio clock, not the frame clock, so RAF
  // jitter never shows up as timing wobble.
  game.audio.tick();

  render(ctx, game);
}

requestAnimationFrame(frame);
