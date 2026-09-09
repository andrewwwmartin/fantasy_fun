(() => {
  const roomId = qs('room');
  const viewerError = document.getElementById('viewerError');

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
    bidCount: document.getElementById('bidCount'),
    enableSoundBtn: document.getElementById('enableSoundBtn'),
  };

  let soundEnabled = false;

  function renderState(state) {
    els.itemName.textContent = state.itemName;
    els.bidLabel.textContent = state.currentBidLabel ? `Current: ${state.currentBidLabel}` : ' ';
    els.statusDisplay.textContent = statusLabel(state.status);
    els.statusDisplay.className = `status-display state-${state.status}`;
    els.bidCount.textContent = state.bidCount > 0 ? `Bid #${state.bidCount}` : '';
  }

  els.roomBadge.textContent = `Auction ${roomId}`;

  socket.on('connect', () => {
    socket.emit('viewer:join', { roomId }, (res) => {
      if (!res || !res.ok) {
        viewerError.textContent = (res && res.error) || 'Could not join this auction.';
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

  Speech.onError((err) => {
    viewerError.textContent = `Voice couldn't play (${err}). Check your phone isn't on silent/mute and the volume is up.`;
  });

  els.enableSoundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    Speech.setMuted(!soundEnabled);
    if (soundEnabled) {
      els.enableSoundBtn.textContent = '🔊 Sound On';
      els.enableSoundBtn.classList.remove('muted');
      viewerError.textContent = '';
      // A user gesture is required before most browsers allow speech synthesis.
      Speech.unlock();
      Speech.speak('Sound enabled.');
    } else {
      els.enableSoundBtn.textContent = '🔇 Sound Off';
      els.enableSoundBtn.classList.add('muted');
    }
  });
})();
