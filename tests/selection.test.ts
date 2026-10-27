import { describe, expect, it } from 'vitest';
import { Store } from '../src/state/store';
import { applyQuery, runQuery, selectAll, summarize, toggle } from '../src/state/selection';
import type { Card, CardRecord } from '../src/state/types';

function record(id: string, p: Partial<CardRecord>): CardRecord {
  return {
    id, oracle_id: id, name: id, set: 'tst', set_name: 'Test', collector_number: '1', rarity: 'common', lang: 'en', layout: 'normal',
    mana_cost: '', cmc: 0, type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], keywords: [], produced_mana: [],
    legalities: {}, finishes: ['nonfoil'], prices: { usd: null, usd_foil: null }, faces: [], fetched_at: 0, ...p,
  };
}

function table(): Store {
  const s = new Store();
  s.addRecords([
    record('bolt', { type_line: 'Instant', colors: ['R'], cmc: 1 }),
    record('goblin', { colors: ['R'], cmc: 2 }),
    record('elf', { colors: ['G'], cmc: 1 }),
    record('angel', { colors: ['W'], cmc: 5 }),
    record('forest', { type_line: 'Basic Land — Forest', cmc: 0 }),
  ]);
  const cards: Card[] = ['bolt', 'goblin', 'elf', 'angel', 'forest', 'bolt'].map((id, i) => ({
    uid: `u${i}`, scryfallId: id, finish: 'nonfoil', x: i * 70, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null,
  }));
  s.addCards(cards);
  return s;
}

describe('refine and table search (spec 9.3, 9.6)', () => {
  it('searches the whole table when nothing is selected', () => {
    const s = table();
    const out = applyQuery(s, 'c:r');
    expect(out.ok && out.scope).toBe(6);
    expect([...s.selection].sort()).toEqual(['u0', 'u1', 'u5']);
  });

  it('refines only within the selection, and chains', () => {
    const s = table();
    s.setSelection(['u0', 'u2', 'u3']);
    expect(runQuery(s, 'mv<=1')).toMatchObject({ ok: true, scope: 3, matches: ['u0', 'u2'] });
    applyQuery(s, 'mv<=1');
    expect([...s.selection]).toEqual(['u0', 'u2']);
    applyQuery(s, 'c:g');
    expect([...s.selection]).toEqual(['u2']);
  });

  it('leaves the selection alone on an error', () => {
    const s = table();
    s.setSelection(['u0']);
    const out = applyQuery(s, 'art:x');
    expect(out.ok).toBe(false);
    expect([...s.selection]).toEqual(['u0']);
  });

  it('is:selected sees the selection', () => {
    const s = table();
    s.setSelection(['u3']);
    expect(runQuery(s, 'is:selected', 'table')).toMatchObject({ matches: ['u3'] });
  });
});

describe('select all and toggle', () => {
  it('selects everything and toggles groups', () => {
    const s = table();
    selectAll(s);
    expect(s.selection.size).toBe(6);
    toggle(s, ['u0', 'u1']);
    expect(s.selection.has('u0')).toBe(false);
    toggle(s, ['u0']);
    expect(s.selection.has('u0')).toBe(true);
  });
});

describe('summarize (HUD)', () => {
  it('counts colour pips, colourless and a mana value histogram without lands', () => {
    const s = table();
    selectAll(s);
    const sum = summarize(s);
    expect(sum.count).toBe(6);
    expect(sum.pips).toEqual({ W: 1, U: 0, B: 0, R: 3, G: 1, C: 1 });
    expect(sum.mv).toEqual([0, 3, 1, 0, 0, 1, 0, 0]);
    expect(sum.loose).toBe(6);
    expect(sum.piles).toBe(0);
  });
});
