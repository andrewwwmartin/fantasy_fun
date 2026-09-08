// Shared helpers used by the host and viewer pages.

const Speech = (() => {
  let muted = false;
  let voice = null;

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Prefer an English voice if available, otherwise just take the default.
    return voices.find((v) => /en[-_]/i.test(v.lang)) || voices[0];
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

  return { speak, cancel, setMuted, isSupported, get muted() { return muted; } };
})();

function announcementVoiceSettings(type) {
  switch (type) {
    case 'sold':
      return { rate: 0.95, pitch: 0.95 };
    case 'going_twice':
      return { rate: 1.02, pitch: 1.0 };
    default:
      return { rate: 1, pitch: 1 };
  }
}

function statusLabel(status) {
  switch (status) {
    case 'idle':
      return 'Waiting for the auction to start...';
    case 'bid_open':
      return 'Bid received';
    case 'going_once':
      return 'Going once...';
    case 'going_twice':
      return 'Going twice...';
    case 'sold':
      return 'SOLD!';
    default:
      return '';
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
