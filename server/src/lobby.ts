// The Lobby (ONLINE.md 10.3): one Durable Object that knows every open room
// from their heartbeats, for the public table browser and the admin page, and
// keeps the rate limits that need one place (room creation, joins, reports).
//
// The rows are kept in SQLite (O105): an idle Lobby is evicted from memory
// within seconds, far sooner than the minute between heartbeats, so a list
// kept only in memory came up empty. A row is written when it changes, and
// otherwise at most every 90 s to keep its last-seen time fresh enough for the
// 3-minute pruning. Reports and delisting are kept too; the rate windows live
// in memory only.

import { DurableObject } from 'cloudflare:workers';
import type { LobbyRow } from '../../shared/protocol';
import { LobbyBook, type AdminRow, type Flags, type LobbyBeat, type ReportResult } from './lobbyBook';
import type { Env } from './worker';

export type { LobbyBeat, AdminRow } from './lobbyBook';

/** A heartbeat that changes nothing still refreshes the stored last-seen time after this long. */
const SEEN_WRITE_MS = 90_000;

export class Lobby extends DurableObject<Env> {
  private readonly book: LobbyBook;
  /** Each row as last written, to skip writes that would change nothing. */
  private readonly written = new Map<string, { json: string; seen: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Rate limits are off only where server/.dev.vars says so (local development, O99).
    this.book = new LobbyBook(env.RATE_LIMITS !== 'off');
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS flags (code TEXT PRIMARY KEY, json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, json TEXT NOT NULL, seen INTEGER NOT NULL)');
    for (const r of sql.exec<{ code: string; json: string }>('SELECT code, json FROM flags')) {
      this.book.flags.set(r.code, JSON.parse(r.json) as Flags);
    }
    for (const r of sql.exec<{ code: string; json: string; seen: number }>('SELECT code, json, seen FROM rooms')) {
      this.book.beat(JSON.parse(r.json) as LobbyBeat, r.seen);
      this.written.set(r.code, { json: r.json, seen: r.seen });
    }
  }

  /** A room's heartbeat: on any change to its name, players, tag, visibility or lock, and every minute (8.8). */
  heartbeat(beat: LobbyBeat): void {
    const now = Date.now();
    this.book.beat(beat, now);
    const json = JSON.stringify(beat);
    const was = this.written.get(beat.code);
    if (!was || was.json !== json || now - was.seen >= SEEN_WRITE_MS) {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO rooms (code, json, seen) VALUES (?, ?, ?)', beat.code, json, now);
      this.written.set(beat.code, { json, seen: now });
    }
    this.prune();
  }

  /** A room closed. */
  remove(code: string): void {
    this.book.remove(code);
    this.forgetRoom(code);
  }

  /** GET /api/rooms. */
  publicList(): LobbyRow[] {
    this.prune();
    return this.book.publicList();
  }

  /** GET /api/admin/rooms. */
  adminList(): AdminRow[] {
    this.prune();
    return this.book.adminList();
  }

  allowCreate(ip: string, id: string): boolean {
    return this.book.allowCreate(ip, id, Date.now());
  }

  allowJoin(ip: string): boolean {
    return this.book.allowJoin(ip, Date.now());
  }

  report(code: string, reporter: string): ReportResult {
    const result = this.book.report(code, reporter, Date.now());
    if (result === 'ok') this.saveFlags(code);
    return result;
  }

  delist(code: string): void {
    this.book.delist(code);
    this.saveFlags(code);
  }

  relist(code: string): void {
    this.book.relist(code);
    this.ctx.storage.sql.exec('DELETE FROM flags WHERE code = ?', code);
  }

  /** Drop silent rooms (with their flags); trim the rate windows now and then. */
  private prune(): void {
    const now = Date.now();
    for (const code of this.book.prune(now)) this.forgetRoom(code);
    this.book.pruneLimits(now);
  }

  private saveFlags(code: string): void {
    const f = this.book.flags.get(code);
    if (f) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO flags (code, json) VALUES (?, ?)', code, JSON.stringify(f));
  }

  private forgetRoom(code: string): void {
    this.written.delete(code);
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
    this.ctx.storage.sql.exec('DELETE FROM flags WHERE code = ?', code);
  }
}
