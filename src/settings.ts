/**
 * Player settings: the two volumes and the mute flag.
 *
 * Deliberately a module-level singleton rather than something threaded through
 * constructors. Three unrelated layers need it — `Audio` to apply it, the
 * settings panel to draw it, and `Game` to change it — and passing a settings
 * object down to all three would be more plumbing than the four numbers are
 * worth.
 *
 * Kept out of `config.ts` on purpose: that file is authored balance, checked
 * into the repository and identical for everyone. This is per-player state that
 * outlives a page load, and the two should never be edited in the same breath.
 */

const KEY = 'afterburn.settings.v1';

/**
 * A clickable rectangle in screen space, pushed by the renderer and consumed by
 * the game's input step.
 *
 * It lives here, in a module that imports nothing, rather than beside the panel
 * that draws it: `Game` and `render/settings` both need the shape, and having
 * either import it from the other would put a cycle in the module graph for the
 * sake of four numbers.
 */
export interface UiHit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Settings {
  /** 0..1 slider position for the soundtrack. */
  music: number;
  /** 0..1 slider position for every sound the game makes itself. */
  sfx: number;
  muted: boolean;
}

const DEFAULTS: Settings = { music: 1, sfx: 1, muted: false };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw) as Partial<Settings>;
    // Field by field, because a stored blob is user-writable and one bad value
    // should cost that one field rather than the whole settings screen.
    return {
      music: typeof s.music === 'number' && isFinite(s.music) ? clamp01(s.music) : DEFAULTS.music,
      sfx: typeof s.sfx === 'number' && isFinite(s.sfx) ? clamp01(s.sfx) : DEFAULTS.sfx,
      muted: s.muted === true,
    };
  } catch {
    // Private browsing, a disabled storage API, malformed JSON — all of which
    // mean "play at default volume", never "do not start".
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

/**
 * Coalesced to the end of the task queue. A slider being dragged calls this
 * every frame, and a synchronous localStorage write per frame is the one thing
 * in a settings panel capable of dropping the frame rate.
 */
let pending = 0;
export function saveSettings() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private browsing — never worth failing over */
    }
  }, 250) as unknown as number;
}

/**
 * Slider position to linear gain.
 *
 * Loudness is not linear in amplitude: a slider that halves the gain sounds far
 * less than half as loud, so a linear control spends its top third doing almost
 * nothing and its bottom third collapsing to silence. Squaring puts the audible
 * midpoint near the middle of the track, which is the only thing a volume
 * slider has to get right.
 */
export const gainFor = (v: number) => clamp01(v) * clamp01(v);
