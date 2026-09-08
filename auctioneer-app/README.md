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
- **Co-auctioneer page** &mdash; a separate shareable link that lets someone
  else also press **New Bid** and **Undo/Hold** from their own device, so two
  (or more) people can work the room together. Co-auctioneers can't change
  the item name/timing settings or see other share links &mdash; that stays
  with whoever started the auction.
- Defaults to 3 seconds between each call, a typical real-world auctioneer's
  pace &mdash; adjust it in the settings panel on the host page (or before
  starting the auction) if you want it faster or slower.

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
   `/viewer.html?room=CODE` link.

Once it's reachable, the host page shows the auction code and a ready-to-copy
link (`.../viewer.html?room=CODE`) &mdash; send that link to anyone you want
watching along. It also shows a separate **co-auctioneer link**
(`.../cohost.html?room=CODE&token=...`) &mdash; send that one instead to
anyone you want to be able to press New Bid alongside you.

## Notes

- Auction state lives in memory on the server, so it resets if the server
  restarts. This is intentionally simple &mdash; it's meant for running live
  auctions, not storing history.
- Speech synthesis requires a user tap/click first on most browsers (this is
  a browser autoplay restriction, not a bug) &mdash; the viewer page has a
  "Tap to Enable Sound" button for this reason.
- "Undo / Hold" cancels an in-progress "going once/twice" countdown (e.g. you
  hit the button by mistake) without ending the auction.
- "Next Item" resets the bid counter and lets you rename the item for a new
  round, on the same shared link.
