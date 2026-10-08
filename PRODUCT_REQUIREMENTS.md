# Momentstamp: product and system architecture

This document records the current product decisions and the system that is implemented in this repository. It distinguishes shipped behavior from the next decisions that still need product or engineering work.

## Product definition

Momentstamp is a browser photobooth for two people in different places. A host creates a room and shares an invite link. Up to six guests can wait for approval; the host admits one guest at a time. The pair takes synchronized portraits, and each browser composes and downloads the same strip locally.

The service targets laptops and mobile devices and is intended for people aged 16 and older. The age checkbox is self-confirmation, not age verification. There is no voice chat.

## 1. Product architecture

### Current surfaces

- **Home:** create a booth or join through a private invite link.
- **Host lobby:** share the link, review up to six waiting requests, admit or reject guests, and close the booth.
- **Guest waiting room:** send a request, wait for approval, or leave the queue.
- **Booth:** side-by-side live previews, filter and mirror controls, a shared readiness state, synchronized countdown, and guest removal / queue management for the host.
- **Result:** each browser composes a shared two-photo strip locally and can download it or retake.

### Product boundaries

- One host and at most one admitted guest are in a booth at once. Other invitees remain in the waiting list.
- There are three filters (soft warm, black and white, natural) and a natural/mirrored choice. Frames are not part of the current product.
- Photos are exchanged through a peer-to-peer WebRTC data channel. The application does not upload or store photo files.
- The browser holds images temporarily for the active session; downloaded copies belong to each participant.

## 2. User flow

1. The host confirms they are 16 or older, agrees to the linked Privacy Policy and Terms, grants camera access, and creates a booth.
2. The host shares the private invite. Guests open it, confirm age and terms, grant camera access, and request to join.
3. The host admits or rejects each request. Up to six requests can be pending; only one guest can be admitted with the host at a time.
4. Both people see their previews and choose a filter and mirror setting. When both are ready, the host starts a countdown.
5. Each browser captures one portrait, exchanges it with the other browser, and composes the same strip locally.
6. Either person can retake or download the strip. Leaving or finishing clears the active session. Room metadata expires automatically.

If a network cannot establish a peer connection, the app should explain the failure and offer a clear retry or network-switch path. TURN credentials are configured as Cloudflare Worker secrets; direct STUN may still work without TURN, but some networks require a relay.

## 3. Technical architecture

### Shipped components

- **Static client:** HTML, CSS, and JavaScript in `public/`; requests camera access after the user chooses to create or join.
- **Cloudflare Worker API:** room creation, join requests, host decisions, room events, WebRTC signaling, and short-lived TURN credential generation.
- **Durable Object:** one SQLite-backed `BoothRoom` per room coordinates membership and event state.
- **Room event delivery:** clients poll the Worker for room events. Offers, answers, ICE candidates, settings, and readiness events are stored briefly in the room event table.
- **WebRTC:** the browsers exchange live video and still images directly when possible. Cloudflare TURN can relay encrypted peer traffic when direct connectivity fails.
- **Local image work:** each browser captures and composes the strip. There is no image storage bucket or server-side image processor.

### Current implementation gaps

- Room events use HTTP polling rather than WebSockets.
- Connection recovery and ICE restart after network changes need further work.
- Capture and data-channel transfers do not yet implement the full chunk retry, checksum, or progress protocol described in the original MVP exploration.
- Exact browser and operating system versions have not been formally declared.

## 4. Database requirements and current schema

Each Durable Object uses SQLite tables for:

- `booth`: invite-token hash, room status, expiry, and last activity.
- `participants`: participant ID, role, display name, status, and join time.
- `events`: short-lived signaling and room events with optional recipient IDs.

The host stores only the hash of the invite token. A room expires after six hours or 90 minutes without activity. Event history is capped at 300 records. The database contains no photo bytes, image URLs, or asset keys.

The server enforces the six-request waiting-list cap and the single admitted guest seat. New persistent data should be justified by a product need and should never include captured image data.

## 5. Real-time communication requirements

- HTTPS protects API requests. WebRTC uses browser-managed encrypted media/data transport.
- Room membership and host decisions are checked server-side. Guests cannot self-admit.
- ICE signaling is exchanged through the room event API. Cloudflare Realtime TURN credentials are generated by the Worker for admitted participants when the two TURN secrets are configured.
- The UI shows connection status. If direct and relayed routes fail, users need a clear explanation and recovery action.
- The app requests camera access but does not request microphone access.
- Do not silently upload photos as a fallback. A server relay for images would require an explicit privacy and retention decision.

## 6. Image processing

- The client captures a square portrait from the local camera preview using a canvas.
- The selected filter and mirror setting apply to the locally captured image and are shared with the other participant.
- Both clients compose the same two-photo vertical strip in browser memory and provide a local download.
- Clear temporary image data when a user finishes, leaves, or resets the session.
- Future image work should define output dimensions, metadata stripping, size limits, mobile memory limits, and retry behavior before adding higher-resolution captures.

## 7. Security and privacy

- Invite URLs are bearer credentials. Keep the token out of logs and third-party referrers, and retain only its hash in room storage.
- Authorize every room action by participant and role. The host controls admission and can close the booth or remove the admitted guest.
- Keep the TURN key ID and secret in Worker secrets. Never include either value in browser assets, Git, screenshots, or support messages.
- Camera access begins after a user action. The app does not store photo files; participants can still save or capture what they see.
- Cloudflare may process request and diagnostics data to operate the service. The Privacy Policy describes room metadata, signaling, retention, and third-party services.
- Age is self-confirmed as 16+. Launch markets, age safeguards, abuse handling, and privacy obligations need review before a wider public launch.

## 8. Deployment architecture

```text
Browser A ─── WebRTC video and photo data ─── Browser B
    │ HTTPS / room signaling                    │
    └──────────── Cloudflare Worker ────────────┘
                         │
             SQLite-backed Durable Object
                         │
              Cloudflare Realtime TURN
               (when a relay is needed)
```

- Wrangler deploys the Worker and serves static assets from `public/`.
- Durable Object SQLite stores room metadata and signaling events; no object storage is used for photos.
- Production TURN uses the `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` Worker secrets. The second value is the TURN key secret returned by Cloudflare, not a general account API token.
- Local development uses Wrangler's local Worker and Durable Object simulation. Production deployment requires Cloudflare authentication.

## Decisions still open

- Which browser and operating system versions should be officially supported?
- What abuse-reporting, moderation, and incident response process should be used for public access?
- What capture dimensions and maximum transfer size should be supported on mobile devices?
- Should room lifetime and idle expiry change based on observed usage?
- Should the app add a retry/ICE-restart action when the network changes?
