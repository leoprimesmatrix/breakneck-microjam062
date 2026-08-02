# BREAKNECK

*Speed is the only thing that cuts.*

A vertical fall-smasher for **Micro Jam 062** (theme: *Speed*, prerequisite:
*Speed is your weapon!*).

Every block is stamped with a hardness number. Your speed in km/h **is** your
damage — clear the number and you burst through it, fall short and it wrecks you.
Steering authority drops as you accelerate, so being fast enough to break most
things means being unable to aim.

## Run it

```bash
npm install && npm run dev
```

Production build (a single self-contained `dist/index.html`):

```bash
npm run build
```

## Controls

`A`/`D` steer · `W` tuck · `S` air-brake · `Space` restart · `M` mute.
Touch: left/right thirds steer, middle tucks, bottom brakes.

## The loop

- **Break** blocks whose number your speed clears — your live POWER number
  (km/h ÷ 60) rides beside the ship, so "mine beats theirs" is always visible.
  Chain breaks for a multiplier.
- **Charge OVERDRIVE** off breaks and grazes. When it fills, hardness stops
  mattering for four seconds and you plough the shaft — the payoff you are
  actually playing for.
- **Descend through zones**, each 700m, each with its own palette, background and
  name card: the Approach, the Foundry, the Cryoshaft, the Reactor, the Deep
  Void, then round again.
- **Get ranked** D through SS at the end of the run.

## How it's built

No engine. TypeScript on a 2D canvas, zero runtime dependencies, one ~55KB HTML
file (19KB gzipped).

- **`src/config.ts`** — every feel-critical constant. Tuning happens here, not
  scattered through the code.
- **Physics is drag-based, not thrust-based.** Posture changes your frontal area
  like a skydiver's; terminal velocity falls out of `sqrt(GRAVITY / drag)`.
  Neutral settles at tier 4, a held tuck reaches **tier 8**, the air-brake drops
  you to tier 1. Tier 8 rather than 9 is deliberate and load-bearing: at 9 a
  held dive breaks everything the generator can emit, nothing on screen ever has
  to be steered around, and the premise never gets tested. Tier 9 is reachable
  only transiently, so hardness-9 blocks are genuine walls.
- **The generator emits formations, not rows.** Independent per-column coin
  flips produce statistically correct mush — every row looks like every other
  one and the only skill is reacting to noise. Named shapes (a wall with one
  gap, a drifting corridor, a walking diagonal, a soft gauntlet built to be
  ploughed) give the player something to read ahead and get better at.
- **Collision is swept** over the vertical span travelled each step, because at
  1800 px/s a discrete check tunnels straight through blocks.
- **Fixed 120Hz sim** with an accumulator, so feel is identical on a 60Hz laptop
  and a 144Hz monitor.
- **The canvas is full-bleed.** The shaft is authored at a fixed 540x760 and
  centred; the leftover width is a parallax exterior with a scrolling depth
  ruler and live telemetry. Letterboxing the shaft into dead black is what made
  the game read as a squashed strip on a desktop monitor.
- **Real post-processing.** The shaft renders into an offscreen buffer, then gets
  a downscale-blur-add bloom pass, channel-split chromatic aberration at speed,
  film grain and scanlines. Emissive art on a near-black field is what makes the
  additive pass behave like light rather than like a blur filter.
- **All audio is synthesised at runtime** via Web Audio — no files. Break sounds
  walk up a minor-pentatonic scale as your chain grows, the music's tempo is
  driven by your velocity, and overdrive shifts the whole sequencer up a gear.
- **Impact feedback scales with significance**, not chain length: smashing a 1 at
  tier 8 is nearly free, smashing an 8 costs real momentum and punches hard.

Balance numbers (rank thresholds, health, difficulty ramps) were calibrated
against simulated runs — a bot holding the dive, a bot doing nothing — rather
than guessed. `__advance()` and `__render()` are exposed on `window` in dev
builds for exactly that.

## Shipping

`ITCH_PAGE.md` has the page copy and the exact upload settings. The build is
deliberately a **single `index.html`** — a zip made on Windows can carry backslash
separators that break nested asset paths once itch.io unpacks it.
