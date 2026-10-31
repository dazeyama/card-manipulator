import { describe, expect, it } from 'vitest';
import { filterRows, upFor } from '../src/ui/tableBrowser';
import type { LobbyRow } from '../shared/protocol';

const MIN = 60_000;

describe('the table browser (ONLINE.md 12.5)', () => {
  it('says how long a room has been up, short', () => {
    const now = 1_000_000_000;
    expect(upFor(now - 10_000, now)).toBe('just now');
    expect(upFor(now - 12 * MIN, now)).toBe('12 min');
    expect(upFor(now - 59 * MIN, now)).toBe('59 min');
    expect(upFor(now - 120 * MIN, now)).toBe('2 h');
    expect(upFor(now - 47 * 60 * MIN, now)).toBe('47 h');
    expect(upFor(now - 72 * 60 * MIN, now)).toBe('3 d');
    // A clock a little ahead of the server's never reads negative.
    expect(upFor(now + 5_000, now)).toBe('just now');
  });

  it('filters by tag with the chips, keeping the server’s order', () => {
    const row = (code: string, tag: 'cube' | 'play'): LobbyRow => ({ code, name: code, players: 1, max: 8, password: false, tag, crown: 'Sam', cards: 10, since: 0 });
    const rows = [row('A', 'play'), row('B', 'cube'), row('C', 'play')];
    expect(filterRows(rows, 'all').map((r) => r.code)).toEqual(['A', 'B', 'C']);
    expect(filterRows(rows, 'play').map((r) => r.code)).toEqual(['A', 'C']);
    expect(filterRows(rows, 'cube').map((r) => r.code)).toEqual(['B']);
  });
});
