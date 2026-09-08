(() => {
  const roomId = qs('room');
  const hostError = document.getElementById('hostError');

  if (!roomId) {
    window.location.href = 'index.html';
    return;
  }

  const hostToken = sessionStorage.getItem(`auctioneer:${roomId}:hostToken`);
  if (!hostToken) {
    hostError.textContent = 'No host access found for this auction on this device/tab.';
  }

  const socket = io();

  const els = {
    itemName: document.getElementById('itemName'),
    bidLabel: document.getElementById('bidLabel'),
    statusDisplay: document.getElementById('statusDisplay'),
    bidCount: document.getElementById('bidCount'),
    newBidBtn: document.getElementById('newBidBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    nextItemBtn: document.getElementById('nextItemBtn'),
    muteBtn: document.getElementById('muteBtn'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsPanel: document.getElementById('settingsPanel'),
    itemNameInput: document.getElementById('itemNameInput'),
    bidLabelInput: document.getElementById('bidLabelInput'),
    onceDelay: document.getElementById('onceDelay'),
    twiceDelay: document.getElementById('twiceDelay'),
    soldDelay: document.getElementById('soldDelay'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    roomCode: document.getElementById('roomCode'),
    shareLink: document.getElementById('shareLink'),
    copyBtn: document.getElementById('copyBtn'),
  };

  let lastState = null;

  function renderState(state) {
    lastState = state;
    els.itemName.textContent = state.itemName;
    els.bidLabel.textContent = state.currentBidLabel ? `Current: ${state.currentBidLabel}` : ' ';
    els.statusDisplay.textContent = statusLabel(state.status);
    els.statusDisplay.className = `status-display state-${state.status}`;
    els.bidCount.textContent = state.bidCount > 0 ? `Bid #${state.bidCount}` : '';

    if (!els.itemNameInput.matches(':focus')) els.itemNameInput.value = state.itemName;
    if (!els.onceDelay.matches(':focus')) els.onceDelay.value = state.timing.onceDelay;
    if (!els.twiceDelay.matches(':focus')) els.twiceDelay.value = state.timing.twiceDelay;
    if (!els.soldDelay.matches(':focus')) els.soldDelay.value = state.timing.soldDelay;

    els.newBidBtn.disabled = state.status === 'sold' ? false : false;
    els.cancelBtn.disabled = state.status === 'idle';
  }

  els.roomCode.textContent = roomId;
  els.shareLink.textContent = shareUrlFor(roomId);

  socket.on('connect', () => {
    socket.emit('host:rejoin', { roomId, hostToken }, (res) => {
      if (!res || !res.ok) {
        hostError.textContent = (res && res.error) || 'Could not reconnect as host.';
        return;
      }
      renderState(res.state);
    });
  });

  socket.on('state', (state) => {
    if (state.roomId === roomId) renderState(state);
  });

  socket.on('announce', ({ type, text }) => {
    Speech.speak(text, announcementVoiceSettings(type));
  });

  els.newBidBtn.addEventListener('click', () => {
    const bidLabel = els.bidLabelInput.value.trim();
    socket.emit('host:newBid', { roomId, hostToken, bidLabel }, (res) => {
      if (!res || !res.ok) hostError.textContent = (res && res.error) || 'Could not register the bid.';
      else hostError.textContent = '';
    });
  });

  els.cancelBtn.addEventListener('click', () => {
    socket.emit('host:cancelBid', { roomId, hostToken });
  });

  els.nextItemBtn.addEventListener('click', () => {
    const nextName = prompt('Name of the next item?', lastState ? lastState.itemName : '');
    if (nextName === null) return;
    els.bidLabelInput.value = '';
    socket.emit('host:nextItem', { roomId, hostToken, itemName: nextName }, (res) => {
      if (res && res.ok) renderState(res.state);
    });
  });

  els.settingsToggle.addEventListener('click', () => {
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
  });

  els.saveSettingsBtn.addEventListener('click', () => {
    const itemName = els.itemNameInput.value.trim();
    const timing = {
      onceDelay: Number(els.onceDelay.value) || 3,
      twiceDelay: Number(els.twiceDelay.value) || 3,
      soldDelay: Number(els.soldDelay.value) || 3,
    };
    socket.emit('host:configure', { roomId, hostToken, itemName, timing }, (res) => {
      if (res && res.ok) {
        renderState(res.state);
        els.settingsPanel.hidden = true;
      }
    });
  });

  els.muteBtn.addEventListener('click', () => {
    const nowMuted = !Speech.muted;
    Speech.setMuted(nowMuted);
    els.muteBtn.textContent = nowMuted ? '🔇 Voice Off' : '🔊 Voice On';
    els.muteBtn.classList.toggle('muted', nowMuted);
  });

  els.copyBtn.addEventListener('click', async () => {
    const link = shareUrlFor(roomId);
    try {
      await navigator.clipboard.writeText(link);
      els.copyBtn.textContent = 'Copied!';
      setTimeout(() => { els.copyBtn.textContent = 'Copy Link'; }, 1500);
    } catch (e) {
      els.shareLink.textContent = link;
    }
  });

  // A user gesture is required before most browsers allow speech synthesis;
  // this "warms up" the speech engine as soon as the host taps anything.
  document.body.addEventListener('click', () => {
    if (Speech.isSupported() && window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    }
  }, { once: true });
})();
