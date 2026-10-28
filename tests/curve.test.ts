import { describe, expect, it } from 'vitest';
import { CASCADE_STEP, colourGroup, curveLayout, GUILDS, landColumn, type CurveCard } from '../src/state/curve';

const card = (uid: string, mv: number, extra: Partial<CurveCard> = {}): CurveCard => ({ uid, name: uid, mv, land: false, creature: false, group: 'R', identity: [], ...extra });
const land = (uid: string, identity: string[]): CurveCard => card(uid, 0, { land: true, group: 'land', identity });

describe('curve layout (decision 107)', () => {
  it('puts each mana value in its own column, left to right', () => {
    const cards = [card('bolt', 1), card('helix', 2), card('wall', 2), card('dragon', 9)];
    const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour: false, split: false }).map((p) => [p.uid, p.at]));
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

  it('puts lands in a row underneath, a cascading column per colour identity (decision 149)', () => {
    const cards = [
      card('bolt', 1),
      land('temple', ['U', 'W']),
      land('tundra', ['W', 'U']),
      land('godless', ['W', 'B']),
      land('breeding', ['G', 'U']),
      land('triome', ['W', 'U', 'B']),
      land('mountain', ['R']),
      land('wastes', []),
    ];
    for (const split of [false, true]) {
      for (const byColour of [false, true]) {
        const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour, split }).map((p) => [p.uid, p.at]));
        // Under every spell.
        for (const l of cards.filter((c) => c.land)) expect(at.get(l.uid)!.y).toBeLessThan(at.get('bolt')!.y - 88);
        // Azorius (one column, cascading by name), Orzhov, Simic, three colours, then one colour and colourless together.
        expect(at.get('temple')!.x).toBe(at.get('tundra')!.x);
        expect(at.get('temple')!.y - at.get('tundra')!.y).toBeCloseTo(CASCADE_STEP, 9);
        expect(at.get('tundra')!.x).toBeLessThan(at.get('godless')!.x);
        expect(at.get('godless')!.x).toBeLessThan(at.get('breeding')!.x);
        expect(at.get('breeding')!.x).toBeLessThan(at.get('triome')!.x);
        expect(at.get('triome')!.x).toBeLessThan(at.get('mountain')!.x);
        expect(at.get('mountain')!.x).toBe(at.get('wastes')!.x);
      }
    }
  });

  it('gives each land a column: the guilds in order, then 3+ colours, then one colour or none', () => {
    expect(GUILDS.map((g) => landColumn(g.split('')))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(landColumn(['U', 'G'])).toBe(9);
    expect(landColumn(['W', 'U', 'B', 'R', 'G'])).toBe(10);
    expect(landColumn(['G'])).toBe(11);
    expect(landColumn([])).toBe(11);
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

  it('lays colours out two to a row: W U, then B R, then G colourless, then multicolour, then lands', () => {
    const groups = ['W', 'U', 'B', 'R', 'G', 'colourless', 'multi', 'land'] as const;
    const cards = groups.map((g) => card(g, 2, { group: g, land: g === 'land' }));
    const at = new Map(curveLayout(cards, { x: 0, y: 0 }, { byColour: true, split: false }).map((p) => [p.uid, p.at]));
    const left = at.get('W')!.x, right = at.get('U')!.x;
    expect(right).toBeGreaterThan(left);
    for (const [l, r] of [['W', 'U'], ['B', 'R'], ['G', 'colourless']]) {
      expect(at.get(l)!.x).toBeCloseTo(left, 9);
      expect(at.get(r)!.x).toBeCloseTo(right, 9);
      expect(at.get(l)!.y).toBeCloseTo(at.get(r)!.y, 9);
    }
    expect(at.get('W')!.y).toBeGreaterThan(at.get('B')!.y);
    expect(at.get('B')!.y).toBeGreaterThan(at.get('G')!.y);
    expect(at.get('G')!.y).toBeGreaterThan(at.get('multi')!.y);
    expect(at.get('multi')!.x).toBeCloseTo(left, 9);
    expect(at.get('multi')!.y).toBeGreaterThan(at.get('land')!.y);
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
