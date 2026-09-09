// Shared helpers used by the host and viewer pages.

const Speech = (() => {
  let muted = false;
  let voice = null;
  let errorHandler = null;

  // Common names for female voices across platforms (macOS/iOS, Windows,
  // Chrome/Android, and cloud voices some browsers expose) — used to pick a
  // pleasant-sounding female voice by default when one is available.
  const FEMALE_NAME_HINTS = [
    'female', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'ava',
    'allison', 'susan', 'zira', 'hazel', 'zoe', 'nicky', 'serena', 'kate',
    'joanna', 'ivy', 'kendra', 'kimberly', 'salli', 'amy', 'emma', 'nicole',
    'aria', 'jenny', 'michelle', 'sara', 'sonia', 'libby', 'olivia', 'natasha',
    'catherine', 'linda', 'heather', 'stephanie', 'lucy', 'shelley', 'moira',
    'anna', 'laura', 'paulina', 'monica', 'ellen', 'flo',
  ];

  function isEnglish(v) {
    return /^en\b/i.test(v.lang);
  }

  function femaleScore(v) {
    const name = v.name.toLowerCase();
    if (name.includes('female')) return 2;
    if (FEMALE_NAME_HINTS.some((hint) => name.includes(hint))) return 1;
    return 0;
  }

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const englishVoices = voices.filter(isEnglish);
    const pool = englishVoices.length ? englishVoices : voices;

    // Prefer the most confidently female-sounding voice available; fall back
    // to whatever the platform offers if none match.
    const best = pool.reduce((acc, v) => {
      const score = femaleScore(v);
      return !acc || score > acc.score ? { voice: v, score } : acc;
    }, null);

    return (best && best.voice) || pool[0];
  }

  if ('speechSynthesis' in window) {
    voice = pickVoice();
    window.speechSynthesis.onvoiceschanged = () => {
      voice = pickVoice();
    };
  }

  function speak(text, { rate = 1, pitch = 1 } = {}) {
    if (muted || !text || !('speechSynthesis' in window)) return;
    // Some browsers (iOS Safari especially, after the tab backgrounds even
    // briefly) can leave the speech queue in a paused/stuck state; resuming
    // before every utterance is a cheap, harmless guard against that.
    try { window.speechSynthesis.resume(); } catch (e) { /* ignore */ }
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) utter.voice = voice;
    utter.rate = rate;
    utter.pitch = pitch;
    utter.onerror = (e) => {
      if (errorHandler) errorHandler(e.error || 'unknown error');
    };
    window.speechSynthesis.speak(utter);
  }

  function cancel() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  function setMuted(value) {
    muted = value;
    if (muted) cancel();
  }

  function isSupported() {
    return 'speechSynthesis' in window;
  }

  function onError(cb) {
    errorHandler = cb;
  }

  // Many mobile browsers (iOS Safari especially) only allow speech synthesis
  // to start once a speak() call has happened directly inside a user gesture
  // (a tap/click handler). Calling this from the first tap on the page
  // "unlocks" the speech engine so later calls triggered by server messages
  // (going once/twice/sold, seconds after the tap) are actually allowed to
  // play. A near-silent, near-instant utterance is enough to do this.
  function unlock() {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.resume();
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    } catch (e) {
      // Nothing useful to do if this fails; real speak() calls will surface errors.
    }
  }

  return { speak, cancel, setMuted, isSupported, onError, unlock, get muted() { return muted; } };
})();

function announcementVoiceSettings(type) {
  // Slightly slower than default and a touch of warmth in pitch reads as
  // smoother/more pleasant than a synthesizer's default flat, rushed cadence.
  switch (type) {
    case 'sold':
      return { rate: 0.9, pitch: 1.05 };
    case 'going_twice':
      return { rate: 0.98, pitch: 1.05 };
    default:
      return { rate: 0.95, pitch: 1.05 };
  }
}

function statusLabel(status) {
  switch (status) {
    case 'idle':
      return 'Waiting to start...';
    case 'bid_open':
      return '🔔 Bid received!';
    case 'going_once':
      return 'Going once...';
    case 'going_twice':
      return 'Going twice...';
    case 'sold':
      return '🎉 SOLD! 🎉';
    default:
      return '';
  }
}

// A short buzz on supported devices (mainly Android) makes the bid button
// feel more like a physical buzzer. iOS Safari doesn't support this API, so
// it's a no-op there.
function buzz(pattern = 30) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }
}

const BID_STEP = 1;

function parseBidAmount(str) {
  if (!str) return null;
  const match = String(str).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function formatBidAmount(amount) {
  const rounded = Math.round(amount * 100) / 100;
  const clean = Number.isInteger(rounded) ? rounded : rounded.toFixed(2);
  return `$${clean}`;
}

// Bumps the amount in a bid input up/down by BID_STEP. If the field is
// empty, starts from the last known bid on the room (so "+" after a bid
// was just placed naturally suggests the next increment) rather than 0.
function stepBidInput(inputEl, delta, fallbackAmount) {
  const current = parseBidAmount(inputEl.value);
  const base = current !== null ? current : (parseBidAmount(fallbackAmount) || 0);
  const next = Math.max(0, base + delta);
  inputEl.value = formatBidAmount(next);
}

// Renders (or replaces) a QR code for `text` into the element with the
// given id, using the vendored qrcodejs library. Passing an empty text
// clears the container instead.
function renderQr(containerId, text) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!text || typeof QRCode === 'undefined') return;
  new QRCode(el, {
    text,
    width: 128,
    height: 128,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// Lets the spacebar trigger a button (defaults to New Bid) from anywhere on
// the page, except while focus is on a form field or another button — where
// space should do its normal job (type a space, activate the focused
// control) instead of also firing this shortcut.
function bindSpacebarShortcut(buttonEl) {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (buttonEl.disabled) return;
    e.preventDefault();
    buttonEl.click();
  });
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function shareUrlFor(roomId) {
  const url = new URL('viewer.html', window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function displayShareUrlFor(roomId) {
  const url = new URL('display.html', window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function coHostShareUrlFor(roomId, coHostToken) {
  const url = new URL('cohost.html', window.location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('token', coHostToken);
  return url.toString();
}
