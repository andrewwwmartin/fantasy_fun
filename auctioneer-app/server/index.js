const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// This app changes fairly often during setup/testing, and a stale cached
// copy of the JS is a real footgun (a page can look identical while running
// old logic). Disable caching for these small static files so a normal
// reload always gets the latest deploy.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Standard real-world auctioneer pacing: a few seconds between each call
// gives the room a chance to jump back in with a counter-bid.
const DEFAULT_TIMING = {
  onceDelay: 3,
  twiceDelay: 3,
  soldDelay: 3,
};

const MIN_DELAY = 1;
const MAX_DELAY = 30;

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeRoomId() {
  // Short, easy to read aloud / type, low collision risk for this use case.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let id;
  do {
    id = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sanitizeTiming(timing = {}) {
  const clamp = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(n)));
  };
  return {
    onceDelay: clamp(timing.onceDelay, DEFAULT_TIMING.onceDelay),
    twiceDelay: clamp(timing.twiceDelay, DEFAULT_TIMING.twiceDelay),
    soldDelay: clamp(timing.soldDelay, DEFAULT_TIMING.soldDelay),
  };
}

function sanitizeItemName(name) {
  if (typeof name !== 'string') return 'this item';
  const trimmed = name.trim().slice(0, 120);
  return trimmed.length ? trimmed : 'this item';
}

function sanitizeBidLabel(label) {
  if (typeof label !== 'string') return '';
  return label.trim().slice(0, 80);
}

function createRoom() {
  const id = makeRoomId();
  const room = {
    id,
    hostToken: makeToken(),
    coHostToken: makeToken(),
    itemName: 'this item',
    timing: { ...DEFAULT_TIMING },
    status: 'idle', // idle | bid_open | going_once | going_twice | sold
    statusStartedAt: Date.now(),
    bidCount: 0,
    currentBidLabel: '',
    timers: [],
  };
  rooms.set(id, room);
  return room;
}

function clearTimers(room) {
  room.timers.forEach(clearTimeout);
  room.timers = [];
}

function setStatus(room, status) {
  room.status = status;
  room.statusStartedAt = Date.now();
}

// How long the current status lasts before the next call, so clients can
// render a countdown (e.g. the projector display). idle/sold have no next
// call scheduled.
function durationForStatus(room) {
  switch (room.status) {
    case 'bid_open':
      return room.timing.onceDelay * 1000;
    case 'going_once':
      return room.timing.twiceDelay * 1000;
    case 'going_twice':
      return room.timing.soldDelay * 1000;
    default:
      return 0;
  }
}

function remainingMsFor(room) {
  const duration = durationForStatus(room);
  if (!duration) return 0;
  return Math.max(0, duration - (Date.now() - room.statusStartedAt));
}

function publicState(room) {
  return {
    roomId: room.id,
    itemName: room.itemName,
    timing: room.timing,
    status: room.status,
    bidCount: room.bidCount,
    currentBidLabel: room.currentBidLabel,
    remainingMs: remainingMsFor(room),
  };
}

function broadcastState(room) {
  io.to(room.id).emit('state', publicState(room));
}

function announce(room, type, text) {
  io.to(room.id).emit('announce', { type, text });
}

function startBidCycle(room, bidLabel) {
  clearTimers(room);
  room.bidCount += 1;
  room.currentBidLabel = bidLabel;
  setStatus(room, 'bid_open');
  broadcastState(room);

  const bidText = bidLabel
    ? `New bid: ${bidLabel} for ${room.itemName}.`
    : `New bid on ${room.itemName}.`;
  announce(room, 'bid', bidText);

  const t1 = setTimeout(() => {
    setStatus(room, 'going_once');
    broadcastState(room);
    announce(room, 'going_once', 'Going once...');

    const t2 = setTimeout(() => {
      setStatus(room, 'going_twice');
      broadcastState(room);
      announce(room, 'going_twice', 'Going twice...');

      const t3 = setTimeout(() => {
        setStatus(room, 'sold');
        broadcastState(room);
        const soldText = bidLabel
          ? `Sold! ${bidLabel}, for ${room.itemName}.`
          : `Sold! ${room.itemName}.`;
        announce(room, 'sold', soldText);
        room.timers = [];
      }, room.timing.soldDelay * 1000);
      room.timers.push(t3);
    }, room.timing.twiceDelay * 1000);
    room.timers.push(t2);
  }, room.timing.onceDelay * 1000);
  room.timers.push(t1);
}

function requireHost(room, token) {
  return room && token && room.hostToken === token;
}

// Co-auctioneers share a link with a separate token and can register bids,
// undo mistakes, and move on to the next item alongside the primary host,
// but can't change auction timing settings or hand out further links.
function requireBidControl(room, token) {
  return room && token && (room.hostToken === token || room.coHostToken === token);
}

io.on('connection', (socket) => {
  socket.on('host:create', (payload, cb) => {
    const room = createRoom();
    room.itemName = sanitizeItemName(payload && payload.itemName);
    room.timing = sanitizeTiming(payload && payload.timing);
    socket.join(room.id);
    cb && cb({
      ok: true,
      roomId: room.id,
      hostToken: room.hostToken,
      coHostToken: room.coHostToken,
      state: publicState(room),
    });
  });

  socket.on('host:rejoin', ({ roomId, hostToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireHost(room, hostToken)) {
      return cb && cb({ ok: false, error: 'Auction not found, or you are not the host on this device.' });
    }
    socket.join(room.id);
    cb && cb({ ok: true, coHostToken: room.coHostToken, state: publicState(room) });
  });

  socket.on('cohost:join', ({ roomId, coHostToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room || !coHostToken || room.coHostToken !== coHostToken) {
      return cb && cb({ ok: false, error: 'This co-auctioneer link is invalid or the auction has ended.' });
    }
    socket.join(room.id);
    cb && cb({ ok: true, state: publicState(room) });
  });

  socket.on('viewer:join', ({ roomId } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!room) {
      return cb && cb({ ok: false, error: 'No live auction found for that link.' });
    }
    socket.join(room.id);
    cb && cb({ ok: true, state: publicState(room) });
  });

  socket.on('host:configure', ({ roomId, hostToken, itemName, timing } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireHost(room, hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    room.itemName = sanitizeItemName(itemName);
    room.timing = sanitizeTiming(timing);
    broadcastState(room);
    cb && cb({ ok: true, state: publicState(room) });
  });

  socket.on('host:newBid', ({ roomId, token, hostToken, bidLabel } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireBidControl(room, token || hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    startBidCycle(room, sanitizeBidLabel(bidLabel));
    cb && cb({ ok: true });
  });

  socket.on('host:cancelBid', ({ roomId, token, hostToken } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireBidControl(room, token || hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    clearTimers(room);
    setStatus(room, room.bidCount > 0 ? 'bid_open' : 'idle');
    broadcastState(room);
    announce(room, 'cancel', 'Hold on...');
    cb && cb({ ok: true });
  });

  socket.on('host:nextItem', ({ roomId, token, hostToken, itemName } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireBidControl(room, token || hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    clearTimers(room);
    setStatus(room, 'idle');
    room.bidCount = 0;
    room.currentBidLabel = '';
    if (itemName) room.itemName = sanitizeItemName(itemName);
    broadcastState(room);
    cb && cb({ ok: true, state: publicState(room) });
  });
});

// Rooms are held in memory only and cleaned up after a period of inactivity
// is implied by process lifetime; this app is intentionally simple/ephemeral.

server.listen(PORT, () => {
  console.log(`Auctioneer app listening on http://localhost:${PORT}`);
});
