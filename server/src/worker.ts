// The room server's Worker (ONLINE.md 10.1): HTTP routes under /api, the
// WebSocket upgrade forwarded to the room's Durable Object, CORS for the
// site and localhost. No static files: GitHub Pages serves the site.
//
// Routes (9.3): GET /api/version; POST /api/rooms; GET /api/rooms/:code;
// GET /api/rooms/:code/ws (the socket). The public list, reports and the
// admin routes come in Phase O3.

import { PROTOCOL, playerIdOf, type CreateRoomBody, type CreateRoomReply, type VersionReply } from '../../shared/protocol';
import { isCode, newCode } from '../../shared/roomCode';
import type { Lobby } from './lobby';
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req, env);

    if (req.method === 'GET' && path === '/api/version') {
      const body: VersionReply = { protocol: PROTOCOL };
      return withCors(json(body), req, env);
    }
    if (req.method === 'POST' && path === '/api/rooms') return withCors(await createRoom(req, env), req, env);

    const room = /^\/api\/rooms\/([^/]+)(\/ws)?$/.exec(path);
    if (room && req.method === 'GET') {
      const code = room[1];
      if (!isCode(code)) return withCors(json({ error: 'not a room code' }, 404), req, env);
      const stub = env.ROOM.getByName(code);
      if (room[2]) {
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return withCors(json({ error: 'expected a WebSocket' }, 426), req, env);
        return stub.fetch(req);
      }
      return withCors(json(await stub.info()), req, env);
    }
    return withCors(json({ error: 'not found' }, 404), req, env);
  },
} satisfies ExportedHandler<Env>;
