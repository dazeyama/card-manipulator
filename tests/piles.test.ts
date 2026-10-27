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

import { detectPiles, sameYaw, snapYaw } from '../src/state/piles';

describe('detectPiles (spec 11.1)', () => {
  let n = 0;
  const id = () => `new${++n}`;
  const card = (uid: string, x: number, y: number, z = 0.15, yaw = 0) => ({ uid, x, y, z, yaw });

  it('finds a stack, a messy pile and leaves loose cards out', () => {
    const cards = [
      card('a', 0, 0, 0.15), card('b', 0.5, 0.5, 0.45), card('c', 0, 0, 0.75),
      card('d', 300, 0, 0.15, 0.1), card('e', 320, 10, 0.45, -0.2),
      card('f', 600, 0),
    ];
    const piles = detectPiles(cards, new Map(), id);
    expect(piles).toHaveLength(2);
    const stack = piles.find((p) => p.cardUids.includes('a'))!;
    expect(stack.kind).toBe('stack');
    expect(stack.cardUids).toEqual(['a', 'b', 'c']);
    expect(stack.top).toBeCloseTo(0.9);
    const messy = piles.find((p) => p.cardUids.includes('d'))!;
    expect(messy.kind).toBe('messy');
  });

  it('joins piles transitively through overlaps', () => {
    const cards = [card('a', 0, 0), card('b', 50, 0, 0.45), card('c', 100, 0, 0.75)];
    expect(detectPiles(cards, new Map(), id)[0].cardUids).toEqual(['a', 'b', 'c']);
  });

  it('does not join cards laid side by side with a gap', () => {
    const cards = [card('a', 0, 0), card('b', 69, 0), card('c', 0, 94)];
    expect(detectPiles(cards, new Map(), id)).toHaveLength(0);
  });

  it('a card turned 180 degrees still squares up; 90 degrees does not', () => {
    expect(sameYaw(0, Math.PI)).toBe(true);
    expect(sameYaw(0, Math.PI / 2)).toBe(false);
    const piles = detectPiles([card('a', 0, 0, 0.15, 0), card('b', 0, 0, 0.45, Math.PI / 2)], new Map(), id);
    expect(piles[0].kind).toBe('messy');
  });

  it('keeps a pile id while the pile keeps most of its cards', () => {
    const prev = new Map([['keep', ['a', 'b', 'c']]]);
    const piles = detectPiles([card('a', 0, 0), card('b', 0, 0, 0.45), card('x', 0, 0, 0.75)], prev, id);
    expect(piles[0].id).toBe('keep');
  });

  it('gives two piles split from one their own ids', () => {
    const prev = new Map([['old', ['a', 'b', 'c', 'd']]]);
    const piles = detectPiles([card('a', 0, 0), card('b', 0, 0, 0.45), card('c', 500, 0), card('d', 500, 0, 0.45)], prev, id);
    expect(new Set(piles.map((p) => p.id)).size).toBe(2);
    expect(piles.map((p) => p.id)).toContain('old');
  });

  it('handles a tower of 1,000 cards quickly', () => {
    const cards = Array.from({ length: 1000 }, (_, i) => card(`t${i}`, 0, 0, 0.15 + i * 0.3));
    const t0 = performance.now();
    const piles = detectPiles(cards, new Map(), id);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(piles[0].cardUids).toHaveLength(1000);
  });

  it('snaps yaw to quarter turns', () => {
    expect(snapYaw(0.3)).toBe(0);
    expect(snapYaw(1.4)).toBeCloseTo(Math.PI / 2);
    expect(snapYaw(-1.7)).toBeCloseTo(-Math.PI / 2);
  });
});
