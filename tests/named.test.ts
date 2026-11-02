import { describe, expect, it } from 'vitest';
import { clearSpot, NamedPiles } from '../src/named';
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

function setup(): { store: Store; named: NamedPiles; away: string[][] } {
  const store = new Store();
  store.addRecords([record('elf', 'Creature — Elf'), record('forest', 'Basic Land — Forest')]);
  const cards: Card[] = ['elf', 'elf', 'forest'].map((id, i) => ({
    uid: `u${i}`, scryfallId: id, finish: 'nonfoil', x: 0, y: 0, z: 0.15 + i * 0.3, yaw: 0, faceUp: true, pileId: null, spreadOf: null,
  }));
  store.addCards(cards);
  redetect(store);
  const named = new NamedPiles({ store, motion: { held: new Set() } } as unknown as App);
  // Turning cards away animates them on the table; here it only records which.
  const away: string[][] = [];
  named.turnAway = (uids) => void away.push(uids);
  return { store, named, away };
}

/** A pile named Keep with the filter t:creature, holding the two elves (u2, the forest, turned away and moved off). */
function keep(): { store: Store; named: NamedPiles; away: string[][]; id: string } {
  const s = setup();
  const id = [...s.store.piles.values()][0].id;
  s.named.promote(id, 'Keep', 't:creature');
  s.store.moveCards([{ uid: 'u2', x: 500, y: 0, pileId: null }]);
  redetect(s.store);
  s.named.keepFilters();
  s.away.length = 0;
  return { ...s, id };
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

  it('a new filter turns away the cards already in the pile that do not match (decision 322)', () => {
    const { store, named, away } = setup();
    const pile = [...store.piles.values()][0];
    named.promote(pile.id, 'Keep', 't:creature');
    expect(away).toEqual([['u2']]);
  });

  it('turns away a card brought into a filtered pile by any move, not only a drop (decision 322)', () => {
    const { store, named, away, id } = keep();
    // A layout, a sweep, a toss or a draw all end in a move like this one.
    store.moveCards([{ uid: 'u2', x: 4, y: 3, z: 0.75 }]);
    redetect(store);
    expect(store.cards.get('u2')!.pileId).toBe(id);
    named.keepFilters();
    expect(away).toEqual([['u2']]);
  });

  it('turns away a spawned or pasted card that lands in a filtered pile', () => {
    const { store, named, away } = keep();
    store.addCards([{ uid: 'n1', scryfallId: 'forest', finish: 'nonfoil', x: 2, y: 2, z: 0.9, yaw: 0, faceUp: true, pileId: null, spreadOf: null }]);
    redetect(store);
    named.keepFilters();
    expect(away).toEqual([['n1']]);
  });

  it('takes in a matching card without turning anything away', () => {
    const { store, named, away, id } = keep();
    store.addCards([{ uid: 'n2', scryfallId: 'elf', finish: 'nonfoil', x: 2, y: 2, z: 0.9, yaw: 0, faceUp: true, pileId: null, spreadOf: null }]);
    redetect(store);
    named.keepFilters();
    expect(away).toEqual([]);
    expect(store.cards.get('n2')!.pileId).toBe(id);
  });

  it('leaves a pile resting against a filtered one whole, turning nothing away (decision 324)', () => {
    const { store, named, away, id } = keep();
    store.addCards([{ uid: 'f2', scryfallId: 'forest', finish: 'nonfoil', x: 520, y: 0, z: 0.45, yaw: 0, faceUp: true, pileId: null, spreadOf: null }]);
    redetect(store);
    const forests = store.cards.get('u2')!.pileId!;
    // The forests' pile, slid over against Keep, then an elf put down touching both.
    store.moveCards([{ uid: 'u2', x: 60, y: 0 }, { uid: 'f2', x: 70, y: 0 }]);
    redetect(store);
    store.addCards([{ uid: 'e3', scryfallId: 'elf', finish: 'nonfoil', x: 30, y: 0, z: 0.9, yaw: 0, faceUp: true, pileId: null, spreadOf: null }]);
    redetect(store);
    named.keepFilters();
    expect(away).toEqual([]);
    expect(store.cards.get('e3')!.pileId).toBe(id);
    expect(store.cards.get('u2')!.pileId).toBe(forests);
    expect(store.cards.get('f2')!.pileId).toBe(forests);
  });

  it('leaves another player\'s change and a loaded table alone', () => {
    const { store, named, away } = keep();
    store.remote(() => store.moveCards([{ uid: 'u2', x: 4, y: 3, z: 0.75 }]));
    redetect(store);
    named.keepFilters();
    expect(away).toEqual([]);
    store.replaceTable(store.table());
    redetect(store);
    named.keepFilters();
    expect(away).toEqual([]);
  });

  it('turns cards away to the first clear spot beside the pile', () => {
    // Clear on the right: one card's width and a gap out.
    expect(clearSpot({ x: 0, y: 0 }, 0, [])).toEqual({ x: 91, y: 0 });
    // A card there: the left side.
    expect(clearSpot({ x: 0, y: 0 }, 0, [{ x: 91, y: 0 }])).toEqual({ x: -91, y: 0 });
    // Both taken: one step further right.
    expect(clearSpot({ x: 0, y: 0 }, 0, [{ x: 91, y: 0 }, { x: -91, y: 0 }])).toEqual({ x: 174, y: 0 });
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

  it('a named pile left with no cards goes (decision 328)', () => {
    const { store, named } = setup();
    const pile = [...store.piles.values()][0];
    named.promote(pile.id, 'Keep', null);
    named.dropEmpty();
    expect(store.named.has(pile.id)).toBe(true);
    store.removeCards(['u0', 'u1', 'u2']);
    redetect(store);
    named.dropEmpty();
    expect(store.named.size).toBe(0);
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
