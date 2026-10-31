// The Lobby (ONLINE.md 10.3): one Durable Object that knows every open room
// from their heartbeats, for the public table browser and the admin page, and
// keeps the rate limits that need one place (room creation, joins, reports).
// The rows and rate windows live in memory (O97): every room heartbeats at
// least once a minute, so after an eviction the list is whole again within a
// minute. Reports and delisting must last, so they are kept in SQLite.

import { DurableObject } from 'cloudflare:workers';
import type { LobbyRow } from '../../shared/protocol';
import { LobbyBook, type AdminRow, type Flags, type LobbyBeat, type ReportResult } from './lobbyBook';
import type { Env } from './worker';

export type { LobbyBeat, AdminRow } from './lobbyBook';

export class Lobby extends DurableObject<Env> {
  private readonly book: LobbyBook;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Rate limits are off only where server/.dev.vars says so (local development, O99).
    this.book = new LobbyBook(env.RATE_LIMITS !== 'off');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS flags (code TEXT PRIMARY KEY, json TEXT NOT NULL)');
    for (const r of ctx.storage.sql.exec<{ code: string; json: string }>('SELECT code, json FROM flags')) {
      this.book.flags.set(r.code, JSON.parse(r.json) as Flags);
    }
  }

  /** A room's heartbeat: on any change to its name, players, tag, visibility or lock, and every minute (8.8). */
  heartbeat(beat: LobbyBeat): void {
    this.book.beat(beat, Date.now());
    this.prune();
  }

  /** A room closed. */
  remove(code: string): void {
    if (this.book.remove(code)) this.forget(code);
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
    if (result === 'ok') this.save(code);
    return result;
  }

  delist(code: string): void {
    this.book.delist(code);
    this.save(code);
  }

  relist(code: string): void {
    this.book.relist(code);
    this.forget(code);
  }

  /** Drop silent rooms (and their flags); trim the rate windows now and then. */
  private prune(): void {
    const now = Date.now();
    for (const code of this.book.prune(now)) this.forget(code);
    this.book.pruneLimits(now);
  }

  private save(code: string): void {
    const f = this.book.flags.get(code);
    if (f) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO flags (code, json) VALUES (?, ?)', code, JSON.stringify(f));
  }

  private forget(code: string): void {
    this.ctx.storage.sql.exec('DELETE FROM flags WHERE code = ?', code);
  }
}
