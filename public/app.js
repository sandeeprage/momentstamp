import { CAPTURE_ROUNDS, paperColors, defaultStripStyle, sanitizeStripStyle, renderStrip } from './strip.js?v=20261011-6';

const CAPTURE_VERSION = 4;
const ROUND_INTERVAL_MS = 3200;
const PHOTO_CHUNK_SIZE = 20_000;

const app = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
const query = new URLSearchParams(location.search);
const inviteInUrl = query.get('invite');
const roomInUrl = query.get('room');
const hostSession = readSession('momentstamp-host');
const savedSession = readSession('momentstamp-session');
const state = {
  screen: 'home', name: '', roomId: null, invite: null, participantId: null, role: null,
  stream: null, remoteStream: null, peer: null, peerId: null, peerName: 'Your person',
  channel: null, candidates: [], offerStarted: false, eventsAfter: 0, pendingGuests: [],
  turnAvailable: false, iceFailureNotified: false,
  filter: 'warm', mirror: false, localReady: false, remoteReady: false,
  ownPhotos: [], otherPhotos: [], photoParts: new Map(), strip: null,
  stripStyle: defaultStripStyle(), stripPhotos: null, stripCanvas: null, captureAt: null,
  styleTimer: null, exportFormat: 'jpeg', captureStarting: false,
  captureId: null, captureRunning: false, captureRound: 0, composing: false,
  captureAbort: null, captureDeadlineTimer: null, sentRounds: new Set(), photoSendQueue: Promise.resolve(),
  remoteCaptureVersion: null, clockSynced: false, clockOffset: 0, clockSamples: 0, clockBestRtt: Infinity, clockPingAt: null,
  pollTimer: null, captureTimer: null, toastTimer: null,
};

function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const boothPath = action => `/api/rooms/${encodeURIComponent(state.roomId)}/${action}`;

async function request(path, method = 'GET', data = null, authorized = true) {
  const headers = { 'content-type': 'application/json' };
  if (authorized && state.participantId) headers['x-participant-id'] = state.participantId;
  const response = await fetch(path, { method, headers, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Please try that again.');
  return result;
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toastNode.classList.remove('is-visible'), 3000);
}

function siteHeader() {
  return `<header class="site-header"><a class="brand" href="/" aria-label="Momentstamp home"><span class="brand-mark">m</span><span>momentstamp</span></a><span class="header-note">A photo booth for two, wherever you are</span></header>`;
}

function renderShell(content, mode = '') {
  app.innerHTML = `<div class="site-shell${mode.includes('booth-mode') ? ' is-booth' : ''}">${siteHeader()}<main class="page ${mode}">${content}</main></div>`;
}

function ageConsentMarkup(id) {
  return `<div class="age-confirm"><input id="${id}" name="age-confirm" type="checkbox"><label for="${id}">I confirm I’m 16 or older and agree to the</label><a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a><span>and</span><a href="/terms.html" target="_blank" rel="noopener">Terms</a><span>.</span></div>`;
}

function renderHome() {
  state.screen = 'home';
  const isGuestInvite = Boolean(inviteInUrl && roomInUrl && hostSession?.roomId !== roomInUrl && !(savedSession?.roomId === roomInUrl && savedSession?.invite === inviteInUrl));
  if (isGuestInvite) return renderGuestEntry();

  renderShell(`<section class="hero">
    <div class="hero-copy"><span class="eyebrow">A tiny room for two</span><h1>Take a picture together.</h1><p class="hero-description">Your own little photobooth, timed together, even when you’re in different places.</p>
      <div class="hero-actions"><button class="button button-primary" data-action="show-create">Create your booth <span aria-hidden="true">↗</span></button><button class="button button-quiet" data-action="show-join">Join a booth</button></div>
      <form class="invite-form is-hidden" id="invite-form"><label for="invite-url">Paste your invite link</label><div class="form-row"><input class="text-input" id="invite-url" name="invite-url" type="url" placeholder="https://…" autocomplete="url"><button class="button button-primary" type="submit">Open invite</button></div></form>
    </div>
    <div class="hero-gallery" role="group" aria-label="Sample photos from the Momentstamp booth">
      <figure class="gallery-photo gallery-photo-main"><img src="/images/vintage-booth.jpg" width="736" height="1104" alt="A vintage photo booth" fetchpriority="high"></figure>
      <figure class="gallery-photo gallery-photo-top"><img src="/images/couple-photo-strips.jpg" width="736" height="1104" alt="A couple holding their photo booth strips" loading="lazy"></figure>
      <figure class="gallery-photo gallery-photo-bottom"><img src="/images/photo-booth-museum.jpg" width="736" height="1104" alt="Photo booth prints and memorabilia at a museum" loading="lazy"></figure>
    </div>
  </section>`, 'home-page');
}

function renderGuestEntry() {
  state.screen = 'home';
  renderShell(`<section class="entry-panel"><a class="back-link" href="/">← Back</a><div class="entry-heading"><span class="eyebrow">You have an invite</span><h1>Almost in.</h1><p>The host will let you into the booth. Add a name and request a spot in the waiting room.</p></div>
    <form id="guest-form" class="entry-form"><label for="guest-name">Your name</label><input class="text-input" id="guest-name" name="name" maxlength="32" autocomplete="nickname" placeholder="What should they call you?">${ageConsentMarkup('guest-age')}<p class="form-error" id="guest-error" aria-live="polite"></p><button class="button button-primary" type="submit">Request to join <span aria-hidden="true">↗</span></button><div class="privacy-note"><span class="privacy-icon" aria-hidden="true">◉</span><span>Your still photos go directly to the other person. Momentstamp does not store them.</span></div></form>
  </section>`, 'product-page');
}

function openCreateDialog() {
  app.insertAdjacentHTML('beforeend', `<div class="dialog-backdrop"><section class="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-heading"><button class="dialog-x" type="button" data-action="dismiss-dialog" aria-label="Close">×</button><span class="eyebrow">Before you begin</span><h2 id="setup-heading">Set up your booth</h2><p>Your name helps your person know it’s you. Camera access starts after you create the room.</p><form id="create-form"><label for="host-name">Your name</label><input class="text-input" id="host-name" name="name" maxlength="32" autocomplete="nickname" placeholder="What should they call you?">${ageConsentMarkup('host-age')}<p class="form-error" id="host-error" aria-live="polite"></p><div class="dialog-actions"><button class="button button-quiet" type="button" data-action="dismiss-dialog">Cancel</button><button class="button button-primary" type="submit">Create your booth</button></div></form></section></div>`);
  document.querySelector('#host-name')?.focus();
}

function cameraView({ id, label, placeholder = 'Camera preview', className = '', controls = false, showLabel = true }) {
  const settings = controls ? `data-filter-style="${state.filter}" data-mirrored="${state.mirror}"` : '';
  return `<div class="camera-view ${className}" ${settings}><video id="${id}" aria-label="${escapeHtml(label)} camera preview" autoplay playsinline muted></video><div class="camera-placeholder" id="${id}-placeholder"><span class="camera-glyph" aria-hidden="true">◉</span><p>${escapeHtml(placeholder)}</p><button type="button" class="button button-quiet is-hidden" data-action="resume-preview">Show camera</button></div>${showLabel ? `<span class="camera-label">${escapeHtml(label)}</span>` : ''}</div>`;
}

function boothCamera({ remote = false } = {}) {
  const id = remote ? 'remote-video' : 'local-video';
  const name = remote ? state.peerName : state.name || 'You';
  return `<section class="booth-camera" aria-label="${escapeHtml(name)} camera"><header class="camera-card-heading"><div class="camera-person"><strong>${escapeHtml(name)}</strong><span>${remote ? 'Your person' : 'You'}</span></div><span class="camera-status" id="${remote ? 'remote' : 'self'}-camera-status">${remote ? 'Connecting' : 'Starting camera'}</span></header>${cameraView({ id, label: name, placeholder: remote ? 'Connecting to your person…' : 'Starting your camera…', className: remote ? 'remote-view' : 'self-view', controls: true, showLabel: false })}</section>`;
}

function roundTrayMarkup() {
  const hostName = state.role === 'host' ? state.name : state.peerName;
  const guestName = state.role === 'host' ? state.peerName : state.name;
  return `<section class="rounds-panel" aria-labelledby="rounds-heading"><div class="rounds-heading"><h2 id="rounds-heading">Your four rounds</h2><span id="rounds-progress" role="status">0 of 4 paired</span></div><ol class="round-tray">${Array.from({ length: CAPTURE_ROUNDS }, (_, round) => `<li class="round-tile" data-round="${round}" data-phase="waiting"><div class="round-pair"><div class="round-portrait" data-owner="${state.role === 'host' ? 'self' : 'remote'}"><span class="round-placeholder">${escapeHtml(hostName || 'Host')}</span></div><div class="round-portrait" data-owner="${state.role === 'host' ? 'remote' : 'self'}"><span class="round-placeholder">${escapeHtml(guestName || 'Guest')}</span></div></div><div class="round-caption"><span>Round ${round + 1}</span><span class="round-state">${round === 0 ? 'Up next' : 'Waiting'}</span></div></li>`).join('')}</ol><p class="rounds-note">Each round adds one photo of each of you to the same row.</p></section>`;
}

function updateRoundTray() {
  const progress = document.querySelector('#rounds-progress');
  if (!progress) return;
  let paired = 0;
  document.querySelectorAll('.round-tile').forEach(tile => {
    const round = Number(tile.dataset.round);
    const complete = Boolean(state.ownPhotos[round] && state.otherPhotos[round] && state.sentRounds.has(round));
    const arriving = Boolean(state.ownPhotos[round] || state.otherPhotos[round]);
    const active = state.captureRunning && state.captureRound === round;
    const phase = complete ? 'complete' : arriving ? 'arriving' : active ? 'active' : 'waiting';
    tile.dataset.phase = phase;
    const label = tile.querySelector('.round-state');
    const copy = complete ? 'Paired' : arriving ? 'Pairing…' : active ? 'Get ready' : !state.captureRunning && round === 0 ? 'Up next' : 'Waiting';
    if (label.textContent !== copy) label.textContent = copy;
    if (complete) paired += 1;
    tile.querySelectorAll('.round-portrait').forEach(portrait => {
      const local = portrait.dataset.owner === 'self';
      const photo = (local ? state.ownPhotos : state.otherPhotos)[round];
      let image = portrait.querySelector('img');
      if (photo) {
        if (!image) { image = document.createElement('img'); portrait.append(image); }
        if (image.getAttribute('src') !== photo) image.src = photo;
        image.alt = `${local ? state.name || 'You' : state.peerName}, round ${round + 1}`;
      } else image?.remove();
      portrait.querySelector('.round-placeholder').classList.toggle('is-hidden', Boolean(photo));
    });
  });
  const copy = `${paired} of ${CAPTURE_ROUNDS} paired`;
  if (progress.textContent !== copy) progress.textContent = copy;
}

function renderLobby() {
  state.screen = 'lobby';
  const isHost = state.role === 'host';
  const inviteUrl = `${location.origin}/?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}`;
  renderShell(`<section class="flow-page"><div class="flow-heading"><span class="eyebrow">The waiting room</span><h1>${isHost ? 'Invite your person.' : 'You’re on the list.'}</h1><p>${isHost ? 'Share the private link. You decide who comes in.' : 'Keep this open. The host will let you in when they’re ready.'}</p></div>
    <div class="lobby-layout"><div class="lobby-camera">${cameraView({ id: 'local-video', label: state.name || (isHost ? 'Host' : 'Guest'), placeholder: isHost ? 'Your camera is ready when you are.' : 'Waiting for the host to approve you.' })}</div>
      <aside class="lobby-details">${isHost ? `<div class="detail-top"><span class="section-label">PRIVATE BOOTH</span><span class="status-tag" id="waiting-status">${state.pendingGuests.length ? `${state.pendingGuests.length} WAITING` : 'WAITING'}</span></div><h2>Your booth is ready.</h2><p>Up to six people can wait here. You choose who gets the single guest spot in your booth.</p><div class="invite-share"><span>${escapeHtml(inviteUrl)}</span><button class="button button-primary" data-action="copy-invite">Copy invite</button></div><div id="join-request-area">${pendingMarkup()}</div>` : `<div class="detail-top"><span class="section-label">GUEST REQUEST</span><span class="status-tag">WAITING</span></div><h2>Request sent.</h2><p>As soon as the host approves, you’ll enter the booth together.</p><div class="privacy-note"><span class="privacy-icon" aria-hidden="true">◉</span><span>Photos are exchanged directly between your browsers. They are not saved on the service.</span></div>`}<button class="text-action" data-action="leave">${isHost ? 'Close this booth' : 'Leave waiting room'}</button></aside>
    </div></section>`, 'product-page');
  attachVideo('local-video', state.stream);
}

function pendingMarkup() {
  if (!state.pendingGuests.length) return state.screen === 'booth' ? '' : `<div class="empty-wait"><span class="empty-ring" aria-hidden="true"></span><span>Waiting for your person to arrive</span></div>`;
  const occupied = state.screen === 'booth';
  return `<div class="waiting-list"><div class="waiting-list-heading"><span class="section-label">WAITING LIST</span><span>${state.pendingGuests.length} / 6</span></div>${state.pendingGuests.map(guest => `<div class="join-request"><div><strong>${escapeHtml(guest.name)}</strong><p>${occupied ? 'Waiting for the guest spot to open.' : 'Requesting to join your booth.'}</p></div><div class="request-actions">${occupied ? '' : `<button class="button button-primary" data-action="admit" data-participant-id="${escapeHtml(guest.id)}">Let in</button>`}<button class="button button-quiet" data-action="reject" data-participant-id="${escapeHtml(guest.id)}">Remove</button></div></div>`).join('')}</div>`;
}

function renderBooth() {
  state.screen = 'booth';
  renderShell(`<section class="booth-page"><header class="booth-heading"><div><span class="eyebrow">Your little booth</span><h1>You and <em>${escapeHtml(state.peerName)}</em></h1></div><span class="connection-state" id="connection-state">Connecting</span></header>
    <p class="booth-description">Get comfortable, choose your look, then get ready together.</p>
    <div class="booth-stage">${boothCamera()}${boothCamera({ remote: true })}</div>
    ${state.role === 'host' ? `<section class="people-panel"><div class="people-panel-copy"><span class="section-label">PEOPLE IN THIS BOOTH</span><p><strong>${escapeHtml(state.name || 'You')}</strong><span aria-hidden="true"> · </span>${escapeHtml(state.peerName)}</p></div><button class="button button-quiet" data-action="remove-guest">Remove guest</button></section><section class="booth-queue" id="waiting-list-area"></section>` : ''}
    <div class="booth-tools"><section class="tool-group"><span class="section-label">FILTER</span><div class="choice-row"><button class="choice ${state.filter === 'warm' ? 'is-selected' : ''}" data-filter="warm">Soft warm</button><button class="choice ${state.filter === 'mono' ? 'is-selected' : ''}" data-filter="mono">Black &amp; white</button><button class="choice ${state.filter === 'original' ? 'is-selected' : ''}" data-filter="original">Natural</button></div></section>
      <section class="tool-group"><span class="section-label">MIRROR</span><div class="choice-row"><button class="choice ${!state.mirror ? 'is-selected' : ''}" data-mirror="false">Natural</button><button class="choice ${state.mirror ? 'is-selected' : ''}" data-mirror="true">Mirrored</button></div></section>
      <section class="capture-tools"><div class="capture-copy"><h2>Four rounds. One shared strip.</h2><p class="capture-instruction">Both people press “I’m ready” once. Four countdowns will take your photos together.</p><p id="ready-message" role="status">${readyMessage()}</p><span class="countdown" id="countdown" aria-live="polite"></span></div><div class="capture-actions"><button class="button button-primary ready-button" data-action="ready" aria-pressed="${state.localReady}" ${state.channel?.readyState !== 'open' ? 'disabled' : ''}>${state.localReady ? 'You’re ready' : 'I’m ready'}</button><button class="button button-quiet" data-action="leave">Leave booth</button></div></section>
    </div>${roundTrayMarkup()}<p class="privacy-line">Your photos travel directly between browsers. They are never uploaded or stored by Momentstamp.</p></section>`, 'product-page booth-mode');
  attachVideo('local-video', state.stream);
  attachVideo('remote-video', state.remoteStream);
  updateConnectionState();
}

function readyMessage() {
  if (state.captureRunning) return state.ownPhotos.filter(Boolean).length === CAPTURE_ROUNDS
    ? 'All four rounds captured. Finishing your shared strip…'
    : `Photo ${state.captureRound + 1} of ${CAPTURE_ROUNDS}. Change your pose between countdowns.`;
  if (state.channel?.readyState === 'open' && state.remoteCaptureVersion !== CAPTURE_VERSION) return 'Both people need the latest booth. Refresh both pages to take four rounds.';
  if (state.channel?.readyState === 'open' && !state.clockSynced) return 'Syncing your cameras for the countdowns…';
  if (state.localReady && state.remoteReady) return 'You’re both ready. Your four countdowns will begin automatically.';
  if (state.remoteReady) return 'Your person is ready. Your turn!';
  if (state.localReady) return 'You’re ready. Waiting for your person.';
  if (state.channel?.readyState !== 'open') return 'Connecting your cameras. You can choose your look while you wait.';
  return 'Choose your look, then get into position.';
}

function renderResult() {
  state.screen = 'result';
  const style = state.stripStyle;
  renderShell(`<section class="result-page"><header class="result-heading"><span class="eyebrow">A little thing to keep</span><h1>Make it yours.</h1><p>Four moments, eight portraits, one keepsake.</p></header>
    <div class="result-workspace"><div class="strip-preview"><img class="photo-strip" id="photo-strip" alt="Your shared photo strip"><p id="strip-size"></p></div>
    <div class="strip-editor"><h2>Your strip</h2><p class="strip-share-status" id="strip-share-status" role="status"></p>
      <fieldset class="strip-controls" ${state.role !== 'host' ? 'disabled' : ''}><legend class="sr-only">Customize your shared strip</legend>
        <div class="strip-field"><span class="section-label" id="paper-label">Paper color</span><div class="paper-options" role="group" aria-labelledby="paper-label">${paperColors.map(paper => `<button type="button" class="paper-option" data-strip-color="${paper.color}" aria-label="${paper.label}" aria-pressed="${style.color === paper.color}"><span class="paper-swatch" data-paper="${paper.id}" aria-hidden="true"></span><span>${paper.label}</span></button>`).join('')}<label class="custom-paper">Custom<input type="color" id="strip-color" value="${style.color}" aria-label="Custom paper color"></label></div></div>
        <div class="strip-field"><label class="section-label" for="strip-caption">Caption</label><input class="text-input" id="strip-caption" maxlength="48" value="${escapeHtml(style.caption)}" placeholder="A few words to remember" aria-describedby="caption-help"><small id="caption-help">Up to 48 characters. Leave blank for just the photos.</small></div>
        <div class="strip-field-row"><div class="strip-field"><label class="section-label" for="strip-font">Lettering</label><select class="text-input" id="strip-font">${[['serif', 'Classic'], ['sans', 'Simple'], ['mono', 'Typewriter']].map(([value, label]) => `<option value="${value}" ${style.font === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="strip-field"><label class="section-label" for="strip-spacing">Spacing</label><select class="text-input" id="strip-spacing">${[['compact', 'Compact'], ['regular', 'Balanced'], ['wide', 'Airy'], ['beside', 'Beside']].map(([value, label]) => `<option value="${value}" ${style.spacing === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>
        <div class="strip-toggles"><label><input type="checkbox" id="strip-rounded" ${style.rounded ? 'checked' : ''}>Rounded photos</label><label><input type="checkbox" id="strip-date" ${style.showDate ? 'checked' : ''}>Show capture date (UTC)</label></div>
        <button class="text-action" type="button" data-action="reset-strip">Reset design</button>
      </fieldset>
      <div class="strip-export"><label for="strip-format">Download as</label><select class="text-input" id="strip-format"><option value="jpeg" ${state.exportFormat === 'jpeg' ? 'selected' : ''}>JPG · smaller file</option><option value="png" ${state.exportFormat === 'png' ? 'selected' : ''}>PNG · lossless</option></select><div class="result-actions"><button class="button button-primary" data-action="download">Download strip</button><button class="button button-quiet" data-action="retake">Take another</button></div></div>
    </div></div><button class="text-action finish-action" data-action="finish">Finish and clear this session</button><p class="privacy-line">The strip lives on your device. Momentstamp does not save it.</p></section>`, 'product-page');
  updateStripPreview(); updateStripShareStatus();
}

function updateStripPreview() {
  const image = document.querySelector('#photo-strip');
  if (image) image.src = state.strip;
  const size = document.querySelector('#strip-size');
  if (size && state.stripCanvas) size.textContent = `${state.stripCanvas.width} × ${state.stripCanvas.height} px`;
}

function updateStripShareStatus() {
  const label = document.querySelector('#strip-share-status');
  if (label) label.textContent = state.channel?.readyState !== 'open'
    ? 'Connection closed. You can still download; new edits stay on this device.'
    : state.role === 'host' ? 'You style it. Both of you see the changes.' : 'Your host is styling the strip. Your preview updates here.';
}

function shareStripStyle() {
  clearTimeout(state.styleTimer);
  if (state.role === 'host' && state.channel?.readyState === 'open') {
    try { state.channel.send(JSON.stringify({ type: 'strip-style', style: state.stripStyle })); }
    catch { toast('Your design could not be shared. Try again when connected.'); }
  }
}

function changeStripStyle(patch, reset = false) {
  if (state.role !== 'host') return;
  state.stripStyle = sanitizeStripStyle({ ...state.stripStyle, ...patch });
  if (state.stripPhotos) composeStrip(...state.stripPhotos);
  if (reset) renderResult();
  document.querySelectorAll('[data-strip-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stripColor === state.stripStyle.color)));
  const color = document.querySelector('#strip-color'); if (color) color.value = state.stripStyle.color;
  clearTimeout(state.styleTimer); state.styleTimer = setTimeout(shareStripStyle, 150);
}

function showCurrentScreen(screen) {
  if (screen === 'lobby') renderLobby();
  else if (screen === 'booth') renderBooth();
  else if (screen === 'result') renderResult();
  else renderHome();
}

function attachVideo(id, stream) {
  const video = document.querySelector(`#${id}`);
  if (!video || !stream) return;
  const placeholder = document.querySelector(`#${id}-placeholder`);
  const status = (message, retry = false) => {
    if (!video.isConnected || video.srcObject !== stream) return;
    placeholder?.classList.remove('is-hidden');
    const copy = placeholder?.querySelector('p'); if (copy) copy.textContent = message;
    placeholder?.querySelector('button')?.classList.toggle('is-hidden', !retry);
    updateConnectionState();
  };
  const showFrame = () => {
    if (!video.isConnected || video.srcObject !== stream || video.paused || !video.videoWidth || video.readyState < 2) return;
    placeholder?.classList.add('is-hidden'); updateConnectionState();
  };
  const confirmFrame = () => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(showFrame);
    else showFrame();
  };
  const play = () => {
    if (!video.isConnected || video.srcObject !== stream || !stream.getVideoTracks().some(track => track.readyState === 'live')) return;
    video.play().then(confirmFrame).catch(error => {
      if (error.name !== 'AbortError') status('Tap to show the live camera preview.', true);
    });
  };
  video.muted = true; video.defaultMuted = true; video.playsInline = true; video.autoplay = true;
  video.onloadedmetadata = play; video.oncanplay = play; video.onplaying = confirmFrame;
  video.onpause = () => { if (!document.hidden) status('Camera preview paused. Tap to show it.', true); };
  video.onwaiting = () => { if (video.readyState < 2) status('Waiting for the camera picture…'); };
  video.onerror = () => status('The camera preview could not play. Try showing it again.', true);
  if (video.srcObject !== stream) {
    video.srcObject = stream;
    status(id === 'remote-video' ? 'Connecting to your person…' : 'Starting your camera…');
  }
  play();
}

function resumeCameraPreviews() {
  if (state.screen !== 'booth' && state.screen !== 'lobby') return;
  attachVideo('local-video', state.stream); attachVideo('remote-video', state.remoteStream);
}

function updateAppearance() {
  document.querySelectorAll('[data-filter], [data-mirror]').forEach(button => {
    const selected = button.dataset.filter !== undefined ? button.dataset.filter === state.filter : button.dataset.mirror === String(state.mirror);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.camera-view[data-filter-style]').forEach(camera => {
    camera.dataset.filterStyle = state.filter; camera.dataset.mirrored = String(state.mirror);
  });
  updateReady();
}

function updateConnectionState(value = null) {
  const element = document.querySelector('#connection-state');
  if (!element) return;
  const channelOpen = state.channel?.readyState === 'open';
  const peerState = state.peer?.connectionState;
  const iceState = state.peer?.iceConnectionState;
  const label = value || (channelOpen ? 'Together' : peerState === 'connected' ? 'Connected' : iceState === 'checking' ? 'Finding a route' : iceState === 'failed' ? 'Can’t connect' : iceState === 'disconnected' ? 'Reconnecting' : 'Connecting');
  element.textContent = label;
  element.classList.toggle('is-connected', channelOpen || peerState === 'connected');
  const button = document.querySelector('[data-action="ready"]');
  if (button) {
    const preview = document.querySelector('#local-video');
    const cameraPlaying = preview && !preview.paused && preview.videoWidth > 0 && preview.readyState >= 2;
    button.disabled = !channelOpen || !cameraPlaying || !state.clockSynced || state.remoteCaptureVersion !== CAPTURE_VERSION || state.captureRunning || state.captureStarting;
    button.textContent = state.captureRunning ? 'Taking four photos…' : state.localReady ? 'You’re ready' : 'I’m ready';
    button.setAttribute('aria-pressed', String(state.localReady));
    button.classList.toggle('is-ready', state.localReady);
  }
  document.querySelectorAll('[data-filter], [data-mirror]').forEach(choice => { choice.disabled = state.captureRunning; });
  const message = document.querySelector('#ready-message');
  if (message && message.textContent !== readyMessage()) message.textContent = readyMessage();
  for (const remote of [false, true]) {
    const status = document.querySelector(`#${remote ? 'remote' : 'self'}-camera-status`);
    if (!status) continue;
    const video = document.querySelector(`#${remote ? 'remote' : 'local'}-video`);
    const playing = Boolean(video && !video.paused && video.videoWidth > 0 && video.readyState >= 2);
    const ready = remote ? state.remoteReady : state.localReady;
    const captured = (remote ? state.otherPhotos : state.ownPhotos).filter(Boolean).length === CAPTURE_ROUNDS;
    const copy = state.captureRunning ? captured ? 'Captured' : 'Posing' : playing ? ready ? 'Ready' : 'Camera on' : remote && !channelOpen ? label : 'Preview paused';
    if (status.textContent !== copy) status.textContent = copy;
    status.classList.toggle('is-ready', playing && ready || state.captureRunning && captured);
  }
  updateRoundTray();
}

async function getCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs a secure connection. Open the app on localhost or HTTPS.');
  if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  return state.stream;
}

function setInlineError(id, message) {
  const error = document.querySelector(`#${id}`);
  if (error) error.textContent = message;
}

async function createBooth(form) {
  const button = form.querySelector('[type="submit"]');
  const age = form.elements['age-confirm'];
  if (!age.checked) { setInlineError('host-error', 'Please confirm that you are 16 or older.'); age.focus(); return; }
  setInlineError('host-error', '');
  button.disabled = true;
  try {
    state.name = form.elements.name.value.trim() || 'Host';
    await getCamera();
    const result = await request('/api/rooms', 'POST', { name: state.name }, false);
    Object.assign(state, { roomId: result.roomId, invite: result.invite, participantId: result.participantId, role: 'host', eventsAfter: 0, pendingGuests: [] });
    const session = { roomId: result.roomId, invite: result.invite, participantId: result.participantId, role: 'host', name: state.name };
    sessionStorage.setItem('momentstamp-host', JSON.stringify(session));
    sessionStorage.setItem('momentstamp-session', JSON.stringify(session));
    history.replaceState({}, '', `/?room=${encodeURIComponent(result.roomId)}&invite=${encodeURIComponent(result.invite)}&host=1`);
    showCurrentScreen('lobby');
    startPolling();
  } catch (error) { toast(error.message); button.disabled = false; }
}

async function requestToJoin(form) {
  const button = form.querySelector('[type="submit"]');
  if (!form.elements['age-confirm'].checked) { setInlineError('guest-error', 'Please confirm that you are 16 or older.'); form.elements['age-confirm'].focus(); return; }
  setInlineError('guest-error', ''); button.disabled = true;
  try {
    state.name = form.elements.name.value.trim() || 'Guest';
    await getCamera();
    const result = await request(`/api/rooms/${encodeURIComponent(roomInUrl)}/request`, 'POST', { name: state.name, invite: inviteInUrl }, false);
    Object.assign(state, { roomId: roomInUrl, invite: inviteInUrl, participantId: result.participantId, role: 'guest', eventsAfter: 0, pendingGuests: [] });
    sessionStorage.setItem('momentstamp-session', JSON.stringify({ roomId: roomInUrl, invite: inviteInUrl, participantId: result.participantId, role: 'guest', name: state.name }));
    history.replaceState({}, '', `/?room=${encodeURIComponent(roomInUrl)}&invite=${encodeURIComponent(inviteInUrl)}`);
    showCurrentScreen('lobby'); startPolling();
  } catch (error) { toast(error.message); button.disabled = false; }
}

function startPolling() { clearTimeout(state.pollTimer); pollEvents(); }
async function pollEvents() {
  if (!state.participantId || !state.roomId) return;
  try {
    const snapshot = await request(`${boothPath('events')}?after=${state.eventsAfter}`);
    if (state.role === 'host') state.pendingGuests = Array.isArray(snapshot.pending) ? snapshot.pending : [];
    if (snapshot.peers?.length) { state.peerId = snapshot.peers[0].id; state.peerName = snapshot.peers[0].name; }
    updatePendingRequest();
    for (const event of snapshot.events || []) {
      await handleRoomEvent(event);
      state.eventsAfter = Math.max(state.eventsAfter, event.id);
    }
    if (snapshot.status === 'closed') { leaveLocal(); renderHome(); return; }
  } catch (error) {
    if (/expired|admitted|does not exist/i.test(error.message)) { toast(error.message); leaveLocal(); renderHome(); return; }
  }
  if (state.participantId) state.pollTimer = setTimeout(pollEvents, 800);
}

function updatePendingRequest() {
  const area = document.querySelector('#join-request-area');
  if (area) area.innerHTML = pendingMarkup();
  const boothArea = document.querySelector('#waiting-list-area');
  if (boothArea) boothArea.innerHTML = pendingMarkup();
  const status = document.querySelector('#waiting-status');
  if (status) status.textContent = state.pendingGuests.length ? `${state.pendingGuests.length} WAITING` : 'WAITING';
}

async function handleRoomEvent(event) {
  if (event.event === 'join-request' && state.role === 'host') { if (!state.pendingGuests.some(guest => guest.id === event.data.id)) state.pendingGuests.push(event.data); updatePendingRequest(); }
  if (event.event === 'admitted' && state.role === 'host') {
    state.pendingGuests = state.pendingGuests.filter(guest => guest.id !== event.data.id);
    state.peerId = event.data.id; state.peerName = event.data.name; showCurrentScreen('booth'); await setupPeer(true);
    updatePendingRequest();
  } else if (event.event === 'admitted' && state.role === 'guest') {
    toast('You’re in. Connecting now.'); showCurrentScreen('booth'); await setupPeer();
  }
  if (event.event === 'peer-ready' && state.role === 'guest') { state.peerId = event.data.id; await setupPeer(); }
  if (event.event === 'rejected') { toast('The host can’t let you in right now.'); leaveLocal(); renderHome(); }
  if (event.event === 'removed' && state.role === 'guest') { toast('The host removed you from the booth.'); leaveLocal(); renderHome(); }
  if (event.event === 'closed') { toast('The host closed this booth.'); leaveLocal(); renderHome(); }
  if (event.event === 'request-left' && state.role === 'host') { state.pendingGuests = state.pendingGuests.filter(guest => guest.id !== event.data.id); updatePendingRequest(); }
  if (event.event === 'guest-left' && state.role === 'host') {
    resetPeerConnection();
    if (state.screen === 'booth') { toast(event.data.removed ? 'Guest removed. Your booth is ready for another invite.' : 'Your person left the booth.'); renderLobby(); }
  }
  if (event.event === 'signal') await handleSignal(event.data);
}

async function setupPeer(makeOffer = false) {
  if (state.peer) { if (makeOffer) await startOffer(); return; }
  let iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
  try {
    const config = await request(boothPath('ice-servers'));
    if (Array.isArray(config.iceServers) && config.iceServers.length) iceServers = config.iceServers;
    state.turnAvailable = Boolean(config.turnAvailable);
  } catch {
    // Keep direct STUN connectivity for local/legacy development servers.
  }
  const peer = new RTCPeerConnection({ iceServers });
  state.peer = peer;
  state.remoteStream = new MediaStream();
  for (const track of state.stream.getTracks()) peer.addTrack(track, state.stream);
  peer.ontrack = event => {
    if (state.peer !== peer) return;
    for (const track of event.streams[0]?.getTracks() || [event.track]) {
      if (!state.remoteStream.getTracks().some(existing => existing.id === track.id)) state.remoteStream.addTrack(track);
    }
    attachVideo('remote-video', state.remoteStream);
  };
  peer.onicecandidate = event => { if (event.candidate) sendSignal('ice', event.candidate.toJSON()); };
  peer.onconnectionstatechange = () => updateConnectionState();
  peer.oniceconnectionstatechange = () => {
    updateConnectionState();
    if (peer.iceConnectionState === 'failed' && !state.iceFailureNotified) {
      state.iceFailureNotified = true;
      toast(state.turnAvailable
        ? 'The network connection failed. Try reconnecting or switching networks.'
        : 'These networks could not connect directly. Cloudflare TURN relay is not configured for this deployment yet.');
    }
  };
  if (state.role === 'host') bindPhotoChannel(peer.createDataChannel('momentstamp-photos', { ordered: true }));
  else peer.ondatachannel = event => bindPhotoChannel(event.channel);
  if (makeOffer) await startOffer();
}

function bindPhotoChannel(channel) {
  state.channel = channel;
  channel.onopen = () => {
    if (state.channel !== channel) return;
    channel.send(JSON.stringify({ type: 'booth-info', captureVersion: CAPTURE_VERSION }));
    if (state.role === 'host') pingCaptureClock();
    updateConnectionState(); shareStripStyle(); updateStripShareStatus();
  };
  channel.onclose = () => {
    if (state.channel !== channel) return;
    if (state.captureRunning) cancelCapture('connection', false);
    updateConnectionState('Disconnected'); updateStripShareStatus();
  };
  channel.onerror = () => toast('Photo connection interrupted. Try again.');
  channel.onmessage = event => {
    if (state.channel !== channel) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'booth-info') { state.remoteCaptureVersion = message.captureVersion; updateReady(); }
      if (message.type === 'clock-ping' && state.role === 'guest' && Number.isFinite(message.at)) {
        channel.send(JSON.stringify({ type: 'clock-pong', at: message.at, remoteAt: Date.now() }));
      }
      if (message.type === 'clock-pong' && state.role === 'host' && message.at === state.clockPingAt && Number.isFinite(message.remoteAt)) {
        const receivedAt = Date.now(), rtt = receivedAt - message.at;
        if (rtt >= 0 && rtt < state.clockBestRtt) { state.clockBestRtt = rtt; state.clockOffset = message.remoteAt - (message.at + receivedAt) / 2; }
        state.clockSynced = true; state.clockSamples += 1; state.clockPingAt = null;
        channel.send(JSON.stringify({ type: 'clock-sync' })); updateReady();
        if (state.clockSamples < 3) pingCaptureClock();
      }
      if (message.type === 'clock-sync' && state.role === 'guest') { state.clockSynced = true; updateReady(); }
      if (message.type === 'capture-settings' && !state.captureRunning && ['warm', 'mono', 'original'].includes(message.filter) && typeof message.mirror === 'boolean') {
        state.filter = message.filter; state.mirror = message.mirror;
        state.localReady = state.remoteReady = false;
        if (state.screen === 'booth') updateAppearance();
      }
      if (message.type === 'capture-ready' && typeof message.ready === 'boolean' && !state.captureRunning && state.remoteCaptureVersion === CAPTURE_VERSION) {
        state.remoteReady = message.ready; updateReady(); startCaptureWhenReady();
      }
      if (message.type === 'capture-start' && state.role === 'guest') scheduleCapture(message);
      if (message.type === 'capture-cancel' && message.captureId === state.captureId && state.captureRunning) cancelCapture(message.reason, false);
      if (message.type === 'strip-style' && state.role === 'guest') {
        state.stripStyle = sanitizeStripStyle(message.style, state.stripStyle);
        if (state.stripPhotos) { composeStrip(...state.stripPhotos); renderResult(); }
      }
      if (message.type === 'photo-start' || message.type === 'photo-chunk') receivePhotoPart(message);
      if (message.type === 'retake' && message.captureId === state.captureId) { clearStripCapture(); state.localReady = state.remoteReady = false; if (state.screen === 'result' || state.screen === 'booth') showCurrentScreen('booth'); updateConnectionState(); }
    } catch { toast('Could not read that photo. Try taking the moment again.'); }
  };
}

function pingCaptureClock() {
  if (state.channel?.readyState !== 'open') return;
  state.clockPingAt = Date.now();
  state.channel.send(JSON.stringify({ type: 'clock-ping', at: state.clockPingAt }));
}

function receivePhotoPart(message) {
  if (!state.captureRunning || message.captureId !== state.captureId || !Number.isInteger(message.round) || message.round < 0 || message.round >= CAPTURE_ROUNDS) return;
  if (!Number.isInteger(message.total) || message.total < 1 || message.total > 128 || state.otherPhotos[message.round]) return;
  if (message.type === 'photo-start') {
    if (!state.photoParts.has(message.round)) state.photoParts.set(message.round, { total: message.total, chunks: new Array(message.total), count: 0 });
    return;
  }
  const parts = state.photoParts.get(message.round);
  if (!parts || message.total !== parts.total || !Number.isInteger(message.index) || message.index < 0 || message.index >= parts.total || typeof message.data !== 'string' || message.data.length > PHOTO_CHUNK_SIZE) return;
  if (parts.chunks[message.index] === undefined) { parts.chunks[message.index] = message.data; parts.count += 1; }
  if (parts.count === parts.total) {
    const photo = parts.chunks.join(''); state.photoParts.delete(message.round);
    if (!photo.startsWith('data:image/jpeg;base64,')) { cancelCapture('camera'); return; }
    state.otherPhotos[message.round] = photo; updateReady(); tryCompose();
  }
}

async function startOffer() {
  if (!state.peer || state.offerStarted) return;
  state.offerStarted = true;
  try { const offer = await state.peer.createOffer(); await state.peer.setLocalDescription(offer); await sendSignal('offer', state.peer.localDescription); }
  catch { state.offerStarted = false; toast('Could not start the camera connection. Please try again.'); }
}

async function sendSignal(kind, payload) {
  if (!state.peerId) return;
  try { await request(boothPath('signal'), 'POST', { targetId: state.peerId, kind, payload }); }
  catch (error) { if (kind !== 'ice') toast(error.message); }
}

async function handleSignal(signal) {
  if (signal.kind === 'offer') {
    await setupPeer(); await state.peer.setRemoteDescription(signal.payload);
    const answer = await state.peer.createAnswer(); await state.peer.setLocalDescription(answer); await sendSignal('answer', state.peer.localDescription);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate);
  } else if (signal.kind === 'answer' && state.peer) {
    await state.peer.setRemoteDescription(signal.payload);
    for (const candidate of state.candidates.splice(0)) await state.peer.addIceCandidate(candidate);
  } else if (signal.kind === 'ice' && state.peer) {
    if (state.peer.remoteDescription) await state.peer.addIceCandidate(signal.payload); else state.candidates.push(signal.payload);
  } else if (signal.kind === 'settings' && !state.captureRunning) {
    if (['warm', 'mono', 'original'].includes(signal.payload?.filter)) state.filter = signal.payload.filter;
    if (typeof signal.payload?.mirror === 'boolean') state.mirror = signal.payload.mirror;
    if (state.screen === 'booth') updateAppearance();
  }
  else if (signal.kind === 'capture-at') toast('This booth has been updated. Refresh both pages to take four rounds.');
}

function updateReady() {
  updateConnectionState();
}

function changeAppearance(key, rawValue) {
  if (state.captureRunning || state.captureStarting) return;
  const value = key === 'mirror' ? rawValue === 'true' : rawValue;
  state[key] = value; state.localReady = false; state.remoteReady = false;
  updateAppearance();
  if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify({ type: 'capture-settings', filter: state.filter, mirror: state.mirror }));
  else sendSignal('settings', { filter: state.filter, mirror: state.mirror });
  updateReady();
}

async function toggleReady() {
  if (state.captureRunning || state.captureStarting || !state.clockSynced || state.remoteCaptureVersion !== CAPTURE_VERSION || state.channel?.readyState !== 'open') return;
  state.localReady = !state.localReady;
  state.channel.send(JSON.stringify({ type: 'capture-ready', ready: state.localReady })); updateReady();
  await startCaptureWhenReady();
}

async function startCaptureWhenReady() {
  if (state.localReady && state.remoteReady && state.role === 'host' && !state.captureStarting && !state.captureRunning && state.clockSynced && state.remoteCaptureVersion === CAPTURE_VERSION && state.channel?.readyState === 'open') {
    state.captureStarting = true;
    const plan = { type: 'capture-start', captureId: crypto.randomUUID(), at: Date.now() + ROUND_INTERVAL_MS, offset: state.clockOffset };
    try { scheduleCapture(plan); state.channel.send(JSON.stringify(plan)); }
    catch { cancelCapture('connection'); }
    finally { state.captureStarting = false; }
  }
}

function scheduleCapture(plan) {
  if (state.captureRunning || state.captureId === plan.captureId || state.screen !== 'booth') return;
  if (!state.localReady || !state.remoteReady) return;
  if (typeof plan.captureId !== 'string' || plan.captureId.length > 64 || !plan.captureId.length || !Number.isFinite(plan.at) || !Number.isFinite(plan.offset) || !state.clockSynced || state.remoteCaptureVersion !== CAPTURE_VERSION) return;
  const localAt = plan.at + (state.role === 'guest' ? plan.offset : 0);
  if (localAt - Date.now() < -1000 || localAt - Date.now() > 10000) {
    state.channel?.send(JSON.stringify({ type: 'capture-cancel', captureId: plan.captureId, reason: 'timeout' }));
    toast('The countdown arrived too late. Both people can press “I’m ready” to try again.'); return;
  }
  clearStripCapture(); state.captureAt = plan.at; state.captureId = plan.captureId;
  state.captureRunning = true; state.captureAbort = new AbortController();
  state.ownPhotos = new Array(CAPTURE_ROUNDS).fill(null); state.otherPhotos = new Array(CAPTURE_ROUNDS).fill(null);
  state.localReady = state.remoteReady = false; updateReady();
  state.captureDeadlineTimer = setTimeout(() => cancelCapture('timeout'), Math.max(0, localAt - Date.now()) + (CAPTURE_ROUNDS - 1) * ROUND_INTERVAL_MS + 30000);
  const tick = () => {
    if (state.captureId !== plan.captureId || !state.captureRunning) return;
    const remaining = localAt + state.captureRound * ROUND_INTERVAL_MS - Date.now();
    const label = document.querySelector('#countdown');
    if (remaining <= 0) {
      if (remaining < -1000 || document.hidden) { cancelCapture('hidden'); return; }
      const round = state.captureRound;
      try { if (!capturePhoto(round)) return; } catch { cancelCapture('camera'); return; }
      state.captureRound += 1; updateReady();
      if (state.captureRound === CAPTURE_ROUNDS) { if (label) label.textContent = 'Four rounds captured'; return; }
      state.captureTimer = setTimeout(tick, 200); return;
    }
    if (label) label.textContent = `Photo ${state.captureRound + 1} of ${CAPTURE_ROUNDS} · ${Math.ceil(remaining / 1000)}`;
    state.captureTimer = setTimeout(tick, Math.min(180, remaining));
  };
  tick();
}

function capturePhoto(round) {
  const video = document.querySelector('#local-video');
  if (!video || video.paused || video.ended || video.readyState < 2 || !video.videoWidth || !state.stream?.active || state.channel?.readyState !== 'open') { cancelCapture('camera'); return false; }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 900;
  const context = canvas.getContext('2d');
  context.filter = state.filter === 'mono' ? 'grayscale(1)' : state.filter === 'warm' ? 'sepia(.17) saturate(1.12)' : 'none';
  const side = Math.min(video.videoWidth, video.videoHeight);
  if (state.mirror) { context.translate(canvas.width, 0); context.scale(-1, 1); }
  context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 900, 900);
  context.setTransform(1, 0, 0, 1, 0, 0);
  const photo = canvas.toDataURL('image/jpeg', .78), captureId = state.captureId, signal = state.captureAbort.signal;
  state.ownPhotos[round] = photo;
  updateRoundTray();
  state.photoSendQueue = state.photoSendQueue.catch(() => {}).then(async () => {
    if (signal.aborted || state.captureId !== captureId) return;
    const channel = state.channel, total = Math.ceil(photo.length / PHOTO_CHUNK_SIZE);
    const send = payload => {
      if (signal.aborted || state.captureId !== captureId || channel.readyState !== 'open') throw new Error('Photo transfer stopped.');
      channel.send(JSON.stringify({ ...payload, captureId, round, total }));
    };
    await waitForPhotoBuffer(channel, signal, 128000);
    send({ type: 'photo-start' });
    for (let index = 0; index < total; index++) {
      await waitForPhotoBuffer(channel, signal, 128000);
      send({ type: 'photo-chunk', index, data: photo.slice(index * PHOTO_CHUNK_SIZE, (index + 1) * PHOTO_CHUNK_SIZE) });
    }
    await waitForPhotoBuffer(channel, signal, 0);
    if (state.captureId === captureId) { state.sentRounds.add(round); updateReady(); tryCompose(); }
  }).catch(() => { if (!signal.aborted && state.captureId === captureId) cancelCapture('connection'); });
  return true;
}

function waitForPhotoBuffer(channel, signal, limit) {
  if (signal.aborted || channel?.readyState !== 'open') return Promise.reject(new Error('Photo connection closed.'));
  if (channel.bufferedAmount <= limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.bufferedAmountLowThreshold = limit;
    const finish = error => { clearTimeout(timer); channel.removeEventListener('bufferedamountlow', low); channel.removeEventListener('close', closed); signal.removeEventListener('abort', closed); error ? reject(error) : resolve(); };
    const low = () => { if (channel.bufferedAmount <= limit) finish(); };
    const closed = () => finish(new Error('Photo transfer stopped.'));
    const timer = setTimeout(closed, 15000);
    channel.addEventListener('bufferedamountlow', low); channel.addEventListener('close', closed); signal.addEventListener('abort', closed, { once: true });
    low();
  });
}

async function tryCompose() {
  if (!state.captureRunning || state.composing || state.sentRounds.size !== CAPTURE_ROUNDS || state.ownPhotos.filter(Boolean).length !== CAPTURE_ROUNDS || state.otherPhotos.filter(Boolean).length !== CAPTURE_ROUNDS) return;
  state.composing = true; const captureId = state.captureId;
  const decode = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
  try {
    const [local, remote] = await Promise.all([Promise.all(state.ownPhotos.map(decode)), Promise.all(state.otherPhotos.map(decode))]);
    if (state.captureId !== captureId) return;
    clearTimeout(state.captureDeadlineTimer); clearTimeout(state.captureTimer);
    state.captureRunning = false; state.stripPhotos = [local, remote]; composeStrip(local, remote);
  } catch { if (state.captureId === captureId) cancelCapture('camera'); }
  finally { if (state.captureId === captureId) state.composing = false; }
}

function composeStrip(local, remote) {
  const host = state.role === 'host' ? local : remote, guest = state.role === 'host' ? remote : local;
  const photos = host.flatMap((photo, round) => [photo, guest[round]]);
  state.stripCanvas = renderStrip(document.createElement('canvas'), photos, state.stripStyle, state.captureAt);
  state.strip = state.stripCanvas.toDataURL('image/jpeg', .91);
  if (state.screen === 'result') updateStripPreview(); else showCurrentScreen('result');
}

function clearStripCapture() {
  clearTimeout(state.captureTimer); clearTimeout(state.captureDeadlineTimer); state.captureAbort?.abort();
  state.ownPhotos = []; state.otherPhotos = []; state.photoParts = new Map(); state.sentRounds = new Set();
  state.strip = state.stripPhotos = state.stripCanvas = state.captureAt = state.captureId = state.captureAbort = null;
  state.captureRunning = state.composing = false; state.captureRound = 0;
}

function cancelCapture(reason, notify = true) {
  if (notify && state.channel?.readyState === 'open' && state.captureId) {
    try { state.channel.send(JSON.stringify({ type: 'capture-cancel', captureId: state.captureId, reason })); } catch { /* Clear the local take even when the connection has closed. */ }
  }
  clearStripCapture(); state.localReady = state.remoteReady = false;
  const label = document.querySelector('#countdown'); if (label) label.textContent = '';
  updateReady();
  const messages = { hidden: 'Keep both booth pages visible during all four countdowns. Press “I’m ready” to try again.', camera: 'A camera could not capture all four photos. Check both previews and try again.', timeout: 'The photo exchange took too long. Both people can press “I’m ready” to try again.' };
  toast(messages[reason] || 'The photo connection was interrupted. Reconnect and take all four rounds again.');
}

function resetPeerConnection() {
  clearTimeout(state.captureTimer);
  state.peer?.close();
  state.peer = state.channel = state.remoteStream = null;
  state.peerId = null; state.peerName = 'Your person'; state.offerStarted = false; state.candidates = [];
  state.turnAvailable = false; state.iceFailureNotified = false;
  state.remoteCaptureVersion = null; state.clockSynced = false; state.clockOffset = 0;
  state.clockSamples = 0; state.clockBestRtt = Infinity; state.clockPingAt = null;
  state.captureStarting = false;
  clearStripCapture();
  state.localReady = state.remoteReady = false;
}

async function removeGuest() {
  if (state.role !== 'host' || !state.peerId) return;
  try {
    await request(boothPath('remove'), 'POST', { participantId: state.peerId });
    resetPeerConnection();
    renderLobby();
    toast('Guest removed. Your booth is ready for another invite.');
  } catch (error) { toast(error.message); }
}

async function hostDecision(action, guestId) {
  try { await request(boothPath(action), 'POST', { participantId: guestId }); state.pendingGuests = state.pendingGuests.filter(guest => guest.id !== guestId); updatePendingRequest(); }
  catch (error) { toast(error.message); }
}

function navigateToInvite(value) {
  try {
    const url = new URL(value);
    if (!url.searchParams.get('room') || !url.searchParams.get('invite')) throw new Error();
    location.href = `${url.pathname}?${url.searchParams.toString()}`;
  } catch { toast('Paste a valid Momentstamp invite link.'); }
}

async function closeBooth() {
  try {
    if (state.role === 'host') await request(boothPath('close'), 'POST', {});
    else if (state.participantId) await request(boothPath('leave'), 'POST', {});
  } catch { /* The room may already be closed. */ }
  leaveLocal(true); history.replaceState({}, '', '/'); renderHome();
}

function leaveLocal(clearStored = true) {
  clearTimeout(state.styleTimer); state.stripStyle = defaultStripStyle();
  clearTimeout(state.pollTimer); clearTimeout(state.captureTimer); state.peer?.close();
  state.stream?.getTracks().forEach(track => track.stop());
  state.peer = state.channel = state.stream = state.remoteStream = null;
  clearStripCapture();
  state.roomId = state.invite = state.participantId = state.role = state.peerId = null;
  state.turnAvailable = false; state.iceFailureNotified = false;
  state.remoteCaptureVersion = null; state.clockSynced = false; state.clockOffset = 0;
  state.clockSamples = 0; state.clockBestRtt = Infinity; state.clockPingAt = null;
  state.captureStarting = false;
  if (clearStored) { sessionStorage.removeItem('momentstamp-host'); sessionStorage.removeItem('momentstamp-session'); }
}

app.addEventListener('click', async event => {
  if (event.target.classList.contains('dialog-backdrop')) { document.querySelector('.dialog-backdrop')?.remove(); return; }
  const target = event.target.closest('[data-action], [data-filter], [data-mirror], [data-strip-color]');
  if (!target) return;
  if (target.dataset.stripColor) return changeStripStyle({ color: target.dataset.stripColor });
  if (target.dataset.filter) return changeAppearance('filter', target.dataset.filter);
  if (target.dataset.mirror !== undefined) return changeAppearance('mirror', target.dataset.mirror);
  const action = target.dataset.action;
  try {
    if (action === 'show-create') openCreateDialog();
    else if (action === 'resume-preview') resumeCameraPreviews();
    else if (action === 'dismiss-dialog') document.querySelector('.dialog-backdrop')?.remove();
    else if (action === 'show-join') { document.querySelector('#invite-form')?.classList.toggle('is-hidden'); document.querySelector('#invite-url')?.focus(); }
    else if (action === 'copy-invite') { await navigator.clipboard.writeText(`${location.origin}/?room=${state.roomId}&invite=${state.invite}`); toast('Invite copied. Send it to your person.'); }
    else if (action === 'admit') await hostDecision('admit', target.dataset.participantId);
    else if (action === 'reject') await hostDecision('reject', target.dataset.participantId);
    else if (action === 'remove-guest') await removeGuest();
    else if (action === 'ready') await toggleReady();
    else if (action === 'leave') await closeBooth();
    else if (action === 'reset-strip') changeStripStyle(defaultStripStyle(), true);
    else if (action === 'download' && state.stripCanvas) {
      shareStripStyle();
      const link = document.createElement('a'); link.href = state.stripCanvas.toDataURL(`image/${state.exportFormat}`, .94);
      link.download = `momentstamp-${state.stripStyle.layout}-${new Date(state.captureAt || Date.now()).toISOString().slice(0, 10)}.${state.exportFormat === 'png' ? 'png' : 'jpg'}`; link.click();
    }
    else if (action === 'retake') { const captureId = state.captureId; shareStripStyle(); clearStripCapture(); state.localReady = state.remoteReady = false; if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify({ type: 'retake', captureId })); showCurrentScreen('booth'); }
    else if (action === 'finish') await closeBooth();
  } catch (error) { toast(error.message || 'Please try that again.'); }
});

app.addEventListener('input', event => {
  if (event.target.id === 'strip-caption') changeStripStyle({ caption: event.target.value });
  if (event.target.id === 'strip-color') changeStripStyle({ color: event.target.value });
});

app.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'strip-font') changeStripStyle({ font: target.value });
  if (target.id === 'strip-spacing') changeStripStyle({ spacing: target.value });
  if (target.id === 'strip-rounded') changeStripStyle({ rounded: target.checked });
  if (target.id === 'strip-date') changeStripStyle({ showDate: target.checked });
  if (target.id === 'strip-format' && ['jpeg', 'png'].includes(target.value)) state.exportFormat = target.value;
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'create-form') await createBooth(event.target);
  else if (event.target.id === 'guest-form') await requestToJoin(event.target);
  else if (event.target.id === 'invite-form') navigateToInvite(event.target.elements['invite-url'].value);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.captureRunning && state.captureRound < CAPTURE_ROUNDS) cancelCapture('hidden');
  else if (!document.hidden) resumeCameraPreviews();
});

window.addEventListener('focus', resumeCameraPreviews);

app.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelector('.dialog-backdrop')?.remove();
});

function initialize() {
  const saved = hostSession && roomInUrl === hostSession.roomId ? { ...hostSession, role: 'host' } : savedSession && roomInUrl === savedSession.roomId && inviteInUrl === savedSession.invite ? savedSession : null;
  if (!saved) { renderHome(); return; }
  Object.assign(state, saved);
  getCamera().then(() => { showCurrentScreen('lobby'); startPolling(); }).catch(error => { toast(error.message); renderHome(); });
}

initialize();
