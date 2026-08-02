import { Input } from './engine/input';
import { Game } from './game/game';
import { render } from './render/renderer';

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
  w.__render = () => render(ctx, game, cssW, cssH, dpr);
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

let cssW = 0;
let cssH = 0;
let dpr = 1;

/**
 * The canvas fills the window rather than being letterboxed to the shaft's
 * 540x760. The shaft is still authored at that size and is centred inside the
 * canvas by the renderer; the leftover width becomes the exterior. Letterboxing
 * left ~480px of dead black on either side of a desktop window, which is what
 * made the game read as a squashed strip.
 *
 * Idempotent and self-healing, and called every frame rather than only on the
 * `resize` event: itch.io embeds the game in an iframe that is commonly hidden
 * behind a "click to play" splash. The page then lays out at 0x0, and no resize
 * event fires when it is later revealed — so a one-shot resize leaves a
 * zero-sized canvas and the game renders nothing at all.
 */
function resize() {
  const d = Math.min(devicePixelRatio || 1, 2);
  const availW = innerWidth || document.documentElement.clientWidth || 0;
  const availH = innerHeight || document.documentElement.clientHeight || 0;

  // Not laid out yet. Leave the previous size alone and try again next frame.
  if (availW <= 0 || availH <= 0) return;
  if (availW === cssW && availH === cssH && d === dpr) return;

  cssW = availW;
  cssH = availH;
  dpr = d;

  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
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

  // Cheap no-op when nothing changed; the safety net for hidden/late-laid-out
  // iframes that never emit a resize event.
  resize();
  if (cssW <= 0 || cssH <= 0) return;

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

  render(ctx, game, cssW, cssH, dpr);
}

requestAnimationFrame(frame);
