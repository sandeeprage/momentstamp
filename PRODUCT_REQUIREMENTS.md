# Momentstamp: product and system requirements

## Product definition

Momentstamp is a browser-based photobooth for two people in different places. A host creates a private booth, approves a guest from a waiting room, and the pair takes synchronized photos together. They receive one shared photo strip. The intended audience is 16+; the product must not imply that every 16-year-old is legally an adult.

### MVP scope

- No account required. Host shares an expiring, private invite link.
- Exactly two participants on supported laptops and mobile devices.
- Host explicitly admits or rejects each guest request.
- Both participants grant camera permission and see live previews. Voice chat and microphone access are not required.
- A small curated set of frames and filters, synchronized readiness, countdown, and retake.
- Both browsers exchange still captures peer-to-peer, compose the same single strip locally, and download it immediately. The service never stores photo bytes.
- Booth metadata expires automatically; no permanent album, social feed, payments, native app, video recording, AI face editing, or millisecond synchronization in MVP.

### Product assumptions

1. Neither camera preview is exposed to the other participant until the host admits the guest and both people consent.
2. Still images travel directly between admitted browsers using an encrypted WebRTC data channel. No silent server-storage fallback is allowed.
3. Photos exist only in browser memory or temporary local session state until the user finishes/leaves. Users may retain downloads in their own device storage.
4. Invite links are bearer credentials, but the host can reject requests, close the booth, and revoke access.
5. Age assurance and market-specific safeguards for the 16+ audience require a decision before public launch.

## 1. Product architecture

### Main surfaces

- **Landing/create:** explain the experience, camera use, peer-to-peer image transfer, and no server photo storage.
- **Host lobby:** local camera setup, share link, waiting guest list, and admit/reject controls.
- **Guest waiting room:** explain that host approval is required; allow the guest to request entry and withdraw the request.
- **Booth:** local/remote live preview, connection state, frame/filter controls, ready state, countdown, capture/transfer progress, retake, leave, and clear-session controls.
- **Result:** one composed strip, download action, and confirmation that the service does not store it.
- **Recovery:** camera denied/device unavailable, request rejected, invite expired/full, peer disconnected, transfer failed, and unsupported browser.

### Core domain objects

- **Booth:** private two-person room, lifecycle, invite-token hash, and allowlisted settings.
- **Participant:** host or guest seat, optional display name, consent, admission, presence, and device/connection state.
- **Capture round:** settings snapshot, readiness, scheduled capture timestamp, capture/transfer/render status.
- **Photo data:** transient browser-local still images and composed strip. This is not a server-side domain record and has no object-storage key.

## 2. User flow

1. Host creates a booth after seeing a concise camera and privacy explanation.
2. Host grants camera access, checks framing, and optionally enters a display name.
3. Host shares the expiring invite link. The host lobby shows pending requests.
4. Guest opens the link, sees that host approval is required, accepts the privacy/camera explanation, grants camera access, and requests to join.
5. Host sees the request and admits or rejects it. A rejected guest cannot enter. Host may close the room at any time.
6. Once admitted, both see connection status and each other's camera preview. They choose a frame/filter and adjust framing.
7. Either proposes a capture. Both confirm readiness; changing settings or disconnecting resets readiness.
8. Server signals a future capture timestamp. Both clients show the same countdown and capture locally.
9. Each still is sent directly to the other participant over WebRTC data channel. Each browser locally composes the same strip from both images and the agreed settings. Both can preview, retake, or finish.
10. Each downloads the result from their own browser. Leaving/finishing clears temporary session images. Server expiry removes booth metadata and signaling state.

If someone disconnects before capture, pause and offer reconnect. A peer disconnect or failed image transfer must produce a visible retry/re-capture path; do not mark a one-sided capture as a completed strip. A downloaded image may remain in that person's device storage.

## 3. Technical architecture

### Components

- **Web client:** responsive laptop/mobile app; camera permissions, preview, local capture, settings, countdown, peer transfer, local composition, download, and session cleanup.
- **Application API:** create/close booth, validate invite, register join requests, host admission/rejection, participant state, and capture-round coordination.
- **Realtime signaling:** authenticated room events and WebRTC offer/answer/ICE signaling, presence, guest requests, host decisions, readiness, countdown, and transfer/render status.
- **Peer connection:** WebRTC peer-to-peer video preview and data channel for still-image exchange. TURN may relay encrypted WebRTC traffic when direct connectivity fails; the application service does not decode or persist it.
- **Metadata store:** relational database for booth, participant, and capture-round state only.
- **Expiry worker:** removes expired room metadata and transient coordination state. No image composition worker or image object store is required.

Keep API and signaling together for MVP if useful, but enforce the same server-side authorization rules on both. Server state is authoritative for room membership, admission, and round coordination. Clients cannot self-admit, declare the other person ready, or claim a completed transfer without protocol confirmation.

## 4. Database requirements

Use a relational database with transactions, UTC timestamps, and indexed expiry queries. Never store camera streams, image bytes, image URLs, or image object keys.

### Suggested schema

- `booths`: `id` (random UUID/ULID), `invite_token_hash`, `status` (waiting/active/complete/closed/expired), `created_at`, `expires_at`, `closed_at`, validated `settings_json`, `version`.
- `participants`: `id`, `booth_id`, `seat` (host/guest), optional length-limited `display_name`, `join_requested_at`, `admitted_at`, `joined_at`, `last_seen_at`, `consent_at`, `consent_version`, `left_at`.
- `capture_rounds`: `id`, `booth_id`, `round_number`, `status`, `settings_snapshot`, `scheduled_capture_at`, `created_at`, `completed_at`.
- `round_participants`: `round_id`, `participant_id`, `ready_at`, `transfer_status`, `client_capture_at`, `transfer_completed_at`; unique `(round_id, participant_id)`. State only; no asset reference.
- `outbox_events` (optional): event id, aggregate id, event type, payload, created/delivered timestamps for reliable asynchronous signaling/expiry work.

### Constraints and retention

- Enforce at most two admitted participants per booth, one host, and one guest seat.
- Store only a hash of a high-entropy invite token. Never log the raw token.
- Use foreign keys, unique constraints, and idempotency for create/join/admit/capture operations.
- Index `booths.expires_at`, status, and foreign keys used by cleanup.
- Keep logs and analytics free of image bytes, invite secrets, and unnecessary personal data.
- Expiry must be retryable and observable. Closing a booth clears browser-local session state; server expiry deletes room metadata. Downloaded files are outside the service's control.

## 5. Real-time communication requirements

### Live preview and peer transfer

- Use WebRTC video for direct live preview and a reliable WebRTC data channel for still images. Use TURN as a relay when ICE cannot make a direct connection.
- Application servers must not record, decode, or persist raw video or image payloads. Do not silently fall back to uploading photos.
- Request camera only after an explicit user action and consent. Do not request microphone access in MVP.
- Show connecting/connected/reconnecting/failed states; distinguish a frozen preview from a live one.
- Support reconnect and renegotiation after network changes, tab sleep/wake, and device changes.
- Transfer stills in bounded chunks with size limits, checksum, progress, and retry/re-capture UX. Bound memory use on mobile devices.

### Signaling and synchronized capture

- WebSocket or equivalent for presence, join requests, admission decisions, WebRTC signaling, readiness, settings, scheduled capture, transfer, and completion state.
- Authenticate each connection to a booth and participant; authorize each event against current server-side membership and role.
- Use server-issued sequence/version numbers and idempotent event IDs for duplicate/out-of-order events.
- Server schedules a future capture timestamp with lead time (for example, 2–3 seconds). Clients estimate server clock offset and count down to the shared timestamp.
- Promise near-simultaneous capture, not frame-level synchronization. Record actual client capture time for diagnostics only.
- Heartbeats and presence timeouts detect abandoned rooms. Rate-limit invite attempts, join requests, signaling, and capture-round creation.

### Network and quality

- WebRTC media/data uses DTLS-SRTP; HTTPS/WSS protects API and signaling.
- Adapt preview resolution/frame rate to weak networks. Define supported browsers/OS versions and test mobile Safari and Chromium-based browsers.
- If peer transfer cannot complete, give clear retry/re-capture guidance. A future server relay would require a separately consented and reviewed storage design.

## 6. Image-processing requirements

- Capture stills locally from the camera track after the scheduled countdown.
- Normalize orientation, bound dimensions/pixel count and file size, and validate actual formats rather than trusting extension or MIME metadata.
- Ship a small curated set of frames and filters. Store filter/frame identifiers and versioned parameters in the round settings snapshot.
- Each browser composes one shared two-person strip locally using the same deterministic layout and rendering rules. Verify output consistency across supported devices.
- Produce a downloadable JPEG or PNG at defined dimensions and quality. Strip unnecessary EXIF/GPS metadata before peer transfer and from generated output.
- Keep originals only in active session memory/local temporary state for retakes; clear originals and previews at finish, leave, close, or session reset.
- Bound canvas size, memory, and processing time. Expose transfer/render progress and allow retry or retake after errors.

## 7. Security and privacy considerations

- Require HTTPS. Use secure, HttpOnly, SameSite cookies or short-lived scoped tokens; protect cookie-authenticated state changes against CSRF.
- Generate cryptographically random invite secrets, store hashes only, support expiry/revocation, avoid tokens in analytics/referrer headers, and set `Referrer-Policy: no-referrer` on invite pages.
- Treat invite links as bearer credentials. Require host approval, show pending requests, reserve one guest seat, prevent room enumeration, and let host close the booth.
- Check booth membership, admission, and role on every API and WebSocket event. No photo asset endpoint should exist in MVP.
- Request camera only after consent; explain that still images go directly to the other admitted participant and are not stored by the service. Make camera state and countdown visible.
- Do not record or relay raw video at the application layer. Do not use images for model training, ads, or unrelated analytics. Redact invite secrets and personal data from logs.
- Apply CSP, secure headers, input validation, output encoding, rate limits, abuse monitoring, and dependency updates.
- Define incident response, access auditing, age assurance, and applicable privacy/child-safety safeguards for the 16+ audience and launch markets before public launch.
- Users can clear the active session, but downloaded files may remain on participant devices. State that distinction plainly.

## 8. Deployment architecture

### MVP deployment shape

```text
Browser A ───── WebRTC video + data channel ───── Browser B
    │ HTTPS/WSS                                  │
    └────────────── Edge / API / signaling ─────┘
                              │
                    Relational database
```

- Serve the web app from a CDN; use immutable hashed assets and avoid caching private booth responses.
- Terminate TLS at a managed edge/load balancer; route HTTPS API and WSS to stateless application instances.
- Keep booth metadata in the database or managed coordination layer so reconnects can reach any instance.
- Use a managed relational database with encryption at rest, private networking, automated backups, and tested restore procedures. Backups contain room metadata only, no images.
- Deploy managed TURN close to target users or use a managed TURN provider; monitor relay connection success and bandwidth cost.
- Store secrets in a secrets manager; separate dev/staging/production and use least-privilege service identities.
- Run scheduled/continuous metadata expiry. Alert on stale booths, failed cleanup, database saturation, signaling failures, and TURN failures.
- Instrument join/admission success, peer connection success, capture completion, transfer/render success, and expiry without logging invite secrets or images.
- Use rolling deployments, backward-compatible schema migrations, infrastructure as code, and a rollback path.

### Launch targets to set

Set initial targets for room creation/join availability, host admission responsiveness, peer connection success, capture/transfer completion, maximum still size, and metadata expiry. Measure pilot sessions before adding regions or scaling infrastructure.

## Confirmed product choices

- One shared strip only; no separate original-portrait deliverable.
- No-account invite-link access, with host approval required for guests.
- Immediate local download; the service stores no photos.
- Frames and filters in the first release.
- Laptops and mobiles are required; exact browser/OS support remains to define.
- No voice-chat requirement.
- Intended audience: 16+; age assurance and market-specific safeguards remain to define.

## Remaining discovery questions

1. Which laptop/mobile browsers, OS versions, and launch regions should be explicitly supported?
2. Should the 16+ audience use a date-of-birth confirmation or another age gate, and what safeguards apply in launch markets?
3. Which specific frames and filters should ship first?
4. How long should booth/invite metadata live, independent of images (which are never stored)?
5. If peer-to-peer transfer fails on restrictive networks, should users retry/use another network, or should a future version offer an explicitly consented temporary server relay?
