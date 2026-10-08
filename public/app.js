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
  ownPhoto: null, otherPhoto: null, photoParts: null, strip: null,
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
  app.innerHTML = `<div class="site-shell">${siteHeader()}<main class="page ${mode}">${content}</main></div>`;
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
      <figure class="gallery-photo gallery-photo-main"><img src="https://images.unsplash.com/photo-1758525224341-ba76f560f5cb?auto=format&amp;fit=crop&amp;crop=faces&amp;w=1000&amp;h=1200&amp;q=85" width="900" height="1180" alt="Two friends smiling together as they take a selfie" fetchpriority="high"></figure>
      <figure class="gallery-photo gallery-photo-top"><img src="https://images.unsplash.com/photo-1742402372285-da4752ec3533?auto=format&amp;fit=crop&amp;crop=faces&amp;w=650&amp;h=760&amp;q=85" width="650" height="760" alt="" loading="lazy"></figure>
      <figure class="gallery-photo gallery-photo-bottom"><img src="https://images.unsplash.com/photo-1734434570358-21badf4ba1c6?auto=format&amp;fit=crop&amp;crop=faces&amp;w=650&amp;h=760&amp;q=85" width="650" height="760" alt="" loading="lazy"></figure>
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

function cameraView({ id, label, placeholder = 'Camera preview', remote = false, className = '', controls = false }) {
  const settings = controls ? `data-filter-style="${state.filter}" data-mirrored="${state.mirror}"` : '';
  return `<div class="camera-view ${className}" ${settings}><video id="${id}" autoplay playsinline ${remote ? '' : 'muted'}></video><div class="camera-placeholder" id="${id}-placeholder"><span class="camera-glyph" aria-hidden="true">◉</span><p>${escapeHtml(placeholder)}</p></div><span class="camera-label">${escapeHtml(label)}</span></div>`;
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
    <div class="booth-stage">${cameraView({ id: 'local-video', label: `You · ${state.name}`, placeholder: 'Your preview', className: 'self-view', controls: true })}${cameraView({ id: 'remote-video', label: state.peerName, placeholder: 'Connecting to your person…', remote: true, className: 'remote-view', controls: true })}<div class="stage-hint" id="stage-hint">You’re side by side. Choose a filter below.</div></div>
    ${state.role === 'host' ? `<section class="people-panel"><div class="people-panel-copy"><span class="section-label">PEOPLE IN THIS BOOTH</span><p><strong>${escapeHtml(state.name || 'You')}</strong><span aria-hidden="true"> · </span>${escapeHtml(state.peerName)}</p></div><button class="button button-quiet" data-action="remove-guest">Remove guest</button></section><section class="booth-queue" id="waiting-list-area"></section>` : ''}
    <div class="booth-tools"><section class="tool-group"><span class="section-label">FILTER</span><div class="choice-row"><button class="choice ${state.filter === 'warm' ? 'is-selected' : ''}" data-filter="warm">Soft warm</button><button class="choice ${state.filter === 'mono' ? 'is-selected' : ''}" data-filter="mono">Black &amp; white</button><button class="choice ${state.filter === 'original' ? 'is-selected' : ''}" data-filter="original">Natural</button></div></section>
      <section class="tool-group"><span class="section-label">MIRROR</span><div class="choice-row"><button class="choice ${!state.mirror ? 'is-selected' : ''}" data-mirror="false">Natural</button><button class="choice ${state.mirror ? 'is-selected' : ''}" data-mirror="true">Mirrored</button></div></section>
      <section class="capture-tools"><p id="ready-message">${readyMessage()}</p><span class="countdown" id="countdown" aria-live="polite"></span><div class="capture-actions"><button class="button button-primary ready-button" data-action="ready" ${state.channel?.readyState !== 'open' ? 'disabled' : ''}>${state.localReady ? 'You’re ready ✓' : 'I’m ready'}</button><button class="button button-quiet" data-action="leave">Leave booth</button></div></section>
    </div><p class="privacy-line">Your photos travel directly between browsers. They are never uploaded or stored by Momentstamp.</p></section>`, 'product-page');
  attachVideo('local-video', state.stream);
  attachVideo('remote-video', state.remoteStream);
  updateConnectionState();
}

function readyMessage() {
  if (state.localReady && state.remoteReady) return 'You’re both ready. The host will start the countdown.';
  if (state.remoteReady) return 'Your person is ready. Your turn!';
  if (state.localReady) return 'You’re ready. Waiting for your person.';
  return 'Choose your look, then get into position.';
}

function renderResult() {
  state.screen = 'result';
  renderShell(`<section class="result-page"><span class="eyebrow">A little thing to keep</span><h1>Look at you two.</h1><p>Your shared photo strip is ready. Download it while you’re here.</p><img class="photo-strip" id="photo-strip" alt="Your shared photo strip"><div class="result-actions"><button class="button button-primary" data-action="download">Download strip</button><button class="button button-quiet" data-action="retake">Take another</button></div><button class="text-action finish-action" data-action="finish">Finish and clear this session</button><p class="privacy-line">The strip lives on your device. Momentstamp does not save it.</p></section>`, 'product-page');
  const image = document.querySelector('#photo-strip');
  if (image) image.src = state.strip;
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
  video.srcObject = stream;
  document.querySelector(`#${id}-placeholder`)?.classList.add('is-hidden');
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
  if (button) button.disabled = !channelOpen;
  const message = document.querySelector('#ready-message');
  if (message) message.textContent = readyMessage();
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
    for (const track of event.streams[0].getTracks()) state.remoteStream.addTrack(track);
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
  channel.onopen = () => { updateConnectionState(); if (state.screen === 'booth') renderBooth(); };
  channel.onclose = () => updateConnectionState('Disconnected');
  channel.onerror = () => toast('Photo connection interrupted. Try again.');
  channel.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'photo-start') state.photoParts = { total: message.total, chunks: new Array(message.total), count: 0 };
      if (message.type === 'photo-chunk' && state.photoParts && message.total === state.photoParts.total) {
        if (state.photoParts.chunks[message.index] === undefined) { state.photoParts.chunks[message.index] = message.data; state.photoParts.count += 1; }
        if (state.photoParts.count === state.photoParts.total) { state.otherPhoto = state.photoParts.chunks.join(''); state.photoParts = null; tryCompose(); }
      }
      if (message.type === 'retake') { state.ownPhoto = state.otherPhoto = state.strip = null; state.localReady = state.remoteReady = false; if (state.screen === 'result') showCurrentScreen('booth'); updateConnectionState(); }
    } catch { toast('Could not read that photo. Try taking the moment again.'); }
  };
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
  } else if (signal.kind === 'ready') { state.remoteReady = true; updateReady(); }
  else if (signal.kind === 'unready') { state.remoteReady = false; updateReady(); }
  else if (signal.kind === 'settings') { Object.assign(state, signal.payload); if (state.screen === 'booth') renderBooth(); }
  else if (signal.kind === 'capture-at') scheduleCapture(signal.payload.at);
  else if (signal.kind === 'capture-cancel') { clearTimeout(state.captureTimer); state.localReady = false; updateReady(); }
}

function updateReady() {
  const button = document.querySelector('[data-action="ready"]');
  if (button) { button.textContent = state.localReady ? 'You’re ready ✓' : 'I’m ready'; button.disabled = state.channel?.readyState !== 'open'; }
  updateConnectionState();
}

function changeAppearance(key, rawValue) {
  const value = key === 'mirror' ? rawValue === 'true' : rawValue;
  state[key] = value; state.localReady = false; state.remoteReady = false;
  const selector = key === 'filter' ? '[data-filter]' : '[data-mirror]';
  document.querySelectorAll(selector).forEach(button => {
    const selected = button.dataset[key] === String(rawValue);
    button.classList.toggle('is-selected', selected);
  });
  document.querySelectorAll('.camera-view[data-filter-style]').forEach(camera => {
    camera.dataset.filterStyle = state.filter;
    camera.dataset.mirrored = String(state.mirror);
  });
  sendSignal('settings', { filter: state.filter, mirror: state.mirror }); sendSignal('unready', {}); updateReady();
}

async function toggleReady() {
  state.localReady = !state.localReady;
  await sendSignal(state.localReady ? 'ready' : 'unready', {}); updateReady();
  if (state.localReady && state.remoteReady && state.role === 'host') {
    const captureAt = Date.now() + 3200;
    await sendSignal('capture-at', { at: captureAt }); scheduleCapture(captureAt);
  }
}

function scheduleCapture(at) {
  clearTimeout(state.captureTimer); state.localReady = state.remoteReady = false; updateReady();
  const label = document.querySelector('#countdown');
  const tick = () => {
    const remaining = at - Date.now();
    if (remaining <= 0) { if (label) label.textContent = 'Smile'; capturePhoto(); return; }
    if (label) label.textContent = String(Math.ceil(remaining / 1000));
    state.captureTimer = setTimeout(tick, Math.min(180, remaining));
  };
  tick();
}

function capturePhoto() {
  const video = document.querySelector('#local-video');
  if (!video || video.readyState < 2 || !video.videoWidth) { toast('Your camera is not ready. Try again.'); return; }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 900;
  const context = canvas.getContext('2d');
  context.filter = state.filter === 'mono' ? 'grayscale(1)' : state.filter === 'warm' ? 'sepia(.17) saturate(1.12)' : 'none';
  const side = Math.min(video.videoWidth, video.videoHeight);
  if (state.mirror) { context.translate(canvas.width, 0); context.scale(-1, 1); }
  context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, 900, 900);
  context.setTransform(1, 0, 0, 1, 0, 0);
  state.ownPhoto = canvas.toDataURL('image/jpeg', .78);
  if (state.channel?.readyState === 'open') {
    const size = 20_000, count = Math.ceil(state.ownPhoto.length / size);
    state.channel.send(JSON.stringify({ type: 'photo-start', total: count }));
    for (let index = 0; index < count; index++) state.channel.send(JSON.stringify({ type: 'photo-chunk', index, total: count, data: state.ownPhoto.slice(index * size, (index + 1) * size) }));
  }
  const label = document.querySelector('#countdown'); if (label) label.textContent = 'Sent';
  tryCompose();
}

function tryCompose() {
  if (!state.ownPhoto || !state.otherPhoto) return;
  const local = new Image(), remote = new Image(); let ready = 0;
  const onload = () => { if (++ready === 2) composeStrip(local, remote); };
  local.onload = remote.onload = onload; local.src = state.ownPhoto; remote.src = state.otherPhoto;
}

function composeStrip(local, remote) {
  const canvas = document.createElement('canvas'); canvas.width = 850; canvas.height = 1830;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fbfcfc'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center'; ctx.fillStyle = '#28383c'; ctx.font = '500 25px monospace'; ctx.fillText('A MOMENT, MADE TOGETHER', 425, 62);
  const photos = [{ image: state.role === 'host' ? local : remote, y: 92 }, { image: state.role === 'host' ? remote : local, y: 842 }];
  photos.forEach(({ image, y }) => {
    const size = Math.min(image.width, image.height);
    ctx.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 62, y, 726, 726);
  });
  ctx.fillStyle = '#27373a'; ctx.font = 'italic 37px Georgia'; ctx.fillText('even from here', 425, 1665);
  ctx.fillStyle = '#637174'; ctx.font = '15px monospace'; ctx.fillText('TWO PLACES, ONE LITTLE MOMENT', 425, 1712);
  state.strip = canvas.toDataURL('image/jpeg', .91); showCurrentScreen('result');
}

function resetPeerConnection() {
  clearTimeout(state.captureTimer);
  state.peer?.close();
  state.peer = state.channel = state.remoteStream = null;
  state.peerId = null; state.peerName = 'Your person'; state.offerStarted = false; state.candidates = [];
  state.turnAvailable = false; state.iceFailureNotified = false;
  state.ownPhoto = state.otherPhoto = state.strip = state.photoParts = null;
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
  clearTimeout(state.pollTimer); clearTimeout(state.captureTimer); state.peer?.close();
  state.stream?.getTracks().forEach(track => track.stop());
  state.peer = state.channel = state.stream = state.remoteStream = null;
  state.ownPhoto = state.otherPhoto = state.strip = state.photoParts = null;
  state.roomId = state.invite = state.participantId = state.role = state.peerId = null;
  state.turnAvailable = false; state.iceFailureNotified = false;
  if (clearStored) { sessionStorage.removeItem('momentstamp-host'); sessionStorage.removeItem('momentstamp-session'); }
}

app.addEventListener('click', async event => {
  if (event.target.classList.contains('dialog-backdrop')) { document.querySelector('.dialog-backdrop')?.remove(); return; }
  const target = event.target.closest('[data-action], [data-filter], [data-mirror]');
  if (!target) return;
  if (target.dataset.filter) return changeAppearance('filter', target.dataset.filter);
  if (target.dataset.mirror !== undefined) return changeAppearance('mirror', target.dataset.mirror);
  const action = target.dataset.action;
  try {
    if (action === 'show-create') openCreateDialog();
    else if (action === 'dismiss-dialog') document.querySelector('.dialog-backdrop')?.remove();
    else if (action === 'show-join') { document.querySelector('#invite-form')?.classList.toggle('is-hidden'); document.querySelector('#invite-url')?.focus(); }
    else if (action === 'copy-invite') { await navigator.clipboard.writeText(`${location.origin}/?room=${state.roomId}&invite=${state.invite}`); toast('Invite copied. Send it to your person.'); }
    else if (action === 'admit') await hostDecision('admit', target.dataset.participantId);
    else if (action === 'reject') await hostDecision('reject', target.dataset.participantId);
    else if (action === 'remove-guest') await removeGuest();
    else if (action === 'ready') await toggleReady();
    else if (action === 'leave') await closeBooth();
    else if (action === 'download') { const link = document.createElement('a'); link.href = state.strip; link.download = `momentstamp-${new Date().toISOString().slice(0, 10)}.jpg`; link.click(); }
    else if (action === 'retake') { state.ownPhoto = state.otherPhoto = state.strip = null; state.localReady = state.remoteReady = false; if (state.channel?.readyState === 'open') state.channel.send(JSON.stringify({ type: 'retake' })); showCurrentScreen('booth'); }
    else if (action === 'finish') await closeBooth();
  } catch (error) { toast(error.message || 'Please try that again.'); }
});

app.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'create-form') await createBooth(event.target);
  else if (event.target.id === 'guest-form') await requestToJoin(event.target);
  else if (event.target.id === 'invite-form') navigateToInvite(event.target.elements['invite-url'].value);
});

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
