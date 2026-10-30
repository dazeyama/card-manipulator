import { describe, expect, it } from 'vitest';
import { fitLayout, gridLayout, layOrder } from '../src/state/piles';

describe('reverse spread order (decision 215)', () => {
  it('keeps the plain order as given', () => {
    expect(layOrder(gridLayout(5, { x: 0, y: 0 }), false)).toEqual([0, 1, 2, 3, 4]);
  });

  it('lays each row right to left, rows still top to bottom', () => {
    // A box two rows tall: a full top row, the rest below.
    const spots = fitLayout(7, { minX: 0, minY: 0, maxX: 200, maxY: 180 });
    expect(new Set(spots.map((s) => s.y)).size).toBe(2);
    const order = layOrder(spots, true);
    const perRow = spots.filter((s) => s.y === spots[0].y).length;
    // The top row first, its rightmost card laid first, so the first card ends on top at the left.
    expect(order.slice(0, perRow)).toEqual([...Array(perRow).keys()].reverse());
    expect(order[order.length - 1]).toBe(perRow);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
