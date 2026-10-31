import { describe, expect, it } from 'vitest';
import { Outbox, splitOp, without } from '../src/online/outbox';
import type { CardSnap } from '../src/state/history';
import type { RoomSync } from '../src/online/connect';
import type { Op } from '../shared/ops';
import type { ClientMsg } from '../shared/protocol';

/** A room's sync with just what the outbox talks to, recording what it does. */
function fakeSync(opts: { crown?: boolean; loading?: boolean } = {}) {
  const sent: ClientMsg[] = [];
  const applied: Op[] = [];
  const own: Op[] = [];
  const toasts: string[] = [];
  const sync = {
    app: {},
    online: { room: { isCrown: !!opts.crown, me: 'me' } },
    session: { send: (m: ClientMsg) => sent.push(m) },
    authority: { own: (_id: string, op: Op) => own.push(op) },
    inbox: { loading: !!opts.loading, applyRemote: (op: Op) => applied.push(op) },
    refusedToast: (reason: string) => toasts.push(reason),
  };
  return { sync: sync as unknown as RoomSync, sent, applied, own, toasts };
}

const turn = () => new Promise<void>((r) => queueMicrotask(r));
const move = (uid: string, x: number): Op => ({ t: 'move', moves: [{ uid, x }] });

describe('the outbox (ONLINE.md 8.6)', () => {
  it('sends the changes of one turn as one op, a batch, with the inverses last first', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    box.record({ t: 'remove', uids: ['b'] }, { t: 'add', cards: [] });
    await turn();
    expect(sent).toHaveLength(1);
    const msg = sent[0] as Extract<ClientMsg, { t: 'op' }>;
    expect(msg.t).toBe('op');
    expect(msg.op).toEqual({ t: 'batch', ops: [move('a', 1), { t: 'remove', uids: ['b'] }] });
    expect(box.waiting).toBe(1);
  });

  it('sends a single change as itself', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    await turn();
    expect((sent[0] as Extract<ClientMsg, { t: 'op' }>).op).toEqual(move('a', 1));
  });

  it('takes a refused change back off the table', async () => {
    const { sync, sent, applied, toasts } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    await turn();
    box.refused((sent[0] as Extract<ClientMsg, { t: 'op' }>).id, 'locked');
    expect(applied).toEqual([move('a', 0)]);
    expect(toasts).toEqual(['locked']);
    expect(box.waiting).toBe(0);
  });

  it('leaves what someone else has moved since alone when rolling back', async () => {
    const { sync, sent, applied } = fakeSync();
    const box = new Outbox(sync);
    box.record({ t: 'move', moves: [{ uid: 'a', x: 1 }, { uid: 'b', x: 1 }] }, { t: 'move', moves: [{ uid: 'a', x: 0 }, { uid: 'b', x: 0 }] });
    await turn();
    box.othersTouched(move('b', 50));
    box.refused((sent[0] as Extract<ClientMsg, { t: 'op' }>).id, 'held');
    expect(applied).toEqual([{ t: 'move', moves: [{ uid: 'a', x: 0 }] }]);
  });

  it('drops a confirmed op, applying it again if someone else touched the same cards meanwhile', async () => {
    const { sync, sent, applied } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    box.flush();
    box.record(move('c', 1), move('c', 0));
    box.flush();
    const [first, second] = sent as Extract<ClientMsg, { t: 'op' }>[];
    expect(box.confirmed(first.id, 'me', first.op)).toBe(true);
    expect(applied).toEqual([]);
    box.othersTouched(move('c', 9));
    expect(box.confirmed(second.id, 'me', second.op)).toBe(true);
    expect(applied).toEqual([move('c', 1)]);
    // Someone else's confirmation is not mine.
    expect(box.confirmed(first.id, 'sam', first.op)).toBe(false);
  });

  it('runs a refused grab\'s own handler', () => {
    const { sync, sent, applied } = fakeSync();
    const box = new Outbox(sync);
    let why = '';
    box.grab(['a'], ['d1'], (reason) => (why = reason));
    const msg = sent[0] as Extract<ClientMsg, { t: 'op' }>;
    expect(msg.op).toEqual({ t: 'grab', uids: ['a'], dice: ['d1'] });
    box.refused(msg.id, 'held');
    expect(why).toBe('held');
    expect(applied).toEqual([]);
  });

  it('confirms the crown\'s own ops on the spot', async () => {
    const { sync, sent, own } = fakeSync({ crown: true });
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    await turn();
    expect(sent).toEqual([]);
    expect(own).toEqual([move('a', 1)]);
    expect(box.waiting).toBe(0);
  });

  it('sends nothing while the room\'s table is still on its way', async () => {
    const { sync, sent } = fakeSync({ loading: true });
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    await turn();
    expect(sent).toEqual([]);
  });

  it('carries an undo\'s precondition on the next op', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    box.pre = { a: 4 };
    box.record(move('a', 1), move('a', 0));
    await turn();
    expect((sent[0] as Extract<ClientMsg, { t: 'op' }>).pre).toEqual({ a: 4 });
    expect(box.pre).toBeNull();
  });
});

describe('without: an op minus what touches some uids', () => {
  const skip = new Set(['a', 'd1']);
  it('drops cards, dice and empty parts', () => {
    expect(without({ t: 'move', moves: [{ uid: 'a', x: 1 }, { uid: 'b', x: 2 }] }, skip)).toEqual({ t: 'move', moves: [{ uid: 'b', x: 2 }] });
    expect(without({ t: 'move', moves: [{ uid: 'a', x: 1 }] }, skip)).toBeNull();
    expect(without({ t: 'remove', uids: ['a'] }, skip)).toBeNull();
    expect(without({ t: 'dice', set: [{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }], remove: ['d2'] }, skip)).toEqual({ t: 'dice', remove: ['d2'] });
    expect(without({ t: 'batch', ops: [{ t: 'remove', uids: ['a'] }, { t: 'table', name: 'x' }] }, skip)).toEqual({ t: 'batch', ops: [{ t: 'table', name: 'x' }] });
    expect(without({ t: 'table', name: 'x' }, new Set())).toEqual({ t: 'table', name: 'x' });
  });
});

const snap = (i: number): CardSnap => ({ uid: `c${i}`, scryfallId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, finish: 'nonfoil', x: i, y: -i, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null });

describe('big ops go out in parts of at most 1,000 cards (O104)', () => {
  it('splits an add, each part with its own inverse', () => {
    const cards = Array.from({ length: 2500 }, (_, i) => snap(i));
    const parts = splitOp({ t: 'add', cards }, { t: 'remove', uids: cards.map((c) => c.uid) });
    expect(parts.map(([op]) => (op as Extract<Op, { t: 'add' }>).cards.length)).toEqual([1000, 1000, 500]);
    const [op, inverse] = parts[1];
    expect((op as Extract<Op, { t: 'add' }>).cards[0].uid).toBe('c1000');
    expect(inverse).toEqual({ t: 'remove', uids: Array.from({ length: 1000 }, (_, i) => `c${1000 + i}`) });
  });

  it('splits a remove and a move, every part of a shuffle still marked', () => {
    const uids = Array.from({ length: 1200 }, (_, i) => `c${i}`);
    expect(splitOp({ t: 'remove', uids }, null).map(([op]) => (op as Extract<Op, { t: 'remove' }>).uids.length)).toEqual([1000, 200]);
    const moves = uids.map((uid, i) => ({ uid, x: i }));
    const parts = splitOp({ t: 'move', moves, shuffle: true }, { t: 'move', moves: uids.map((uid) => ({ uid, x: 0 })) });
    expect(parts).toHaveLength(2);
    expect(parts.every(([op]) => op.t === 'move' && op.shuffle)).toBe(true);
    expect((parts[1][1] as Extract<Op, { t: 'move' }>).moves.map((m) => m.uid)).toEqual(uids.slice(1000));
  });

  it('leaves small ops and every other kind whole', () => {
    expect(splitOp(move('a', 1), move('a', 0))).toEqual([[move('a', 1), move('a', 0)]]);
    const table: Op = { t: 'table', name: 'x' };
    expect(splitOp(table, null)).toEqual([[table, null]]);
  });

  it('sends a spawn of 2,500 cards as three ops; a refusal takes back only its own part', async () => {
    const { sync, sent, applied } = fakeSync();
    const box = new Outbox(sync);
    const cards = Array.from({ length: 2500 }, (_, i) => snap(i));
    box.record({ t: 'add', cards }, { t: 'remove', uids: cards.map((c) => c.uid) });
    await turn();
    const ops = sent as Extract<ClientMsg, { t: 'op' }>[];
    expect(ops.map((m) => (m.op as Extract<Op, { t: 'add' }>).cards.length)).toEqual([1000, 1000, 500]);
    expect(Math.max(...ops.map((m) => JSON.stringify(m).length))).toBeLessThan(512 * 1024);
    box.refused(ops[2].id, 'cap');
    expect(applied).toEqual([{ t: 'remove', uids: cards.slice(2000).map((c) => c.uid) }]);
  });

  it('gives each part of an undo only its own precondition', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    const uids = Array.from({ length: 1500 }, (_, i) => `c${i}`);
    box.pre = Object.fromEntries(uids.map((u) => [u, 3]));
    box.record({ t: 'move', moves: uids.map((uid) => ({ uid, x: 1 })) }, { t: 'move', moves: uids.map((uid) => ({ uid, x: 0 })) });
    await turn();
    const ops = sent as Extract<ClientMsg, { t: 'op' }>[];
    expect(ops.map((m) => Object.keys(m.pre ?? {}).length)).toEqual([1000, 500]);
  });

  it('sends a turn too big for one message change by change', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    const cards = Array.from({ length: 6000 }, (_, i) => snap(i));
    // Three big changes in one turn: about 1 MB as one batch.
    for (let k = 0; k < 3; k++) {
      const part = cards.slice(k * 2000, (k + 1) * 2000);
      box.record({ t: 'add', cards: part }, { t: 'remove', uids: part.map((c) => c.uid) });
    }
    await turn();
    const ops = sent as Extract<ClientMsg, { t: 'op' }>[];
    expect(ops.every((m) => m.op.t === 'add')).toBe(true);
    expect(ops.map((m) => (m.op as Extract<Op, { t: 'add' }>).cards.length)).toEqual([1000, 1000, 1000, 1000, 1000, 1000]);
  });

  it('keeps a turn of small changes as one batch', async () => {
    const { sync, sent } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    box.record(move('b', 1), move('b', 0));
    await turn();
    expect(sent).toHaveLength(1);
    expect((sent[0] as Extract<ClientMsg, { t: 'op' }>).op.t).toBe('batch');
  });
});

describe('refusals of two ops on the same card end where the crown is (review 16)', () => {
  const two = async () => {
    const { sync, sent, applied } = fakeSync();
    const box = new Outbox(sync);
    box.record(move('a', 1), move('a', 0));
    box.flush();
    box.record(move('a', 2), move('a', 1));
    box.flush();
    const [first, second] = sent as Extract<ClientMsg, { t: 'op' }>[];
    return { box, applied, first, second };
  };
  /** Where card a ends after the rollbacks, starting from x 2. */
  const end = (ops: Op[]) => {
    let x = 2;
    const walk = (op: Op) => {
      if (op.t === 'batch') op.ops.forEach(walk);
      else if (op.t === 'move') for (const m of op.moves) if (m.uid === 'a' && m.x !== undefined) x = m.x;
    };
    ops.forEach(walk);
    return x;
  };

  it('in the order sent', async () => {
    const { box, applied, first, second } = await two();
    box.refused(first.id, 'locked');
    box.refused(second.id, 'locked');
    expect(end(applied)).toBe(0);
  });

  it('newest first', async () => {
    const { box, applied, first, second } = await two();
    box.refused(second.id, 'locked');
    box.refused(first.id, 'locked');
    expect(end(applied)).toBe(0);
  });
});
