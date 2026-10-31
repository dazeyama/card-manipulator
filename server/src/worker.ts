// The room server's Worker (ONLINE.md 10.1): HTTP routes under /api, the
// WebSocket upgrade forwarded to the room's Durable Object, CORS for the
// site and localhost. No static files: GitHub Pages serves the site.
//
// Routes (9.3): GET /api/version; GET and POST /api/rooms (the public list,
// a new room); GET /api/rooms/:code; GET /api/rooms/:code/ws (the socket);
// POST /api/rooms/:code/report; and, with the x-admin-key header,
// GET /api/admin/rooms and POST /api/admin/rooms/:code/delist, /relist, /close.
// When the free plan's daily limit is spent, every route answers 429
// { error: 'quota' } and a socket gets `bye quota` (15).

import { PROTOCOL, playerIdOf, type ByeReason, type CreateRoomBody, type CreateRoomReply, type VersionReply } from '../../shared/protocol';
import { isCode, newCode } from '../../shared/roomCode';
import type { Lobby } from './lobby';
import { isQuotaError } from './quota';
import type { Room } from './room';

export { Room } from './room';
export { Lobby } from './lobby';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** The Pages origin, for CORS. */
  SITE_ORIGIN: string;
  /** The owner's admin key (O15): a secret, server/.dev.vars locally. */
  ADMIN_KEY: string;
  /** "off" turns the creation and join limits off: server/.dev.vars, for local development (O99). */
  RATE_LIMITS?: string;
}

function lobby(env: Env) {
  return env.LOBBY.getByName('lobby');
}

/** The caller's ip as Cloudflare sees it; empty locally. */
function ipOf(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? '';
}

/** The admin key, compared in constant time (10.1). False when no key is set on the Worker. */
async function isAdmin(req: Request, env: Env): Promise<boolean> {
  const given = req.headers.get('x-admin-key');
  if (!given || !env.ADMIN_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_KEY))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** A token from a JSON body, or null. */
async function tokenOf(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { token?: unknown };
    return typeof body.token === 'string' && body.token.length >= 16 && body.token.length <= 128 ? body.token : null;
  } catch {
    return null;
  }
}

/** The admin routes (12.8): every room with its reports; delist, relist, close. */
async function admin(req: Request, env: Env, path: string): Promise<Response> {
  if (!(await isAdmin(req, env))) return json({ error: 'key' }, 401);
  if (req.method === 'GET' && path === '/api/admin/rooms') return json({ rooms: await lobby(env).adminList() });
  const m = /^\/api\/admin\/rooms\/([^/]+)\/(delist|relist|close)$/.exec(path);
  if (!m || req.method !== 'POST' || !isCode(m[1])) return json({ error: 'not found' }, 404);
  const [, code, action] = m;
  if (action === 'delist') await lobby(env).delist(code);
  else if (action === 'relist') await lobby(env).relist(code);
  else return json({ ok: await env.ROOM.getByName(code).adminClose() });
  return json({ ok: true });
}

/** POST /api/rooms/:code/report: three distinct reporters delist a room until the admin looks (O15). */
async function report(req: Request, env: Env, code: string): Promise<Response> {
  const token = await tokenOf(req);
  if (!token) return json({ error: 'bad token' }, 400);
  const result = await lobby(env).report(code, await playerIdOf(token));
  if (result === 'rate') return json({ error: 'rate' }, 429);
  if (result === 'closed') return json({ error: 'closed' }, 404);
  return json({ ok: true });
}

/** The site, and any localhost port for development. */
function allowedOrigin(origin: string | null, env: Env): string | null {
  if (!origin) return null;
  if (origin === env.SITE_ORIGIN) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function withCors(res: Response, req: Request, env: Env): Response {
  const origin = allowedOrigin(req.headers.get('Origin'), env);
  if (!origin || res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  out.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  out.headers.set('Access-Control-Max-Age', '86400');
  out.headers.set('Vary', 'Origin');
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST /api/rooms: a new room with a fresh code; the maker then connects to it (4.1). */
async function createRoom(req: Request, env: Env): Promise<Response> {
  let body: Partial<CreateRoomBody>;
  try {
    body = (await req.json()) as Partial<CreateRoomBody>;
  } catch {
    return json({ error: 'bad body' }, 400);
  }
  if (typeof body.token !== 'string' || body.token.length < 16 || body.token.length > 128) return json({ error: 'bad token' }, 400);
  const tag = body.tag === 'play' ? 'play' : 'cube';
  const maker = await playerIdOf(body.token);
  // 5 an hour per ip and per identity (10.4).
  if (!(await lobby(env).allowCreate(ipOf(req), maker))) return json({ error: 'rate' }, 429);
  // A collision among 887 million codes is rare; try a few.
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const made = await env.ROOM.getByName(code).create({ code, maker, name: typeof body.name === 'string' ? body.name : '', tag });
    if (made) {
      const reply: CreateRoomReply = { code };
      return json(reply, 201);
    }
  }
  return json({ error: 'no free code' }, 503);
}

/**
 * A socket that only says goodbye (12.7): for an upgrade the room cannot
 * take, such as when the free plan's daily limit is spent.
 */
function byeSocket(reason: ByeReason): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ t: 'bye', reason }));
  server.close(4000, reason);
  return new Response(null, { status: 101, webSocket: client });
}

function isUpgrade(req: Request): boolean {
  return req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (err) {
      // The free plan's daily limits (15): Rooms are back after midnight UTC.
      if (isQuotaError(err)) return isUpgrade(req) ? byeSocket('quota') : withCors(json({ error: 'quota' }, 429), req, env);
      console.error('room server error', err);
      return isUpgrade(req) ? new Response(null, { status: 503 }) : withCors(json({ error: 'unavailable' }, 503), req, env);
    }
  },
} satisfies ExportedHandler<Env>;

/** The routes of 9.3. */
async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req, env);

  if (req.method === 'GET' && path === '/api/version') {
    const body: VersionReply = { protocol: PROTOCOL };
    return withCors(json(body), req, env);
  }
  if (req.method === 'POST' && path === '/api/rooms') return withCors(await createRoom(req, env), req, env);
  if (req.method === 'GET' && path === '/api/rooms') return withCors(json({ rooms: await lobby(env).publicList() }), req, env);
  if (path.startsWith('/api/admin/')) return withCors(await admin(req, env, path), req, env);

  const reported = /^\/api\/rooms\/([^/]+)\/report$/.exec(path);
  if (reported && req.method === 'POST') {
    if (!isCode(reported[1])) return withCors(json({ error: 'not a room code' }, 404), req, env);
    return withCors(await report(req, env, reported[1]), req, env);
  }

  const room = /^\/api\/rooms\/([^/]+)(\/ws)?$/.exec(path);
  if (room && req.method === 'GET') {
    const code = room[1];
    if (!isCode(code)) return withCors(json({ error: 'not a room code' }, 404), req, env);
    const stub = env.ROOM.getByName(code);
    if (room[2]) {
      if (!isUpgrade(req)) return withCors(json({ error: 'expected a WebSocket' }, 426), req, env);
      return stub.fetch(req);
    }
    return withCors(json(await stub.info()), req, env);
  }
  return withCors(json({ error: 'not found' }, 404), req, env);
}
