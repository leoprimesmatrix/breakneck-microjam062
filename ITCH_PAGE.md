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

But the faster you fall, the less you can steer. Terminal velocity is where you
break everything and control nothing.


CONTROLS

  A / D  —  steer (authority drops as you speed up)
  W      —  tuck, cut your drag, dive faster
  S      —  air-brake, buy back control
  SPACE  —  restart instantly
  M      —  mute

Plays with mouse/touch too — tap the left and right thirds to steer, the middle
to tuck, the bottom to brake.


HOW TO GO DEEP

  • The world tells you everything. WHITE blocks are ones you're currently fast
    enough to destroy. RED blocks will wreck you. Get faster and red turns white.
  • CHAIN — every block you smash without braking builds your multiplier, and the
    hit sounds climb a scale as it grows. Braking forfeits the whole chain.
  • Skimming a block you didn't break is a GRAZE — free points and a speed kick.
  • Every 500m is a GATE: a full-width wall with one number. No gaps. Be fast enough.
  • A 10-chain repairs your hull.


HOW I USED THE THEME (Speed)

Speed isn't a stat in this game, it's the entire verb. It's your damage number,
your health, your steering penalty and your score, all at once. The music's tempo
is driven by your actual velocity, so the soundtrack accelerates as you do.


HOW I USED THE PREREQUISITE (Speed is your weapon!)

There is no attack button. The only weapon is velocity. A block breaks when your
speed in km/h clears its hardness number and not before — so "speed is your
weapon" is the literal collision rule, not a metaphor.

The twist is that it's also the danger: steering authority falls off as you
accelerate, so being fast enough to break anything means being unable to aim.


MADE FOR MICRO JAM 062

Built from scratch in the jam window. No engine — hand-written TypeScript on a
2D canvas. All sound is generated live in the browser with the Web Audio API;
there isn't a single audio file in the build. The whole game is one 24KB HTML
file.
```

---

## Upload settings

| Setting | Value |
|---|---|
| Kind of project | **HTML** |
| Upload | `breakneck-web.zip` |
| Check | **"This file will be played in the browser"** |
| Embed width | **540** |
| Embed height | **760** |
| Fullscreen button | **enabled** |
| Mobile friendly | **enabled** (touch controls are implemented) |
| Cover image | `shots/cover-630x500.png` |

The build is a single `index.html` at the zip root — itch will find it automatically.

## Tags

```
arcade, score-attack, minimalist, fast-paced, high-score, one-more-run,
procedural, html5, singleplayer, difficult
```

Do **not** add `#gamemaker`, `#ziva`, or `#easel` — those tags are for the sponsor
prize categories and we didn't use those tools.
