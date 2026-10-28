import { describe, expect, it } from 'vitest';
import { CASCADE_STEP, colourGroup, curveLayout, type CurveCard } from '../src/state/curve';

const card = (uid: string, mv: number, extra: Partial<CurveCard> = {}): CurveCard => ({ uid, name: uid, mv, land: false, creature: false, group: 'R', ...extra });

describe('curve layout (decision 107)', () => {
  it('puts each mana value in its own column, left to right, lands first', () => {
    const cards = [card('bolt', 1), card('helix', 2), card('wall', 2), card('mountain', 0, { land: true }), card('dragon', 9)];
    const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour: false, split: false }).map((p) => [p.uid, p.at]));
    expect(at.get('mountain')!.x).toBeLessThan(at.get('bolt')!.x);
    expect(at.get('bolt')!.x).toBeLessThan(at.get('helix')!.x);
    expect(at.get('helix')!.x).toBe(at.get('wall')!.x);
    // 9 shares the 7+ column, which comes last.
    expect(at.get('dragon')!.x).toBeGreaterThan(at.get('helix')!.x);
  });

  it('cascades a column down the table in name order, one title bar apart', () => {
    const cards = [card('c', 2), card('a', 2), card('b', 2)];
    const order = curveLayout(cards, { x: 0, y: 0 }, { byColour: false, split: false });
    expect(order.map((p) => p.uid)).toEqual(['a', 'b', 'c']);
    expect(order[0].at.y - order[1].at.y).toBeCloseTo(CASCADE_STEP, 9);
    expect(order[1].at.y - order[2].at.y).toBeCloseTo(CASCADE_STEP, 9);
  });

  it('stacks lands neatly on one spot', () => {
    const cards = [card('m1', 0, { land: true }), card('m2', 0, { land: true }), card('m3', 0, { land: true })];
    const spots = curveLayout(cards, { x: 0, y: 0 }, { byColour: false, split: false }).map((p) => `${p.at.x},${p.at.y}`);
    expect(new Set(spots).size).toBe(1);
  });

  it('splits creatures above non-creatures when asked', () => {
    const cards = [card('bear', 2, { creature: true }), card('shock', 2)];
    const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour: false, split: true }).map((p) => [p.uid, p.at]));
    expect(at.get('bear')!.x).toBe(at.get('shock')!.x);
    expect(at.get('bear')!.y).toBeGreaterThan(at.get('shock')!.y + 88);
  });

  it('sorts by colour into rows top to bottom in cube order, with columns lined up', () => {
    const cards = [card('g2', 2, { group: 'G' }), card('w3', 3, { group: 'W' }), card('w2', 2, { group: 'W' }), card('gold', 2, { group: 'multi' })];
    const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour: true, split: false }).map((p) => [p.uid, p.at]));
    expect(at.get('w2')!.y).toBeGreaterThan(at.get('g2')!.y);
    expect(at.get('g2')!.y).toBeGreaterThan(at.get('gold')!.y);
    expect(at.get('w2')!.x).toBe(at.get('g2')!.x);
    expect(at.get('w3')!.x).toBeGreaterThan(at.get('w2')!.x);
  });

  it('centres the layout on the spot', () => {
    const cards = [card('a', 1), card('b', 3)];
    const xs = curveLayout(cards, { x: 500, y: -200 }, { byColour: false, split: false }).map((p) => p.at.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(500, 9);
  });

  it('groups colours like a cube list', () => {
    expect(colourGroup(['R'], false)).toBe('R');
    expect(colourGroup(['W', 'U'], false)).toBe('multi');
    expect(colourGroup([], false)).toBe('colourless');
    expect(colourGroup(['G'], true)).toBe('land');
  });
});
