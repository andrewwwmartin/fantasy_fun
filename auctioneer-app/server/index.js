const path = require('path');
const fs = require('fs');
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

// Short, typable links for the share pages — /viewer.html?room=CODE and
// friends still work directly, but these are what's shown/copied on the
// host page so someone at a desktop isn't stuck typing a long URL.
// Uppercased defensively since every code/token here is generated
// uppercase-only, in case someone hand-types it in lowercase.
app.get('/v/:code', (req, res) => {
  res.redirect(`/viewer.html?room=${encodeURIComponent(req.params.code.toUpperCase())}`);
});
app.get('/d/:code', (req, res) => {
  res.redirect(`/display.html?room=${encodeURIComponent(req.params.code.toUpperCase())}`);
});
app.get('/c/:code/:token', (req, res) => {
  const room = encodeURIComponent(req.params.code.toUpperCase());
  const token = encodeURIComponent(req.params.token.toUpperCase());
  res.redirect(`/cohost.html?room=${room}&token=${token}`);
});

// Optional player pool for a fantasy-draft-style auction — a static list
// (currently FantasyPros consensus top 300) searched by name so you don't
// have to type every player out by hand each round. Purely a search-and-fill
// convenience: whatever ends up in the item name field, picked from the pool
// or freely typed, is treated identically by the rest of the app.
const PLAYER_POOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'players.json'), 'utf8'));
const PLAYER_SEARCH_LIMIT = 8;

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

// Lightweight persistence: rooms are written to a local JSON file on every
// change and reloaded at boot, so a process crash/restart resumes the
// current auction(s) instead of losing them. This only survives a restart
// of the same running instance — most hosting platforms don't guarantee a
// fresh deploy's container reuses the previous one's local disk, so a new
// deploy still starts clean. `timers` are runtime-only and never persisted;
// they're rebuilt by resumeRoom() after loading.
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');

function persistRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const serializable = Array.from(rooms.values()).map(({ timers, ...rest }) => rest);
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializable));
  } catch (e) {
    console.error('Failed to persist auction state:', e.message);
  }
}

function loadRooms() {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return; // no persisted state yet, or it's unreadable — start fresh
  }
  for (const roomData of saved) {
    // usedNames fallback: a room persisted before this field existed.
    const room = { usedNames: [], ...roomData, timers: [] };
    rooms.set(room.id, room);
    resumeRoom(room);
  }
  if (saved.length) {
    console.log(`Restored ${saved.length} auction(s) from disk.`);
    persistRooms(); // write back any statuses resumeRoom fast-forwarded
  }
}

// No 0/O/1/I — easy to read aloud, type, or tell apart at a glance.
const FRIENDLY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  return Array.from({ length }, () => FRIENDLY_ALPHABET[crypto.randomInt(FRIENDLY_ALPHABET.length)]).join('');
}

function makeRoomId() {
  // Short, easy to read aloud / type, low collision risk for this use case.
  let id;
  do {
    id = randomCode(5);
  } while (rooms.has(id));
  return id;
}

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

// The co-auctioneer link is meant to be shared and sometimes typed by hand,
// so its token trades some cryptographic strength for length: 8 characters
// from a 32-symbol alphabet is ~1 trillion possibilities, effectively
// unguessable for a short-lived live auction with no automated attacker,
// while still being short enough to type. The host's own token never
// appears in a link a human types (it's stored automatically), so it stays
// long and fully random.
function makeCoHostToken() {
  return randomCode(8);
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

// Sets room.itemName and, if a real name was actually given (not the empty
// fallback), records it in usedNames so the player-pool search can gray it
// out as already nominated. Used by every place itemName can be set,
// keeping that bookkeeping in one place.
function setItemName(room, rawName) {
  room.itemName = sanitizeItemName(rawName);
  if (typeof rawName === 'string' && rawName.trim()) {
    const key = room.itemName.toLowerCase();
    if (!room.usedNames.includes(key)) room.usedNames.push(key);
  }
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
    coHostToken: makeCoHostToken(),
    itemName: 'this item',
    timing: { ...DEFAULT_TIMING },
    status: 'idle', // idle | bid_open | going_once | going_twice | sold
    statusStartedAt: Date.now(),
    // Whether the current status is genuinely counting down toward the next
    // call (true during a live bid cycle) versus held indefinitely (after
    // Undo/Hold, or idle) — resumeRoom() must not fast-forward a held room
    // after a restart just because time has passed while it sat waiting.
    autoAdvance: false,
    bidCount: 0,
    currentBidLabel: '',
    usedNames: [], // lowercased item names already nominated, for the player-pool search
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
  persistRooms();
}

function announce(room, type, text) {
  io.to(room.id).emit('announce', { type, text });
}

// The call sequence a bid moves through. 'idle' isn't part of it — it's the
// resting state before any bid, or after Next Item.
const CALL_SEQUENCE = ['bid_open', 'going_once', 'going_twice', 'sold'];

function nextStatus(status) {
  const idx = CALL_SEQUENCE.indexOf(status);
  return idx >= 0 && idx < CALL_SEQUENCE.length - 1 ? CALL_SEQUENCE[idx + 1] : null;
}

function announceForStatus(room) {
  const bidLabel = room.currentBidLabel;
  switch (room.status) {
    case 'bid_open':
      announce(room, 'bid', bidLabel ? `New bid: ${bidLabel} for ${room.itemName}.` : `New bid on ${room.itemName}.`);
      break;
    case 'going_once':
      announce(room, 'going_once', 'Going once...');
      break;
    case 'going_twice':
      announce(room, 'going_twice', 'Going twice...');
      break;
    case 'sold':
      announce(room, 'sold', bidLabel ? `Sold! ${bidLabel}, for ${room.itemName}.` : `Sold! ${room.itemName}.`);
      break;
  }
}

// Schedules the timer that advances the room from its current status to the
// next one in CALL_SEQUENCE, honoring any time already elapsed since
// statusStartedAt. In normal live use elapsed is ~0; on server restart it can
// be large, which just makes the transition fire sooner (see resumeRoom).
function scheduleAdvance(room) {
  const next = nextStatus(room.status);
  if (!next) return; // sold or idle: nothing further to schedule
  const remaining = Math.max(0, durationForStatus(room) - (Date.now() - room.statusStartedAt));
  const timer = setTimeout(() => {
    setStatus(room, next);
    broadcastState(room);
    announceForStatus(room);
    scheduleAdvance(room);
  }, remaining);
  room.timers.push(timer);
}

function startBidCycle(room, bidLabel) {
  clearTimers(room);
  room.bidCount += 1;
  room.currentBidLabel = bidLabel;
  room.autoAdvance = true;
  setStatus(room, 'bid_open');
  broadcastState(room);
  announceForStatus(room);
  scheduleAdvance(room);
}

// Called once per restored room at server boot. Fast-forwards synchronously
// through any stages that would have completed entirely during the downtime
// (so a long outage lands straight on 'sold' rather than rapid-firing every
// intermediate call), then hands off to the normal live timer chain for
// whatever genuinely remains.
function resumeRoom(room) {
  if (!room.autoAdvance) return; // held (Undo/Hold) or idle: leave it exactly as it was
  if (!CALL_SEQUENCE.includes(room.status) || room.status === 'sold') return;
  let elapsed = Date.now() - room.statusStartedAt;
  let status = room.status;
  while (true) {
    const duration = durationForStatus({ ...room, status });
    if (elapsed < duration) break;
    elapsed -= duration;
    const next = nextStatus(status);
    if (!next) break;
    status = next;
    if (status === 'sold') break;
  }
  setStatus(room, status);
  room.statusStartedAt = Date.now() - elapsed;
  if (status === 'sold') {
    announceForStatus(room);
  } else {
    scheduleAdvance(room);
  }
}

function requireHost(room, token) {
  return room && token && room.hostToken === token;
}

// Co-auctioneers share a link with a separate token and can do everything
// the primary host can except hand out further share links: register bids,
// undo mistakes, move on to the next item, and change item/timing settings.
function requireBidControl(room, token) {
  return room && token && (room.hostToken === token || room.coHostToken === token);
}

io.on('connection', (socket) => {
  socket.on('host:create', (payload, cb) => {
    const room = createRoom();
    setItemName(room, payload && payload.itemName);
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

  socket.on('host:configure', ({ roomId, token, hostToken, itemName, timing } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireBidControl(room, token || hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    setItemName(room, itemName);
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
    room.autoAdvance = false;
    setStatus(room, room.bidCount > 0 ? 'bid_open' : 'idle');
    broadcastState(room);
    announce(room, 'cancel', 'Hold on...');
    cb && cb({ ok: true });
  });

  socket.on('host:nextItem', ({ roomId, token, hostToken, itemName } = {}, cb) => {
    const room = rooms.get(roomId);
    if (!requireBidControl(room, token || hostToken)) return cb && cb({ ok: false, error: 'Not authorized.' });
    clearTimers(room);
    room.autoAdvance = false;
    setStatus(room, 'idle');
    room.bidCount = 0;
    room.currentBidLabel = '';
    if (itemName) setItemName(room, itemName);
    broadcastState(room);
    cb && cb({ ok: true, state: publicState(room) });
  });

  socket.on('players:search', ({ roomId, query } = {}, cb) => {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (q.length < 2) return cb && cb({ ok: true, results: [] });
    const room = roomId ? rooms.get(roomId) : null;
    const results = [];
    for (const player of PLAYER_POOL) {
      if (!player.name.toLowerCase().includes(q)) continue;
      results.push({
        name: player.name,
        pos: player.pos,
        team: player.team,
        used: room ? room.usedNames.includes(player.name.toLowerCase()) : false,
      });
      if (results.length >= PLAYER_SEARCH_LIMIT) break;
    }
    cb && cb({ ok: true, results });
  });
});

loadRooms();

server.listen(PORT, () => {
  console.log(`Auctioneer app listening on http://localhost:${PORT}`);
});
