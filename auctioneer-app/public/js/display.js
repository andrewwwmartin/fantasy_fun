(() => {
  const roomId = qs('room');

  if (!roomId) {
    window.location.href = 'index.html';
    return;
  }

  const socket = io();

  const els = {
    roomBadge: document.getElementById('roomBadge'),
    itemName: document.getElementById('itemName'),
    bidLabel: document.getElementById('bidLabel'),
    statusDisplay: document.getElementById('statusDisplay'),
    countdown: document.getElementById('countdown'),
    enableSoundBtn: document.getElementById('enableSoundBtn'),
  };

  let soundEnabled = false;

  // Countdown is computed client-side from a single snapshot (remainingMs at
  // the moment the state was received) rather than trusting synced clocks
  // between server and viewer — only this browser's own clock is used to
  // measure elapsed time since that snapshot.
  let countdown = null;

  // The item name is sized (via CSS) to visually match the going-once/twice
  // banner, which is large enough that a long name wrapping to 3+ lines
  // would run off a projector screen. Shrink it just enough to fit within
  // two lines rather than let that happen; short names keep the full size.
  function fitItemName() {
    const el = els.itemName;
    el.style.fontSize = '';
    const computed = getComputedStyle(el);
    let fontSize = parseFloat(computed.fontSize);
    const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.08;
    const maxHeight = lineHeight * 2 + 2;
    const minFontSize = fontSize * 0.4;
    while (el.scrollHeight > maxHeight && fontSize > minFontSize) {
      fontSize -= 2;
      el.style.fontSize = `${fontSize}px`;
    }
  }

  function renderState(state) {
    els.itemName.textContent = state.itemName;
    fitItemName();
    els.bidLabel.textContent = state.currentBidLabel ? `Current bid: ${state.currentBidLabel}` : ' ';
    els.statusDisplay.textContent = statusLabel(state.status);
    els.statusDisplay.className = `display-status state-${state.status}`;

    if (state.remainingMs > 0) {
      countdown = { remainingAtReceipt: state.remainingMs, receivedAt: Date.now() };
      els.countdown.hidden = false;
    } else {
      countdown = null;
      els.countdown.hidden = true;
    }
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitItemName, 150);
  });

  els.roomBadge.textContent = `Auction ${roomId}`;

  socket.on('connect', () => {
    socket.emit('viewer:join', { roomId }, (res) => {
      if (!res || !res.ok) {
        els.statusDisplay.textContent = (res && res.error) || 'Could not join this auction.';
        els.statusDisplay.className = 'display-status state-idle';
        return;
      }
      renderState(res.state);
    });
  });

  socket.on('disconnect', () => {
    els.roomBadge.textContent = 'Reconnecting...';
  });

  socket.on('state', (state) => {
    if (state.roomId === roomId) renderState(state);
  });

  socket.on('announce', ({ type, text }) => {
    if (soundEnabled) Speech.speak(text, announcementVoiceSettings(type));
  });

  els.enableSoundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    Speech.setMuted(!soundEnabled);
    if (soundEnabled) {
      els.enableSoundBtn.textContent = '🔊 Sound On';
      els.enableSoundBtn.classList.remove('muted');
      // A user gesture is required before most browsers allow speech synthesis.
      Speech.unlock();
      Speech.speak('Sound enabled.');
    } else {
      els.enableSoundBtn.textContent = '🔇 Sound Off';
      els.enableSoundBtn.classList.add('muted');
    }
  });

  setInterval(() => {
    if (!countdown) return;
    const remainingMs = Math.max(0, countdown.remainingAtReceipt - (Date.now() - countdown.receivedAt));
    els.countdown.textContent = Math.ceil(remainingMs / 1000);
  }, 100);
})();
