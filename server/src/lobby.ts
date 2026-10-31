// The Lobby (ONLINE.md 10.3): one Durable Object that knows every open room
// from their heartbeats, for the public table browser and the admin page, and
// keeps the rate limits that need one place (room creation, joins, reports).
//
// The rows are kept in SQLite (O105): an idle Lobby is evicted from memory
// within seconds, far sooner than the minute between heartbeats, so a list
// kept only in memory came up empty. A row is written when it changes, and
// otherwise at most every 90 s to keep its last-seen time fresh enough for the
// 3-minute pruning. Reports, delisting and the rate limits' counts are kept
// too (O106).

import { DurableObject } from 'cloudflare:workers';
import type { LobbyRow } from '../../shared/protocol';
import { CREATE_RATE, JOIN_RATE, REPORT_RATE } from './limits';
import { LobbyBook, type AdminRow, type Flags, type LobbyBeat, type ReportResult } from './lobbyBook';
import { StoredWindow } from './storedWindow';
import type { Env } from './worker';

export type { LobbyBeat, AdminRow } from './lobbyBook';

/** A heartbeat that changes nothing still refreshes the stored last-seen time after this long. */
const SEEN_WRITE_MS = 90_000;

export class Lobby extends DurableObject<Env> {
  private readonly book: LobbyBook;
  /** Each row as last written, to skip writes that would change nothing. */
  private readonly written = new Map<string, { json: string; seen: number }>();
  private prunedAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // Rate limits are off only where server/.dev.vars says so (local development, O99);
    // their counts are stored, so an eviction does not reset them (O106).
    this.book = new LobbyBook(env.RATE_LIMITS !== 'off', {
      createByIp: new StoredWindow(sql, 'rate_create_ip', CREATE_RATE.limit, CREATE_RATE.windowMs),
      createById: new StoredWindow(sql, 'rate_create_id', CREATE_RATE.limit, CREATE_RATE.windowMs),
      joinByIp: new StoredWindow(sql, 'rate_join_ip', JOIN_RATE.limit, JOIN_RATE.windowMs),
      reportsBy: new StoredWindow(sql, 'rate_report', REPORT_RATE.limit, REPORT_RATE.windowMs),
    });
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

  /** Drop silent rooms (with their flags); trim the rate windows at most once a minute. */
  private prune(): void {
    const now = Date.now();
    for (const code of this.book.prune(now)) this.forgetRoom(code);
    if (now - this.prunedAt < 60_000) return;
    this.prunedAt = now;
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
