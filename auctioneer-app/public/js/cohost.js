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
    bidDecBtn: document.getElementById('bidDecBtn'),
    bidIncBtn: document.getElementById('bidIncBtn'),
    newBidBtn: document.getElementById('newBidBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    nextItemBtn: document.getElementById('nextItemBtn'),
    muteBtn: document.getElementById('muteBtn'),
    testVoiceBtn: document.getElementById('testVoiceBtn'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsPanel: document.getElementById('settingsPanel'),
    itemNameInput: document.getElementById('itemNameInput'),
    onceDelay: document.getElementById('onceDelay'),
    twiceDelay: document.getElementById('twiceDelay'),
    soldDelay: document.getElementById('soldDelay'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  };

  let lastState = null;

  function renderState(state) {
    lastState = state;
    els.itemName.textContent = state.itemName;
    els.bidLabel.textContent = state.currentBidLabel ? `Current: ${state.currentBidLabel}` : ' ';
    els.statusDisplay.textContent = statusLabel(state.status);
    els.statusDisplay.className = `status-display state-${state.status}`;
    els.bidCount.textContent = state.bidCount > 0 ? `Bid #${state.bidCount}` : '';
    els.cancelBtn.disabled = state.status === 'idle';

    if (!els.itemNameInput.matches(':focus')) els.itemNameInput.value = state.itemName;
    if (!els.onceDelay.matches(':focus')) els.onceDelay.value = state.timing.onceDelay;
    if (!els.twiceDelay.matches(':focus')) els.twiceDelay.value = state.timing.twiceDelay;
    if (!els.soldDelay.matches(':focus')) els.soldDelay.value = state.timing.soldDelay;
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

  els.bidDecBtn.addEventListener('click', () => {
    stepBidInput(els.bidLabelInput, -BID_STEP, lastState && lastState.currentBidLabel);
  });

  els.bidIncBtn.addEventListener('click', () => {
    stepBidInput(els.bidLabelInput, BID_STEP, lastState && lastState.currentBidLabel);
  });

  els.nextItemBtn.addEventListener('click', () => {
    const nextName = prompt('Name of the next item?', lastState ? lastState.itemName : '');
    if (nextName === null) return;
    els.bidLabelInput.value = '';
    socket.emit('host:nextItem', { roomId, token: coHostToken, itemName: nextName }, (res) => {
      if (res && res.ok) renderState(res.state);
      else cohostError.textContent = (res && res.error) || 'Could not move to the next item.';
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
    socket.emit('host:configure', { roomId, token: coHostToken, itemName, timing }, (res) => {
      if (res && res.ok) {
        renderState(res.state);
        els.settingsPanel.hidden = true;
      } else {
        cohostError.textContent = (res && res.error) || 'Could not save settings.';
      }
    });
  });

  els.muteBtn.addEventListener('click', () => {
    const nowMuted = !Speech.muted;
    Speech.setMuted(nowMuted);
    els.muteBtn.textContent = nowMuted ? '🔇 Voice Disabled' : '🔊 Voice Enabled';
    els.muteBtn.classList.toggle('muted', nowMuted);
  });

  els.testVoiceBtn.addEventListener('click', () => {
    if (!Speech.isSupported()) {
      cohostError.textContent = 'This browser does not support text-to-speech at all — try Chrome or Safari.';
      return;
    }
    cohostError.textContent = '';
    Speech.speak('This is a test of the auctioneer voice. If you can hear this, the voice works on this device.');
  });

  // Unlock speech synthesis on the very first tap anywhere on the page, so
  // later announcements triggered by server messages are allowed to play.
  document.body.addEventListener('click', () => {
    Speech.unlock();
  }, { once: true });
})();
