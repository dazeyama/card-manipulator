import { describe, expect, it } from 'vitest';
import { NamedPiles } from '../src/named';
import { Store } from '../src/state/store';
import { redetect } from '../src/state/pileSync';
import type { App } from '../src/app';
import type { Card, CardRecord } from '../src/state/types';

function record(id: string, type: string): CardRecord {
  return {
    id, oracle_id: id, name: id, set: 'tst', set_name: 'Test', collector_number: '1', rarity: 'common', lang: 'en', layout: 'normal',
    mana_cost: '', cmc: 1, type_line: type, oracle_text: '', colors: [], color_identity: [], keywords: [], produced_mana: [],
    legalities: {}, finishes: ['nonfoil'], prices: { usd: null, usd_foil: null }, faces: [], fetched_at: 0,
  };
}

function setup(): { store: Store; named: NamedPiles } {
  const store = new Store();
  store.addRecords([record('elf', 'Creature — Elf'), record('forest', 'Basic Land — Forest')]);
  const cards: Card[] = ['elf', 'elf', 'forest'].map((id, i) => ({
    uid: `u${i}`, scryfallId: id, finish: 'nonfoil', x: 0, y: 0, z: 0.15 + i * 0.3, yaw: 0, faceUp: true, pileId: null, spreadOf: null,
  }));
  store.addCards(cards);
  redetect(store);
  const named = new NamedPiles({ store } as unknown as App);
  return { store, named };
}

describe('named piles (spec 11.3)', () => {
  it('promotes a pile, keeps it through re-detection, and answers pile:', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    expect(named.promote(pile.id, 'Keep', 't:creature')).toBeNull();
    redetect(store);
    expect(store.piles.get(pile.id)?.name).toBe('Keep');
    expect(store.cards.get('u0')!.pileId).toBe(pile.id);
  });

  it('rejects bad names and filters', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    expect(named.promote(pile.id, '  ', null)).toMatch(/needs a name/);
    expect(named.promote(pile.id, 'Keep', 'art:x')).toMatch(/Not supported/);
    named.createEmpty('Sell', { x: 500, y: 0 });
    expect(named.promote(pile.id, 'sell', null)).toMatch(/already a pile called Sell/);
  });

  it('sorts dropped cards by the pile filter', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    named.promote(pile.id, 'Keep', 't:creature');
    expect(named.sort(pile.id, ['u0', 'u1', 'u2'])).toEqual({ accepted: ['u0', 'u1'], rejected: ['u2'] });
  });

  it('an emptied named pile stays as an outline until deleted (decision 27)', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    named.promote(pile.id, 'Keep', null);
    store.removeCards(['u0', 'u1', 'u2']);
    redetect(store);
    expect(named.empty().map((n) => n.name)).toEqual(['Keep']);
    expect(named.outlineAt(10, 20)?.name).toBe('Keep');
    expect(named.outlineAt(200, 0)).toBeNull();
    named.remove(pile.id);
    expect(named.empty()).toEqual([]);
  });

  it('un-naming makes it an ordinary pile again', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    named.promote(pile.id, 'Keep', null);
    named.unname(pile.id);
    redetect(store);
    expect(store.named.size).toBe(0);
    expect(store.piles.get(pile.id)?.name ?? null).toBeNull();
  });
});
