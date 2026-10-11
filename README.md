# Momentstamp

A private browser photobooth for two people in different places. The host can have up to six people waiting, then admit one guest into the booth. Both participants take four synchronized rounds and create the same eight-photo strip in their own browsers, with both people side by side in each row.

## Features

- No account; the host shares an expiring invite link and approves guest requests.
- A waiting list for up to six guests; one guest can be in the booth with the host at a time.
- Live camera previews, soft warm / black-and-white / natural filters, and a mirror option. Preview elements stay attached while settings change; paused or blocked playback offers a “Show camera” button.
- Participant camera cards show connection and readiness states. A four-round tray displays paired thumbnails as photos arrive, with the host on the left in each pair.
- One eight-photo strip with four rows of paired portraits, warm paper, slim borders, and a small booth stamp. Paper colors, captions, lettering, four spacing options, rounded photos, and an optional date. Thin gaps separate people, with wider gaps between rounds. “Beside” joins the two photos with no center gap or border; rounding applies to the outside of each joined row. The paper height fits the photos and footer. The host styles the result and both people see the changes; either can download JPG or PNG.
- Both people press “I’m ready” once to start four synchronized countdowns. Photos are exchanged directly between browsers, composed and downloaded locally; Momentstamp does not store photo files.
- No voice chat. The product is intended for people aged 16 and older, with self-confirmation at entry.

## How it works

Cloudflare Workers serves the app and API. Each booth gets a SQLite-backed Durable Object that keeps room details and signaling events temporarily. Browsers use WebRTC for live previews and photo exchange, with Cloudflare TURN as a relay when direct connections fail. Each browser builds and downloads the shared strip locally; the service does not store photos.

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

## Policies

Read the [Privacy Policy](public/privacy.html) and [Terms of Use](public/terms.html).

## Known limitations

- The app uses HTTP polling for room events and WebRTC for live previews and photo transfer.
- Connection success depends on browser and network support. TURN improves connectivity on restrictive networks but does not guarantee every connection.
- Age confirmation is self-reported, not verified.
- Both people need to keep the booth visible during the four countdowns. An interrupted take can be restarted using “I’m ready”.
