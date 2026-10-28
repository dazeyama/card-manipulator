import { describe, expect, it } from 'vitest';
import { nextQuarterClockwise, uprightYaw, visibleShare } from '../src/state/piles';
import { gridLayout, LOOSE_OFFSET, LOOSE_TURN, looseStackLayout, messyLayout, overlaps, rng, spreadLayout, stackLayout, surfaceTop } from '../src/state/piles';
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

describe('detectPiles with named piles (spec 11.3, 11.4)', () => {
  let n = 0;
  const id = () => `new${++n}`;
  const card = (uid: string, x: number, y: number, z = 0.15, yaw = 0) => ({ uid, x, y, z, yaw });

  it('a named pile keeps its id when more cards join than it had', () => {
    const prev = new Map([['keep', ['a']], ['other', ['b', 'c', 'd']]]);
    const cards = [card('a', 0, 0), card('b', 0, 0, 0.45), card('c', 0, 0, 0.75), card('d', 0, 0, 1.05)];
    const piles = detectPiles(cards, prev, id, { named: new Set(['keep']), moved: new Set(['b', 'c', 'd']) });
    expect(piles[0].id).toBe('keep');
  });

  it('a named pile shrunk to one card is still a pile', () => {
    const prev = new Map([['keep', ['a', 'b']]]);
    const piles = detectPiles([card('a', 0, 0), card('b', 400, 0)], prev, id, { named: new Set(['keep']), moved: new Set(['b']) });
    expect(piles).toHaveLength(1);
    expect(piles[0]).toMatchObject({ id: 'keep', cardUids: ['a'] });
  });

  it('the card that left a named pile does not steal its id', () => {
    const prev = new Map([['keep', ['a', 'b', 'c']]]);
    const cards = [card('a', 0, 0), card('b', 0, 0, 0.45), card('c', 500, 0), card('x', 500, 0, 0.45)];
    const piles = detectPiles(cards, prev, id, { named: new Set(['keep']), moved: new Set(['c']) });
    expect(piles.find((p) => p.cardUids.includes('a'))!.id).toBe('keep');
    expect(piles.find((p) => p.cardUids.includes('c'))!.id).not.toBe('keep');
  });

  it('when two named piles merge the receiving pile wins and the other is reported', () => {
    const prev = new Map([['keep', ['a', 'b']], ['sell', ['c', 'd']]]);
    const cards = [card('a', 0, 0), card('b', 0, 0, 0.45), card('c', 0, 0, 0.75), card('d', 0, 0, 1.05)];
    const piles = detectPiles(cards, prev, id, { named: new Set(['keep', 'sell']), moved: new Set(['c', 'd']) });
    expect(piles).toHaveLength(1);
    expect(piles[0].id).toBe('keep');
    expect(piles[0].merged).toEqual(['sell']);
  });

  it('an emptied named pile simply has no group', () => {
    const prev = new Map([['keep', ['a']]]);
    const piles = detectPiles([card('x', 0, 0)], prev, id, { named: new Set(['keep']) });
    expect(piles).toHaveLength(0);
  });
});

describe('looseStackLayout (decision 94)', () => {
  it('keeps every card near the spot, a little turned, stacked bottom first', () => {
    const at = { x: 100, y: -50, yaw: 0.3 };
    const cards = looseStackLayout(40, at, 2, rng(11));
    expect(cards).toHaveLength(40);
    for (const [i, c] of cards.entries()) {
      expect(Math.hypot(c.x - at.x, c.y - at.y)).toBeLessThanOrEqual(LOOSE_OFFSET + 1e-9);
      expect(Math.abs(c.yaw - at.yaw)).toBeLessThanOrEqual(LOOSE_TURN + 1e-9);
      expect(c.z).toBeCloseTo(2 + 0.15 + i * 0.3, 6);
    }
  });

  it('is visibly loose: not every card is squared up', () => {
    const cards = looseStackLayout(20, { x: 0, y: 0, yaw: 0 }, 0, rng(5));
    expect(cards.some((c) => Math.hypot(c.x, c.y) > 2)).toBe(true);
    expect(cards.some((c) => Math.abs(c.yaw) > 0.02)).toBe(true);
  });

  it('overlaps as one pile', () => {
    const cards = looseStackLayout(30, { x: 0, y: 0, yaw: 0 }, 0, rng(9));
    expect(cards.every((c) => overlaps(c, cards[0]))).toBe(true);
  });
});

describe('visibleShare (decision 101)', () => {
  const card = { x: 0, y: 0, yaw: 0 };
  it('is all of the face with nothing on top, and none under a card squarely on it', () => {
    expect(visibleShare(card, [])).toBe(1);
    expect(visibleShare(card, [{ x: 0, y: 0, yaw: 0 }])).toBe(0);
  });

  it('counts the strip a fan leaves showing', () => {
    // Shifted 10 mm across a 63 mm card: about a sixth shows.
    const share = visibleShare(card, [{ x: 10, y: 0, yaw: 0 }]);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.2);
  });

  it('sees a corner peeking out from under a turned card', () => {
    const share = visibleShare(card, [{ x: 4, y: 6, yaw: 0.3 }]);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.5);
  });
});

describe('rotate snapping (decision 102)', () => {
  const q = Math.PI / 2;
  it('turns a square card a full quarter clockwise', () => {
    expect(nextQuarterClockwise(0)).toBeCloseTo(-q, 9);
    expect(nextQuarterClockwise(-q)).toBeCloseTo(-2 * q, 9);
    expect(nextQuarterClockwise(q)).toBeCloseTo(0, 9);
  });

  it('squares a card at an odd angle to the quarter turn just clockwise of it', () => {
    expect(nextQuarterClockwise(0.3)).toBeCloseTo(0, 9);
    expect(nextQuarterClockwise(-0.3)).toBeCloseTo(-q, 9);
    expect(nextQuarterClockwise(2)).toBeCloseTo(q, 9);
  });

  it('stands a card upright by the shortest turn', () => {
    expect(uprightYaw(-q)).toBeCloseTo(0, 9);
    expect(uprightYaw(0.4)).toBeCloseTo(0, 9);
    expect(uprightYaw(2 * Math.PI - 0.2)).toBeCloseTo(2 * Math.PI, 9);
    expect(Math.abs(uprightYaw(3) - 3)).toBeLessThanOrEqual(Math.PI);
  });
});
