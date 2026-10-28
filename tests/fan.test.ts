import { describe, expect, it } from 'vitest';
import { FAN_MAX_SPREAD, FAN_RADIUS, FAN_STEP, fanLayout } from '../src/state/fan';
import { overlaps } from '../src/state/piles';

describe('fan layout (decision 141)', () => {
  it('fans left to right, the bottom card on the left, each turned a little further clockwise', () => {
    const fan = fanLayout(7, { x: 0, y: 0 });
    for (let i = 1; i < fan.length; i++) {
      expect(fan[i].x).toBeGreaterThan(fan[i - 1].x);
      expect(fan[i].yaw).toBeCloseTo(fan[i - 1].yaw - FAN_STEP, 9);
    }
  });

  it('arches: the middle card sits at the centre, upright, and the ends are lower', () => {
    const fan = fanLayout(7, { x: 100, y: 50 });
    expect(fan[3].x).toBeCloseTo(100, 9);
    expect(fan[3].y).toBeCloseTo(50, 9);
    expect(fan[3].yaw).toBeCloseTo(0, 9);
    expect(fan[0].y).toBeLessThan(fan[3].y);
    expect(fan[6].y).toBeLessThan(fan[3].y);
    expect(fan[0].yaw).toBeGreaterThan(0);
  });

  it('keeps every card on the circle round the pivot below', () => {
    const fan = fanLayout(5, { x: 0, y: 0 });
    for (const c of fan) expect(Math.hypot(c.x, c.y + FAN_RADIUS)).toBeCloseTo(FAN_RADIUS, 9);
  });

  it('overlaps neighbours like a hand, without piling them on one spot', () => {
    const fan = fanLayout(10, { x: 0, y: 0 });
    for (let i = 1; i < fan.length; i++) {
      expect(overlaps(fan[i], fan[i - 1])).toBe(true);
      expect(Math.hypot(fan[i].x - fan[i - 1].x, fan[i].y - fan[i - 1].y)).toBeGreaterThan(10);
    }
  });

  it('closes up a big pile so the whole fan stays within its spread', () => {
    const fan = fanLayout(60, { x: 0, y: 0 });
    expect(fan[0].yaw - fan[59].yaw).toBeCloseTo(FAN_MAX_SPREAD, 9);
    expect(fanLayout(1, { x: 3, y: 4 })).toEqual([{ x: 3, y: 4, yaw: -0, z: 0.15 }]);
  });
});
