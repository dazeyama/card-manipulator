import { describe, expect, it } from 'vitest';
import { colourColumn, colourLayout, type ColourCard } from '../src/state/colourLayout';

const card = (uid: string, colours: string[], mv = 1, extra: Partial<ColourCard> = {}): ColourCard => ({ uid, name: uid, mv, land: false, creature: false, colours, ...extra });

describe('colour view, C C (decision 217)', () => {
  it('puts each card in W U B R G, colourless, multicolour or lands', () => {
    expect(colourColumn(card('a', ['W']))).toBe(0);
    expect(colourColumn(card('a', ['G']))).toBe(4);
    expect(colourColumn(card('a', []))).toBe(5);
    expect(colourColumn(card('a', ['U', 'R']))).toBe(6);
    expect(colourColumn(card('a', ['G'], 0, { land: true }))).toBe(7);
  });

  it('lays out only the columns used, left to right in that order', () => {
    const spots = colourLayout([card('land', [], 0, { land: true }), card('red', ['R']), card('white', ['W']), card('gold', ['W', 'B'])], { x: 0, y: 0 }, { split: false });
    const x = new Map(spots.map((s) => [s.uid, s.at.x]));
    expect(x.get('white')!).toBeLessThan(x.get('red')!);
    expect(x.get('red')!).toBeLessThan(x.get('gold')!);
    expect(x.get('gold')!).toBeLessThan(x.get('land')!);
    // Four columns, centred.
    expect((x.get('white')! + x.get('land')!) / 2).toBeCloseTo(0, 6);
  });

  it('runs each column cheapest first, then by name, cascading down', () => {
    const spots = colourLayout([card('b', ['U'], 3), card('a', ['U'], 3), card('c', ['U'], 1)], { x: 0, y: 0 }, { split: false });
    expect(spots.map((s) => s.uid)).toEqual(['c', 'a', 'b']);
    expect(spots[0].at.y).toBeGreaterThan(spots[1].at.y);
  });

  it('puts creatures in their own band above with Split on', () => {
    const spots = colourLayout([card('spell', ['W']), card('bear', ['W'], 2, { creature: true })], { x: 0, y: 0 }, { split: true });
    const y = new Map(spots.map((s) => [s.uid, s.at.y]));
    expect(y.get('bear')!).toBeGreaterThan(y.get('spell')!);
  });
});
