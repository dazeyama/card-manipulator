import { describe, expect, it } from 'vitest';
import { diffCards, sameTable, snapshot } from '../src/state/history';
import { Store } from '../src/state/store';
import type { Card } from '../src/state/types';

const card = (uid: string, x = 0, extra: Partial<Card> = {}): Card => ({ uid, scryfallId: 's' + uid, finish: 'nonfoil', x, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...extra });

describe('one-step undo snapshots (decision 204)', () => {
  it('keeps a copy that later changes do not touch', () => {
    const store = new Store();
    store.addCards([card('a'), card('b', 100)]);
    const before = snapshot(store);
    store.moveCards([{ uid: 'a', x: 50, faceUp: false }]);
    expect(before.cards.find((c) => c.uid === 'a')).toMatchObject({ x: 0, faceUp: true });
  });

  it('finds the cards to move back, add back and take away', () => {
    const store = new Store();
    store.addCards([card('a'), card('b', 100), card('gone', 200)]);
    const before = snapshot(store);
    store.moveCards([{ uid: 'a', x: 50 }]);
    store.removeCards(['gone']);
    store.addCards([card('new', 300)]);
    const d = diffCards(snapshot(store), before);
    expect(d.move.map((c) => [c.uid, c.x])).toEqual([['a', 0]]);
    expect(d.add.map((c) => c.uid)).toEqual(['gone']);
    expect(d.remove).toEqual(['new']);
  });

  it('notices a turn, a flip, a pile change, a lie-flat mark and a playmat move', () => {
    const store = new Store();
    store.addCards([card('a')]);
    store.addMat({ uid: 'm', scryfallId: 'x', name: 'Mat', art: '', x: 0, y: 0, yaw: 0 });
    const before = snapshot(store);
    expect(sameTable(before, snapshot(store))).toBe(true);
    store.cards.get('a')!.laidAt = { x: 0, y: 0 };
    expect(sameTable(before, snapshot(store))).toBe(false);
    store.cards.get('a')!.laidAt = undefined;
    store.moveMat('m', 10, 0, 0);
    expect(sameTable(before, snapshot(store))).toBe(false);
    store.moveMat('m', 0, 0, 0);
    store.moveCards([{ uid: 'a', yaw: 1 }]);
    expect(diffCards(snapshot(store), before).move).toHaveLength(1);
  });
});
