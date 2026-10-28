import { describe, expect, it } from 'vitest';
import { fitLayout } from '../src/state/piles';
import { CARD_H, CARD_W } from '../src/state/types';

type Box = { minX: number; minY: number; maxX: number; maxY: number };
// Every card's whole footprint lies inside the box.
const inside = (spots: { x: number; y: number }[], b: Box) =>
  spots.every((p) => p.x - CARD_W / 2 >= b.minX - 1e-6 && p.x + CARD_W / 2 <= b.maxX + 1e-6 && p.y - CARD_H / 2 >= b.minY - 1e-6 && p.y + CARD_H / 2 <= b.maxY + 1e-6);

describe('spreading into a dragged box (decision 159)', () => {
  it('keeps the usual gap when the box has room, centred in it', () => {
    const box = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };
    const spots = fitLayout(6, box);
    expect(inside(spots, box)).toBe(true);
    expect(spots[1].x - spots[0].x).toBeCloseTo(CARD_W + 6, 9);
    const xs = spots.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(1000, 6);
  });

  it('overlaps the cards to fit a small box, never going outside it', () => {
    for (const box of [
      { minX: 0, minY: 0, maxX: 300, maxY: 200 },
      { minX: -50, minY: 10, maxX: 150, maxY: 400 },
      { minX: 0, minY: 0, maxX: 900, maxY: 120 },
    ]) {
      for (const n of [2, 7, 30, 120]) expect(inside(fitLayout(n, box), box)).toBe(true);
    }
  });

  it('lays a wide box out in a row and a tall box in a column', () => {
    const wide = fitLayout(5, { minX: 0, minY: 0, maxX: 400, maxY: CARD_H });
    expect(new Set(wide.map((p) => p.y)).size).toBe(1);
    const tall = fitLayout(5, { minX: 0, minY: 0, maxX: CARD_W, maxY: 500 });
    expect(new Set(tall.map((p) => p.x)).size).toBe(1);
  });

  it('goes top card first, left to right then down', () => {
    const spots = fitLayout(4, { minX: 0, minY: 0, maxX: 2 * CARD_W + 6, maxY: 2 * CARD_H + 6 });
    expect(spots[0].x).toBeLessThan(spots[1].x);
    expect(spots[0].y).toBeCloseTo(spots[1].y, 9);
    expect(spots[2].y).toBeLessThan(spots[0].y);
  });

  it('centres the cards on a box smaller than one card', () => {
    const spots = fitLayout(3, { minX: 0, minY: 0, maxX: 20, maxY: 20 });
    for (const p of spots) {
      expect(p.x).toBeCloseTo(10, 9);
      expect(p.y).toBeCloseTo(10, 9);
    }
  });
});
