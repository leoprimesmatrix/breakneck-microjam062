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
Speed is the only thing that cuts. Dive fast enough to melt straight through the shaft — but the heat that gets you through is also burning you alive.
```

---

## Page body

```
You are falling, and you are getting hotter.

HEAT is the whole game. Diving builds it. Heat is the only thing that melts the
barriers in the shaft — and past the redline it is burning through your hull.
It is your weapon, your score multiplier and the thing killing you, all at once.

Nothing has a number on it. Barriers are made of something, and you read them
the way you read anything real:

  GLASS   thin, translucent, cracked   melts cold
  GRATE   see-through lattice          melts warm
  PLATE   solid, riveted               melts hot
  CORE    banded, glowing seams        meltdown only

Anything you can melt glows and softens as you approach. Anything you cannot is
cold, hard-edged and hazard-striped. You never compare two numbers — you look.


CONTROLS

  W      —  dive, build heat
  A / D  —  steer (authority drops as you speed up)
  S      —  vent, dump heat before it burns you
  SPACE  —  restart instantly
  M      —  mute

Plays with touch too — sides steer, middle dives, bottom vents.


HOW TO GO DEEP

  • Watch the ship, not the HUD. Dark steel is cold. Ember, orange, white-hot is
    the ladder. The bar at the bottom shows which materials that heat opens.
  • Doing nothing makes you COLD, and cold bounces off everything. Heat has to be
    dived for.
  • Smashing heats you up. Ploughing a soft gauntlet is the fastest way to the
    redline — which is exactly where you both want and do not want to be.
  • Past the REDLINE your hull burns, continuously. Vent, or commit.
  • MELTDOWN at full heat: four seconds where nothing touches you and CORE walls
    open. It costs about a hull pip to reach, and you come out still hot.
  • CORE is the only thing you must always steer around. It is why you steer.
  • Every 700m the shaft changes: five named zones, then round again deeper.
  • Get ranked D through SS when you finally go down.


HOW I USED THE THEME (Speed)

Speed is not a stat here, it is the entire verb — it is the only thing that makes
heat, and heat is the only thing that does anything. Fall faster, burn hotter,
melt more, score more, and get closer to cooking yourself. The music's tempo is
driven by your actual velocity, the camera pulls back and the lens splits as the
shaft starts moving too fast to hold together, and the redline has its own alarm.


HOW I USED THE PREREQUISITE (Speed is your weapon!)

There is no attack button. The only weapon is velocity, laundered through heat:
you go through a barrier because you are hot enough, and you are hot enough
because you were falling fast enough. That is the literal collision rule.

The twist is that the weapon is pointed at you as well. The heat that opens the
shaft is burning your hull the whole time you hold it, steering gets worse the
faster you go, and the toughest material in the game cannot be melted at all
without deliberately overheating first. Every second you are choosing how much
of the weapon to point at yourself.


MADE FOR MICRO JAM 062

Built from scratch in the jam window. No engine — hand-written TypeScript on a
2D canvas, including the bloom, the chromatic aberration and the grain. All sound
is generated live in the browser with the Web Audio API; there is not a single
audio file in the build. The whole game is one 60KB HTML file, and it fills
whatever window you give it.
```

---

## Upload settings

| Setting | Value |
|---|---|
| Kind of project | **HTML** |
| Upload | `breakneck-web.zip` |
| Check | **"This file will be played in the browser"** |
| Embed width | **1000** |
| Embed height | **760** |
| Fullscreen button | **enabled** |
| Mobile friendly | **enabled** (touch controls are implemented) |
| Cover image | `shots/cover-630x500.png` |

**Give it as much width as you can.** The playfield now fills the entire canvas
edge to edge — there is no letterbox and no fixed shaft. Vertical lookahead is
pinned, so extra width simply becomes extra lanes (7 on a phone, up to 14 on a
monitor) and the game plays the same at every aspect. A wider embed is just more
game visible at once.

The build is a single `index.html` at the zip root — itch will find it automatically.

## Tags

```
arcade, score-attack, minimalist, fast-paced, high-score, one-more-run,
procedural, html5, singleplayer, difficult
```

Do **not** add `#gamemaker`, `#ziva`, or `#easel` — those tags are for the sponsor
prize categories and we didn't use those tools.
