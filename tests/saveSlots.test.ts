import { describe, expect, it } from 'vitest';
import { savedAgo } from '../src/io/saveSlots';

describe('save slots (decision 359)', () => {
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const min = 60_000;
  it('says briefly when a slot was saved', () => {
    expect(savedAgo(now - 20_000, now)).toBe('just now');
    expect(savedAgo(now - 5 * min, now)).toBe('5 min ago');
    expect(savedAgo(now - 3 * 60 * min, now)).toBe('3 h ago');
    expect(savedAgo(now - 30 * 60 * min, now)).toBe('yesterday');
    expect(savedAgo(now - 4 * 24 * 60 * min, now)).toBe('4 days ago');
    expect(savedAgo(now - 10 * 24 * 60 * min, now)).toBe(new Date(now - 10 * 24 * 60 * min).toLocaleDateString());
  });
});
