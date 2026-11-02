// The room protocol (ONLINE.md Section 9): every message between a browser and
// the room server, as JSON text frames, each with `t`. Bump PROTOCOL whenever
// a message changes shape (O48): the server speaks one version and tells a
// stale tab `bye {reason: 'version'}`.
//
// Also the few numbers and helpers both sides must agree on: the limits of
// 10.5 that the client checks too, the color set (5.2), the player id from
// an identity token (5.1), and snapshot parts (8.7).

import type { Finish } from '../src/state/types';
import type { Op } from './ops';
import type { Rank } from './permissions';
import type { Basics, CardSnap, CubeInfo, Die, Flag, Mat, NamedPile, Spread, TableState } from './table';

export const PROTOCOL = 3;

// ---- limits both sides check (10.5; the server's own rates are in server/src/limits.ts) ----

export const MAX_PLAYERS = 8;
/** Cards on a room's table (O43), plus mats, dice and stands. */
export const MAX_CARDS = 5000;
/** One message, in bytes of UTF-8. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** The most cards one search may look through (decision 310): a big deck, with room to spare. */
export const MAX_SEARCH = 250;
/** One snapshot part, in bytes of UTF-8. */
export const MAX_SNAPSHOT_PART_BYTES = 256 * 1024;
/**
 * **(agent, O104)** An `op` or `confirm` message: a spawn of a whole cube, a
 * layout of every card, a `replace` (New table, Load file) carries thousands
 * of cards in one op. 1 MiB is Cloudflare's own ceiling for a WebSocket
 * message; a 5,000-card add is about 900 KB, and the outbox splits big ops so
 * none comes near it.
 */
export const MAX_OP_BYTES = 1024 * 1024;
/** A crown's `confirm` of a `replace` op: the same ceiling as any op (O104). */
export const MAX_REPLACE_BYTES = MAX_OP_BYTES;
/** Cards per snapshot part (8.7). */
export const SNAPSHOT_PART_CARDS = 1000;
export const NICKNAME_MAX = 20;
export const ROOM_NAME_MAX = 60;
export const PASSWORD_MAX = 32;
export const CHAT_TEXT_MAX = 300;
export const CHAT_LINES = 100;
/** Stream messages a second (O45). */
export const STREAM_HZ = 10;

/** The eight player colors (5.2, O76): far apart on the felt and in small tags. */
export const PLAYER_COLOURS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#4895ef', '#7b2cbf', '#ff6fb5', '#f1f5f9'];

// ---- room meta ----

export type Visibility = 'unlisted' | 'public' | 'password';
export type Tag = 'cube' | 'play';

export interface RoomSettings {
  name: string;
  visibility: Visibility;
  /** 1 to 32 characters; only ever sent from the crown to the server. */
  password?: string;
  tag: Tag;
  /** The rank a new player joins at (O22). */
  newcomers: Rank;
  /** Lock table (O51). */
  locked: boolean;
  /** Downloads for everyone but the crown (O50). */
  downloads: boolean;
}

/** Settings as the server sends them: whether a password is set, never the password. */
export type PublicSettings = Omit<RoomSettings, 'password'> & { password: boolean };

/** A new room's settings (4.3). */
export function defaultRoomSettings(name: string, tag: Tag = 'cube'): RoomSettings {
  return { name, visibility: 'unlisted', tag, newcomers: 'move', locked: false, downloads: true };
}

export interface Player {
  id: string;
  nickname: string;
  colour: string;
  /** The crown's rank is kept too (what it falls back to when the crown passes). */
  rank: Rank;
  side: 0 | 1;
  connected: boolean;
  /** Join order: server time of the first join, ms. */
  joinedAt: number;
  isCrown: boolean;
  isMaker: boolean;
}

export interface ChatLine {
  /** Server time, ms. */
  at: number;
  /** The player id; absent for a system line ("Sam joined as Move"). */
  from?: string;
  text: string;
}

export type RefuseReason = 'rank' | 'locked' | 'held' | 'stand' | 'oneStand' | 'cap' | 'crownOnly' | 'touched' | 'noCrown' | 'unknown';

export type ByeReason = 'kicked' | 'banned' | 'closed' | 'version' | 'full' | 'password' | 'size' | 'rate' | 'quota';

// ---- streams (8.3) ----

/** A drawn pose, rounded to 0.1 mm and 0.01 rad. */
export type Pose6 = [x: number, y: number, z: number, yaw: number, roll: number, tilt: number];

export interface StreamOut {
  /** Table point under the cursor, mm; absent when the pointer is outside. */
  cur?: [x: number, y: number];
  /** Mirror mode (M). */
  side: 0 | 1;
  /** The selection, cards and dice, at most twice a second, only when it changed. */
  sel?: string[];
  /** What I hold: cards and dice, their drawn poses. */
  hold?: Record<string, Pose6>;
  /** My physics: tossed cards, rolling dice, until they settle. */
  fly?: Record<string, Pose6>;
  /**
   * **(decision 293)** The glove my cursor shows (a `Glove` name from src/ui/cursorArt.ts:
   * open, fist, point, a gesture...), sent with `cur`; others draw it in my color,
   * without its emoji. At most 16 characters.
   */
  cs?: string;
}

// ---- snapshots (8.7) ----

/**
 * One part of a snapshot. Part 0 carries everything but the cards (and `count`,
 * the number of cards in all, for the joining line); every later part carries
 * up to SNAPSHOT_PART_CARDS cards. A table with no cards is one part.
 */
export interface SnapshotPart {
  t: 'snapshot';
  part: number;
  parts: number;
  name?: string;
  basics?: Basics;
  named?: NamedPile[];
  spreads?: Spread[];
  mats?: Mat[];
  dice?: Die[];
  cubes?: CubeInfo[];
  flags?: Flag[];
  count?: number;
  cards?: CardSnap[];
  /** On part 0 of a snapshot the server sends: the seq it is current to. The crown never sends it. */
  seq?: number;
}

/**
 * The cards' share of one part, in bytes: well under MAX_SNAPSHOT_PART_BYTES,
 * since a card with a stand, a side and a lie-flat mark is twice a plain one
 * (final review #7).
 */
export const SNAPSHOT_PART_BUDGET = 200 * 1024;

/** A table in snapshot parts: a part closes at `perPart` cards or SNAPSHOT_PART_BUDGET bytes, whichever comes first. */
export function splitSnapshot(table: TableState, perPart = SNAPSHOT_PART_CARDS): SnapshotPart[] {
  const groups: CardSnap[][] = [];
  let group: CardSnap[] = [];
  let bytes = 0;
  for (const card of table.cards) {
    const size = byteLength(JSON.stringify(card)) + 1;
    if (group.length && (group.length >= perPart || bytes + size > SNAPSHOT_PART_BUDGET)) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(card);
    bytes += size;
  }
  if (group.length) groups.push(group);
  const parts = 1 + groups.length;
  const out: SnapshotPart[] = [{
    t: 'snapshot', part: 0, parts,
    name: table.name, basics: table.basics, named: table.named, spreads: table.spreads, mats: table.mats, dice: table.dice, cubes: table.cubes ?? [], flags: table.flags ?? [],
    count: table.cards.length,
  }];
  groups.forEach((cards, i) => out.push({ t: 'snapshot', part: i + 1, parts, cards }));
  return out;
}

/** The table back from all its parts (any order), or null while some are missing. */
export function joinSnapshot(parts: SnapshotPart[]): TableState | null {
  if (!parts.length) return null;
  const total = parts[0].parts;
  const byPart = new Map(parts.map((p) => [p.part, p]));
  if (byPart.size !== total) return null;
  const head = byPart.get(0);
  if (!head || !head.basics) return null;
  const cards: CardSnap[] = [];
  for (let i = 1; i < total; i++) {
    const p = byPart.get(i);
    if (!p) return null;
    cards.push(...(p.cards ?? []));
  }
  return {
    name: head.name ?? 'Untitled table',
    cards,
    named: head.named ?? [],
    spreads: head.spreads ?? [],
    mats: head.mats ?? [],
    dice: head.dice ?? [],
    basics: head.basics,
    cubes: head.cubes ?? [],
    flags: head.flags ?? [],
  };
}

// ---- messages (9.1, 9.2) ----

export type ClientMsg =
  | { t: 'hello'; v: number; token: string; nickname: string; colour: string; key?: string; side: 0 | 1 }
  /** A proposal, for the crown. `pre`: an undo's precondition, uid → the seq of the last op that touched it as this browser saw it (8.6). */
  | { t: 'op'; id: string; op: Op; pre?: Record<string, number> }
  /** Crown only: a judged op, its own (`by` itself) or another's with their id. */
  | { t: 'confirm'; id?: string; by: string; op: Op }
  /** Crown only. */
  | { t: 'refuse'; id: string; to: string; reason: RefuseReason }
  /** Crown only: the full table for the mirror (Go online, every 30 s, and when asked). */
  | SnapshotPart
  | ({ t: 'stream' } & StreamOut)
  | { t: 'chat'; text: string }
  /** Crown only. */
  | { t: 'settings'; set: Partial<RoomSettings> }
  /** Crown only. */
  | { t: 'rank'; player: string; rank: Rank }
  | { t: 'kick'; player: string }
  | { t: 'ban'; player: string }
  | { t: 'pass'; player: string }
  | { t: 'close' }
  /** My own swatch. */
  | { t: 'colour'; colour: string }
  /** After a gap in seq. */
  | { t: 'needSnapshot' }
  /**
   * **(decision 310)** L L: let me look through these face-down cards (a pile) while I search it.
   * Move rank; at most MAX_SEARCH cards. `uids: []` ends my search.
   */
  | { t: 'search'; uids: string[] }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; me: string; crown: string; maker: string; rank: Rank; settings: PublicSettings; code: string; players: Player[]; chat: ChatLine[]; seq: number }
  /** Redacted for you; unredacted after youAreCrown. */
  | SnapshotPart
  /** A confirmed op, redacted for you. */
  | { t: 'op'; seq: number; by: string; id?: string; op: Op }
  /** **(agent, O93)** To the crown only: another player's proposal to judge (and, after youAreCrown, the queued ones). */
  | { t: 'propose'; id: string; from: string; op: Op; pre?: Record<string, number> }
  | { t: 'reveal'; cards: { uid: string; scryfallId: string; finish: Finish }[] }
  | { t: 'forget'; uids: string[] }
  | { t: 'refused'; id: string; reason: RefuseReason }
  | ({ t: 'stream'; from: string } & StreamOut)
  /** On any join, leave, rank, color, side or crown change. */
  | { t: 'players'; players: Player[] }
  | { t: 'chat'; line: ChatLine }
  /** Who is crown now. */
  | { t: 'crown'; player: string }
  /** You are the crown: `parts` unredacted snapshot parts follow, then queued proposals. */
  | { t: 'youAreCrown'; parts: number }
  /** **(agent, O93)** To the crown: send a fresh snapshot (after the server woke from hibernation). */
  | { t: 'needSnapshot' }
  | { t: 'settings'; settings: PublicSettings }
  /** **(decision 310)** To everyone: a player is searching these cards (they glow in their color); `uids: []`, done. */
  | { t: 'searching'; player: string; uids: string[] }
  | { t: 'bye'; reason: ByeReason }
  | { t: 'pong' };

export type ClientMsgType = ClientMsg['t'];
export type ServerMsgType = ServerMsg['t'];

const CLIENT_TYPES = new Set<string>(['hello', 'op', 'confirm', 'refuse', 'snapshot', 'stream', 'chat', 'settings', 'rank', 'kick', 'ban', 'pass', 'close', 'colour', 'needSnapshot', 'search', 'ping']);
const SERVER_TYPES = new Set<string>(['welcome', 'snapshot', 'op', 'propose', 'reveal', 'forget', 'refused', 'stream', 'players', 'chat', 'crown', 'youAreCrown', 'needSnapshot', 'settings', 'searching', 'bye', 'pong']);

/** A light shape check: an object whose `t` is a client message type. The server checks each field it reads. */
export function isClientMsg(x: unknown): x is ClientMsg {
  return !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string' && CLIENT_TYPES.has((x as { t: string }).t);
}

export function isServerMsg(x: unknown): x is ServerMsg {
  return !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string' && SERVER_TYPES.has((x as { t: string }).t);
}

/** Bytes of a frame as UTF-8, for the size limits. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The size limit for a message of this type. */
export function maxBytes(t: string): number {
  if (t === 'snapshot') return MAX_SNAPSHOT_PART_BYTES;
  if (t === 'op' || t === 'confirm') return MAX_OP_BYTES;
  return MAX_MESSAGE_BYTES;
}

// ---- HTTP (9.3) ----

export interface VersionReply {
  protocol: number;
}

/** POST /api/rooms. */
export interface CreateRoomBody {
  token: string;
  nickname: string;
  name: string;
  tag: Tag;
}

export interface CreateRoomReply {
  code: string;
}

/** GET /api/rooms/:code, for the join prompt and the phone page. */
export interface RoomInfo {
  name: string;
  players: number;
  max: number;
  password: boolean;
  tag: Tag;
  open: boolean;
  /** The crown's nickname ("hosted by Dazey", 12.3). */
  crown: string;
  /** Colors held by a seated player, connected or away (O19), with the holder's first letter, for the join prompt's grayed swatches. */
  taken: { colour: string; initial: string }[];
}

/** One row of the public list (O13). */
export interface LobbyRow {
  code: string;
  name: string;
  players: number;
  max: number;
  password: boolean;
  tag: Tag;
  /** The crown's nickname. */
  crown: string;
  cards: number;
  /** When the room went online, server time ms. */
  since: number;
}

/** One row of the admin page (12.8): every open room, listed or not. */
export interface AdminRow extends LobbyRow {
  visibility: Visibility;
  locked: boolean;
  reports: number;
  delisted: boolean;
}

// ---- identity (5.1) ----

/** Bytes as base64url, no padding. */
export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The player id a room knows for an identity token: base64url(sha256(token)), first 16 characters. */
export async function playerIdOf(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return base64url(new Uint8Array(hash)).slice(0, 16);
}
