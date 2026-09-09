(() => {
  const roomId = qs('room');
  const hostError = document.getElementById('hostError');

  if (!roomId) {
    window.location.href = 'index.html';
    return;
  }

  const hostToken = localStorage.getItem(`auctioneer:${roomId}:hostToken`);

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
    coHostLink: document.getElementById('coHostLink'),
    copyCoHostBtn: document.getElementById('copyCoHostBtn'),
    testVoiceBtn: document.getElementById('testVoiceBtn'),
  };

  let lastState = null;
  let coHostToken = localStorage.getItem(`auctioneer:${roomId}:coHostToken`) || '';

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

  function renderCoHostLink() {
    els.coHostLink.textContent = coHostToken ? coHostShareUrlFor(roomId, coHostToken) : 'Unavailable';
  }
  renderCoHostLink();

  function lockOutHost(message) {
    els.newBidBtn.disabled = true;
    els.newBidBtn.textContent = '⚠️ Not connected as host';
    els.cancelBtn.disabled = true;
    els.nextItemBtn.disabled = true;
    els.statusDisplay.textContent = message;
    els.statusDisplay.className = 'status-display state-idle';
    hostError.textContent = `${message} Go back and start a new auction from the home page.`;
  }

  socket.on('connect', () => {
    socket.emit('host:rejoin', { roomId, hostToken }, (res) => {
      if (!res || !res.ok) {
        lockOutHost((res && res.error) || 'Lost host access to this auction.');
        return;
      }
      if (res.coHostToken) {
        coHostToken = res.coHostToken;
        localStorage.setItem(`auctioneer:${roomId}:coHostToken`, coHostToken);
        renderCoHostLink();
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

  Speech.onError((err) => {
    hostError.textContent = `Voice couldn't play (${err}). Check your phone isn't on silent/mute and the volume is up, then tap New Bid again.`;
  });

  els.newBidBtn.addEventListener('click', () => {
    Speech.unlock();
    buzz();
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

  els.testVoiceBtn.addEventListener('click', () => {
    if (!Speech.isSupported()) {
      hostError.textContent = 'This browser does not support text-to-speech at all — try Chrome or Safari.';
      return;
    }
    hostError.textContent = '';
    Speech.speak('This is a test of the auctioneer voice. If you can hear this, the voice works on this device.');
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

  els.copyCoHostBtn.addEventListener('click', async () => {
    if (!coHostToken) return;
    const link = coHostShareUrlFor(roomId, coHostToken);
    try {
      await navigator.clipboard.writeText(link);
      els.copyCoHostBtn.textContent = 'Copied!';
      setTimeout(() => { els.copyCoHostBtn.textContent = 'Copy Co-Auctioneer Link'; }, 1500);
    } catch (e) {
      els.coHostLink.textContent = link;
    }
  });

  // Unlock speech synthesis on the very first tap anywhere on the page, so
  // later announcements triggered by server messages are allowed to play.
  document.body.addEventListener('click', () => {
    Speech.unlock();
  }, { once: true });
})();
