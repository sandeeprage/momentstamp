import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const rooms = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');

function emit(room, event, data = {}, to = null) {
  room.seq += 1;
  room.events.push({ id: room.seq, event, data, to });
  if (room.events.length > 300) room.events.splice(0, room.events.length - 300);
}

function participant(room, id) { return room.people.find(person => person.id === id); }
function snapshot(room, me) {
  return { status: room.status, expiresAt: room.expiresAt, host: room.people[0]?.name ?? 'Host', guest: room.people[1] ? { name: room.people[1].name, admitted: room.people[1].admitted } : null,
    pending: me.role === 'host' && room.pending ? { id: room.pending.id, name: room.pending.name } : null,
    peers: room.people.filter(p => p.id !== me.id && p.admitted).map(p => ({ id: p.id, name: p.name, role: p.role })) };
}

async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 64_000) throw new Error('Request too large'); }
  return body ? JSON.parse(body) : {};
}
function send(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const input = await bodyJson(req);
      const name = String(input.name || 'Host').trim().slice(0, 32) || 'Host';
      const roomId = token(18), invite = token(24), hostId = token(18);
      const room = { id: roomId, inviteHash: hash(invite), status: 'waiting', expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        people: [{ id: hostId, role: 'host', name, admitted: true, seenAt: Date.now() }], pending: null, denied: new Set(), seq: 0, events: [] };
      rooms.set(roomId, room);
      return send(res, 201, { roomId, invite, participantId: hostId, role: 'host', expiresAt: room.expiresAt });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(request|admit|reject|events|signal|close|leave)$/);
    if (match) {
      const [, roomId, action] = match, room = rooms.get(roomId);
      if (!room || room.expiresAt < Date.now()) { rooms.delete(roomId); return send(res, 404, { error: 'This booth has expired or does not exist.' }); }
      const input = ['GET'].includes(req.method) ? {} : await bodyJson(req);
      if (action === 'request' && req.method === 'POST') {
        if (!input.invite || hash(input.invite) !== room.inviteHash) return send(res, 403, { error: 'That invite link is not valid.' });
        if (room.status === 'closed' || room.people.length > 1 && room.people[1].admitted) return send(res, 409, { error: 'This booth is already full or closed.' });
        if (room.pending) return send(res, 409, { error: 'Someone is already waiting for approval.' });
        const guest = { id: token(18), role: 'guest', name: String(input.name || 'Guest').trim().slice(0, 32) || 'Guest', admitted: false, seenAt: Date.now() };
        room.pending = guest; emit(room, 'join-request', { id: guest.id, name: guest.name }, 'host');
        return send(res, 200, { participantId: guest.id, role: 'guest', status: 'pending', roomId });
      }
      const who = req.headers['x-participant-id'];
      const me = participant(room, who) || (room.pending?.id === who ? room.pending : room.denied.has(who) ? { id: who, role: 'guest', admitted: false } : null);
      if (!me || (!me.admitted && !['events', 'leave'].includes(action))) return send(res, 403, { error: 'You are not admitted to this booth.' });
      me.seenAt = Date.now();
      if (action === 'events' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0);
        return send(res, 200, { ...snapshot(room, me), events: room.events.filter(e => e.id > after && (!e.to || e.to === me.role)).map(({ to, ...e }) => e) });
      }
      if (action === 'admit' && req.method === 'POST' && me.role === 'host') {
        if (!room.pending || room.pending.id !== input.participantId) return send(res, 409, { error: 'That request is no longer waiting.' });
        room.pending.admitted = true; room.people.push(room.pending); const guest = room.pending; room.pending = null; room.status = 'active';
        emit(room, 'admitted', { id: guest.id, name: guest.name });
        emit(room, 'peer-ready', { id: me.id, name: me.name }, 'guest');
        return send(res, 200, { ok: true });
      }
      if (action === 'reject' && req.method === 'POST' && me.role === 'host') {
        if (room.pending?.id === input.participantId) { emit(room, 'rejected', {}, 'guest'); room.denied.add(input.participantId); room.pending = null; }
        return send(res, 200, { ok: true });
      }
      if (action === 'leave' && req.method === 'POST' && me.role === 'guest') {
        if (room.pending?.id === me.id) room.pending = null;
        room.people = room.people.filter(p => p.id !== me.id);
        room.denied.add(me.id); room.status = room.status === 'closed' ? 'closed' : 'waiting';
        emit(room, 'guest-left', { name: me.name || 'Guest' }, 'host');
        return send(res, 200, { ok: true });
      }
      if (action === 'signal' && req.method === 'POST') {
        const target = participant(room, input.targetId);
        if (!target?.admitted || !me.admitted || !['offer', 'answer', 'ice', 'ready', 'unready', 'settings', 'capture-at', 'capture-cancel'].includes(input.kind)) return send(res, 403, { error: 'Signaling action is not allowed.' });
        emit(room, 'signal', { from: me.id, kind: input.kind, payload: input.payload }, target.role);
        return send(res, 202, { ok: true });
      }
      if (action === 'close' && req.method === 'POST' && me.role === 'host') {
        room.status = 'closed'; room.pending = null; emit(room, 'closed'); return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'Method not allowed.' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, { error: 'Not found.' });
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = normalize(pathname).replace(/^([/\\]*\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const file = join(publicRoot, safePath);
    if (!file.startsWith(publicRoot)) return send(res, 404, { error: 'Not found.' });
    await stat(file);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache, no-store, must-revalidate', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error instanceof SyntaxError) return send(res, 400, { error: 'Invalid request.' });
    if (error.code === 'ENOENT') return send(res, 404, { error: 'Not found.' });
    console.error('Request failed:', error.message);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) if (room.expiresAt < now || (room.status !== 'closed' && now - Math.max(...room.people.map(p => p.seenAt), 0) > 90 * 60 * 1000)) rooms.delete(id);
}, 60_000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Momentstamp is running on http://localhost:${port}`));
