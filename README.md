# Momentstamp

A private browser photobooth for two people in different places. The host can have up to six people waiting, then admit one guest into the booth. Both participants take portraits together and create the same downloadable photo strip in their own browsers.

## Features

- No account; the host shares an expiring invite link and approves guest requests.
- A waiting list for up to six guests; one guest can be in the booth with the host at a time.
- Live camera previews, soft warm / black-and-white / natural filters, and a mirror option.
- Synchronized countdown and peer-to-peer photo exchange. Images are composed and downloaded locally; Momentstamp does not store photo files.
- No voice chat. The product is intended for people aged 16 and older, with self-confirmation at entry.

## Run locally

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev
```

Open the local HTTPS or localhost URL printed by Wrangler. Browsers require a secure context for camera access. Wrangler runs the Worker and simulates SQLite-backed Durable Objects locally.

## Deploy to Cloudflare

```sh
npm run deploy
```

The Worker serves the files in `public/` and coordinates rooms using one SQLite-backed Durable Object per booth. Room data expires after six hours or 90 minutes without activity. Wrangler may ask you to select your Cloudflare account.

### Configure TURN

TURN helps browsers connect when a network blocks a direct WebRTC path. In the Cloudflare dashboard, open **Realtime → TURN Server** and create a TURN key. Keep its generated key ID and key secret private. From this project folder, add them to the Worker:

```sh
npx wrangler secret put CF_TURN_KEY_ID
npx wrangler secret put CF_TURN_API_TOKEN
```

Enter the TURN key ID for `CF_TURN_KEY_ID` and the TURN key secret for `CF_TURN_API_TOKEN`. The latter is the TURN key secret, not your general Cloudflare account API token. Wrangler deploys the Worker when each secret is added. Without TURN, direct STUN connections may still work, but restrictive networks can fail to connect. See [Cloudflare’s credential guide](https://developers.cloudflare.com/realtime/turn/generate-credentials/) and [TURN pricing](https://developers.cloudflare.com/realtime/turn/faq/).

## Project notes

- [Product requirements and architecture](PRODUCT_REQUIREMENTS.md) describes the shipped system and remaining product decisions.
- [Contributing](CONTRIBUTING.md) covers local setup and review expectations.
- [Security reporting](SECURITY.md) explains how to report a vulnerability privately.
- [Privacy Policy](public/privacy.html) and [Terms of Use](public/terms.html) are served by the app.

## Known limitations

- The app uses HTTP polling for room events and WebRTC for live previews and photo transfer.
- Connection success depends on browser and network support. TURN improves connectivity on restrictive networks but does not guarantee every connection.
- Age confirmation is self-reported, not verified.
- The home page loads sample photos from Unsplash.
