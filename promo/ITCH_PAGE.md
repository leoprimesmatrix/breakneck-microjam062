# AFTERBURN — itch.io submission sheet

Everything below maps 1:1 onto the itch.io "Create new project" form, top to
bottom. Copy each block into its field.

---

## Basics

| Field | Value |
|---|---|
| **Title** | AFTERBURN |
| **Project URL** | `afterburn` (→ primedevstudios.itch.io/afterburn) |
| **Short description / tagline** | You can't walk. You can't shoot. You can only STRIKE. Speed is the only weapon. |
| **Classification** | Games |
| **Kind of project** | HTML — *"This file will be played in the browser"* on the zip |
| **Release status** | Released |
| **Pricing** | $0 / No payments (jam builds should never gate) |

## Uploads

- **`AFTERBURN-web.zip`** (22 MB) — check **"This file will be played in the browser"**.
  Inside: `index.html` at the root (the entire game — code, art, typeface, all
  sound effects) plus `music/` with the ten soundtrack tracks. Nothing else to
  upload. The music streams on demand, so the game is playable immediately;
  the zip's size is not a startup cost.

## Embed options

| Option | Value |
|---|---|
| Viewport | **1280 × 720** |
| Fullscreen button | **ON** (the game rescales to any size — fullscreen is its best self) |
| Mobile friendly | **ON** (real touch support: tap-and-hold to aim, prompts switch to touch wording) |
| Orientation | Landscape |

## Details / description

Paste the Markdown below (itch's rich-text editor accepts it via the "edit as Markdown" toggle):

---

**You cannot walk. You cannot shoot. You can only STRIKE — a blinding, straight-line burst that kills everything it touches.**

Hold to aim: the world slows to a crawl and a line shows you *exactly* what will die. Release: you **become the line**. Every kill mid-strike extends the strike — thread three enemies in one lance and the game hands you the room. Kills refill FOCUS, and FOCUS is the slow-motion you think with. Camp and you starve. Attack and time itself is your reward.

One rule: **anything on your line dies.** One exception — and it turns its shield toward you.

### How it plays

| Input | Effect |
|---|---|
| **HOLD** (left mouse / space) | Time slows. The aim line shows every kill before you commit. |
| **RELEASE** | You become the line. Anything on it dies. |
| **KILL** | Refills FOCUS. Chains stretch the strike further mid-flight. |

WASD nudges your drift · M mutes · P pauses (with a codex of everything that's killed you)

### The hostiles

- **MOTE** — a drifting mine. It comes to you. Don't be where it is.
- **SEEDER** — a brood pod. Kill it and three more mines spill out. You can see them in there.
- **WARD** — one eye behind a plated barricade. The shield turns to face you; strike the flank.
- **LANCER** — a missile that marks a line, then *becomes* it. Get off the line.
- **SPINE** — a turret bolted to the floor. Watch the light climb the barrel.

### Under the hood

- Hand-built in **vanilla TypeScript + Canvas2D** — no engine, no sprites, no font files. The entire game — art, typeface, bloom pipeline and every sound effect — is **one 126 KB HTML file** that draws and synthesizes all of it at runtime.
- Every sound is built the way a mixed one is: a transient, a body and a tail per effect, struck-metal partials for anything that gets hit, saturation and glue compression across the effects bus, a synthesized room behind it — and **every hit panned to where it happened in the arena**.
- **Ten original tracks**, shuffled so nothing repeats until you have heard them all. Hold to aim and a low-pass closes over the music with you — slow motion you can hear.
- Real post-processing: bloom, chromatic aberration, film grain, adaptive quality that keeps 60fps on weak hardware.
- Persistent best score, ranks, and a strike-by-strike combo system built to be chased.

Made solo in a week for **Micro Jam 062** (theme: **SPEED**). Built with AI assistance (Claude) — disclosed under itch's AI generation policy.

### Soundtrack

Ten tracks, played as a shuffled bag — nothing repeats until you have heard the
other nine, and which one opens the title screen is different every time you
load the game. They crossfade into each other, so the music never stops.

`IGNITION` · `REDLINE` · `COLDSTART` · `SLIPSTREAM` · `OVERPRESSURE` ·
`FLASHPOINT` · `KILL LINE` · `TERMINAL VELOCITY` · `BLACKOUT` · `LAST LIGHT`

### Follow the dev

- 𝕏 **[@PrimeDevv](https://x.com/PrimeDevv)**
- 📷 **[officialprimedev](https://www.instagram.com/officialprimedev/)**

A follow genuinely helps more than you'd think. Tell me your best rank — mine's S.

---

## Metadata

| Field | Value |
|---|---|
| **Genre** | Action |
| **Tags** (10 max) | `arcade`, `fast-paced`, `score-attack`, `top-down`, `singleplayer`, `2d`, `neon`, `soundtrack`, `html5`, `short` |
| **AI generation disclosure** | **Yes** — code and art made with AI assistance (Claude); the ten soundtrack tracks are AI-generated. Tick every category that applies. Over-disclosing costs nothing; under-disclosing can get an entry pulled after the votes are in. |
| **Custom noun** | arena strike game |
| **Community** | Comments enabled |

## Jam submission questions

| Question | Answer |
|---|---|
| Ziva | **No** — wasn't made with Ziva |
| GameMaker | **No** — wasn't made with GameMaker |
| Easel | **No** — wasn't made with Easel |

## Images

All five are under itch's 3 MB per-image limit.

- **Cover image**: **`cover.gif`** (630×500, 2.5 MB, ~3.4 s loop) — real gameplay:
  the aim line sweeps onto three enemies in slow-mo, the strike tears through
  all three, TRIPLE +600, smash cut to the wordmark. Use THIS as the cover —
  in a grid of ~87 static covers, the one that moves gets the click.
- **Fallback / social image**: `thumbnail.png` (1260×1000, 1.4 MB — if the GIF
  is ever rejected, and for X/IG posts, which don't animate GIFs from itch links)
- **Screenshots** (1600×900, 1.2–1.9 MB each), in this order — the first shows beside the cover most often:
  1. `shot-2-strike.png` — mid-strike, blade out, seeder contact card up
  2. `shot-1-title.png` — the title screen after the cold open
  3. `shot-3-aftermath.png` — scarred floor, lancer mid-charge

## Submission checklist (do these in order)

1. Create project → paste Basics + Description → upload zip → check "played in browser".
2. Embed options exactly as above (fullscreen ON matters).
3. Upload cover + 3 screenshots.
4. **Save & view page once** — confirm the game boots inside the itch iframe.
5. Submit to **Micro Jam 062** from the jam page (before the deadline!), answer the three tool questions No/No/No.
6. Post a short "I made this" with the thumbnail on X/IG with the page link — jam ratings correlate hard with early plays.
