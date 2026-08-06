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
/** Give up on recorded music after this many consecutive failures. */
const MAX_FAILURES = 3;

/**
 * How long the live deck may make no progress before it is written off.
 *
 * A deck that reports itself paused has already failed — it was asked to play
 * and it is not playing — so it gets much less rope than one that is merely
 * waiting on bytes over a slow connection.
 */
const STALL_PAUSED = 1.5;
const STALL_BUFFERING = 6;

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
  /** Null until `attach` wires the deck into an AudioContext. */
  gain: GainNode | null;
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
  /** Watchdog: the live deck's last observed position, and when it froze there. */
  private lastPos = -1;
  private stalledSince = 0;
  /** More than one thing waits on the downbeat; see `onFirstNote`. */
  private firstNote: (() => void)[] = [];

  constructor() {
    this.reshuffle();
    this.prime();
  }

  /** True once a real track is actually coming out of the speakers. */
  get active() {
    return this.playing;
  }

  /**
   * True once samples are genuinely flowing.
   *
   * Deliberately not the same question as `active`: `play()` resolves when the
   * browser has *accepted* the request, which can be a beat before the first
   * sample is heard. The title's cold open is timed against this, and a
   * flashbulb that goes off before the downbeat is worse than no sync at all.
   */
  get audible() {
    const d = this.decks[this.live];
    return this.playing && !!d && !d.el.paused && d.el.currentTime > 0;
  }

  /**
   * Run `cb` the instant the first track becomes audible.
   *
   * The title's cold open and the music's own fade-in both hang off this.
   * Polling `audible` from the frame loop would have been simpler, but it costs
   * up to a frame of slack, and a flashbulb that lands after its own downbeat
   * is exactly the thing this is meant to fix. The `playing` event is the
   * earliest signal the platform gives.
   */
  onFirstNote(cb: () => void) {
    if (this.audible) cb();
    else this.firstNote.push(cb);
  }

  /**
   * Create the elements and start pulling the first track down *before* any
   * user gesture. Autoplay policy gates playback, not loading — so by the time
   * someone clicks, the track is buffered and starts within a frame instead of
   * a second later, which is the whole reason the cold open can be timed to it.
   */
  private prime() {
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
        this.decks.push({ el, gain: null, track: null });
      }
      const first = this.decks[0];
      first.track = this.take();
      first.el.src = src(first.track.file);
      first.el.load();
    } catch {
      this.decks = [];
    }
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

  /** A track someone asked for by name, consumed by the next `take`. */
  private wanted = -1;

  /**
   * Ask for a specific track, by file name. A request, not a command: it is
   * consumed by whichever `take` happens next — usually the queue buffering a
   * whole track ahead — so the deck it lands on has a full lead time to load.
   * Taking out of band leaves the bag's position alone, so every track still
   * comes around eventually.
   */
  request(file: string) {
    const i = TRACKS.findIndex((t) => t.file === file);
    if (i < 0 || i === this.last) return;
    this.wanted = i;
    // If the idle deck has already buffered its next pick, that pick predates
    // this request — re-point the deck now, while there is still a whole wave
    // of lead time to load in. Waiting for the next natural `take` would land
    // the request one full track late, which for a sector switch is never.
    if (!this.ctx) return;
    if (this.ctx.currentTime < this.fadeEndsAt) return;
    const idle = this.decks[1 - this.live];
    if (idle && idle.track && idle.track.file !== file) {
      idle.track = this.take();
      idle.el.src = src(idle.track.file);
      idle.el.load();
    }
  }

  /**
   * Crossfade to whatever is already buffered on the idle deck, now. False if
   * that cannot be done safely — no context, nothing playing, a fade already
   * in flight, or the idle deck not loaded. Never forces: the failure mode of
   * a slow network is that the old track keeps playing, which is infinitely
   * better than the silence a hard swap to an unbuffered deck used to buy.
   */
  jump(): boolean {
    if (!this.ctx || !this.playing) return false;
    if (this.ctx.currentTime < this.fadeEndsAt) return false;
    const idle = this.decks[1 - this.live];
    if (!idle || !idle.track || !idle.el.src) return false;
    this.advance(false);
    return true;
  }

  private take(): Track {
    if (this.wanted >= 0) {
      const i = this.wanted;
      this.wanted = -1;
      this.last = i;
      return TRACKS[i];
    }
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
    if (!this.decks.length) return false;
    try {
      for (const deck of this.decks) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(deck.el).connect(gain);
        gain.connect(dest);
        deck.gain = gain;

        // Safety net. The crossfade normally advances things well before the
        // end, but a track whose duration never resolves (a stalled range
        // request, a browser that will not report it) would otherwise stop the
        // soundtrack dead at its first silence.
        deck.el.addEventListener('playing', () => {
          const waiting = this.firstNote;
          if (!waiting.length) return;
          this.firstNote = [];
          for (const cb of waiting) cb();
        });
        deck.el.addEventListener('ended', () => {
          if (this.decks[this.live] === deck) this.advance(true);
        });
        deck.el.addEventListener('error', () => {
          if (this.decks[this.live] === deck) {
            this.fail();
            return;
          }
          // The idle deck is buffering the *next* track a whole track ahead, so
          // a failure here is caught long before anyone would have heard it.
          // Drop it and let `advance` pick a replacement when it gets there —
          // requeueing right now would spin the whole bag if the server is down.
          deck.track = null;
        });
      }
      this.ctx = ctx;
      return true;
    } catch {
      // A missing MediaElementSource, a file:// origin — either means "no
      // recorded music", never "no game".
      this.ctx = null;
      this.decks = [];
      return false;
    }
  }

  /** Kick off the first track. Must be inside a user gesture. */
  start() {
    if (!this.ctx || this.playing || this.decks.length < 2) return;
    const deck = this.decks[this.live];
    // `prime` already chose this track and started buffering it at page load.
    if (!deck.track) {
      deck.track = this.take();
      deck.el.src = src(deck.track.file);
    }
    deck.gain?.gain.setValueAtTime(1, this.ctx.currentTime);
    void deck.el
      .play()
      .then(() => {
        this.playing = true;
        this.failures = 0;
        this.armWatchdog();
        // Start pulling the second track down now rather than at the crossfade,
        // so it has a whole track's worth of time to arrive. See `queue`.
        this.queue();
      })
      .catch(() => {
        this.playing = false;
      });
  }

  /**
   * Buffer the next track into the idle deck.
   *
   * The crossfade used to be the first thing that asked for the next file,
   * which gave it 2.4 seconds to travel — and the outgoing track was faded out
   * and stopped on that same schedule whether or not the incoming one had
   * arrived. A slow response therefore bought silence: the old track gone, the
   * new one not yet started. Loading a whole track ahead means the overlap is
   * an overlap of two buffered files, which is what it always claimed to be.
   *
   * Only ever called when the idle deck is genuinely idle — never while it is
   * still fading out, because assigning `src` would cut its tail off.
   */
  private queue() {
    const idle = this.decks[1 - this.live];
    if (!idle || idle.track) return;
    idle.track = this.take();
    idle.el.src = src(idle.track.file);
    idle.el.load();
  }

  /**
   * One track failed in a way the player would hear as silence. Move on, and
   * hand back to the procedural sequencer if this keeps happening — `Audio.tick`
   * watches `active` and ramps the fallback in when recorded music gives up.
   */
  private fail() {
    if (++this.failures <= MAX_FAILURES) this.advance(true);
    else this.playing = false;
  }

  /** Reset the stall detector — the live deck is expected to move from here. */
  private armWatchdog() {
    this.lastPos = -1;
    this.stalledSince = 0;
  }

  // ------------------------------------------------------------------ update
  /** Called every frame. Drives the crossfade off the audio clock. */
  tick() {
    if (!this.ctx || !this.playing || this.decks.length < 2) return;
    const now = this.ctx.currentTime;
    if (now < this.fadeEndsAt) return; // a crossfade is already in flight

    const el = this.decks[this.live].el;

    /**
     * The watchdog, and the reason the soundtrack used to stop for good.
     *
     * Every other recovery path in this class hangs off the element's `error`
     * event, and there is a whole class of failure that never fires one: a
     * rejected `play()`. Autoplay refusals and the `AbortError` raised when a
     * fresh `load()` interrupts a play already in flight both land there, and
     * both leave this deck live, silent, and at position zero — where nothing
     * would ever have moved it again, because `ended` needs a track that
     * started and the crossfade below needs one that is nearly over.
     *
     * So progress is checked rather than assumed. If the live deck has not
     * moved, it is written off and the next track takes over.
     */
    if (el.currentTime !== this.lastPos || el.ended) {
      this.lastPos = el.currentTime;
      this.stalledSince = 0;
    } else if (!this.stalledSince) {
      this.stalledSince = now;
    } else if (now - this.stalledSince > (el.paused ? STALL_PAUSED : STALL_BUFFERING)) {
      this.armWatchdog();
      this.fail();
      return;
    }

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
    if (!from.gain || !to.gain) return;

    // Normally `queue` loaded this a whole track ago and there is nothing to do
    // but play it. The exception is a deck whose preload failed, which cleared
    // its track precisely so that this picks a different one.
    if (!to.track) this.queue();
    if (!to.track) return;
    if (to.el.currentTime !== 0) to.el.currentTime = 0;

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
    this.armWatchdog();

    void to.el
      .play()
      .then(() => {
        // Genuinely consecutive, which is what the name always claimed. Without
        // this, three failures spread across an hour would retire the
        // soundtrack as surely as three in a row.
        this.failures = 0;
      })
      .catch(() => {
        // A rejected `play()` fires no `error` event, so nothing else is coming
        // to fix this. The watchdog in `tick` would catch it a second and a
        // half later regardless; this just skips the wait.
        this.fail();
      });

    // Let the fade finish in the graph before the element stops feeding it.
    const el = from.el;
    setTimeout(
      () => {
        if (this.decks[this.live].el === el) return;
        el.pause();
        el.currentTime = 0;
        // Now that it is genuinely idle, it becomes the deck that buffers the
        // next track. Doing this any earlier would truncate the fade above.
        from.track = null;
        this.queue();
      },
      (fade + 0.1) * 1000,
    );
  }
}
