# itch.io page — copy & settings

Everything below is ready to paste. The two "How I used…" sections exist because
**Use of theme** and **Use of prerequisite** are each a scored criterion, and most
entries leave the judge to infer it. Spelling it out costs nothing and is worth
real points.

---

## Title

```
BREAKNECK
```

## Short description / tagline (the one-liner under the title)

```
Speed is the only thing that cuts. Outrun a block's number to smash through it — too slow, and it smashes you.
```

---

## Page body

```
Every block in the shaft is stamped with a number. That number is how fast you
have to be going to destroy it.

Your speedometer IS your damage. Hit a 7 doing 400 km/h and you burst straight
through it. Hit it doing 200 and it wrecks you instead.

But the faster you fall, the less you can steer. And a held dive tops out at
tier 8 — so the 9s are walls, and you have to go around them at the exact speed
where going around anything is hardest.


CONTROLS

  A / D  —  steer (authority drops as you speed up)
  W      —  tuck, cut your drag, dive faster
  S      —  air-brake, buy back control
  SPACE  —  restart instantly
  M      —  mute

Plays with mouse/touch too — tap the left and right thirds to steer, the middle
to tuck, the bottom to brake.


HOW TO GO DEEP

  • Your POWER number rides beside your ship — it's your km/h ÷ 60. Any block
    whose number it beats shatters on contact.
  • The world tells you everything. BRIGHT blocks are ones you're currently fast
    enough to destroy. RED HATCHED blocks will wreck you. Get faster and red
    turns bright.
  • GATES are called out before they arrive, with the number you need. Tuck and
    beat it, or brake and pay for the safety.
  • CHAIN — every block you smash without braking builds your multiplier, and the
    hit sounds climb a scale as it grows. Braking forfeits the whole chain.
  • OVERDRIVE — breaks and grazes charge the meter. Fill it and hardness stops
    mattering entirely for four seconds. Go and take the line you couldn't.
  • Skimming a block you didn't break is a GRAZE — free points and a speed kick.
  • Every 500m is a GATE: a full-width wall with one number. No gaps. Be fast enough.
  • A 10-chain repairs your hull.
  • Every 700m the shaft changes: five named zones, each with its own look, then
    round again deeper. Get ranked D through SS when you finally go down.


HOW I USED THE THEME (Speed)

Speed isn't a stat in this game, it's the entire verb. It's your damage number,
your health, your steering penalty and your score, all at once. The music's tempo
is driven by your actual velocity, so the soundtrack accelerates as you do, and
the camera pulls back and the lens splits as the shaft starts moving too fast to
hold together.


HOW I USED THE PREREQUISITE (Speed is your weapon!)

There is no attack button. The only weapon is velocity. A block breaks when your
speed in km/h clears its hardness number and not before — so "speed is your
weapon" is the literal collision rule, not a metaphor.

The twist is that it's also the danger: steering authority falls off as you
accelerate, and a sustained dive still isn't fast enough to break the hardest
blocks. So the fastest line is the one where you can least afford to need it.


MADE FOR MICRO JAM 062

Built from scratch in the jam window. No engine — hand-written TypeScript on a
2D canvas, including the bloom, the chromatic aberration and the grain. All sound
is generated live in the browser with the Web Audio API; there isn't a single
audio file in the build. The whole game is one 55KB HTML file.
```

---

## Upload settings

| Setting | Value |
|---|---|
| Kind of project | **HTML** |
| Upload | `breakneck-web.zip` |
| Check | **"This file will be played in the browser"** |
| Embed width | **940** |
| Embed height | **760** |
| Fullscreen button | **enabled** |
| Mobile friendly | **enabled** (touch controls are implemented) |
| Cover image | `shots/cover-630x500.png` |

**The embed is deliberately wider than the shaft.** The canvas is full-bleed: the
540x760 play area is centred and the leftover width becomes a parallax exterior
carrying the depth ruler and the velocity/overdrive telemetry. At a 540-wide
embed all of that is suppressed and the essentials fold back into the play area —
it works, but it is the phone layout, and it is not what the game looks like.
940x760 gives each flank enough room for the instrumentation.

The build is a single `index.html` at the zip root — itch will find it automatically.

## Tags

```
arcade, score-attack, minimalist, fast-paced, high-score, one-more-run,
procedural, html5, singleplayer, difficult
```

Do **not** add `#gamemaker`, `#ziva`, or `#easel` — those tags are for the sponsor
prize categories and we didn't use those tools.
