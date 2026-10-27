import { describe, expect, it } from 'vitest';
import { flickDirection, sweepCount, SWEEP_ALL_MS, SWEEP_MORE_MS } from '../src/physics/feel';

describe('flickDirection (spec 10.5)', () => {
  it('fires on a fast move that reverses sharply, tossing the way it was going', () => {
    const d = flickDirection({ x: 3000, y: 0 }, { x: -800, y: 50 }, 2300);
    expect(d).not.toBeNull();
    expect(d!.x).toBeCloseTo(1);
    expect(d!.y).toBeCloseTo(0);
  });
  it('ignores slow moves, gentle turns and stops', () => {
    expect(flickDirection({ x: 1000, y: 0 }, { x: -800, y: 0 }, 2300)).toBeNull();
    expect(flickDirection({ x: 3000, y: 0 }, { x: 2000, y: 1500 }, 2300)).toBeNull();
    expect(flickDirection({ x: 3000, y: 0 }, { x: -50, y: 0 }, 2300)).toBeNull();
  });
  it('respects the setting: Sensitive fires sooner, Off never', () => {
    expect(flickDirection({ x: 1600, y: 0 }, { x: -800, y: 0 }, 1400)).not.toBeNull();
    expect(flickDirection({ x: 99999, y: 0 }, { x: -800, y: 0 }, Infinity)).toBeNull();
  });
});

describe('sweepCount (decision 89)', () => {
  it('a quick pass takes only the top card', () => {
    expect(sweepCount(0, 40)).toBe(1);
    expect(sweepCount(SWEEP_MORE_MS - 1, 40)).toBe(1);
  });

  it('lingering takes more, slowly at first, then the whole pile', () => {
    expect(sweepCount(SWEEP_MORE_MS, 40)).toBe(2);
    const mid = sweepCount((SWEEP_MORE_MS + SWEEP_ALL_MS) / 2, 40);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(20);
    expect(sweepCount(SWEEP_ALL_MS, 40)).toBe(40);
  });

  it('never goes down as time passes, nor past the pile', () => {
    let prev = 0;
    for (let ms = 0; ms <= SWEEP_ALL_MS + 200; ms += 16) {
      const n = sweepCount(ms, 12);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(12);
      prev = n;
    }
    expect(sweepCount(5000, 1)).toBe(1);
    expect(sweepCount(5000, 0)).toBe(0);
  });
});
