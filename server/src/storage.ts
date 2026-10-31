// The Room's storage (ONLINE.md 10.2): the meta under one KV key, the mirror
// as snapshot parts in one SQLite table, and the confirmed ops since the last
// snapshot in another. On waking after hibernation the Room rebuilds its
// mirror from the snapshot and the op log.
//
// Writes are kept few for the free plan's 100,000 rows a day (O97): a snapshot
// rewrites only the parts that changed, and confirmed ops go to the log in
// batches (one row per batch, keyed by the batch's last seq).

import { applyOp } from '../../shared/apply';
import type { ConfirmedOp } from '../../shared/ops';
import { joinSnapshot, splitSnapshot, type SnapshotPart } from '../../shared/protocol';
import type { TableState } from '../../shared/table';
import type { Meta } from './meta';
import { isQuotaError } from './quota';

export class RoomStorage {
  /** The parts as last written, to skip writing those that did not change. */
  private written: string[] = [];
  /**
   * Set once the free plan refused a write for the day (15): the room carries
   * on from memory, unsaved, rather than failing the players in it.
   */
  refused = false;
  /** Told once when a write is first refused (the Room then stays awake, O106). */
  onRefused: (() => void) | null = null;

  constructor(private readonly storage: DurableObjectStorage) {
    this.init();
  }

  /** Make the tables (again after a deleteAll, when a closed room's code is used anew). */
  init(): void {
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS snapshot (part INTEGER PRIMARY KEY, json TEXT NOT NULL)');
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS oplog (seq INTEGER PRIMARY KEY, json TEXT NOT NULL)');
  }

  loadMeta(): Meta | null {
    return (this.storage.kv.get<Meta>('meta') as Meta | undefined) ?? null;
  }

  saveMeta(meta: Meta): void {
    this.write(() => this.storage.kv.put('meta', meta));
  }

  /**
   * The mirror and its seq from the last snapshot plus the op log, and how many
   * logged ops were replayed over the snapshot; null when no snapshot was ever written.
   */
  loadMirror(): { table: TableState; seq: number; replayed: number } | null {
    const rows = [...this.storage.sql.exec<{ part: number; json: string }>('SELECT part, json FROM snapshot ORDER BY part')];
    if (!rows.length) return null;
    this.written = rows.map((r) => r.json);
    const table = joinSnapshot(rows.map((r) => JSON.parse(r.json) as SnapshotPart));
    if (!table) return null;
    let seq = (this.storage.kv.get<number>('snapSeq') as number | undefined) ?? 0;
    let mirror = table;
    let replayed = 0;
    for (const row of this.storage.sql.exec<{ seq: number; json: string }>('SELECT seq, json FROM oplog WHERE seq > ? ORDER BY seq', seq)) {
      for (const c of JSON.parse(row.json) as ConfirmedOp[]) {
        if (c.seq <= seq) continue;
        try {
          mirror = applyOp(mirror, c.op);
        } catch (err) {
          console.warn('op log replay failed at seq', c.seq, err);
        }
        seq = c.seq;
        replayed++;
      }
    }
    return { table: mirror, seq, replayed };
  }

  /** Write the mirror as the snapshot at `seq` and drop the op log up to it. */
  writeSnapshot(table: TableState, seq: number): void {
    const parts = splitSnapshot(table).map((p) => JSON.stringify(p));
    this.write(() => {
      parts.forEach((json, i) => {
        if (this.written[i] !== json) this.storage.sql.exec('INSERT OR REPLACE INTO snapshot (part, json) VALUES (?, ?)', i, json);
      });
      if (this.written.length > parts.length) this.storage.sql.exec('DELETE FROM snapshot WHERE part >= ?', parts.length);
      this.written = parts;
      this.storage.kv.put('snapSeq', seq);
      this.storage.sql.exec('DELETE FROM oplog WHERE seq <= ?', seq);
    });
  }

  /** Add confirmed ops (in seq order) to the log as one row. */
  appendOps(ops: ConfirmedOp[]): void {
    if (!ops.length) return;
    this.write(() => this.storage.sql.exec('INSERT OR REPLACE INTO oplog (seq, json) VALUES (?, ?)', ops[ops.length - 1].seq, JSON.stringify(ops)));
  }

  /** A write, unless the day's writes are spent; a refused one is logged and the room goes on. */
  private write(fn: () => void): void {
    if (this.refused) return;
    try {
      fn();
    } catch (err) {
      if (isQuotaError(err)) {
        this.refused = true;
        console.warn('room storage: the free plan refused a write for the day; carrying on from memory', err);
        this.onRefused?.();
      } else console.warn('room storage: a write failed', err);
    }
  }

  /** The room closed (O61): nothing is kept. */
  async deleteAll(): Promise<void> {
    this.written = [];
    this.refused = false;
    await this.storage.deleteAlarm();
    await this.storage.deleteAll();
  }
}
