// A room's meta (ONLINE.md 10.2): who is seated, their ranks and colours, who
// is crown and maker, the settings, bans and the chat log. The Room object
// keeps one in memory and in storage; everything here is pure so tests can
// run it without the Workers runtime.

import { RANK_LABEL, RANKS, type Rank } from '../../shared/permissions';
import {
  CHAT_LINES, MAX_PLAYERS, NICKNAME_MAX, PLAYER_COLOURS, ROOM_NAME_MAX, base64url, defaultRoomSettings,
  type ChatLine, type Player, type PublicSettings, type RoomInfo, type RoomSettings, type Tag,
} from '../../shared/protocol';
import { clean } from '../../shared/words';

/** A player's place in the room, kept while they are away until the room closes (O19). */
export interface Seat {
  id: string;
  nickname: string;
  colour: string;
  /** Kept while crown too: what they fall back to when the crown passes back. */
  rank: Rank;
  side: 0 | 1;
  connected: boolean;
  /** Server time of the first join: the election's tie-break (O62). */
  joinedAt: number;
}

export interface Meta {
  code: string;
  createdAt: number;
  /** The player id of the browser that went online (O6). */
  maker: string;
  /** The crown's player id; null before the maker's first hello, or while nobody is connected. */
  crown: string | null;
  settings: Omit<RoomSettings, 'password'>;
  /** sha256(code + ':' + password) as base64url; null for no password (3.2). */
  passwordHash: string | null;
  /** Join order. */
  seats: Seat[];
  /** Banned player ids, for the room's life (O49). */
  bans: string[];
  /** The last CHAT_LINES lines, for joiners. */
  chat: ChatLine[];
}

export function newMeta(code: string, maker: string, name: string, tag: Tag, now: number): Meta {
  const settings: Omit<RoomSettings, 'password'> = defaultRoomSettings(cleanRoomName(name, code), tag);
  return { code, createdAt: now, maker, crown: null, settings, passwordHash: null, seats: [], bans: [], chat: [] };
}

export function seatOf(meta: Meta, id: string): Seat | undefined {
  return meta.seats.find((s) => s.id === id);
}

export function connectedSeats(meta: Meta): Seat[] {
  return meta.seats.filter((s) => s.connected);
}

/** The player list as the protocol sends it. */
export function playersOf(meta: Meta): Player[] {
  return meta.seats.map((s) => ({ ...s, isCrown: s.id === meta.crown, isMaker: s.id === meta.maker }));
}

export function publicSettings(meta: Meta): PublicSettings {
  return { ...meta.settings, password: meta.passwordHash !== null };
}

/** What GET /api/rooms/:code says; `open: false` for a room that has closed (or never was). */
export function roomInfo(meta: Meta | null): RoomInfo {
  if (!meta) return { name: '', players: 0, max: MAX_PLAYERS, password: false, tag: 'cube', open: false, crown: '', taken: [] };
  return {
    name: meta.settings.name,
    players: connectedSeats(meta).length,
    max: MAX_PLAYERS,
    password: meta.passwordHash !== null,
    tag: meta.settings.tag,
    open: true,
    crown: (meta.crown && seatOf(meta, meta.crown)?.nickname) || '',
    taken: meta.seats.map((s) => ({ colour: s.colour, initial: s.nickname.slice(0, 1).toUpperCase() })),
  };
}

/**
 * Who takes the crown when it falls free (4.5, O62): the connected player
 * with the highest rank, the longest present among equals; View too if that is
 * all there is. Null when nobody is connected.
 */
export function electCrown(seats: Seat[], exclude?: string): string | null {
  let best: Seat | null = null;
  for (const s of seats) {
    if (!s.connected || s.id === exclude) continue;
    if (!best) best = s;
    else {
      const r = RANKS.indexOf(s.rank) - RANKS.indexOf(best.rank);
      if (r > 0 || (r === 0 && s.joinedAt < best.joinedAt)) best = s;
    }
  }
  return best?.id ?? null;
}

/**
 * The colour a player gets (O18): the one asked for if it is one of the eight
 * and no other seat holds it; else the first free one; else (more than eight
 * seats, some away) the first no connected player holds.
 */
export function pickColour(meta: Meta, wanted: string, forId: string): string {
  const others = meta.seats.filter((s) => s.id !== forId);
  const held = new Set(others.map((s) => s.colour));
  if (PLAYER_COLOURS.includes(wanted) && !held.has(wanted)) return wanted;
  const free = PLAYER_COLOURS.find((c) => !held.has(c));
  if (free) return free;
  const live = new Set(others.filter((s) => s.connected).map((s) => s.colour));
  return PLAYER_COLOURS.find((c) => !live.has(c)) ?? PLAYER_COLOURS[0];
}

/** May this colour be swapped to (5.2): one of the eight, held by no other seat. */
export function colourFree(meta: Meta, colour: string, forId: string): boolean {
  return PLAYER_COLOURS.includes(colour) && !meta.seats.some((s) => s.id !== forId && s.colour === colour);
}

/** A nickname as the room shows it: spaces collapsed, 1 to 20 characters, "Player N" when empty or blocked (10.4). */
export function cleanNickname(raw: unknown, seatNumber: number): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX).trim() : '';
  return clean(s, '') || `Player ${seatNumber}`;
}

/** A room name: 1 to 60 characters, "Table CODE" when empty or blocked (10.4). */
export function cleanRoomName(raw: unknown, code: string): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX).trim() : '';
  return clean(s, '') || `Table ${code}`;
}

export function isRank(x: unknown): x is Rank {
  return typeof x === 'string' && (RANKS as string[]).includes(x);
}

/** The room's door code as stored (3.2): sha256(code + ':' + password), base64url. */
export async function passwordHash(code: string, password: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${code}:${password}`));
  return base64url(new Uint8Array(hash));
}

/**
 * The crown's change to the settings (4.3), each field checked; the password
 * is hashed by the caller. Returns the names of the fields that changed.
 */
export function applySettings(meta: Meta, set: Partial<RoomSettings>): string[] {
  const s = meta.settings;
  const changed: string[] = [];
  if (typeof set.name === 'string' && cleanRoomName(set.name, meta.code) !== s.name) {
    s.name = cleanRoomName(set.name, meta.code);
    changed.push('name');
  }
  if ((set.visibility === 'unlisted' || set.visibility === 'public' || set.visibility === 'password') && set.visibility !== s.visibility) {
    s.visibility = set.visibility;
    changed.push('visibility');
  }
  if ((set.tag === 'cube' || set.tag === 'play') && set.tag !== s.tag) {
    s.tag = set.tag;
    changed.push('tag');
  }
  if (isRank(set.newcomers) && set.newcomers !== s.newcomers) {
    s.newcomers = set.newcomers;
    changed.push('newcomers');
  }
  if (typeof set.locked === 'boolean' && set.locked !== s.locked) {
    s.locked = set.locked;
    changed.push('locked');
  }
  if (typeof set.downloads === 'boolean' && set.downloads !== s.downloads) {
    s.downloads = set.downloads;
    changed.push('downloads');
  }
  return changed;
}

/**
 * What a socket remembers through hibernation while storage writes are refused
 * (O108): the room's seq, its player's seat, and whether that player is crown.
 * Kept in the socket's attachment, which the runtime holds outside storage.
 */
export interface LiveNote {
  seq: number;
  seat: Seat;
  crown: boolean;
}

/**
 * After a wake, bring the stored meta up to what the sockets remember (O108):
 * seats that joined or changed after the last save, and the crown. Returns the
 * highest seq any socket saw (0 when none noted anything).
 */
export function restoreLive(meta: Meta, notes: LiveNote[]): number {
  let seq = 0;
  for (const n of notes) {
    seq = Math.max(seq, n.seq);
    const have = seatOf(meta, n.seat.id);
    if (have) Object.assign(have, n.seat);
    else meta.seats.push({ ...n.seat });
    if (n.crown) meta.crown = n.seat.id;
  }
  return seq;
}

/** Seats kept at most (8 connected, the rest away): the meta stays far under its 128 KB (10.2, O100). */
export const MAX_SEATS = 32;
/** Bans kept at most; the oldest go first. */
export const MAX_BANS = 200;

/**
 * Make room for a new seat when the room has MAX_SEATS: the longest-away seat
 * goes, unless it is the maker's, the crown's or owns a stand (`owners`), which
 * wait for their browser (O19). False when no seat can go.
 */
export function makeRoomForSeat(meta: Meta, owners: Set<string>): boolean {
  if (meta.seats.length < MAX_SEATS) return true;
  const i = meta.seats.findIndex((s) => !s.connected && s.id !== meta.maker && s.id !== meta.crown && !owners.has(s.id));
  if (i < 0) return false;
  meta.seats.splice(i, 1);
  return true;
}

/** Ban an identity, keeping the last MAX_BANS. */
export function addBan(meta: Meta, id: string): void {
  if (meta.bans.includes(id)) return;
  meta.bans.push(id);
  if (meta.bans.length > MAX_BANS) meta.bans.splice(0, meta.bans.length - MAX_BANS);
}

/** Add a chat line, keeping the last CHAT_LINES. */
export function addChat(meta: Meta, line: ChatLine): void {
  meta.chat.push(line);
  if (meta.chat.length > CHAT_LINES) meta.chat.splice(0, meta.chat.length - CHAT_LINES);
}

/** The grey system lines of 5.5. */
export const say = {
  joined: (s: Seat) => `${s.nickname} joined as ${RANK_LABEL[s.rank]}`,
  /** The maker's first hello: they are the crown, not a rank. */
  opened: (s: Seat) => `${s.nickname} opened the room`,
  /** A newcomer who walks into a room with no crown (after a restart) is the crown at once. */
  joinedCrown: (s: Seat) => `${s.nickname} joined and is the crown now`,
  back: (s: Seat) => `${s.nickname} is back`,
  left: (s: Seat) => `${s.nickname} left`,
  crown: (s: Seat) => `${s.nickname} is the crown now`,
  reclaimed: (s: Seat) => `${s.nickname} took the crown back`,
  passed: (from: Seat, to: Seat) => `${from.nickname} passed the crown to ${to.nickname}`,
  kicked: (s: Seat) => `${s.nickname} was kicked`,
  banned: (s: Seat) => `${s.nickname} was banned`,
  locked: 'The table is locked',
  unlocked: 'The table is unlocked',
  settings: 'Room settings changed',
};
