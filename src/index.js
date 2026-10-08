import { DurableObject } from 'cloudflare:workers';

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const IDLE_TTL_MS = 90 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const SIGNAL_KINDS = new Set(['offer', 'answer', 'ice', 'ready', 'unready', 'settings', 'capture-at', 'capture-cancel']);

function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hashToken(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large.'), { status: 413 });
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error('Request too large.'), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('Invalid request.'), { status: 400 }); }
}

function resultResponse(result) {
  if (result?.error) return json({ error: result.error }, result.status || 400);
  return json(result);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true });

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      try {
        const input = await readJson(request);
        const roomId = randomToken(18);
        const invite = randomToken(24);
        const participantId = randomToken(18);
        const expiresAt = Date.now() + ROOM_TTL_MS;
        const room = env.BOOTH_ROOMS.getByName(roomId);
        const result = await room.createRoom({
          inviteHash: await hashToken(invite),
          hostId: participantId,
          name: cleanName(input.name, 'Host'),
          expiresAt,
        });
        return resultResponse({ ...result, roomId, invite, participantId, role: 'host', expiresAt });
      } catch (error) { return json({ error: error.status === 413 ? error.message : 'Could not create the booth.' }, error.status || 500); }
    }

    const match = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(request|admit|reject|events|signal|ice-servers|close|leave|remove)$/);
    if (!match) return json({ error: 'Not found.' }, 404);
    const [, roomId, action] = match;
    const room = env.BOOTH_ROOMS.getByName(roomId);

    try {
      if (action === 'request' && request.method === 'POST') {
        const input = await readJson(request);
        if (typeof input.invite !== 'string' || input.invite.length > 128) return json({ error: 'That invite link is not valid.' }, 403);
        return resultResponse(await room.requestJoin({ inviteHash: await hashToken(input.invite), name: cleanName(input.name, 'Guest') }));
      }

      const participantId = request.headers.get('x-participant-id') || '';
      if (action === 'events' && request.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) return json({ error: 'Invalid event cursor.' }, 400);
        return resultResponse(await room.getEvents({ participantId, after }));
      }

      if (action === 'ice-servers' && request.method === 'GET') {
        const access = await room.authorizeParticipant({ participantId });
        if (access?.error) return resultResponse(access);
        if (!env.CF_TURN_KEY_ID || !env.CF_TURN_API_TOKEN) {
          return json({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turnAvailable: false });
        }
        const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: 6 * 60 * 60 }),
        });
        if (!response.ok) {
          console.error('Cloudflare TURN credential request failed.', response.status);
          return json({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], turnAvailable: false });
        }
        const result = await response.json();
        const iceServers = (result.iceServers || []).map(server => ({
          ...server,
          urls: Array.isArray(server.urls) ? server.urls.filter(urlValue => !/:53(?:\?|$)/.test(urlValue)) : server.urls,
        }));
        return json({ iceServers, turnAvailable: iceServers.some(server => String(server.urls).includes('turn:')) });
      }

      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      const input = await readJson(request);
      switch (action) {
        case 'admit': return resultResponse(await room.admit({ participantId, guestId: input.participantId }));
        case 'reject': return resultResponse(await room.reject({ participantId, guestId: input.participantId }));
        case 'remove': return resultResponse(await room.removeGuest({ participantId, guestId: input.participantId }));
        case 'leave': return resultResponse(await room.leave({ participantId }));
        case 'close': return resultResponse(await room.close({ participantId }));
        case 'signal':
          if (!SIGNAL_KINDS.has(input.kind) || typeof input.targetId !== 'string') return json({ error: 'Signaling action is not allowed.' }, 403);
          return resultResponse(await room.sendSignal({ participantId, targetId: input.targetId, kind: input.kind, payload: input.payload }));
        default: return json({ error: 'Not found.' }, 404);
      }
    } catch (error) {
      return json({ error: error.status === 413 ? error.message : 'Something went wrong. Please try again.' }, error.status || 500);
    }
  },
};

function cleanName(value, fallback) {
  return String(value || fallback).trim().slice(0, 32) || fallback;
}

export class BoothRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS booth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        invite_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        joined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        recipient TEXT
      );
      CREATE INDEX IF NOT EXISTS events_recipient_id ON events(recipient, id);
    `);
  }

  roomRow() { return this.sql.exec('SELECT * FROM booth WHERE id = 1').toArray()[0] || null; }
  person(id) { return this.sql.exec('SELECT * FROM participants WHERE id = ?', id).toArray()[0] || null; }

  append(event, data = {}, recipient = null) {
    this.sql.exec('INSERT INTO events (event, data, recipient) VALUES (?, ?, ?) RETURNING id', event, JSON.stringify(data), recipient).one();
    this.sql.exec('DELETE FROM events WHERE id <= (SELECT COALESCE(MAX(id), 0) - 300 FROM events)');
  }

  async expireIfNeeded(row = this.roomRow()) {
    if (!row) return { error: 'This booth has expired or does not exist.', status: 404 };
    const now = Date.now();
    if (row.expires_at <= now || (row.status !== 'closed' && row.last_activity + IDLE_TTL_MS <= now)) {
      this.sql.exec('DELETE FROM events; DELETE FROM participants; DELETE FROM booth;');
      await this.ctx.storage.deleteAlarm();
      return { error: 'This booth has expired or does not exist.', status: 404 };
    }
    return null;
  }

  async touch() {
    const now = Date.now();
    this.sql.exec('UPDATE booth SET last_activity = ? WHERE id = 1', now);
    const row = this.roomRow();
    await this.ctx.storage.setAlarm(Math.min(row.expires_at, row.status === 'closed' ? row.expires_at : now + IDLE_TTL_MS));
  }

  async createRoom({ inviteHash, hostId, name, expiresAt }) {
    if (this.roomRow()) return { error: 'Could not create the booth.', status: 409 };
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO booth (id, invite_hash, status, expires_at, last_activity) VALUES (1, ?, ?, ?, ?)', inviteHash, 'waiting', expiresAt, now);
      this.sql.exec('INSERT INTO participants (id, role, name, status, joined_at) VALUES (?, ?, ?, ?, ?)', hostId, 'host', name, 'admitted', now);
    });
    await this.ctx.storage.setAlarm(expiresAt);
    return { ok: true };
  }

  async requestJoin({ inviteHash, name }) {
    const row = this.roomRow();
    const expired = await this.expireIfNeeded(row);
    if (expired) return expired;
    if (row.invite_hash !== inviteHash) return { error: 'That invite link is not valid.', status: 403 };
    const guest = this.sql.exec("SELECT id FROM participants WHERE role = 'guest' AND status = 'admitted'").toArray()[0];
    const pending = this.sql.exec("SELECT id FROM participants WHERE role = 'guest' AND status = 'pending'").toArray()[0];
    if (row.status === 'closed' || guest) return { error: 'This booth is already full or closed.', status: 409 };
    if (pending) return { error: 'Someone is already waiting for approval.', status: 409 };
    const guestId = randomToken(18);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO participants (id, role, name, status, joined_at) VALUES (?, ?, ?, ?, ?)', guestId, 'guest', name, 'pending', Date.now());
      this.append('join-request', { id: guestId, name }, 'host');
    });
    await this.touch();
    return { participantId: guestId, role: 'guest', status: 'pending' };
  }

  async getEvents({ participantId, after }) {
    const row = this.roomRow();
    const expired = await this.expireIfNeeded(row);
    if (expired) return expired;
    const me = this.person(participantId);
    if (!me || !['admitted', 'pending', 'denied'].includes(me.status)) return { error: 'You are not admitted to this booth.', status: 403 };
    const host = this.sql.exec("SELECT name FROM participants WHERE role = 'host' LIMIT 1").toArray()[0];
    const guest = this.sql.exec("SELECT id, name, status FROM participants WHERE role = 'guest' AND status IN ('admitted', 'pending') LIMIT 1").toArray()[0];
    const peers = this.sql.exec("SELECT id, name, role FROM participants WHERE status = 'admitted' AND id != ?", participantId).toArray();
    const events = this.sql.exec(
      'SELECT id, event, data FROM events WHERE id > ? AND (recipient IS NULL OR recipient = ? OR recipient = ?) ORDER BY id LIMIT 300',
      after, me.role, participantId,
    ).toArray().map(item => ({ id: item.id, event: item.event, data: JSON.parse(item.data) }));
    await this.touch();
    return {
      status: row.status,
      expiresAt: row.expires_at,
      host: host?.name ?? 'Host',
      guest: guest ? { name: guest.name, admitted: guest.status === 'admitted' } : null,
      pending: me.role === 'host' && guest?.status === 'pending' ? { id: guest.id, name: guest.name } : null,
      peers,
      events,
    };
  }

  async authorizeParticipant({ participantId }) {
    const expired = await this.expireIfNeeded();
    if (expired) return expired;
    const me = this.person(participantId);
    if (!me || me.status !== 'admitted') return { error: 'You are not admitted to this booth.', status: 403 };
    await this.touch();
    return { ok: true };
  }

  async admit({ participantId, guestId }) {
    const denied = await this.authorizeHost(participantId);
    if (denied) return denied;
    const guest = this.person(guestId);
    if (!guest || guest.role !== 'guest' || guest.status !== 'pending') return { error: 'That request is no longer waiting.', status: 409 };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE participants SET status = 'admitted' WHERE id = ?", guestId);
      this.sql.exec("UPDATE booth SET status = 'active' WHERE id = 1");
      this.append('admitted', { id: guest.id, name: guest.name }, 'host');
      this.append('admitted', { id: guest.id, name: guest.name }, guest.id);
      const host = this.sql.exec("SELECT id, name FROM participants WHERE role = 'host' LIMIT 1").one();
      this.append('peer-ready', { id: host.id, name: host.name }, guest.id);
    });
    await this.touch();
    return { ok: true };
  }

  async reject({ participantId, guestId }) {
    const denied = await this.authorizeHost(participantId);
    if (denied) return denied;
    const guest = this.person(guestId);
    if (guest?.role === 'guest' && guest.status === 'pending') {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE participants SET status = 'denied' WHERE id = ?", guestId);
        this.append('rejected', {}, guestId);
      });
      await this.touch();
    }
    return { ok: true };
  }

  async removeGuest({ participantId, guestId }) {
    const denied = await this.authorizeHost(participantId);
    if (denied) return denied;
    const guest = this.person(guestId);
    if (!guest || guest.role !== 'guest' || guest.status !== 'admitted') return { error: 'That guest is no longer in the booth.', status: 404 };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE participants SET status = 'denied' WHERE id = ?", guestId);
      this.sql.exec("UPDATE booth SET status = 'waiting' WHERE id = 1");
      this.append('removed', {}, guestId);
      this.append('guest-left', { name: guest.name, removed: true }, 'host');
    });
    await this.touch();
    return { ok: true };
  }

  async leave({ participantId }) {
    const expired = await this.expireIfNeeded();
    if (expired) return expired;
    const person = this.person(participantId);
    if (!person || person.role !== 'guest' || !['pending', 'admitted'].includes(person.status)) return { error: 'You are not admitted to this booth.', status: 403 };
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE participants SET status = 'left' WHERE id = ?", participantId);
      this.sql.exec("UPDATE booth SET status = 'waiting' WHERE id = 1 AND status != 'closed'");
      this.append('guest-left', { name: person.name }, 'host');
    });
    await this.touch();
    return { ok: true };
  }

  async close({ participantId }) {
    const denied = await this.authorizeHost(participantId);
    if (denied) return denied;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE booth SET status = 'closed' WHERE id = 1");
      this.sql.exec("UPDATE participants SET status = 'denied' WHERE role = 'guest' AND status = 'pending'");
      this.append('closed');
    });
    await this.touch();
    return { ok: true };
  }

  async sendSignal({ participantId, targetId, kind, payload }) {
    const row = this.roomRow();
    const expired = await this.expireIfNeeded(row);
    if (expired) return expired;
    const sender = this.person(participantId);
    const target = this.person(targetId);
    if (!sender || sender.status !== 'admitted' || !target || target.status !== 'admitted' || !SIGNAL_KINDS.has(kind)) {
      return { error: 'Signaling action is not allowed.', status: 403 };
    }
    let encoded = '{}';
    try {
      encoded = JSON.stringify(payload ?? {});
      if (encoded.length > 60_000) return { error: 'Signaling payload is too large.', status: 413 };
    } catch { return { error: 'Invalid signaling payload.', status: 400 }; }
    this.ctx.storage.transactionSync(() => this.append('signal', { from: participantId, kind, payload: JSON.parse(encoded) }, targetId));
    await this.touch();
    return { ok: true };
  }

  async authorizeHost(participantId) {
    const row = this.roomRow();
    const expired = await this.expireIfNeeded(row);
    if (expired) return expired;
    const me = this.person(participantId);
    if (!me || me.role !== 'host' || me.status !== 'admitted') return { error: 'You are not admitted to this booth.', status: 403 };
    return null;
  }

  async alarm() {
    const row = this.roomRow();
    if (!row) return;
    const now = Date.now();
    if (row.expires_at <= now || (row.status !== 'closed' && row.last_activity + IDLE_TTL_MS <= now)) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM events; DELETE FROM participants; DELETE FROM booth;');
      });
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(row.expires_at, row.status === 'closed' ? row.expires_at : row.last_activity + IDLE_TTL_MS));
  }
}
