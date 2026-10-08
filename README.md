# Momentstamp

A small photo booth for two people in different places. The host approves a guest, both participants capture portraits at the same time, and each browser creates and downloads the shared strip locally.

## Run locally

Requires Node.js 20 or newer. Install dependencies once, then start Wrangler:

```sh
npm install
npm run dev
```

Open the local URL printed by Wrangler. Use a secure origin (localhost or HTTPS) for camera access. Wrangler runs the Worker and simulates the per-room SQLite Durable Objects locally.

## Deploy to Cloudflare Workers

```sh
npm run deploy
```

The first deployment creates the Worker, serves `public/` as static assets, and applies the SQLite Durable Object migration. Wrangler will ask you to choose an account if needed. No separate database or image bucket is required.

For restrictive NATs and firewalls, create a Cloudflare Realtime TURN key and configure these Worker secrets:

```sh
npx wrangler secret put CF_TURN_KEY_ID
npx wrangler secret put CF_TURN_API_TOKEN
```

The API token should have only the Calls permission needed to generate TURN credentials. The Worker generates short-lived credentials for admitted participants; the long-lived key and token remain server-side. TURN relays encrypted WebRTC traffic and may incur usage charges; direct peer connections continue to use STUN when TURN is not configured.

## Product behavior and privacy

- No accounts; invite links are bearer credentials and the host can approve up to six people in the waiting list. Only one guest can be admitted alongside the host at a time.
- Room metadata and signaling events live in one SQLite-backed Durable Object per booth and expire after six hours, or 90 minutes idle.
- Camera video and captured images use peer-to-peer WebRTC. The Worker does not receive or store image bytes, and the strip is composed and downloaded in each browser.
- There is no voice chat. The app asks for camera access only after a participant chooses to enter a booth.
- The audience is 16+ with a self-confirmation prompt.

The landing page uses three Unsplash-hosted photographs. Replace them with product-selected and licensed photography before launch if consistent brand imagery is needed.

## Current limits

- The browser uses HTTP polling for room events and WebRTC for live media and still-image transfer.
- Without Cloudflare TURN credentials, some restrictive networks may not establish a peer connection. The booth now reports this state instead of silently appearing to connect forever.
- The age prompt is self-confirmation, not age verification. Public launch still needs abuse controls, a support and incident process, and review of the 16+ safeguards in target markets.
