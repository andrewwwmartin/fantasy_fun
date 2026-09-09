(() => {
  const roomId = qs('room');
  const coHostToken = qs('token');
  const cohostError = document.getElementById('cohostError');

  if (!roomId || !coHostToken) {
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
    bidLabelInput: document.getElementById('bidLabelInput'),
    newBidBtn: document.getElementById('newBidBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    muteBtn: document.getElementById('muteBtn'),
  };

  function renderState(state) {
    els.itemName.textContent = state.itemName;
    els.bidLabel.textContent = state.currentBidLabel ? `Current: ${state.currentBidLabel}` : ' ';
    els.statusDisplay.textContent = statusLabel(state.status);
    els.statusDisplay.className = `status-display state-${state.status}`;
    els.bidCount.textContent = state.bidCount > 0 ? `Bid #${state.bidCount}` : '';
    els.cancelBtn.disabled = state.status === 'idle';
  }

  els.roomBadge.textContent = `Auction ${roomId} · Co-Auctioneer`;

  socket.on('connect', () => {
    socket.emit('cohost:join', { roomId, coHostToken }, (res) => {
      if (!res || !res.ok) {
        cohostError.textContent = (res && res.error) || 'Could not join this auction as a co-auctioneer.';
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
    Speech.speak(text, announcementVoiceSettings(type));
  });

  Speech.onError((err) => {
    cohostError.textContent = `Voice couldn't play (${err}). Check your phone isn't on silent/mute and the volume is up, then tap New Bid again.`;
  });

  els.newBidBtn.addEventListener('click', () => {
    Speech.unlock();
    buzz();
    const bidLabel = els.bidLabelInput.value.trim();
    socket.emit('host:newBid', { roomId, token: coHostToken, bidLabel }, (res) => {
      cohostError.textContent = (!res || !res.ok) ? ((res && res.error) || 'Could not register the bid.') : '';
    });
  });

  els.cancelBtn.addEventListener('click', () => {
    socket.emit('host:cancelBid', { roomId, token: coHostToken });
  });

  els.muteBtn.addEventListener('click', () => {
    const nowMuted = !Speech.muted;
    Speech.setMuted(nowMuted);
    els.muteBtn.textContent = nowMuted ? '🔇 Voice Off' : '🔊 Voice On';
    els.muteBtn.classList.toggle('muted', nowMuted);
  });

  // Unlock speech synthesis on the very first tap anywhere on the page, so
  // later announcements triggered by server messages are allowed to play.
  document.body.addEventListener('click', () => {
    Speech.unlock();
  }, { once: true });
})();
