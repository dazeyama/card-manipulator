import { describe, expect, it } from 'vitest';
import { Outbox, without } from '../src/online/outbox';
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
