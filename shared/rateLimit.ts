// A sliding-window counter (ONLINE.md 10.4): at most `limit` hits per key in
// any `windowMs`. Pure: the caller passes the time, so tests need no clock.
// The server keeps one per control (chat, joins, wrong passwords, creation,
// reports, streams). Limits that must outlast hibernation use the same shape
// kept in storage (server/src/storedWindow.ts).

/** A rate limit's counter, in memory or in storage. */
export interface RateWindow {
  /** Count a hit for `key` at `now`. False (and not counted) when the key is over its limit. */
  hit(key: string, now: number): boolean;
  /** True when `key` may hit now, without counting. */
  allows(key: string, now: number): boolean;
  /** Take back `key`'s latest hit (a guess that turned out right). */
  refund(key: string): void;
  /** Forget hits older than the window. */
  prune(now: number): void;
}

export class SlidingWindow implements RateWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(readonly limit: number, readonly windowMs: number) {}

  refund(key: string): void {
    const times = this.hits.get(key);
    if (!times) return;
    times.pop();
    if (!times.length) this.hits.delete(key);
  }

  /** Count a hit for `key` at `now`. False (and not counted) when the key is over its limit. */
  hit(key: string, now: number): boolean {
    const recent = this.recent(key, now);
    if (recent.length >= this.limit) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** True when `key` may hit now, without counting. */
  allows(key: string, now: number): boolean {
    return this.recent(key, now).length < this.limit;
  }

  /** Hits for `key` within the window ending at `now`. */
  count(key: string, now: number): number {
    return this.recent(key, now).length;
  }

  /** Forget windows that have emptied, so the map does not grow. */
  prune(now: number): void {
    for (const [key, times] of this.hits) {
      const kept = times.filter((t) => now - t < this.windowMs);
      if (kept.length) this.hits.set(key, kept);
      else this.hits.delete(key);
    }
  }

  /** How many keys are held (for tests and pruning checks). */
  get size(): number {
    return this.hits.size;
  }

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
  }
}
