// Who this browser is in a room (ONLINE.md 5.1, O17): a random token, a
// nickname and a color, kept in localStorage. The token goes only in hello;
// the room knows the player id, a hash of it (shared/protocol.ts playerIdOf).
// Clearing site data makes a new person.
//
// Dev only (O90): `?player=<name>` in the page's query keeps a separate
// identity under `online.identity.v1:<name>`, so two tabs of one browser are
// two players. The production build ignores it.

import { base64url, playerIdOf } from '../../shared/protocol';

export interface Identity {
  /** 16 random bytes, base64url. */
  token: string;
  /** Empty until the join prompt or Go online asks. */
  nickname: string;
  /** One of PLAYER_COLOURS, or empty until chosen. */
  colour: string;
}

const BASE_KEY = 'online.identity.v1';

/** The localStorage key for this tab's identity. */
export function identityKey(): string {
  if (import.meta.env.DEV) {
    const name = new URLSearchParams(location.search).get('player');
    if (name) return `${BASE_KEY}:${name}`;
  }
  return BASE_KEY;
}

function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** Without storage (a locked-down browser) the identity lasts as long as the page. */
let memory: Identity | null = null;

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(identityKey());
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Identity>;
    if (typeof v.token !== 'string' || v.token.length < 16) return null;
    return { token: v.token, nickname: typeof v.nickname === 'string' ? v.nickname : '', colour: typeof v.colour === 'string' ? v.colour : '' };
  } catch {
    return memory;
  }
}

function write(id: Identity): void {
  memory = id;
  try {
    localStorage.setItem(identityKey(), JSON.stringify(id));
  } catch {
    // Kept for this page only.
  }
}

/** This browser's identity, made on first use. */
export function getIdentity(): Identity {
  const have = read() ?? memory;
  if (have) return have;
  const id: Identity = { token: newToken(), nickname: '', colour: '' };
  write(id);
  return id;
}

export function setNickname(nickname: string): void {
  write({ ...getIdentity(), nickname });
}

export function setColour(colour: string): void {
  write({ ...getIdentity(), colour });
}

/** The player id a room knows this browser by. */
export function myPlayerId(): Promise<string> {
  return playerIdOf(getIdentity().token);
}
