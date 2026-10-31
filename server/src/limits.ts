// The room server's numbers (ONLINE.md 10.4, 10.5, O69), in one place to
// tune. Limits the client checks too (players, cards, message sizes, name
// lengths) live in shared/protocol.ts and are re-exported here. Pure.

// MAX_OP_BYTES: an op or a confirm may carry a whole cube, or a replace its whole table (O104).
export {
  MAX_PLAYERS, MAX_CARDS, MAX_MESSAGE_BYTES, MAX_SNAPSHOT_PART_BYTES, MAX_OP_BYTES, SNAPSHOT_PART_CARDS,
  NICKNAME_MAX, ROOM_NAME_MAX, PASSWORD_MAX, CHAT_TEXT_MAX, CHAT_LINES, STREAM_HZ,
} from '../../shared/protocol';

/** Stream messages a player may send a second before the extras are dropped (10.5). */
export const STREAMS_PER_SECOND = 15;

/** Chat: 5 lines per 5 seconds per player (5.5). */
export const CHAT_RATE = { limit: 5, windowMs: 5_000 };

/** Ops waiting for a crown are refused with noCrown after this long (4.5). */
export const NO_CROWN_WAIT_MS = 5_000;

/** The server writes its mirror as a snapshot after this many confirmed ops, if the crown has not sent one (10.2). */
export const SNAPSHOT_EVERY_OPS = 50;

/** Confirmed ops are written to the op log in batches, this long after the last one (O97). */
export const OPLOG_FLUSH_MS = 1_000;

/** The Room's alarm while anyone is connected: Lobby heartbeat, pruning (10.2). */
export const HEARTBEAT_MS = 60_000;

/** The Lobby drops rooms silent for this long (8.8). */
export const LOBBY_STALE_MS = 180_000;

/** Room creation: 5 an hour per ip and per identity (10.4). */
export const CREATE_RATE = { limit: 5, windowMs: 3_600_000 };

/** Joins: 30 an hour per ip. */
export const JOIN_RATE = { limit: 30, windowMs: 3_600_000 };

/** Wrong passwords: 10 per 10 minutes per ip, then `bye rate` for 10 minutes. */
export const PASSWORD_RATE = { limit: 10, windowMs: 600_000 };

/** A wrong password is answered after this long. */
export const WRONG_PASSWORD_DELAY_MS = 1_000;

/** Reports: 3 an hour per identity; 3 distinct reporters delist a room. */
export const REPORT_RATE = { limit: 3, windowMs: 3_600_000 };
export const REPORTS_TO_DELIST = 3;

/** The public list shows at most this many rooms. */
export const PUBLIC_LIST_MAX = 1000;

/** Close codes on the room socket (beyond `bye`). */
export const CLOSE_BYE = 4000;
/** The same identity connected again from another socket: the older one is closed and should not reconnect (O97). */
export const CLOSE_REPLACED = 4001;
/** The crown's table passed the cap's backstop: its socket is closed so it reconnects and is resynced by the hand-over (O107). */
export const CLOSE_RESYNC = 4002;
