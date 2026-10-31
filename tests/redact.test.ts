import { describe, expect, it } from 'vitest';
import { applyOp } from '../shared/apply';
import type { Op } from '../shared/ops';
import { affectedCards, canSee, carriesIdentities, hideCard, redactOp, redactTable, viewOf, visibilityDiff } from '../shared/redact';
import { HIDDEN, emptyTable, type CardSnap, type Mat, type TableState } from '../shared/table';

function card(uid: string, over: Partial<CardSnap> = {}): CardSnap {
  return { uid, scryfallId: `id-${uid}`, finish: 'foil', x: 0, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...over };
}

function stand(uid: string, owner?: string): Mat {
  return { uid, kind: 'stand', scryfallId: '', name: 'Stand', art: '', x: 0, y: 0, yaw: 0, ...(owner ? { owner } : {}) };
}

function table(cards: CardSnap[], mats: Mat[] = []): TableState {
  return { ...emptyTable('T'), cards, mats };
}

/** Apply an op and diff visibility for one player, as the Room does. */
function diff(t: TableState, op: Op, player: string) {
  const after = applyOp(t, op);
  const bv = viewOf(t), av = viewOf(after);
  return visibilityDiff(bv, av, affectedCards(op, bv, av), player);
}

describe('canSee', () => {
  const mats = new Map([['s1', stand('s1', 'bea')], ['s2', stand('s2')]]);

  it('shows face-up cards off stands to everyone', () => {
    expect(canSee(card('a'), mats, 'ann')).toBe(true);
  });

  it('hides face-down cards off stands from everyone, their mover included (O30)', () => {
    expect(canSee(card('a', { faceUp: false }), mats, 'ann')).toBe(false);
  });

  it('shows a stand\'s cards, face up or down, only to its owner (O29)', () => {
    expect(canSee(card('a', { stand: 's1' }), mats, 'bea')).toBe(true);
    expect(canSee(card('a', { stand: 's1', faceUp: false }), mats, 'bea')).toBe(true);
    expect(canSee(card('a', { stand: 's1' }), mats, 'ann')).toBe(false);
  });

  it('hides an unowned stand\'s cards from everyone (O65)', () => {
    expect(canSee(card('a', { stand: 's2' }), mats, 'bea')).toBe(false);
    expect(canSee(card('a', { stand: 'gone' }), mats, 'bea')).toBe(false);
  });
});

describe('redaction', () => {
  it('hides a card\'s printing and finish only', () => {
    const h = hideCard(card('a', { x: 5 }));
    expect(h).toMatchObject({ uid: 'a', scryfallId: HIDDEN, finish: 'nonfoil', x: 5 });
  });

  it('redacts a snapshot per player', () => {
    const t = table([card('up'), card('down', { faceUp: false }), card('mine', { stand: 's1' })], [stand('s1', 'bea')]);
    const forAnn = redactTable(t, 'ann');
    expect(forAnn.cards.map((c) => c.scryfallId)).toEqual(['id-up', HIDDEN, HIDDEN]);
    const forBea = redactTable(t, 'bea');
    expect(forBea.cards.map((c) => c.scryfallId)).toEqual(['id-up', HIDDEN, 'id-mine']);
    expect(t.cards[1].scryfallId).toBe('id-down');
  });

  it('redacts an add against the table after it, through batches', () => {
    const t = table([], [stand('s1', 'bea')]);
    const op: Op = { t: 'batch', ops: [{ t: 'add', cards: [card('a', { faceUp: false }), card('b', { stand: 's1' }), card('c')] }] };
    const after = viewOf(applyOp(t, op));
    const forAnn = redactOp(op, after, 'ann') as Extract<Op, { t: 'batch' }>;
    expect((forAnn.ops[0] as Extract<Op, { t: 'add' }>).cards.map((c) => c.scryfallId)).toEqual([HIDDEN, HIDDEN, 'id-c']);
    const forBea = redactOp(op, after, 'bea') as Extract<Op, { t: 'batch' }>;
    expect((forBea.ops[0] as Extract<Op, { t: 'add' }>).cards.map((c) => c.scryfallId)).toEqual([HIDDEN, 'id-b', 'id-c']);
    expect(carriesIdentities(op)).toBe(true);
    expect(carriesIdentities({ t: 'move', moves: [] })).toBe(false);
  });

  it('redacts a replace\'s table', () => {
    const op: Op = { t: 'replace', table: table([card('a', { faceUp: false })]) };
    const r = redactOp(op, viewOf(emptyTable()), 'ann') as Extract<Op, { t: 'replace' }>;
    expect(r.table.cards[0].scryfallId).toBe(HIDDEN);
  });

  it('leaves ops without identities alone', () => {
    const op: Op = { t: 'move', moves: [{ uid: 'a', x: 1 }] };
    expect(redactOp(op, viewOf(emptyTable()), 'ann')).toBe(op);
  });
});

describe('visibility diffs', () => {
  it('reveals a card flipped face up on the table, to everyone', () => {
    const t = table([card('a', { faceUp: false })]);
    expect(diff(t, { t: 'move', moves: [{ uid: 'a', faceUp: true }] }, 'ann')).toEqual({ reveal: [{ uid: 'a', scryfallId: 'id-a', finish: 'foil' }], forget: [] });
  });

  it('forgets a card flipped face down', () => {
    const t = table([card('a')]);
    expect(diff(t, { t: 'move', moves: [{ uid: 'a', faceUp: false }] }, 'ann')).toEqual({ reveal: [], forget: ['a'] });
  });

  it('a face-up card put on Bea\'s stand: Ann forgets it, Bea keeps it', () => {
    const t = table([card('a')], [stand('s1', 'bea')]);
    const op: Op = { t: 'move', moves: [{ uid: 'a', stand: 's1' }] };
    expect(diff(t, op, 'ann').forget).toEqual(['a']);
    expect(diff(t, op, 'bea')).toEqual({ reveal: [], forget: [] });
  });

  it('a face-down card taken off Bea\'s stand onto the table: Bea forgets it', () => {
    const t = table([card('a', { stand: 's1', faceUp: false })], [stand('s1', 'bea')]);
    const op: Op = { t: 'move', moves: [{ uid: 'a', stand: null }] };
    expect(diff(t, op, 'bea').forget).toEqual(['a']);
    expect(diff(t, op, 'ann')).toEqual({ reveal: [], forget: [] });
  });

  it('a face-down card dealt onto Bea\'s stand: revealed to Bea only', () => {
    const t = table([card('a', { faceUp: false })], [stand('s1', 'bea')]);
    const op: Op = { t: 'move', moves: [{ uid: 'a', stand: 's1', x: 1 }] };
    expect(diff(t, op, 'bea').reveal.map((r) => r.uid)).toEqual(['a']);
    expect(diff(t, op, 'ann').reveal).toEqual([]);
  });

  it('a stand changing owner: the old owner forgets its cards, the new one learns them', () => {
    const t = table([card('a', { stand: 's1' }), card('b', { stand: 's1', faceUp: false }), card('c')], [stand('s1', 'bea')]);
    const op: Op = { t: 'mat', set: [stand('s1', 'cal')] };
    expect(diff(t, op, 'bea')).toEqual({ reveal: [], forget: ['a', 'b'] });
    expect(diff(t, op, 'cal').reveal.map((r) => r.uid)).toEqual(['a', 'b']);
    expect(diff(t, op, 'ann')).toEqual({ reveal: [], forget: [] });
  });

  it('a stand released (unowned): its owner forgets its cards', () => {
    const t = table([card('a', { stand: 's1' })], [stand('s1', 'bea')]);
    expect(diff(t, { t: 'mat', set: [stand('s1')] }, 'bea').forget).toEqual(['a']);
  });

  it('a spill (cards dropped face down, stand removed): the owner forgets, nobody learns', () => {
    const t = table([card('a', { stand: 's1' }), card('b', { stand: 's1' })], [stand('s1', 'bea')]);
    const op: Op = { t: 'batch', ops: [{ t: 'move', moves: [{ uid: 'a', faceUp: false, stand: null }, { uid: 'b', faceUp: false, stand: null }] }, { t: 'mat', spill: ['s1'] }] };
    expect(diff(t, op, 'bea')).toEqual({ reveal: [], forget: ['a', 'b'] });
    expect(diff(t, op, 'ann')).toEqual({ reveal: [], forget: [] });
  });

  it('a spill of face-up cards without a move would reveal them: the diff says so', () => {
    const t = table([card('a', { stand: 's1' })], [stand('s1', 'bea')]);
    expect(diff(t, { t: 'mat', spill: ['s1'] }, 'ann').reveal.map((r) => r.uid)).toEqual(['a']);
  });

  it('ignores removed and added cards, and replaces', () => {
    const t = table([card('a', { faceUp: false })]);
    expect(diff(t, { t: 'remove', uids: ['a'] }, 'ann')).toEqual({ reveal: [], forget: [] });
    expect(diff(t, { t: 'add', cards: [card('b')] }, 'ann')).toEqual({ reveal: [], forget: [] });
    expect(diff(t, { t: 'replace', table: table([card('a')]) }, 'ann')).toEqual({ reveal: [], forget: [] });
  });

  it('a reuid keeps hidden cards hidden under their new uids, with no diff', () => {
    const t = table([card('a', { faceUp: false })]);
    expect(diff(t, { t: 'reuid', pairs: [['a', 'z']] }, 'ann')).toEqual({ reveal: [], forget: [] });
  });
});
