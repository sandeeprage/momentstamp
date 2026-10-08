# Contributing

Thanks for helping improve Momentstamp. Keep changes focused and make sure documentation continues to describe the shipped app accurately.

## Set up

Requires Node.js 20 or newer.

```sh
npm ci
npm run dev
```

Use the localhost URL printed by Wrangler for camera access. Cloudflare TURN secrets are only needed to exercise relayed connections; never commit or paste their values into an issue or pull request.

## Before opening a pull request

Run the checks relevant to your change:

```sh
node --check src/index.js
node --check public/app.js
git diff --check
npm run deploy -- --dry-run
```

There is no automated browser behavior test suite yet. For changes to room access, signaling, camera behavior, or capture, describe the manual browser and device checks performed.

Keep photos, invite links, participant identifiers, TURN credentials, and `.dev.vars` files out of commits. Update `README.md` or `PRODUCT_REQUIREMENTS.md` when product behavior changes.
