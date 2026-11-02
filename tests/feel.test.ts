import { describe, expect, it } from 'vitest';
import { CARRY_S, FLICK_SPEED, flickDirection, inMotion, MOVING_SPEED, planeBase, stopWhereTheyAre, sweepCount, SWEEP_ALL_MS, SWEEP_MESSY_ALL_MS, SWEEP_MESSY_MORE_MS, SWEEP_MORE_MS } from '../src/physics/feel';

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
  it('fires on a quick shake at the Normal speed, turning back just past square (decision 345)', () => {
    expect(flickDirection({ x: 1400, y: 0 }, { x: -10, y: 600 }, FLICK_SPEED.normal)).not.toBeNull();
    expect(flickDirection({ x: 1300, y: 0 }, { x: -800, y: 0 }, FLICK_SPEED.normal)).toBeNull();
    expect(flickDirection({ x: 900, y: 0 }, { x: -800, y: 0 }, FLICK_SPEED.sensitive)).not.toBeNull();
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

describe('sweeping a messy pile (decision 178)', () => {
  it('gives way much sooner than a deck', () => {
    expect(sweepCount(SWEEP_MESSY_MORE_MS, 40, false)).toBe(2);
    expect(sweepCount(SWEEP_MESSY_ALL_MS, 40, false)).toBe(40);
    expect(SWEEP_MESSY_ALL_MS).toBeLessThan(SWEEP_ALL_MS / 2);
    // Halfway through, a messy pile has given far more than a deck would.
    const ms = SWEEP_MORE_MS + (SWEEP_MESSY_ALL_MS - SWEEP_MORE_MS) / 2;
    expect(sweepCount(ms, 40, false)).toBeGreaterThan(sweepCount(ms, 40, true) + 10);
  });

  it('never goes down as time passes', () => {
    let prev = 0;
    for (let ms = 0; ms <= SWEEP_MESSY_ALL_MS + 100; ms += 16) {
      const n = sweepCount(ms, 30, false);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
});

describe('letting go mid-motion (decision 95)', () => {
  it('counts as moving only when some card is faster than the threshold', () => {
    expect(inMotion([{ vx: 0, vy: 0 }, { vx: 10, vy: -20 }])).toBe(false);
    expect(inMotion([{ vx: 0, vy: 0 }, { vx: MOVING_SPEED + 1, vy: 0 }])).toBe(true);
  });

  it('leaves each card where it is, slid on a little, keeping its turn', () => {
    const spots = stopWhereTheyAre([
      { x: 0, y: 0, yaw: 0.2, vx: 1000, vy: 0 },
      { x: -60, y: 5, yaw: -0.1, vx: 600, vy: 200 },
    ]);
    expect(spots[0]).toEqual({ x: 1000 * CARRY_S, y: 0, yaw: 0.2 });
    expect(spots[1].x).toBeCloseTo(-60 + 600 * CARRY_S, 9);
    expect(spots[1].y).toBeCloseTo(5 + 200 * CARRY_S, 9);
    expect(spots[1].yaw).toBe(-0.1);
  });
});

describe('planeBase: held cards clear what is under them (decision 97)', () => {
  const LIFT = 10;

  it('holds a level group at the lift height over bare table', () => {
    expect(planeBase([{ x: 0, y: 0, dz: 0, surface: 0 }], 0, 0, 0, 0, LIFT)).toBeCloseTo(LIFT + 0.15, 9);
  });

  it('rises over a stack under any one card', () => {
    const base = planeBase([{ x: 0, y: 0, dz: 0, surface: 0 }, { x: 80, y: 0, dz: 0.3, surface: 30 }], 0, 0, 0, 0, LIFT);
    expect(base + 0.3 - 0.15).toBeGreaterThanOrEqual(30 + LIFT - 1e-9);
  });

  it('lifts a tilted group so the low corner of a trailing card still clears', () => {
    // Slope 0.2 along x: a card 60 mm behind the cursor sits 12 mm lower on the plane.
    const sx = 0.2;
    const cards = [{ x: 0, y: 0, dz: 0, surface: 0 }, { x: -60, y: 0, dz: 0.3, surface: 5 }];
    const base = planeBase(cards, 0, 0, sx, 0, 0);
    const corner = (Math.hypot(63, 88) / 2) * sx;
    const trailingCentre = base + 0.3 + sx * -60;
    expect(trailingCentre - corner - 0.15).toBeGreaterThanOrEqual(5 - 1e-9);
  });
});
