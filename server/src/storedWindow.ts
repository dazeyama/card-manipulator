// A sliding-window rate limit kept in a Durable Object's SQLite (O106). An
// idle object hibernates or is evicted within seconds and comes back with
// empty memory, so a limit kept in memory (shared/rateLimit.ts) resets with it:
// the wrong-password limit, and the Lobby's creation, join and report limits,
// live here instead. One row per hit; old rows are pruned. An index on (key, at)
// keeps each check to that key's few rows, since every row scanned is billed as
// a read (review N1). A write the free plan refuses never blocks anyone (N3).

import type { RateWindow } from '../../shared/rateLimit';

export class StoredWindow implements RateWindow {
  /** `table` is a fixed name chosen in code, never from input. */
  constructor(private readonly sql: SqlStorage, private readonly table: string, readonly limit: number, readonly windowMs: number) {
    this.init();
  }

  /** Make the table and its index (again after a closed room's deleteAll). */
  init(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (key TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ${this.table}_key_at ON ${this.table} (key, at)`);
  }

  count(key: string, now: number): number {
    const rows = [...this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${this.table} WHERE key = ? AND at > ?`, key, now - this.windowMs)];
    return rows[0]?.n ?? 0;
  }

  allows(key: string, now: number): boolean {
    return this.count(key, now) < this.limit;
  }

  hit(key: string, now: number): boolean {
    if (!this.allows(key, now)) return false;
    this.write(() => this.sql.exec(`INSERT INTO ${this.table} (key, at) VALUES (?, ?)`, key, now));
    return true;
  }

  refund(key: string): void {
    this.write(() => this.sql.exec(`DELETE FROM ${this.table} WHERE rowid = (SELECT rowid FROM ${this.table} WHERE key = ? ORDER BY at DESC LIMIT 1)`, key));
  }

  prune(now: number): void {
    this.write(() => this.sql.exec(`DELETE FROM ${this.table} WHERE at <= ?`, now - this.windowMs));
  }

  /** A write, logged and let go if refused: a spent quota must not lock anyone out or stop the alarm. */
  private write(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn('rate limit: a write was refused', err);
    }
  }
}
