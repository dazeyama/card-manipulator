import { describe, expect, it } from 'vitest';
import { rng } from '../src/state/piles';
import { messyLayout, overlaps } from '../src/state/piles';
import { bottomAt, capRest, laidFlat, MAX_SLOPE, POP_MIN, popLift, REST_SLACK, restCapped, restOn, restSlope, slopesOf, tiltFor, type Resting } from '../src/state/rest';
import { CARD_H, CARD_T, CARD_W } from '../src/state/types';

const flat = (x: number, y: number, z: number, yaw = 0): Resting => ({ x, y, z, yaw, tiltX: 0, tiltY: 0 });

/** Top face of a resting card at a table point. */
function topOf(c: Resting, px: number, py: number): number {
  const dx = px - c.x, dy = py - c.y;
  const a = dx * Math.cos(c.yaw) + dy * Math.sin(c.yaw);
  const b = -dx * Math.sin(c.yaw) + dy * Math.cos(c.yaw);
  const { gs, gt } = slopesOf(c.tiltX, c.tiltY);
  return c.z + CARD_T / 2 + gs * a + gt * b;
}

/** True if (px, py) lies over the card's rectangle. */
function over(c: Resting, px: number, py: number): boolean {
  const dx = px - c.x, dy = py - c.y;
  const a = dx * Math.cos(c.yaw) + dy * Math.sin(c.yaw);
  const b = -dx * Math.sin(c.yaw) + dy * Math.cos(c.yaw);
  return Math.abs(a) <= CARD_W / 2 + 1e-9 && Math.abs(b) <= CARD_H / 2 + 1e-9;
}

/** The lowest gap between a resting card's bottom and what is under it, sampled finely. */
function minGap(at: { x: number; y: number; yaw: number }, rest: ReturnType<typeof restOn>, supports: Resting[]): number {
  let gap = Infinity;
  for (let i = 0; i <= 30; i++) {
    for (let j = 0; j <= 40; j++) {
      const s = -CARD_W / 2 + (CARD_W * i) / 30;
      const t = -CARD_H / 2 + (CARD_H * j) / 40;
      const px = at.x + s * Math.cos(at.yaw) - t * Math.sin(at.yaw);
      const py = at.y + s * Math.sin(at.yaw) + t * Math.cos(at.yaw);
      let under = 0;
      for (const c of supports) if (over(c, px, py)) under = Math.max(under, topOf(c, px, py));
      gap = Math.min(gap, bottomAt(rest, s, t) - under);
    }
  }
  return gap;
}

describe('resting as rigid cards (decisions 99, 100)', () => {
  it('turns pose tilt into slopes and back', () => {
    const t = tiltFor(0.12, -0.3);
    const g = slopesOf(t.tiltX, t.tiltY);
    expect(g.gs).toBeCloseTo(0.12, 9);
    expect(g.gt).toBeCloseTo(-0.3, 9);
  });

  it('lies flat on the bare table', () => {
    expect(restOn({ x: 0, y: 0, yaw: 0 }, [])).toEqual({ z: CARD_T / 2, tiltX: 0, tiltY: 0 });
  });

  it('lies flat on a card squarely under it', () => {
    const r = restOn({ x: 0, y: 0, yaw: 0 }, [flat(0, 0, CARD_T / 2)]);
    expect(r.z).toBeCloseTo(CARD_T * 1.5, 9);
    expect(Math.abs(r.tiltX) + Math.abs(r.tiltY)).toBeLessThan(1e-9);
  });

  it('lies flat on a card when its center is supported, even hanging a little off it', () => {
    const at = { x: 5, y: 0, yaw: 0 };
    const supports = [flat(0, 0, CARD_T / 2)];
    const r = restOn(at, supports);
    expect(Math.abs(r.tiltX) + Math.abs(r.tiltY)).toBeLessThan(1e-9);
    expect(r.z).toBeCloseTo(CARD_T * 1.5, 9);
    expect(minGap(at, r, supports)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('never builds a tower: a messy heap is no taller than its cards stacked flat', () => {
    // The droop rule of decision 99 stood 60 cards 70-130 mm tall.
    for (const seed of [1, 2, 3]) {
      const placed: Resting[] = [];
      let top = 0;
      for (const at of messyLayout(60, { x: 0, y: 0, yaw: 0 }, 0, rng(seed))) {
        const r = restOn(at, placed.slice(-20));
        expect(minGap(at, r, placed.slice(-20))).toBeGreaterThanOrEqual(-1e-6);
        placed.push({ ...at, ...r });
        for (const s of [-CARD_W / 2, CARD_W / 2]) for (const t of [-CARD_H / 2, CARD_H / 2]) top = Math.max(top, bottomAt(r, s, t) + CARD_T);
      }
      expect(top).toBeLessThanOrEqual(60 * CARD_T + 1e-6);
    }
  });

  it('stays flat hanging off a tall stack while its center is over it, and tips once it is not', () => {
    const stack = [flat(0, 0, 30)];
    const held = restOn({ x: 20, y: 0, yaw: 0 }, stack);
    expect(Math.abs(slopesOf(held.tiltX, held.tiltY).gs)).toBeLessThan(1e-9);
    const tipped = restOn({ x: 40, y: 0, yaw: 0 }, stack);
    const gs = slopesOf(tipped.tiltX, tipped.tiltY).gs;
    expect(gs).toBeLessThan(-0.2);
    expect(Math.abs(gs)).toBeLessThanOrEqual(MAX_SLOPE + 1e-9);
  });

  it('never sinks into a messy heap of turned, tilted cards', () => {
    const random = rng(21);
    const placed: Resting[] = [];
    for (let i = 0; i < 30; i++) {
      const at = { x: (random() - 0.5) * 60, y: (random() - 0.5) * 60, yaw: (random() - 0.5) * 1.2 };
      const r = restOn(at, placed);
      expect(minGap(at, r, placed)).toBeGreaterThanOrEqual(-0.05);
      placed.push({ ...at, ...r });
    }
  });

  it('balanced on a ridge, tips the gentler way; caps the slope', () => {
    expect(restSlope([{ u: -44, z: 0 }, { u: 0, z: 5 }, { u: 44, z: 1 }])).toBeCloseTo(-4 / 44, 9);
    expect(Math.abs(restSlope([{ u: -44, z: 200 }, { u: 44, z: 0 }]))).toBe(MAX_SLOPE);
  });
});

describe('cards laid by an X spread (decision 160)', () => {
  it('lie flat while they stay where they were laid', () => {
    expect(laidFlat({ x: 10, y: 20, laidAt: { x: 10, y: 20 } })).toBe(true);
    // Saved and loaded: both rounded to the same thousandth.
    expect(laidFlat({ x: 10.0004, y: 20, laidAt: { x: 10, y: 20 } })).toBe(true);
  });

  it('rest normally once moved, or when never laid', () => {
    expect(laidFlat({ x: 15, y: 20, laidAt: { x: 10, y: 20 } })).toBe(false);
    expect(laidFlat({ x: 10, y: 20 })).toBe(false);
  });
});

describe('the hover pop (decision 174)', () => {
  const card = (z: number, x = 0, extra: Partial<{ tiltX: number; tiltY: number }> = {}) => ({ x, y: 0, z, yaw: 0, tiltX: 0, tiltY: 0, ...extra });

  it('pops a top card the usual 2 mm', () => {
    expect(popLift(card(CARD_T / 2), [card(CARD_T / 2, 200)])).toBe(POP_MIN);
  });

  it('lifts a buried card clear of every card lying on it', () => {
    const me = card(CARD_T / 2);
    const above = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => card(CARD_T / 2 + i * CARD_T, 20));
    const lift = popLift(me, above);
    // Its bottom ends up above the highest card's top.
    expect(me.z - CARD_T / 2 + lift).toBeGreaterThan(above[9].z + CARD_T / 2);
  });

  it('lifts the bottom card of a very tall stack above its top, with no limit (decision 347)', () => {
    const me = card(CARD_T / 2);
    const above = Array.from({ length: 400 }, (_, i) => card(CARD_T / 2 + (i + 1) * CARD_T));
    const lift = popLift(me, above);
    expect(lift).toBeGreaterThan(400 * CARD_T);
    expect(me.z - CARD_T / 2 + lift).toBeGreaterThan(above[399].z + CARD_T / 2);
  });

  it('allows for a tilted card above', () => {
    const me = card(CARD_T / 2);
    const flat = popLift(me, [card(CARD_T * 1.5, 20)]);
    const tilted = popLift(me, [card(CARD_T * 1.5, 20, { tiltX: 0.1 })]);
    expect(tilted).toBeGreaterThan(flat);
  });

  it('measures a slanted card above where it overlaps, not at its far high corner (decision 351)', () => {
    const me = card(CARD_T / 2);
    // Overlapping only along its low edge, rising away from the hovered card.
    const slanted = { x: 55, y: 0, z: CARD_T * 1.5 + 4, yaw: 0, tiltX: 0, tiltY: 0.15 };
    const lift = popLift(me, [slanted]);
    // Clear of it where they overlap...
    const edge = slanted.z + CARD_T / 2 - Math.tan(0.15) * (55 - CARD_W / 2) - 0.01;
    expect(me.z - CARD_T / 2 + lift).toBeGreaterThan(Math.min(edge, slanted.z));
    // ...but nowhere near its far corner, as the old measure had it.
    const old = slanted.z + CARD_T / 2 + Math.sin(0.15) * Math.hypot(CARD_W, CARD_H) / 2 - (me.z - CARD_T / 2) + 0.6;
    expect(lift).toBeLessThan(old - 3);
  });

  it('ignores cards below it and cards that do not overlap it', () => {
    expect(popLift(card(5), [card(1), card(30, 300)])).toBe(POP_MIN);
  });
});

describe('deep messy piles (decision 194)', () => {
  it('stay close to their stacked height instead of growing a tower', () => {
    const random = rng(7);
    const placed = messyLayout(450, { x: 0, y: 0, yaw: 0 }, 0, random);
    const resting: Resting[] = [];
    let top = 0;
    let sunk = 0;
    placed.forEach((c, k) => {
      const supports: Resting[] = [];
      for (let j = k - 1; j >= 0 && supports.length < 20; j--) if (overlaps(resting[j], c)) supports.push(resting[j]);
      const r = restCapped(c, supports, c.z);
      // No card under it shows through it (decision 355): its bottom clears every support at its center.
      for (const s of supports) {
        const dx = c.x - s.x, dy = c.y - s.y, cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
        const ls = dx * cs + dy * sn, lt = -dx * sn + dy * cs;
        if (Math.abs(ls) < 31.5 && Math.abs(lt) < 44 && r.z - CARD_T / 2 < bottomAt(s, ls, lt) + CARD_T - 0.01) sunk++;
      }
      resting.push({ x: c.x, y: c.y, yaw: c.yaw, ...r });
      top = Math.max(top, r.z);
    });
    // 450 cards are 135 mm of card; the pile may sit a little proud, but never a tower (about a meter before decision 194).
    expect(top).toBeLessThan(placed[449].z + 20);
    expect(sunk).toBe(0);
  });

  it('leaves an ordinary rest alone', () => {
    const rest = { z: 1, tiltX: 0.1, tiltY: 0 };
    expect(capRest(rest, 0.9)).toBe(rest);
    expect(capRest({ z: 50, tiltX: 0.4, tiltY: -0.2 }, 10)).toEqual({ z: 10 + REST_SLACK, tiltX: 0.2, tiltY: -0.1 });
  });
});
