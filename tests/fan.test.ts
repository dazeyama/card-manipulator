import { describe, expect, it } from 'vitest';
import { FAN_MAX_SPREAD, FAN_RADIUS, FAN_STEP, fanLayout, HAND_ROW_STEP, handLayout } from '../src/state/fan';
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

describe('big hands drawn with 0, in packs of 15 (decisions 162, 205)', () => {
  it('deals up to 15 cards as one fan', () => {
    expect(handLayout(15, { x: 0, y: 0 })).toEqual(fanLayout(15, { x: 0, y: 0 }));
  });

  it('deals 90 cards as six fans of 15, one under the next, centred', () => {
    const spots = handLayout(90, { x: 50, y: 0 });
    expect(spots).toHaveLength(90);
    const rows = [0, 1, 2, 3, 4, 5].map((r) => spots.slice(r * 15, r * 15 + 15));
    // Each fan's middle sits one row step below the last.
    const mid = rows.map((row) => Math.max(...row.map((p) => p.y)));
    for (let r = 1; r < 6; r++) expect(mid[r - 1] - mid[r]).toBeCloseTo(HAND_ROW_STEP, 6);
    expect((mid[0] + mid[5]) / 2).toBeCloseTo(fanLayout(15, { x: 50, y: 0 }).reduce((m, p) => Math.max(m, p.y), -Infinity), 6);
  });

  it('puts the leftover cards in a last, smaller fan', () => {
    // 27 cards: a pack of 15, then 12.
    const spots = handLayout(27, { x: 0, y: 0 });
    expect(spots).toHaveLength(27);
    expect(spots.slice(0, 15)).toEqual(fanLayout(15, { x: 0, y: HAND_ROW_STEP / 2 }));
    expect(spots.slice(15)).toEqual(fanLayout(12, { x: 0, y: -HAND_ROW_STEP / 2 }));
    // 30 cards: two full packs.
    const two = handLayout(30, { x: 0, y: 0 });
    expect(two.slice(15)).toEqual(fanLayout(15, { x: 0, y: -HAND_ROW_STEP / 2 }));
  });
});
