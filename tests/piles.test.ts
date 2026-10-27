import { describe, expect, it } from 'vitest';
import { gridLayout, messyLayout, overlaps, rng, spreadLayout, stackLayout, surfaceTop } from '../src/state/piles';
import { CARD_T } from '../src/state/types';

describe('overlaps', () => {
  it('detects overlapping and separate cards', () => {
    expect(overlaps({ x: 0, y: 0, yaw: 0 }, { x: 30, y: 40, yaw: 0 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, yaw: 0 }, { x: 64, y: 0, yaw: 0 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, yaw: 0 }, { x: 0, y: 89, yaw: 0 })).toBe(false);
  });

  it('accounts for rotation', () => {
    // A card turned 90 degrees is 88 wide: at x = 70 it reaches back to x = 26, inside the first card.
    expect(overlaps({ x: 0, y: 0, yaw: 0 }, { x: 70, y: 0, yaw: Math.PI / 2 })).toBe(true);
    expect(overlaps({ x: 0, y: 0, yaw: 0 }, { x: 70, y: 0, yaw: 0 })).toBe(false);
  });
});

describe('layouts', () => {
  it('stacks cards one thickness apart above the surface', () => {
    const s = stackLayout(3, { x: 10, y: 20, yaw: 0 }, 1.2);
    expect(s.map((p) => p.z)).toEqual([1.2 + CARD_T / 2, 1.2 + CARD_T * 1.5, 1.2 + CARD_T * 2.5].map((z) => expect.closeTo(z, 6)));
    expect(s.every((p) => p.x === 10 && p.y === 20)).toBe(true);
  });

  it('finds the surface under a footprint', () => {
    const cards = stackLayout(5, { x: 0, y: 0, yaw: 0 });
    expect(surfaceTop(cards, { x: 10, y: 10, yaw: 0 })).toBeCloseTo(5 * CARD_T);
    expect(surfaceTop(cards, { x: 200, y: 0, yaw: 0 })).toBe(0);
  });

  it('makes messy piles that stay close and climb', () => {
    const m = messyLayout(50, { x: 0, y: 0, yaw: 0 }, 0, rng(7));
    expect(m).toHaveLength(50);
    for (let i = 1; i < m.length; i++) expect(m[i].z).toBeGreaterThan(m[i - 1].z);
    expect(Math.max(...m.map((p) => Math.hypot(p.x, p.y)))).toBeLessThanOrEqual(28);
    expect(new Set(m.map((p) => p.yaw.toFixed(3))).size).toBeGreaterThan(10);
  });

  it('is deterministic for a seed', () => {
    expect(messyLayout(5, { x: 0, y: 0, yaw: 0 }, 0, rng(3))).toEqual(messyLayout(5, { x: 0, y: 0, yaw: 0 }, 0, rng(3)));
  });

  it('spreads in rows of ten beside the anchor', () => {
    const s = spreadLayout(23, { x: 0, y: 0 });
    expect(s).toHaveLength(23);
    expect(new Set(s.map((p) => p.y)).size).toBe(3);
    expect(Math.min(...s.map((p) => p.x))).toBeGreaterThan(63);
    // No two spread cards overlap.
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y)).toBeGreaterThan(60);
  });

  it('centres a grid on a point', () => {
    const g = gridLayout(12, { x: 100, y: 50 });
    const cx = g.reduce((n, p) => n + p.x, 0) / g.length;
    expect(Math.abs(cx - 100)).toBeLessThan(70);
  });
});
