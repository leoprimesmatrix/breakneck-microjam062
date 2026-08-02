import { Input } from './engine/input';
import { Game } from './game/game';
import { solveStrike } from './game/strike';
import { render } from './render/renderer';
import { resetHud } from './render/hud';
import { updateViewport, view } from './viewport';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

/**
 * Dismiss the pre-boot splash. Owned by the module that replaces it rather than
 * by an inline script in the document: a second inline module is treated as its
 * own entry point by the bundler and disappears when the build collapses the
 * whole thing into one file — leaving "LOADING" printed over a running game.
 */
function dismissSplash() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 500);
}

/**
 * The viewport has to exist before the game does — `Game` places the player at
 * the centre of the arena in its constructor, and an arena of size zero would
 * put it at the origin and leave the first frame looking broken.
 */
sizeCanvas();

const input = new Input(canvas);
const game = new Game(input);

/**
 * Fixed 120Hz simulation regardless of display refresh, so strike timing,
 * collision and feel are identical on a 60Hz laptop and a 240Hz monitor.
 */
const FIXED_DT = 1 / 120;
const MAX_STEPS = 8;

function sizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth || document.documentElement.clientWidth || 0;
  const h = innerHeight || document.documentElement.clientHeight || 0;
  if (w <= 0 || h <= 0) return false;

  const prevW = view.arenaW;
  const prevH = view.arenaH;
  if (!updateViewport(w, h, dpr)) return false;

  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  return { prevW, prevH };
}

/**
 * Called every frame, not only on the `resize` event. itch.io embeds the game
 * in an iframe that is commonly hidden behind a "click to play" splash; the
 * page lays out at 0x0 and no resize event fires when it is later revealed, so
 * a one-shot resize leaves a zero-sized canvas and the game renders nothing at
 * all. Re-checking each frame is what makes it come back.
 */
function resize() {
  const r = sizeCanvas();
  if (r && typeof r === 'object') game.onResize(r.prevW, r.prevH);
}

addEventListener('resize', resize);

// Browsers start every AudioContext suspended; it can only be created or
// resumed inside a real user gesture, so hang it off the first one we see.
const unlock = () => game.audio.ensure();
addEventListener('keydown', unlock);
addEventListener('pointerdown', unlock);

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') game.audio.toggleMute();
});

// A tab that loses focus mid-run should not come back to a dead player.
addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'play') {
    game.state = 'paused';
    game.audio.setRunning(false);
  }
});

if (import.meta.env.DEV) {
  // Headless browsers and backgrounded tabs never fire requestAnimationFrame,
  // so verifying a change needs a way to advance and draw on demand.
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__input = input;
  w.__view = view;
  w.__render = () => render(ctx, game);
  w.__advance = (seconds: number) => {
    const n = Math.round(seconds * 120);
    for (let k = 0; k < n; k++) game.step(FIXED_DT);
  };
  w.__resetHud = resetHud;
  // Lets a headless driver evaluate a heading without advancing the world,
  // which is what makes an automated balance pass possible at all.
  w.__solve = (angle: number) => {
    const p = solveStrike(game.swarm, game.player.x, game.player.y, angle, 0);
    return { kills: p.kills, dist: p.dist, blocked: p.blocked };
  };
}

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
  if (!booted) {
    booted = true;
    dismissSplash();
  }
}

let booted = false;
requestAnimationFrame(frame);
// Belt and braces: a tab that is backgrounded at load may never receive a frame,
// and the splash must not outlive the game underneath it.
setTimeout(dismissSplash, 1200);
