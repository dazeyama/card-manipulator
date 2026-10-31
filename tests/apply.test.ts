import { describe, expect, it } from 'vitest';
import { applyOp, copyTable } from '../shared/apply';
import type { Op } from '../shared/ops';
import type { TableState } from '../shared/table';
import { applyToStore } from '../src/online/inbox';
import { Store } from '../src/state/store';
import { defaultBasics } from '../src/state/basics';
import type { Card } from '../src/state/types';

const card = (uid: string, x = 0, extra: Partial<Card> = {}): Card => ({ uid, scryfallId: 's' + uid, finish: 'nonfoil', x, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...extra });

/** A table with a bit of everything: loose cards, a spread, cards on a stand, a named pile, mats and dice. */
function build(): Store {
  const store = new Store();
  store.setName('Room table');
  store.addCards([card('a'), card('b', 100, { pileId: 'p1' }), card('c', 200, { spreadOf: 's1', laidAt: { x: 200, y: 0 } }), card('d', 300, { stand: 'st', side: 1 }), card('e', 310, { stand: 'st', faceUp: false })]);
  store.addMat({ uid: 'm1', scryfallId: 'x', name: 'Mat', art: '', x: 0, y: 0, yaw: 0, life: 18 });
  store.addMat({ uid: 'st', kind: 'stand', scryfallId: '', name: 'Sam', art: '', x: 0, y: 400, yaw: 0, owner: 'sam' });
  store.setNamed([{ id: 'p1', name: 'Keep', filter: null, anchor: { x: 100, y: 0 }, yaw: 0 }]);
  store.setSpreads([{ id: 's1', anchor: { x: 200, y: 0 }, yaw: 0, uids: ['c'], pileId: null }]);
  store.setDice([{ uid: 'd1', x: 5, y: 5, z: 10, yaw: 0, value: 3 }, { uid: 'd2', x: 50, y: 5, z: 10, yaw: 0, value: 6, kind: 'd20', color: '#1f3a6e' }]);
  return store;
}

const OPS: [string, Op][] = [
  ['add new cards', { t: 'add', cards: [card('n1', 10), card('n2', 20, { faceUp: false })] }],
  ['add over an existing card', { t: 'add', cards: [card('a', 999)] }],
  ['remove', { t: 'remove', uids: ['a', 'c', 'missing'] }],
  ['move, flip and turn', { t: 'move', moves: [{ uid: 'a', x: 5, y: 6, z: 0.45, yaw: 1, faceUp: false }, { uid: 'missing', x: 1 }] }],
  ['move onto a stand and off one', { t: 'move', moves: [{ uid: 'a', stand: 'st', side: 1 }, { uid: 'd', stand: null, side: null }] }],
  ['move the links', { t: 'move', moves: [{ uid: 'b', pileId: null }, { uid: 'c', spreadOf: null, laidAt: null }, { uid: 'a', laidAt: { x: 1, y: 2 } }] }],
  ['grab', { t: 'grab', uids: ['a'], dice: ['d1'] }],
  ['release', { t: 'release', uids: ['a'] }],
  ['reuid', { t: 'reuid', pairs: [['c', 'c2'], ['e', 'e2']] }],
  ['named set and remove', { t: 'named', set: [{ id: 'p2', name: 'Bin', filter: 't:land', anchor: { x: 0, y: -200 }, yaw: 0 }], remove: ['p1'] }],
  ['named rename in place', { t: 'named', set: [{ id: 'p1', name: 'Keepers', filter: null, anchor: { x: 100, y: 0 }, yaw: 0.5 }] }],
  ['spread set and remove', { t: 'spread', set: [{ id: 's2', anchor: { x: 0, y: 0 }, yaw: 0, uids: ['a', 'b'], pileId: 'p1' }], remove: ['s1'] }],
  ['mat set, new and changed', { t: 'mat', set: [{ uid: 'm2', scryfallId: 'y', name: 'Mat 2', art: '', x: 700, y: 0, yaw: 0 }, { uid: 'm1', scryfallId: 'x', name: 'Mat', art: '', x: 10, y: 0, yaw: Math.PI, life: 3, lifeHidden: true, locked: true }] }],
  ['mat remove', { t: 'mat', remove: ['m1'] }],
  ['mat spill', { t: 'mat', spill: ['st'] }],
  ['dice set and remove', { t: 'dice', set: [{ uid: 'd1', x: 9, y: 9, z: 10, yaw: 1, value: 5 }, { uid: 'd3', x: 0, y: 0, z: 10, yaw: 0, value: 1 }], remove: ['d2'] }],
  ['basics', { t: 'basics', basics: { ...defaultBasics(), Island: { name: 'Snow-Covered Island', set: 'khm', number: '277', foil: true } } }],
  ['table name', { t: 'table', name: '  Draft night  ' }],
  ['replace', { t: 'replace', table: { name: 'Fresh', cards: [card('z', 1)], named: [], spreads: [], mats: [], dice: [], basics: defaultBasics() } }],
  ['batch', { t: 'batch', ops: [{ t: 'remove', uids: ['a'] }, { t: 'move', moves: [{ uid: 'b', x: 1 }] }, { t: 'dice', remove: ['d1'] }, { t: 'table', name: 'B' }] }],
];

describe('applyOp and the store agree (ONLINE.md 11.1)', () => {
  for (const [name, op] of OPS) {
    it(name, () => {
      const store = build();
      const before = store.table();
      const frozen = JSON.stringify(before);
      const pure = applyOp(before, op);
      store.remote(() => applyToStore(store, op));
      expect(store.table()).toEqual(pure);
      // The table passed in is left as it was.
      expect(JSON.stringify(before)).toBe(frozen);
    });
  }

  it('copies a table deeply', () => {
    const t = build().table();
    const c = copyTable(t);
    expect(c).toEqual(t);
    c.cards[0].x = 12345;
    c.named[0].anchor.x = 12345;
    expect(t.cards[0].x).not.toBe(12345);
    expect(t.named[0].anchor.x).not.toBe(12345);
  });
});

/** Order-free, for comparing a table after an undo, which may put things back at the end. */
function norm(t: TableState): unknown {
  const by = <T>(list: T[], key: (x: T) => string) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    ...t,
    cards: by(t.cards, (c) => c.uid),
    named: by(t.named, (p) => p.id),
    spreads: by(t.spreads, (s) => s.id),
    mats: by(t.mats, (m) => m.uid),
    dice: by(t.dice, (d) => d.uid),
  };
}

describe('the store tells a room each local change and how to undo it', () => {
  const changes: [string, (s: Store) => void][] = [
    ['addCards', (s) => s.addCards([card('n1'), card('a', 50)])],
    ['removeCards', (s) => s.removeCards(['a', 'd'])],
    ['moveCards', (s) => s.moveCards([{ uid: 'a', x: 9, faceUp: false, stand: 'st' }, { uid: 'c', laidAt: null, spreadOf: null }])],
    ['renameCards', (s) => s.renameCards([['c', 'c9']])],
    ['setNamed', (s) => s.setNamed([{ id: 'p9', name: 'New', filter: null, anchor: { x: 0, y: 0 }, yaw: 0 }, { id: 'p1', name: 'Renamed', filter: 'c:r', anchor: { x: 1, y: 1 }, yaw: 0 }])],
    ['setNamed remove', (s) => s.setNamed([], ['p1'])],
    ['setSpreads', (s) => s.setSpreads([{ id: 's9', anchor: { x: 0, y: 0 }, yaw: 0, uids: ['a'], pileId: null }], ['s1'])],
    ['addMat', (s) => s.addMat({ uid: 'm9', scryfallId: 'q', name: 'Q', art: '', x: 0, y: 0, yaw: 0 })],
    ['moveMat', (s) => s.moveMat('m1', 50, 60, 1)],
    ['setMatLife', (s) => s.setMatLife('m1', 7)],
    ['setMatLifeHidden', (s) => s.setMatLifeHidden('m1', true)],
    ['setMatName', (s) => s.setMatName('st', 'Pat')],
    ['setMatLocked', (s) => s.setMatLocked('m1', true)],
    ['setMatOwner', (s) => s.setMatOwner('st', null)],
    ['removeMat', (s) => s.removeMat('m1')],
    ['spillMat', (s) => s.spillMat('st')],
    ['setDice', (s) => s.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 6 }, { uid: 'd9', x: 1, y: 1, z: 10, yaw: 0, value: 2 }])],
    ['removeDice', (s) => s.removeDice(['d2'])],
    ['replaceDice', (s) => s.replaceDice([{ uid: 'd9', x: 1, y: 1, z: 10, yaw: 0, value: 2 }])],
    ['setBasics', (s) => s.setBasics({ ...defaultBasics(), Forest: { name: 'Forest', set: 'unf', number: '239', foil: false } })],
    ['setName', (s) => s.setName('Other')],
    ['clear', (s) => s.clear()],
    ['replaceTable', (s) => s.replaceTable({ name: 'R', cards: [card('r1')], named: [], spreads: [], mats: [], dice: [], basics: defaultBasics() })],
  ];
  for (const [name, change] of changes) {
    it(name, () => {
      const store = build();
      const told: [Op, Op][] = [];
      store.onLocalChange = (op, inverse) => told.push([op, inverse]);
      const before = store.table();
      change(store);
      const after = store.table();
      expect(told.length).toBeGreaterThan(0);
      // The ops replay the change on the plain table; their inverses, last first, take it back.
      const replayed = told.reduce((t, [op]) => applyOp(t, op), before);
      expect(norm(replayed)).toEqual(norm(after));
      const undone = [...told].reverse().reduce((t, [, inverse]) => applyOp(t, inverse), after);
      expect(norm(undone)).toEqual(norm(before));
    });
  }

  it('says nothing while the change comes from the room', () => {
    const store = build();
    const told: Op[] = [];
    store.onLocalChange = (op) => told.push(op);
    store.remote(() => {
      store.moveCards([{ uid: 'a', x: 1 }]);
      store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 2 }]);
    });
    expect(told).toEqual([]);
    expect(store.origin).toBe('local');
  });

  it('works nothing out offline, when nobody listens', () => {
    const store = build();
    store.moveCards([{ uid: 'a', x: 1 }]);
    expect(store.cards.get('a')!.x).toBe(1);
  });
});
