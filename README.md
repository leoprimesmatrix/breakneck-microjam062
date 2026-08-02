# BREAKNECK

*Speed is the only thing that cuts.*

A vertical fall-smasher for **Micro Jam 062** (theme: *Speed*, prerequisite:
*Speed is your weapon!*).

Diving builds **HEAT**. Heat is what melts through barriers, heat is your score
multiplier, and past the redline heat burns your hull. One resource, three jobs.

Barriers are made of something — glass, grate, plate, core — read by texture and
opacity, never by a number. Anything your current heat can melt glows and softens;
anything it cannot is cold and hazard-striped. No arithmetic, just looking.

## Run it

```bash
npm install && npm run dev
```

Production build (a single self-contained `dist/index.html`):

```bash
npm run build
```

## Controls

`W` dive · `A`/`D` steer · `S` vent · `Space` restart · `M` mute.
Touch: left/right thirds steer, middle dives, bottom vents.

## The loop

- **Dive** to build heat. Your hull runs dark when cold, then ember, orange, and
  white-hot — the ship *is* the gauge.
- **Melt** what your heat can reach. Smashing dumps more heat into you, so
  ploughing a soft gauntlet is what pushes you toward the redline.
- **Vent** with `S` before the burn eats your hull — but venting costs the heat
  that is also your multiplier and your melting power.
- **MELTDOWN** at maximum heat: four seconds where nothing can hurt you and even
  CORE walls open. It is bought with roughly a hull pip of burn, and it drops you
  out still hot — right back at the decision.
- **Descend through zones**, each 700m, each with its own palette, background and
  name card: the Approach, the Foundry, the Cryoshaft, the Reactor, the Deep
  Void, then round again deeper.
- **Get ranked** D through SS.

## How it's built

No engine. TypeScript on a 2D canvas, zero runtime dependencies, one ~60KB HTML
file (20KB gzipped).

- **`src/config.ts`** — every feel-critical constant. Tuning happens here, not
  scattered through the code.
- **Physics is drag-based, not thrust-based.** Posture changes your frontal area
  like a skydiver's; terminal velocity falls out of `sqrt(GRAVITY / drag)`.
- **The thermal equilibrium is the most important number in the game.** Heat gain
  is quadratic in speed against a constant passive vent, and they balance at a
  speed *above* the neutral-posture terminal and below the tuck terminal. So a
  player who does nothing cools, goes cold, and cannot melt anything. Heat has to
  be actively dived for.
- **Smashing heats you.** This is what killed "hold W": the strategy that breaks
  the most material is the one that cooks itself fastest.
- **Marginality weighs material toughness, not just headroom.** Glass melts at
  zero heat, so a cold player has no headroom over it — scoring that as a
  maximally marginal break made every pane cost 13% of velocity, and ploughing
  the gauntlets that are supposed to *build* heat instead bled it away.
- **The playfield fills the window.** Vertical lookahead is pinned, because
  visible depth is literally reaction time — scale to fit the width and a
  widescreen monitor gets half the reaction time of a phone. So the canvas scales
  by *height* and leftover width becomes extra lanes (7–14). Lane width stays
  near-constant, and the ship and every steering speed are expressed as fractions
  of a lane, so a 7-lane phone and a 14-lane monitor play identically.
- **The generator emits formations, not rows.** Independent per-column coin flips
  produce statistically correct mush — every row looks like every other one and
  the only skill is reacting to noise. Named shapes (a wall with one gap, a
  drifting corridor, a walking diagonal, a soft gauntlet built to be ploughed)
  give the player something to read ahead and get better at. Every lane count is
  a fraction of the field, never an absolute.
- **CORE is the reason steering exists.** It cannot be melted without a meltdown,
  so it is the one thing that must always be gone around.
- **A bounce keeps you falling.** Reversing velocity on a failed impact cost all
  your speed, which cost your heat, which cost your ability to melt the next
  barrier — four hull in three seconds with no way out.
- **Collision is swept** over the vertical span travelled each step, because at
  1800 px/s a discrete check tunnels straight through barriers.
- **Fixed 120Hz sim** with an accumulator, so feel is identical on a 60Hz laptop
  and a 144Hz monitor.
- **Real post-processing.** The playfield renders into an offscreen buffer sized
  to the viewport, then gets a downscale-blur-add bloom pass, channel-split
  chromatic aberration, film grain and scanlines. Emissive art on a near-black
  field is what makes the additive pass behave like light rather than a blur.
- **All audio is synthesised at runtime** via Web Audio — no files. Break sounds
  walk up a minor-pentatonic scale as the chain grows and sit lower for tougher
  material; the redline gets a continuous tremolo alarm; meltdown shifts the whole
  sequencer up a gear.

Balance was calibrated against scripted bots rather than guessed — one holding the
dive, one pressing nothing, one running a heat thermostat and steering around what
it cannot melt. The thermostat bot has to win and holding the dive has to be the
*fastest way to die*. Both are now true; both were false at the first three tuning
passes. `__advance()` and `__render()` are exposed on `window` in dev builds for
exactly this, because headless/backgrounded tabs never fire `requestAnimationFrame`.

## Shipping

`ITCH_PAGE.md` has the page copy and the exact upload settings. The build is
deliberately a **single `index.html`** — a zip made on Windows can carry backslash
separators that break nested asset paths once itch.io unpacks it.
