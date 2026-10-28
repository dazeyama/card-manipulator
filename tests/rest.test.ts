import { describe, expect, it } from 'vitest';
import { rng } from '../src/state/piles';
import { bottomAt, MAX_SLOPE, restOn, restSlope, SAG_MAX, slopesOf, tiltFor, type Resting } from '../src/state/rest';
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

describe('resting tilt (decision 99)', () => {
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

  it('droops onto the table when it hangs a little off a card', () => {
    // Offset 5 mm across: the card touches the table on the free side.
    const at = { x: 5, y: 0, yaw: 0 };
    const supports = [flat(0, 0, CARD_T / 2)];
    const r = restOn(at, supports);
    const { gs, gt } = slopesOf(r.tiltX, r.tiltY);
    expect(gs).toBeLessThan(0);
    expect(Math.abs(gs)).toBeLessThanOrEqual(SAG_MAX);
    expect(Math.abs(gt)).toBeLessThan(1e-6);
    expect(bottomAt(r, CARD_W / 2, 0)).toBeCloseTo(0, 6);
    expect(minGap(at, r, supports)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('keeps a fanned stack low: a 40-card ribbon stays a few mm tall, not 12 mm', () => {
    const placed: Resting[] = [];
    let top = 0;
    for (let i = 0; i < 40; i++) {
      const at = { x: i * 5, y: 0, yaw: 0 };
      const r = restOn(at, placed.filter((c) => Math.abs(c.x - at.x) < CARD_W));
      expect(minGap(at, r, placed)).toBeGreaterThanOrEqual(-1e-6);
      placed.push({ ...at, ...r });
      for (const s of [-CARD_W / 2, CARD_W / 2]) top = Math.max(top, bottomAt(r, s, 0) + CARD_T);
    }
    expect(top).toBeLessThan(6);
  });

  it('stays flat hanging off a tall stack while its centre is over it, and tips once it is not', () => {
    const stack = [flat(0, 0, 30)];
    const held = restOn({ x: 20, y: 0, yaw: 0 }, stack);
    expect(Math.abs(slopesOf(held.tiltX, held.tiltY).gs)).toBeLessThan(1e-9);
    const tipped = restOn({ x: 40, y: 0, yaw: 0 }, stack);
    const gs = slopesOf(tipped.tiltX, tipped.tiltY).gs;
    expect(gs).toBeLessThan(-SAG_MAX);
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

  it('droops toward the lower side off a ridge, and caps the slope', () => {
    expect(restSlope([{ u: -44, z: 0 }, { u: 0, z: 5 }, { u: 44, z: 1 }])).toBeCloseTo(5 / 44, 9);
    expect(Math.abs(restSlope([{ u: -44, z: 200 }, { u: 44, z: 0 }]))).toBe(MAX_SLOPE);
  });
});
