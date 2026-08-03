/**
 * The soundtrack: ten recorded tracks, played as a shuffled bag.
 *
 * Three decisions worth knowing about.
 *
 * **The bag, not the dice.** Picking at random every time means a track can
 * repeat back-to-back, which sounds like a bug even when it isn't. Instead the
 * ten are shuffled into an order and played through; only when the order is
 * exhausted is it reshuffled, and the reshuffle refuses to put the track that
 * just played at the front. So nothing repeats until everything else has had a
 * turn, and no track is ever heard twice in a row across that seam. The first
 * shuffle happens at construction, so which track opens the title screen is
 * different every time the page is loaded.
 *
 * **Two decks, not one.** Swapping `src` on a single element leaves an audible
 * hole between tracks — the encoder's own padding plus however long the network
 * takes. Two elements let the next track start underneath the one that is
 * ending, and the pair is crossfaded on an equal-power curve so the sum stays
 * at constant loudness through the overlap rather than dipping in the middle.
 *
 * **It routes through the game's filter, not straight to the speakers.** The
 * caller hands us a destination node; everything the player hears goes through
 * it. That is what lets bullet time close a low-pass over the music, which is
 * the one audio effect in this game that people actually notice.
 */

export interface Track {
  /** Basename under `music/`. */
  file: string;
  /** What the game calls it on screen. */
  name: string;
}

export const TRACKS: readonly Track[] = [
  { file: 'ignition', name: 'IGNITION' },
  { file: 'redline', name: 'REDLINE' },
  { file: 'coldstart', name: 'COLDSTART' },
  { file: 'slipstream', name: 'SLIPSTREAM' },
  { file: 'overpressure', name: 'OVERPRESSURE' },
  { file: 'flashpoint', name: 'FLASHPOINT' },
  { file: 'kill-line', name: 'KILL LINE' },
  { file: 'terminal-velocity', name: 'TERMINAL VELOCITY' },
  { file: 'blackout', name: 'BLACKOUT' },
  { file: 'last-light', name: 'LAST LIGHT' },
];

/** Seconds of overlap between the outgoing and incoming track. */
const CROSSFADE = 2.4;
/** Give up on a track after this many consecutive load failures. */
const MAX_FAILURES = 3;

/**
 * itch.io serves the game from a nested path inside an iframe, so this has to
 * resolve against the document rather than the site root.
 */
const src = (file: string) => `music/${file}.mp3`;

/** Equal-power crossfade curve: cos/sin quarter-wave, sampled for the ramp. */
function fadeCurve(rising: boolean, steps = 33) {
  const c = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (Math.PI / 2);
    c[i] = rising ? Math.sin(t) : Math.cos(t);
  }
  return c;
}
const RISE = fadeCurve(true);
const FALL = fadeCurve(false);

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  track: Track | null;
}

export class Music {
  private ctx: AudioContext | null = null;
  private decks: Deck[] = [];
  private live = 0;
  private order: number[] = [];
  private pos = 0;
  /** Index of the track that played most recently, to break the reshuffle seam. */
  private last = -1;
  private failures = 0;
  private fadeEndsAt = 0;
  private playing = false;

  constructor() {
    this.reshuffle();
  }

  /** True once a real track is actually coming out of the speakers. */
  get active() {
    return this.playing;
  }

  /** Display name of what is playing, or null before the first track starts. */
  get nowPlaying(): string | null {
    return this.decks[this.live]?.track?.name ?? null;
  }

  // --------------------------------------------------------------------- bag
  private reshuffle() {
    const n = TRACKS.length;
    this.order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    // A fresh bag whose first track is the one that just finished would repeat
    // across the seam, which is the single thing shuffling is supposed to stop.
    if (n > 1 && this.order[0] === this.last) {
      const swap = 1 + Math.floor(Math.random() * (n - 1));
      [this.order[0], this.order[swap]] = [this.order[swap], this.order[0]];
    }
    this.pos = 0;
  }

  private take(): Track {
    if (this.pos >= this.order.length) this.reshuffle();
    const i = this.order[this.pos++];
    this.last = i;
    return TRACKS[i];
  }

  // ------------------------------------------------------------------- setup
  /**
   * Build the two decks against a live AudioContext. Safe to call repeatedly;
   * only the first call does anything. Returns false if the browser refuses to
   * wire an element into the graph, in which case the caller should fall back
   * to the procedural sequencer.
   */
  attach(ctx: AudioContext, dest: AudioNode): boolean {
    if (this.ctx) return true;
    try {
      for (let i = 0; i < 2; i++) {
        const el = new window.Audio();
        el.preload = 'auto';
        // Deliberately no `crossOrigin`: the tracks always ship beside the HTML
        // and so are always same-origin. Asking for CORS anyway gains nothing
        // and adds an `Origin` header that a CDN is free to refuse — which
        // would show up as a game with no music and no error to explain it.
        //
        // The decks are faded by the graph, not by the element; leaving the
        // element's own volume anywhere but 1 would stack two attenuations.
        el.volume = 1;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(el).connect(gain);
        gain.connect(dest);

        const deck: Deck = { el, gain, track: null };
        // Safety net. The crossfade normally advances things well before the
        // end, but a track whose duration never resolves (a stalled range
        // request, a browser that will not report it) would otherwise stop the
        // soundtrack dead at its first silence.
        el.addEventListener('ended', () => {
          if (this.decks[this.live] === deck) this.advance(true);
        });
        el.addEventListener('error', () => {
          if (this.decks[this.live] !== deck) return;
          if (++this.failures <= MAX_FAILURES) this.advance(true);
          else this.playing = false;
        });
        this.decks.push(deck);
      }
      this.ctx = ctx;
      return true;
    } catch {
      // Autoplay policy, a missing MediaElementSource, a file:// origin — all
      // of them mean "no recorded music", never "no game".
      this.ctx = null;
      this.decks = [];
      return false;
    }
  }

  /** Kick off the first track. Must be inside a user gesture. */
  start() {
    if (!this.ctx || this.playing || this.decks.length < 2) return;
    const deck = this.decks[this.live];
    deck.track = this.take();
    deck.el.src = src(deck.track.file);
    deck.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    void deck.el
      .play()
      .then(() => {
        this.playing = true;
        this.failures = 0;
      })
      .catch(() => {
        this.playing = false;
      });
  }

  // ------------------------------------------------------------------ update
  /** Called every frame. Drives the crossfade off the audio clock. */
  tick() {
    if (!this.ctx || !this.playing || this.decks.length < 2) return;
    const now = this.ctx.currentTime;
    if (now < this.fadeEndsAt) return; // a crossfade is already in flight

    const el = this.decks[this.live].el;
    const dur = el.duration;
    if (!isFinite(dur) || dur <= 0) return; // metadata has not landed yet
    if (dur - el.currentTime <= CROSSFADE) this.advance(false);
  }

  /**
   * Move to the next track in the bag.
   *
   * @param hard skip the crossfade — the outgoing track has already stopped, so
   *             there is nothing left to fade out of.
   */
  private advance(hard: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.decks.length < 2) return;
    const from = this.decks[this.live];
    const to = this.decks[1 - this.live];
    const now = ctx.currentTime;

    to.track = this.take();
    to.el.src = src(to.track.file);
    to.el.currentTime = 0;

    const fade = hard ? 0.12 : CROSSFADE;
    to.gain.gain.cancelScheduledValues(now);
    from.gain.gain.cancelScheduledValues(now);
    try {
      to.gain.gain.setValueAtTime(0, now);
      to.gain.gain.setValueCurveAtTime(RISE, now, fade);
      from.gain.gain.setValueAtTime(1, now);
      from.gain.gain.setValueCurveAtTime(FALL, now, fade);
    } catch {
      // `setValueCurveAtTime` throws if it overlaps a curve that is still
      // running, which happens when a track fails to load *during* a
      // crossfade and forces a second advance on top of the first. Cutting is
      // worse than fading and much better than an exception that leaves one
      // deck stuck at zero and the soundtrack silent for the rest of the run.
      to.gain.gain.setValueAtTime(1, now);
      from.gain.gain.setValueAtTime(0, now);
    }

    this.live = 1 - this.live;
    this.fadeEndsAt = now + fade;

    void to.el.play().catch(() => {
      /* the element's own error handler owns the retry */
    });

    // Let the fade finish in the graph before the element stops feeding it.
    const el = from.el;
    setTimeout(
      () => {
        if (this.decks[this.live].el !== el) {
          el.pause();
          el.currentTime = 0;
        }
      },
      (fade + 0.1) * 1000,
    );
  }
}
