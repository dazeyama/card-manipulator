import { describe, expect, it } from 'vitest';
import { HIDDEN, hiddenRow, visibleTo } from '../src/online/hidden';
import { tableOfDoc, validateDoc } from '../src/io/saveFile';
import { CARD_H, type Mat, type TableDoc } from '../src/state/types';

function stand(uid: string, owner?: string): Mat {
  return { uid, kind: 'stand', scryfallId: '', name: 'Sam', art: '', x: 0, y: 0, yaw: 0, ...(owner ? { owner } : {}) };
}

describe('who may know a card (ONLINE.md 7.1)', () => {
  const mats = new Map<string, Mat>([['s1', stand('s1', 'me')], ['s2', stand('s2', 'sam')], ['s3', stand('s3')]]);

  it('shows a face-up card on no stand to everyone', () => {
    expect(visibleTo({ scryfallId: 'x', faceUp: true }, mats, 'me')).toBe(true);
    expect(visibleTo({ scryfallId: 'x', faceUp: true }, mats, 'sam')).toBe(true);
  });

  it('hides every face-down card off your own stand, yours included (O30)', () => {
    expect(visibleTo({ scryfallId: 'x', faceUp: false }, mats, 'me')).toBe(false);
  });

  it('shows a stand’s cards to its owner only, face up or down (O29)', () => {
    expect(visibleTo({ scryfallId: 'x', faceUp: true, stand: 's1' }, mats, 'me')).toBe(true);
    expect(visibleTo({ scryfallId: 'x', faceUp: false, stand: 's1' }, mats, 'me')).toBe(true);
    expect(visibleTo({ scryfallId: 'x', faceUp: true, stand: 's2' }, mats, 'me')).toBe(false);
  });

  it('hides an unowned stand’s cards from everyone (O65)', () => {
    expect(visibleTo({ scryfallId: 'x', faceUp: true, stand: 's3' }, mats, 'me')).toBe(false);
    expect(visibleTo({ scryfallId: 'x', faceUp: true, stand: 'gone' }, mats, 'me')).toBe(false);
  });

  it('never shows a card whose identity is HIDDEN', () => {
    expect(visibleTo({ scryfallId: HIDDEN, faceUp: true }, mats, 'me')).toBe(false);
    expect(visibleTo({ scryfallId: HIDDEN, faceUp: true, stand: 's1' }, mats, 'me')).toBe(false);
  });

  it('shows the cards of my own search, face down too, and only mine (decision 310)', () => {
    const mine = new Set(['c1']);
    expect(visibleTo({ uid: 'c1', scryfallId: 'x', faceUp: false }, mats, 'me', mine)).toBe(true);
    expect(visibleTo({ uid: 'c2', scryfallId: 'x', faceUp: false }, mats, 'me', mine)).toBe(false);
    expect(visibleTo({ uid: 'c1', scryfallId: HIDDEN, faceUp: false }, mats, 'me', mine)).toBe(false);
  });
});

describe('hidden cards after a sorted layout (7.3)', () => {
  it('lays them in a row under the layout, from its left edge', () => {
    const laid = [{ x: 0, y: 0, yaw: 0, z: 0 }, { x: 100, y: -22, yaw: 0, z: 0 }];
    const row = hiddenRow(laid, 3, { x: 50, y: 0 });
    expect(row.length).toBe(3);
    expect(row.every((p) => p.y === -22 - CARD_H - 16)).toBe(true);
    expect(row.map((p) => p.x)).toEqual([0, 24, 48]);
  });

  it('centres the row where the cards were when every card is hidden', () => {
    const row = hiddenRow([], 3, { x: 100, y: 50 });
    expect(row.map((p) => p.x)).toEqual([76, 100, 124]);
    expect(row.every((p) => p.y === 50)).toBe(true);
    expect(hiddenRow([], 0, { x: 0, y: 0 })).toEqual([]);
  });
});

describe('a saved copy with hidden cards (7.5, O75)', () => {
  const doc: TableDoc = {
    format: 'card-manipulator-table', version: 1, name: 'Copy', savedAt: '', settings: {}, camera: { target: [0, 0, 0], distance: 900, pitch: 55, yaw: 0 },
    piles: [],
    cards: [
      { uid: 'a', scryfallId: 'real', finish: 'foil', x: 0, y: 0, z: 0, yaw: 0, faceUp: true, pileId: null },
      { uid: 'b', scryfallId: HIDDEN, finish: 'nonfoil', x: 0, y: 0, z: 0, yaw: 0, faceUp: false, pileId: null, hidden: true },
    ],
    cardData: {},
  };

  it('is a valid table file', () => {
    expect(validateDoc(doc)).toBeNull();
  });

  it('loads hidden cards as unknowable backs and the rest as they were', () => {
    const t = tableOfDoc(doc);
    expect(t.cards.find((c) => c.uid === 'a')).toMatchObject({ scryfallId: 'real', finish: 'foil' });
    const b = t.cards.find((c) => c.uid === 'b')!;
    expect(b).toMatchObject({ scryfallId: HIDDEN, finish: 'nonfoil' });
    expect('hidden' in b).toBe(false);
  });
});
