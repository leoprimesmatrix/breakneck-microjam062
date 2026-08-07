# titlecard2 — the v2 title sequence renders

The second-generation AFTERBURN title sequence, plus its render pipeline. The
first generation (`promo/titlecard.mjs`) rendered against `npm run dev` and
needed node on the machine; this one needs **nothing installed at all** — a
PowerShell static server stands in for vite, hand-ported JS stands in for the
TS modules, and the browser itself encodes the mp4 (WebCodecs H.264) and the
GIF (gifenc). The finished files land in `promo/` beside the v1 assets, which
are kept untouched.

## Outputs

| file | variant | sky | arrival |
|---|---|---|---|
| `promo/title-anim-v2.{mp4,gif}` | the sequence | companion | — |
| `promo/title-coming-soon.{mp4,gif}` | "COMING SOON." at the bottom of frame, after a breath | companion | — |
| `promo/title-august-2026.{mp4,gif}` | "AUGUST 2026", same placement | companion | — |
| `promo/title-ship-coming-soon.{mp4,gif}` | the interceptor coils on the words' spot, strikes away through the top of frame, and "COMING SOON." is what the flash leaves behind | eclipse | sweep |
| `promo/title-ship-august-2026.{mp4,gif}` | the same beat, closing on "AUGUST 2026" | companion | dive |
| `promo/title-ship-strike.{mp4,gif}` | the third arrival — a full-speed crossing that hooks back against its own momentum — closing on "COMING SOON." | rise | strafe |
| `promo/teaser-coming-soon.mp4` | the ~24s teaser: galaxy vista with the game's pitch as cards, the ship's hero run and charge, and its strike white-out smash-cutting into the whole title beat |
| `promo/teaser-august-2026.mp4` | the same teaser, closing on "AUGUST 2026" |
| `promo/trailer.mp4` | the ~83s trailer: a gas giant with a star cresting its limb, a graveyard of hulls with something waking in it, one live ship and the line it cashes, three half-lit hunters, a six-kill rush, and the title beat |

mp4s are 1920×1080@60, ~12 Mbps. GIFs are 560×315 under itch's 3 MB limit.
The teasers are mp4-only — 24 seconds does not fit under a 3 MB GIF cap at
any honest frame rate.

## What v2 adds over v1

- **A cold open**: the mark is never seen whole. The video opens
  mid-detonation — shards already riding the blast wave, camera still
  recoiling from an impact the viewer just missed. The word is the payoff,
  never the setup.
- **A room that moves**: two parallax nebula layers that rotate and breathe,
  a spiral galaxy turning in its own plane, wisps streaming across the sky,
  scheduled comets, three planes of twinkling starfield that streak when
  impacts hit — and a deck under everything carrying a blurred reflection of
  the whole sequence, with glints racing the horizon at each big hit.
- **Real debris physics**: pieces ride an elliptical blast wave out, drift in
  a differentially-rotating field, come home on curved paths banking
  nose-first into the turn, land with directional overshoot and sparks. A
  tenth hold back and whip in late.
- **Metal instead of strokes**: tapered two-pass shards with a white-hot core
  that follows the temperature arc, and glints where the tumble catches the
  key light.
- **Bigger impacts**: anamorphic lens streaks, per-letter landing rings and
  camera kicks, film grain, camera roll, a bullet-time lean-in while the
  ship charges.

## Files

- `seq.mjs` — the sequence. Variant via query:
  `seq.mjs?v=plain|soon|date|shipsoon|shipdate`.
- `teaser.mjs` — the three-act teaser. Acts I–II (galaxy vista with text
  cards, the ship's run and charge) are its own scenes; Act III delegates to
  `seq.mjs` — the release white-out decays into the title beat's cold open,
  so the strike you watch is the impact the title opens on. Variant via
  `teaser.mjs?v=soon|date`.
- `space.mjs` — the place everything happens in. Per-pixel shaded spheres
  (banded surface, wrapped terminator, limb darkening, a Fresnel rim of
  atmosphere on the lit edge), baked ring textures drawn in two halves so the
  planet sits inside its own rings and casts a shadow across them, ridged-fbm
  nebula puffs placed in a 3D volume, dust lanes that occlude by
  `destination-out` rather than painting grey, a colour-temperature starfield
  the camera flies through, wreck hulls as near-black silhouettes with one lit
  edge, and a lens flare restrained enough to read as glass. Nothing animates
  that does not have to: the bakes are one-time and seeded.

- `trailer.mjs` — the ~83s trailer: six acts (the vista, the graveyard, the
  move, three hunters, the rush) and the delegated title finale.

  **The rule the first two versions broke:** a shot staged in a black void
  gives the eye nothing to want, and no amount of retiming fixes that. So the
  order here is place first, game second — a gas giant with a star climbing out
  from behind its limb, a field of dead hulls, a nebula interior, a moon. Every
  frame is meant to hold up paused.

  It is cut like a trailer rather than played like a demo. Every act is a dolly
  move with its own start and end framing, hard cuts land as dip-to-blacks with
  a zoom bump the camera absorbs, three octaves of handheld drift ride
  underneath, and the charge before the release is a real speed ramp. A 2.2:1
  letterbox comes in over the first breath and leaves with the white-out. Each
  act carries its own exposure, so the ones with actors in them stop the room
  down and let the ship be the brightest thing on screen.

  The cards live in the middle of the frame: a small setup line tracks itself
  in letter by letter, then the closing word **slams** to size against a
  radial scrim, with a flash, flanking rules sliding out from its shoulders,
  a camera kick and a white blink. The punchline always lands *after* the
  moment it is about, and the copy withholds — "EVERY SHIP THAT CAME HERE /
  NEVER LEFT." tells you less than it implies, which is the point.
- `foes.mjs` — the enemy bodies, hand-ported from `src/render/bodies.ts` and
  `src/game/enemies.ts`: silhouettes, hull ramp, rim lighting, and the four
  species the trailer shows (the SPINE is deliberately absent). Plus
  `burstFoe`, a death that breaks the real outline apart edge by edge.
- `lib.mjs` — hand-ported copies of `src/config.ts` (palette),
  `src/render/glyphs.ts` (display face), the sprite half of `glow.ts`, and the
  `drawShip` half of `ship.ts`. Data is verbatim; if the game's face or ship
  changes, re-copy it.

  One trap worth knowing: `drawRadial` *multiplies* its `alpha` argument by
  the canvas's current `globalAlpha` rather than replacing it. A block of
  glows therefore inherits whatever the last thing drawn happened to leave
  behind — and when that thing fades out and stops drawing at all, the glows
  silently go with it. Set `ctx.globalAlpha` explicitly at the top of any
  group of `drawRadial` calls.
- `encode.mjs` — WebCodecs → mp4-muxer, and gifenc with a global palette and
  a fit-under-3MB retry ladder. Both libs load from esm.sh at render time.
- `run.html` — harness page with preview buttons, `TC.still()`, and
  `RUNV(variant)`.
- `serve.ps1` — static file server + `POST /save` sink on `localhost:8788`.
- `tmp/` — preview stills the harness POSTs back while iterating (gitignored).

## Re-rendering

```
powershell -ExecutionPolicy Bypass -File promo/titlecard2/serve.ps1
```

then open `http://localhost:8788/`, and in the console:

```js
await RUNV('plain');   // or 'soon' | 'date' | 'shipsoon' | 'shipdate'
await RUNT('date');    // or 'soon' — the teaser, mp4 only
await RUNFULL();       // the story trailer, mp4 only, 9 Mbps
```

The GIF ladder reaches far enough for the longest variant on its own now. It
used to stop four rungs in, which lands the 543-frame `plain` at 2.8 MB and the
753-frame ship variants at 3.3-4.2 MB — over itch's cap, and shipped anyway,
because running off the end of the ladder was silent. It now steps down to
`{skip:3, colors:128, delay:15, refresh:30}` and returns `overCap` (plus a
console warning) if even that is not enough.

Where each variant landed: plain 2.71 MB, soon 2.75, date 2.75, ship-coming-soon
2.45, ship-august-2026 2.11, ship-strike 2.71. The 753-frame variants pay for it
in frame rate — `shipdate` needed the last rung — which is the honest trade at
a 3 MB cap for a 12.5-second piece. The mp4 is the asset; the GIF is for itch's
cover slot.

Progress is in `window.__prog`. Every render is deterministic — same seeds,
same frames, same bytes, no wall clock anywhere.
