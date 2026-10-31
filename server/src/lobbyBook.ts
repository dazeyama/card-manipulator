// The Lobby's bookkeeping (ONLINE.md 10.3, 10.4), pure so tests can run it:
// the open rooms from their heartbeats, the public list, reports and
// delisting, and the rate limits that live in one place (room creation per
// ip and identity, joins per ip, reports per identity). The Lobby Durable
// Object wraps it and persists the flags (reports, delisted).

import { SlidingWindow } from '../../shared/rateLimit';
import type { AdminRow, LobbyRow, Visibility } from '../../shared/protocol';
import { CREATE_RATE, JOIN_RATE, LOBBY_STALE_MS, PUBLIC_LIST_MAX, REPORT_RATE, REPORTS_TO_DELIST } from './limits';

export type { AdminRow };

/** What a Room tells the Lobby about itself. */
export interface LobbyBeat extends LobbyRow {
  visibility: Visibility;
  locked: boolean;
}

/** What the Lobby must keep through an eviction. */
export interface Flags {
  /** Distinct reporters' player ids. */
  reports: string[];
  /** Out of the public list until the admin relists it (O15). */
  delisted: boolean;
}

export type ReportResult = 'ok' | 'rate' | 'closed';

function row(b: LobbyBeat): LobbyRow {
  return { code: b.code, name: b.name, players: b.players, max: b.max, password: b.password, tag: b.tag, crown: b.crown, cards: b.cards, since: b.since };
}

export class LobbyBook {
  private readonly rooms = new Map<string, LobbyBeat & { seen: number }>();
  readonly flags = new Map<string, Flags>();
  private readonly createByIp = new SlidingWindow(CREATE_RATE.limit, CREATE_RATE.windowMs);
  private readonly createById = new SlidingWindow(CREATE_RATE.limit, CREATE_RATE.windowMs);
  private readonly joinByIp = new SlidingWindow(JOIN_RATE.limit, JOIN_RATE.windowMs);
  private readonly reportsBy = new SlidingWindow(REPORT_RATE.limit, REPORT_RATE.windowMs);

  /** `limits` false turns the creation and join limits off (local development, O99). */
  constructor(private readonly limits = true) {}

  /** A room's heartbeat (8.8). */
  beat(b: LobbyBeat, now: number): void {
    this.rooms.set(b.code, { ...b, seen: now });
  }

  /** A room closed. True if it had flags to forget. */
  remove(code: string): boolean {
    this.rooms.delete(code);
    return this.flags.delete(code);
  }

  /** Drop rooms silent for three minutes. Returns the codes dropped (their flags go too). */
  prune(now: number): string[] {
    const gone: string[] = [];
    for (const [code, r] of this.rooms) {
      if (now - r.seen <= LOBBY_STALE_MS) continue;
      this.rooms.delete(code);
      this.flags.delete(code);
      gone.push(code);
    }
    return gone;
  }

  isOpen(code: string): boolean {
    return this.rooms.has(code);
  }

  /** The table browser's list (12.5): public and password rooms not delisted, most players first, then longest up. */
  publicList(): LobbyRow[] {
    return [...this.rooms.values()]
      .filter((r) => r.visibility !== 'unlisted' && !this.flags.get(r.code)?.delisted)
      .sort((a, b) => b.players - a.players || a.since - b.since)
      .slice(0, PUBLIC_LIST_MAX)
      .map(row);
  }

  /** Every open room, with its reports, for the admin page. */
  adminList(): AdminRow[] {
    return [...this.rooms.values()]
      .sort((a, b) => a.since - b.since)
      .map((r) => ({ ...row(r), visibility: r.visibility, locked: r.locked, reports: this.flags.get(r.code)?.reports.length ?? 0, delisted: !!this.flags.get(r.code)?.delisted }));
  }

  /** May this ip and identity make a room now (5 an hour each)? Counts it if so. An empty ip is not limited by ip. */
  allowCreate(ip: string, id: string, now: number): boolean {
    if (!this.limits) return true;
    if ((ip && !this.createByIp.allows(ip, now)) || !this.createById.allows(id, now)) return false;
    if (ip) this.createByIp.hit(ip, now);
    this.createById.hit(id, now);
    return true;
  }

  /** May this ip join a room now (30 an hour)? Counts it if so. */
  allowJoin(ip: string, now: number): boolean {
    if (!this.limits || !ip) return true;
    return this.joinByIp.hit(ip, now);
  }

  /** A report (3 an hour per identity); three distinct reporters delist the room. */
  report(code: string, reporter: string, now: number): ReportResult {
    if (!this.rooms.has(code)) return 'closed';
    if (!this.reportsBy.hit(reporter, now)) return 'rate';
    const f = this.flags.get(code) ?? { reports: [], delisted: false };
    if (!f.reports.includes(reporter)) f.reports.push(reporter);
    if (f.reports.length >= REPORTS_TO_DELIST) f.delisted = true;
    this.flags.set(code, f);
    return 'ok';
  }

  delist(code: string): void {
    const f = this.flags.get(code) ?? { reports: [], delisted: false };
    f.delisted = true;
    this.flags.set(code, f);
  }

  /** The admin looked: reports cleared, the room listed again. */
  relist(code: string): void {
    this.flags.delete(code);
  }

  /** Forget old rate-limit windows. */
  pruneLimits(now: number): void {
    this.createByIp.prune(now);
    this.createById.prune(now);
    this.joinByIp.prune(now);
    this.reportsBy.prune(now);
  }
}
