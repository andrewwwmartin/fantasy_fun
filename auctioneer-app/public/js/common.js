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

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function shareUrlFor(roomId) {
  const url = new URL('viewer.html', window.location.href);
  url.searchParams.set('room', roomId);
  return url.toString();
}

function coHostShareUrlFor(roomId, coHostToken) {
  const url = new URL('cohost.html', window.location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('token', coHostToken);
  return url.toString();
}
