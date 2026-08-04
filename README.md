# AFTERBURN

*Speed is the only weapon you have.*

An arena game for **Micro Jam 062** (theme: *Speed*, prerequisite:
*Speed is your weapon!*). Pure HTML5 canvas, no assets, no dependencies at
runtime — the whole game ships as one self-contained `index.html`.

## The idea

You cannot walk. You cannot shoot. You can only **strike**: a blinding
straight-line burst that kills whatever it passes through.

**Hold** to aim, and the world drops into bullet time. A line extends from your
ship showing exactly what the strike will hit, in the order it will hit it, and
exactly where it will stop. **Release**, and you become that line.

That preview is the whole design. The old failure mode of a fast game is that it
is unreadable; here, the player controls the tempo and is *shown the outcome
before committing to it*. Speed stops being chaos and becomes a decision.

The cost is **FOCUS**. Aiming drains it in real time; kills refill it. Run dry
and the world stops slowing down for you — you can still strike, you just have to
do it at full speed. Aggression buys thinking time. Hesitation spends it.

## Enemies

One rule, one exception.

| | |
|---|---|
| **MOTE** | Drifts toward you. Anything on your line dies. |
| **SEEDER** | Bursts into three Motes when it dies. |
| **WARD** | Its shield turns to face you. Strike the flank. |
| **LANCER** | Marks a line, then charges down it. Get off the line. |
| **SPINE** | Rooted gun. Its orbs sit on your line like anything else. |

Each one introduces itself with a one-line rule card the first time it appears.
The WARD is the exception to "everything on the line dies" — and the aim preview
shows the block in red *before* you commit, so the lesson costs you a beat of
tempo, never a hull point you did not see coming.

## Run it

```bash
npm install && npm run dev
```

Production build — a self-contained `dist/index.html` (126 kB, 41 kB gzipped)
beside `dist/music/`, the ten soundtrack files:

```bash
npm run build
```

`promo/AFTERBURN-web.zip` is that build as it was actually uploaded to itch.io,
kept here so the submitted artefact survives independently of the page.

## Controls

| | |
|---|---|
| Mouse | aim at the cursor · **hold left button** to charge · release to strike |
| Keyboard | **WASD** / arrows steer the reticle · **hold Space** or **Shift** · release |
| Touch | touch anywhere to aim through that point · release to strike |
| | `P` / `Esc` pause · `M` mute · `F` frame stats |

## How the theme is used

Theme and prerequisite are the same system, not two features bolted together.
Your velocity *is* the weapon — there is no other damage source in the game — and
the contrast between bullet-time aiming and a 3000-unit-per-second strike is what
makes that velocity legible as power rather than as noise.

## Architecture

```
src/
  main.ts          fixed-120Hz loop, canvas sizing, dev hooks
  viewport.ts      constant-area arena; aspect follows the window
  config.ts        every tunable, one file
  engine/
    math.ts        easing, damping, seeded RNG, segment math
    input.ts       polled mouse / keyboard / touch
    juice.ts       hitstop, shake, flash, lens punch
    particles.ts   fixed-capacity additive pool
    audio.ts       procedural WebAudio for every effect, plus the music bus
    music.ts       the soundtrack: shuffled bag, two decks, crossfade
  game/
    strike.ts      the solver — runs the preview and the strike itself
    enemies.ts     five behaviours, one shared pool
    waves.ts       twelve authored waves, then procedural
    player.ts      two-state machine: drift / strike
    game.ts        rules, scoring, wave flow, teaching
  render/
    glyphs.ts      bespoke vector display typeface
    text.ts        vector + system type setting
    glow.ts        halos, blurred in a buffer that fits them
    quality.ts     measures frame time, decides what the machine can afford
    scene.ts       arena, entities, aim preview
    hud.ts         crisp screen-space HUD
    screens.ts     title, pause, results
    postfx.ts      bloom, chromatic aberration, grain
    renderer.ts    frame assembly
```

Three details worth knowing:

- **`strike.ts` is run twice per frame's worth of intent** — once to draw the
  preview and once to execute. It is deliberately one function, because two
  implementations would eventually disagree, and the moment a player is shown
  three kills and dealt two is the moment they stop trusting the only thing the
  game asks them to trust.
- **The display face is vector data, not a webfont.** It ships inside the bundle,
  renders identically everywhere, and can be drawn on progressively — which is
  where the title sequence comes from.
- **No glow is ever blurred at screen size.** `ctx.filter = 'blur()'` allocates
  and blurs a layer the size of the clip — the whole canvas — for every draw it
  touches, so eight glowing things cost eight full-screen Gaussians a frame. A
  blur is low-frequency by definition, so `glow.ts` renders each halo into a
  small buffer, blurs it there, and scales it back up. Same image; a few thousand
  pixels instead of five million. If the frame budget still slips, `quality.ts`
  sheds effects in order of what is least missed — press `F` to watch it.

## Press kit

Everything that was ever made to sell this game is in `promo/`, at the size it
was made, so the repository is the archive rather than a pointer to one.

| | |
|---|---|
| `thumbnail.png` | 1260×1000 key art — the cover the GIF resolves into |
| `cover.gif` | 630×500 itch cover: gameplay, then it lands on the key art and holds |
| `title-anim.mp4` | 1920×1080/60 title sequence — the wordmark shattered and reassembled |
| `title-anim.gif` | the same piece at 560×315, under itch's 3 MB image limit |
| `title-still.png` | its final frame, for anywhere a flat lockup is wanted |
| `shot-*.png` | the three page screenshots at 1600×900 |
| `full/shot-*.png` | the same three at full canvas resolution, before downscaling |
| `ITCH_PAGE.md` | every field of the itch.io submission form, ready to paste |
| `SOCIAL_POSTS.md` | the launch posts for X, Instagram and Discord |
| `AFTERBURN-web.zip` | the exact build uploaded to the jam |

Two of the pieces are programs rather than pictures. `composer.mjs` draws the
key art and `titlecard.mjs` renders the title sequence, both using the game's
own modules — the real ship, the real enemy bodies, the real display face — so
the marketing is the game rather than an impression of it. Neither is imported
by the game; both are loaded by hand from the browser console against
`npm run dev`, and they render offline, a frame at a time.

`audio/masters/` holds the eleven generated takes the soundtrack was cut from.
`public/music/` has the ten that shipped, levelled and renamed.

## Credits

Built by Leonardo Diaz for Micro Jam 062. The art, the typeface and every
sound effect are generated at runtime from code in this repository; the ten
soundtrack files in `public/music/` are the one thing loaded rather than
computed. A fallback sequencer in `audio.ts` still plays if they cannot be
fetched, so the game is never silent.
