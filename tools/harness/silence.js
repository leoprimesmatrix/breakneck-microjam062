/**
 * Silence — for the one browser that must never make noise, and no other.
 *
 * This game is developed with an automation pane driving it, and a build that
 * starts singing because a tool opened it is a build nobody can work next to.
 * So there has to be a mute. The mistake worth not repeating is *where the
 * decision lives*: it used to be `?sound`, opt-in, applied to every response the
 * dev server sent. That silences the automation pane, and it silences the person
 * who owns the machine, and only one of those was ever the point. A default that
 * a human has to know a secret query string to escape is not a mute, it is a
 * broken game — and it reads exactly like one, because there is no error and no
 * log line, just a soundtrack that never plays.
 *
 * So the gate is *who is asking*, not *what they remembered to type*. The pane
 * identifies itself in its User-Agent (`Claude/…`, `Electron/…`); a real browser
 * never does. That flips both failure modes the right way round: the automation
 * pane is silent without anyone electing it, and a person opening the same URL
 * in Chrome hears the game as shipped.
 *
 *   ?sound   force audible, whoever is asking
 *   ?mute    force silent, whoever is asking
 *
 * Loaded first thing in `<head>`, before any module: the soundtrack's two decks
 * are constructed during module init, so a patch installed after that would miss
 * the elements it exists to catch.
 *
 * Nothing here writes to the player's saved settings. Mute is a profile value
 * the person owns, and a dev page must not change it just by being opened —
 * which is why this holds the graph down rather than calling `toggleMute()`.
 */
(() => {
  const q = new URLSearchParams(location.search);
  if (q.has('sound')) return;

  // Belt: the pane says who it is. Braces: `?mute` for a human who wants quiet.
  const driven = /\bClaude\/|\bElectron\//.test(navigator.userAgent);
  if (!driven && !q.has('mute')) return;

  // Every AudioContext the page builds gets its destination cut. Patched at the
  // constructor rather than after the fact because the game creates its context
  // inside a user gesture, which is somewhere this script cannot stand.
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const patched = function (...a) {
      const ctx = new AC(...a);
      try {
        ctx.suspend();
      } catch {
        /* a context that will not suspend is still about to be gained to zero */
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination); // the real one — the shadow below is not set yet
      Object.defineProperty(ctx, 'destination', { get: () => gain });
      return ctx;
    };
    patched.prototype = AC.prototype;
    window.AudioContext = window.webkitAudioContext = patched;
  }

  // The soundtrack decks are bare `new Audio()` and are never put in the
  // document, so a `querySelectorAll('audio')` sweep finds nothing and looks
  // like it worked. They have to be caught at the constructor.
  const A = window.Audio;
  if (A) {
    window.Audio = function (...a) {
      const el = new A(...a);
      el.muted = true;
      const play = el.play.bind(el);
      el.play = () => {
        el.muted = true;
        el.volume = 0;
        return play();
      };
      return el;
    };
    window.Audio.prototype = A.prototype;
  }

  const tag = document.createElement('div');
  tag.textContent = 'MUTED FOR AUTOMATION — ?sound to hear it';
  tag.style.cssText =
    'position:fixed;left:12px;bottom:10px;z-index:9;pointer-events:none;' +
    'font:700 10px/1 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#7e92be;opacity:.55';
  if (document.body) document.body.appendChild(tag);
  else addEventListener('DOMContentLoaded', () => document.body.appendChild(tag));
})();
