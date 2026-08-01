# BREAKNECK

*Speed is the only thing that cuts.*

A vertical fall-smasher for **Micro Jam 062** (theme: *Speed*, prerequisite:
*Speed is your weapon!*).

Every block is stamped with a hardness number. Your speed in km/h **is** your
damage — clear the number and you burst through it, fall short and it wrecks you.
Steering authority drops as you accelerate, so being fast enough to break
anything means being unable to aim.

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

## How it's built

No engine. TypeScript on a 2D canvas, zero runtime dependencies, ~24KB shipped.

- **`src/config.ts`** — every feel-critical constant. Tuning happens here, not
  scattered through the code.
- **Physics is drag-based, not thrust-based.** Posture changes your frontal area
  like a skydiver's; terminal velocity falls out of `sqrt(GRAVITY / drag)`.
  Neutral settles at tier 4, a held tuck reaches tier 9, the air-brake drops you
  to tier 1. This is what stops the game playing itself — without drag you pin
  the top tier in two seconds of doing nothing.
- **Collision is swept** over the vertical span travelled each step, because at
  1800 px/s a discrete check tunnels straight through blocks.
- **Fixed 120Hz sim** with an accumulator, so feel is identical on a 60Hz laptop
  and a 144Hz monitor.
- **All audio is synthesised at runtime** via Web Audio — no files. Break sounds
  walk up a minor-pentatonic scale as your chain grows, and the music's tempo is
  driven by your velocity.
- **Impact feedback scales with significance**, not chain length: smashing a 1 at
  tier 9 is nearly free, smashing a 9 at tier 9 costs real momentum and punches
  hard.

## Shipping

`ITCH_PAGE.md` has the page copy and the exact upload settings. The build is
deliberately a **single `index.html`** — a zip made on Windows can carry backslash
separators that break nested asset paths once itch.io unpacks it.
