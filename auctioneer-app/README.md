# Digital Auctioneer

A tiny web app that runs the "going once... going twice... sold!" call for
you. Works on phone or desktop, speaks out loud, and gives you a shareable
link so other people can watch and listen live from their own device.

## How it works

- **Host page** &mdash; set what's being bid on and how many seconds to wait
  between "going once", "going twice", and "sold". Press the big **New Bid**
  button every time someone bids; the app handles the timing and speaks each
  call out loud.
- **Viewer page** &mdash; a read-only page, reachable via a shareable link
  (with the auction's short code baked in), that mirrors the host's calls in
  real time and speaks them aloud on the viewer's own device too.
- **Co-auctioneer page** &mdash; a separate shareable link giving someone else
  full auctioneer controls (New Bid, Undo/Hold, Next Item, and item/timing
  settings) from their own device, so two (or more) people can run the room
  together. The one thing they don't get is the other share links &mdash;
  those stay with whoever started the auction.
- **Display page** &mdash; a big-screen link meant for a TV or projector: the
  item name, the current bid, the call ("Going once...", etc.), and a live
  countdown to the next call. A small "Tap to Enable Sound" button in the
  corner turns on the same voice narration as the viewer page (once, before
  the room gathers round) &mdash; everything else about the page stays
  controls-free.
- Defaults to 3 seconds between each call, a typical real-world auctioneer's
  pace &mdash; adjust it in the settings panel on the host page (or before
  starting the auction) if you want it faster or slower.
- **Player pool search** &mdash; useful for a fantasy football auction draft.
  Typing an item name (on the landing page, or in the "Next Item" box on the
  host/co-auctioneer page) shows a live search over a built-in player list
  (FantasyPros consensus top 300, `server/players.json`); picking a
  suggestion fills the name in and starts the round. A player already
  nominated in this auction shows up grayed out and struck through rather
  than being hidden, so you can still see they exist without re-picking them
  by accident. Free typing always still works too &mdash; nothing requires
  picking from the list, so a player not in the pool (or a non-fantasy item
  entirely) works exactly the same as before.

Under the hood it's a small Node/Express server with Socket.IO for real-time
sync, and plain HTML/CSS/JS on the front end (no build step) using the
browser's built-in speech synthesis (`SpeechSynthesis` Web API) so every
device speaks locally &mdash; no audio streaming needed.

## Running it locally

```bash
cd auctioneer-app
npm install
npm start
```

Then open http://localhost:3000 in your browser to start an auction.

## Sharing it with others

The shareable "viewer" link only works for people who can reach the same
server. To let people outside your own computer/network join:

1. **Deploy the server somewhere public** &mdash; this is a plain Node app, so
   it runs as-is on services like Render, Railway, Fly.io, or a small VPS.
   Set the `PORT` environment variable if your host requires it (defaults to
   `3000`).
2. **Or, for a quick one-off auction**, run it locally and expose it with a
   tunnel tool like `ngrok` (`ngrok http 3000`), then share the ngrok URL's
   `/v/CODE` link.

Once it's reachable, the host page shows the auction code and a ready-to-copy
link (`.../v/CODE`) &mdash; send that link to anyone you want watching along.
It also shows a separate **co-auctioneer link** (`.../c/CODE/TOKEN`) &mdash;
send that one instead to anyone you want to be able to press New Bid
alongside you &mdash; and a **display link** (`.../d/CODE`) to put up on a TV
or projector for the room to watch. These short forms (`/v/`, `/d/`, `/c/`)
are what's shown and copied on the host page, kept short on purpose so
they're easy to read out or type by hand on a desktop; the longer
`/viewer.html?room=CODE`-style URLs still work too, they're just not what
gets shared. Each link also has a QR code underneath it on the host page, so
people at an in-person event can just scan it with
their phone camera instead of typing anything.

## Notes

- Auction state is kept in memory and also written to `data/rooms.json` on
  every change, so a server **crash or process restart** resumes the
  in-progress auction(s) instead of losing them &mdash; any stage that
  would've finished entirely during the downtime is fast-forwarded through
  (landing straight on "Sold" for a long outage) rather than replaying every
  intermediate call late. This does **not** protect against a fresh
  **deploy**: most hosting platforms (Render included, without a paid disk
  add-on) start a new deploy from a clean container, so pushing new code
  still resets any auction in progress. It's meant for running live
  auctions, not storing permanent history.
- Press **Space** (or tap the button) to register a new bid on the host or
  co-auctioneer page &mdash; handy if you're running the auction from a
  laptop. It's ignored while typing in a text field, so it won't interfere
  with entering an item name or bid amount.
- The co-auctioneer link's token is a short 8-character code rather than a
  long cryptographic one, trading some strength for being typable by hand.
  It's still on the order of a trillion possibilities &mdash; effectively
  unguessable for the lifetime of a live auction with no automated attacker
  &mdash; but is a deliberately weaker guarantee than the host's own access,
  which never needs to be typed and stays long and fully random.
- Speech synthesis requires a user tap/click first on most browsers (this is
  a browser autoplay restriction, not a bug) &mdash; the viewer page has a
  "Tap to Enable Sound" button for this reason.
- "Undo / Hold" cancels an in-progress "going once/twice" countdown (e.g. you
  hit the button by mistake) without ending the auction.
- "Next Item" resets the bid counter and lets you rename the item for a new
  round, on the same shared link.
- The host and co-auctioneer pages both have a "Test Voice" button that
  speaks a fixed test phrase immediately on tap &mdash; useful for checking
  whether voice works at all on a given phone (ringer/silent switch, volume,
  browser support) separately from whether the timed announcements play.
- The host's access to an auction is tied to a token saved in the browser's
  `localStorage` when the auction is created. If a host page ever shows
  "Lost host access to this auction," that browser lost track of the token
  (e.g. site data was cleared) &mdash; start a new auction from the home page.
