# Momentstamp

A dependency-free browser photobooth MVP for two people in different places. A host creates a private booth, approves a guest from a waiting room, and the pair takes synchronized photos together to receive a shared photo strip.

## Run locally

Requires Node.js 20 or newer. From this directory, run:

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Camera access works on localhost. For a second device, deploy behind HTTPS; browsers block camera access on ordinary non-local HTTP origins.

## MVP flow

1. Create a booth and copy the private invite link.
2. The guest requests entry; the host admits or rejects them.
3. Both grant camera access, choose a filter/frame, and get ready.
4. The host starts a synchronized countdown once both participants are ready.
5. Still images travel over a WebRTC data channel and each browser composes and downloads the same strip locally.

Images are not posted to the application API or saved by the server. A simple 16+ self-confirmation is shown before entering. Voice chat is not implemented.

The landing page uses original local SVG artwork, so the hero does not depend on a third-party image service.

## Current implementation limits

- Room state is held in process memory and is lost when the Node process restarts. Run one server instance only; this is a prototype, not a production deployment.
- WebRTC uses public STUN for direct connections. No TURN relay is configured yet, so some restrictive mobile or corporate networks will fail to connect.
- Local still capture is one synchronized portrait per person. It does not yet have a multi-shot sequence, account system, persistent gallery, age verification, or production abuse controls.
- To make the app available to other devices, deploy the Node server over HTTPS and configure TURN credentials, rate limits, persistent/managed room coordination, and monitoring first.
