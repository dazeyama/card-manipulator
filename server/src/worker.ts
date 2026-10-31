// The room server's Worker (ONLINE.md 10.1): HTTP routes under /api, the
// WebSocket upgrade forwarded to the room's Durable Object, CORS for the
// site and localhost. No static files: GitHub Pages serves the site.
//
// Seeded by the hub with /api/version only; the Server fork builds the rest
// (Room, Lobby, the routes of 9.3).

import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL, type VersionReply } from '../../shared/protocol';

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
  if (!origin) return res;
  const out = new Response(res.body, res);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  out.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  out.headers.set('Vary', 'Origin');
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), req, env);
    if (req.method === 'GET' && url.pathname === '/api/version') {
      const body: VersionReply = { protocol: PROTOCOL };
      return withCors(json(body), req, env);
    }
    return withCors(json({ error: 'not found' }, 404), req, env);
  },
} satisfies ExportedHandler<Env>;

/** One room (10.2): meta, the mirror of the table, the relay. Built by the Server fork. */
export class Room extends DurableObject<Env> {}

/** The public list (10.3). Built by the Server fork. */
export class Lobby extends DurableObject<Env> {}
