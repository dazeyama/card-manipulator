// Room links and the room server's HTTP routes (ONLINE.md 4.2, 4.4, 9.3).
// A room is addressed by a fragment, `#/room/7KQ2MX`, which never reaches any
// server; an invite link adds the password, `#/room/7KQ2MX?key=...` (O12).
// `#/admin` is the owner's admin page (12.8). The parsing and link building
// are pure and tested; the fetches talk to VITE_ROOM_SERVER.

import { PROTOCOL, type CreateRoomBody, type CreateRoomReply, type RoomInfo, type VersionReply } from '../../shared/protocol';

/** The alphabet of room codes (4.2, O11): no 0, O, 1, I or L. */
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export interface RoomRoute {
  kind: 'room';
  code: string;
  /** The password, from an invite link. */
  key?: string;
}

export type Route = RoomRoute | { kind: 'admin' } | null;

/** True for a well-formed room code. */
export function isRoomCode(s: string): boolean {
  return CODE.test(s);
}

/** What a location hash asks for: a room (with its key), the admin page, or nothing. */
export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h === '/admin' || h.startsWith('/admin?')) return { kind: 'admin' };
  const m = /^\/room\/([^/?#]+)(?:\?(.*))?$/.exec(h);
  if (!m) return null;
  const code = decodeURIComponent(m[1]).toUpperCase();
  if (!isRoomCode(code)) return null;
  const key = m[2] ? new URLSearchParams(m[2]).get('key') : null;
  return key ? { kind: 'room', code, key } : { kind: 'room', code };
}

/**
 * A room code from whatever someone pasted: a code, with or without spaces,
 * or a whole room link. Null if there is none in it.
 */
export function codeFromText(text: string): RoomRoute | null {
  const t = text.trim();
  const at = t.indexOf('#');
  if (at >= 0) {
    const r = parseHash(t.slice(at));
    return r?.kind === 'room' ? r : null;
  }
  const code = t.replace(/[\s-]/g, '').toUpperCase();
  return isRoomCode(code) ? { kind: 'room', code } : null;
}

/** The page's own address without its query (the dev-only ?player=) or fragment. */
export function pageBase(loc: { origin: string; pathname: string } = location): string {
  return `${loc.origin}${loc.pathname}`;
}

/** The link to share (Copy link). */
export function roomLink(code: string, base = pageBase()): string {
  return `${base}#/room/${code}`;
}

/** The link that carries the password and opens straight in (Copy invite link, O12). */
export function inviteLink(code: string, key: string, base = pageBase()): string {
  return `${roomLink(code, base)}?key=${encodeURIComponent(key)}`;
}

/** The hash for a room, to put in the address bar while in it. */
export function roomHash(code: string): string {
  return `#/room/${code}`;
}

/** Set the address bar's fragment without a hashchange (going online, leaving). */
export function setHash(hash: string): void {
  history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
}

// ---- the room server ----

/** The room server's base URL, from VITE_ROOM_SERVER, or null when there is none. */
export function roomServer(): string | null {
  const raw = (import.meta.env.VITE_ROOM_SERVER as string | undefined)?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

/** The WebSocket URL of a room: http becomes ws, https wss. */
export function socketUrl(code: string, server = roomServer()): string | null {
  if (!server) return null;
  return `${server.replace(/^http/, 'ws')}/api/rooms/${code}/ws`;
}

/** What a call to the room server came back with when it did not work. */
export type ServerTrouble = 'offline' | 'quota' | 'rate' | 'version' | 'error';

/**
 * A refusal: the room server answers 429 with `{ error: 'rate' }` for its own
 * limits and `{ error: 'quota' }` when the free plan's day is spent (O101);
 * Cloudflare's own 1027 page for the spent day is not JSON at all (Section 15).
 */
async function troubleOf(res: Response): Promise<ServerTrouble> {
  if (res.status !== 429) return 'error';
  try {
    const body = (await res.json()) as { error?: string };
    return body.error === 'rate' ? 'rate' : 'quota';
  } catch {
    return 'quota';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T | ServerTrouble> {
  const server = roomServer();
  if (!server) return 'offline';
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, init);
  } catch {
    return 'offline';
  }
  if (!res.ok) return await troubleOf(res);
  try {
    return (await res.json()) as T;
  } catch {
    return 'error';
  }
}

/** Is the room server there, and does it speak our protocol (O48)? */
export async function checkServer(): Promise<'ok' | ServerTrouble> {
  const r = await call<VersionReply>('/api/version');
  if (typeof r === 'string') return r;
  return r.protocol === PROTOCOL ? 'ok' : 'version';
}

/** Make a room (POST /api/rooms): its code, or what went wrong. */
export async function createRoom(body: CreateRoomBody): Promise<CreateRoomReply | ServerTrouble> {
  return call<CreateRoomReply>('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** A room's join details (GET /api/rooms/:code); null when there is no such room open. */
export async function roomInfo(code: string): Promise<RoomInfo | null | ServerTrouble> {
  const server = roomServer();
  if (!server) return 'offline';
  let res: Response;
  try {
    res = await fetch(`${server}/api/rooms/${code}`);
  } catch {
    return 'offline';
  }
  if (res.status === 404) return null;
  if (!res.ok) return await troubleOf(res);
  try {
    const info = (await res.json()) as RoomInfo;
    return info.open === false ? null : info;
  } catch {
    return 'error';
  }
}

// ---- the clipboard ----

/** Copy text, falling back to a hidden text area where the clipboard API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
