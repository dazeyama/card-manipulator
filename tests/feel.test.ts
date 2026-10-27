import { describe, expect, it } from 'vitest';
import { flickDirection } from '../src/physics/feel';

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
