import { describe, expect, it } from 'vitest';
import { changedByMe, foldInto } from '../src/undo';
import { Store } from '../src/state/store';
import { snapshot } from '../src/state/history';
import type { Card } from '../src/state/types';

const card = (uid: string, x = 0): Card => ({ uid, scryfallId: 's' + uid, finish: 'nonfoil', x, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null });

describe('undo online takes back only your own action (ONLINE.md 8.6, O41)', () => {
  it('folds another player\'s change into the kept table, leaving yours to undo', () => {
    const store = new Store();
    store.addCards([card('mine'), card('theirs', 100), card('gone', 200)]);
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }]);
    const kept = snapshot(store);
    // My action, then someone else's arrives.
    store.moveCards([{ uid: 'mine', x: 50 }]);
    store.moveCards([{ uid: 'theirs', x: 999 }]);
    store.removeCards(['gone']);
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 6 }]);
    foldInto(kept, { t: 'batch', ops: [{ t: 'move', moves: [{ uid: 'theirs', x: 999 }] }, { t: 'remove', uids: ['gone'] }, { t: 'dice', set: [{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 6 }] }] }, store);
    const by = new Map(kept.cards.map((c) => [c.uid, c]));
    expect(by.get('mine')!.x).toBe(0);
    expect(by.get('theirs')!.x).toBe(999);
    expect(by.has('gone')).toBe(false);
    expect(kept.dice[0].value).toBe(6);
  });

  it('knows when someone else touches what your last action changed', () => {
    const store = new Store();
    store.addCards([card('mine'), card('other', 100)]);
    const kept = snapshot(store);
    store.moveCards([{ uid: 'mine', x: 50 }]);
    // Before their op is applied: theirs touches only the other card, then yours.
    expect(changedByMe(kept, { t: 'move', moves: [{ uid: 'other', x: 9 }] }, store)).toBe(false);
    expect(changedByMe(kept, { t: 'move', moves: [{ uid: 'mine', x: 9 }] }, store)).toBe(true);
  });

  it('keeps the dice in the store\'s order when folding (review 9)', () => {
    const store = new Store();
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }, { uid: 'd2', x: 30, y: 0, z: 10, yaw: 0, value: 2 }]);
    const kept = snapshot(store);
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 5 }]);
    foldInto(kept, { t: 'dice', set: [{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 5 }] }, store);
    expect(kept.dice.map((d) => d.uid)).toEqual(['d1', 'd2']);
    expect(JSON.stringify(kept.dice)).toBe(JSON.stringify([...store.dice.values()]));
  });
});
