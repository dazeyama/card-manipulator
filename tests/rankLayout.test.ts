import { describe, expect, it } from 'vitest';
import { CASCADE_STEP } from '../src/state/curve';
import { rankColumn, rankLayout, type RankCard } from '../src/state/rankLayout';

const card = (uid: string, value: number | undefined, creature = false): RankCard => ({ uid, name: uid, creature, value });
const at = (cards: RankCard[], mode: 'edhrec' | 'elo', split = false) => new Map(rankLayout(cards, { x: 0, y: 0 }, { mode, split }).map((p) => [p.uid, p.at]));

describe('rank view (decision 198)', () => {
  it('bands EDHREC ranks, widening as they go, the most played the best', () => {
    expect(rankColumn('edhrec', 1)).toBe(rankColumn('edhrec', 100));
    expect(rankColumn('edhrec', 101)).toBeLessThan(rankColumn('edhrec', 100));
    expect(rankColumn('edhrec', 250)).toBe(rankColumn('edhrec', 101));
    expect(rankColumn('edhrec', 20001)).toBeLessThan(rankColumn('edhrec', 20000));
    expect(rankColumn('edhrec', 90000)).toBe(rankColumn('edhrec', 20001));
    expect(rankColumn('edhrec', undefined)).toBe(-Infinity);
  });

  it('buckets Elo in steps of 50', () => {
    expect(rankColumn('elo', 1050)).toBe(1050);
    expect(rankColumn('elo', 1099.9)).toBe(1050);
    expect(rankColumn('elo', 1100)).toBe(1100);
  });

  it('runs from the least valued on the left to the best on the right, unknowns first', () => {
    const e = at([card('solring', 1), card('mid', 3000), card('obscure', 25000), card('none', undefined)], 'edhrec');
    expect(e.get('none')!.x).toBeLessThan(e.get('obscure')!.x);
    expect(e.get('obscure')!.x).toBeLessThan(e.get('mid')!.x);
    expect(e.get('mid')!.x).toBeLessThan(e.get('solring')!.x);
    const l = at([card('low', 1060), card('high', 1520), card('mid', 1300)], 'elo');
    expect(l.get('low')!.x).toBeLessThan(l.get('mid')!.x);
    expect(l.get('mid')!.x).toBeLessThan(l.get('high')!.x);
  });

  it('cascades each column 22 mm, its best card at the top', () => {
    const l = at([card('b', 1310), card('a', 1340), card('c', 1301)], 'elo');
    expect(l.get('a')!.x).toBe(l.get('b')!.x);
    expect(l.get('a')!.y - l.get('b')!.y).toBeCloseTo(CASCADE_STEP, 9);
    expect(l.get('b')!.y - l.get('c')!.y).toBeCloseTo(CASCADE_STEP, 9);
  });

  it('puts creatures above non-creatures when Split creatures is on', () => {
    const l = at([card('bear', 1200, true), card('bolt', 1200)], 'elo', true);
    expect(l.get('bear')!.x).toBe(l.get('bolt')!.x);
    expect(l.get('bear')!.y).toBeGreaterThan(l.get('bolt')!.y + 88);
  });
});
