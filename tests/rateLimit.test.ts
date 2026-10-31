import { describe, expect, it } from 'vitest';
import { SlidingWindow } from '../shared/rateLimit';

describe('sliding window', () => {
  it('allows the limit within a window, then refuses', () => {
    const w = new SlidingWindow(5, 5000);
    for (let i = 0; i < 5; i++) expect(w.hit('a', 1000 + i)).toBe(true);
    expect(w.hit('a', 1005)).toBe(false);
    expect(w.count('a', 1005)).toBe(5);
  });

  it('slides: old hits fall out of the window', () => {
    const w = new SlidingWindow(2, 1000);
    expect(w.hit('a', 0)).toBe(true);
    expect(w.hit('a', 500)).toBe(true);
    expect(w.hit('a', 999)).toBe(false);
    expect(w.hit('a', 1000)).toBe(true);
    expect(w.allows('a', 1200)).toBe(false);
    expect(w.allows('a', 1500)).toBe(true);
  });

  it('keeps keys apart', () => {
    const w = new SlidingWindow(1, 1000);
    expect(w.hit('a', 0)).toBe(true);
    expect(w.hit('b', 0)).toBe(true);
    expect(w.hit('a', 10)).toBe(false);
  });

  it('does not count refused hits', () => {
    const w = new SlidingWindow(1, 1000);
    w.hit('a', 0);
    w.hit('a', 100);
    w.hit('a', 200);
    expect(w.count('a', 300)).toBe(1);
    expect(w.hit('a', 1000)).toBe(true);
  });

  it('takes back the latest hit (a guess that turned out right)', () => {
    const w = new SlidingWindow(2, 1000);
    w.hit('a', 0);
    w.hit('a', 10);
    expect(w.allows('a', 20)).toBe(false);
    w.refund('a');
    expect(w.count('a', 20)).toBe(1);
    w.refund('a');
    w.refund('a');
    expect(w.size).toBe(0);
  });

  it('prunes emptied keys', () => {
    const w = new SlidingWindow(3, 1000);
    w.hit('a', 0);
    w.hit('b', 900);
    w.prune(1500);
    expect(w.size).toBe(1);
    w.prune(2000);
    expect(w.size).toBe(0);
  });
});
