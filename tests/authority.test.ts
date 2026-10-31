import { describe, expect, it } from 'vitest';
import { Authority } from '../src/online/authority';
import { applyToStore } from '../src/online/inbox';
import { RoomState } from '../src/online/room';
import type { RoomSync } from '../src/online/connect';
import { Store } from '../src/state/store';
import type { Card, CardRecord, Mat } from '../src/state/types';
import type { Rank } from '../shared/permissions';
import type { Op } from '../shared/ops';
import type { ClientMsg, Player } from '../shared/protocol';
import { defaultRoomSettings } from '../shared/protocol';

const card = (uid: string, extra: Partial<Card> = {}): Card => ({ uid, scryfallId: 's' + uid, finish: 'nonfoil', x: 0, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...extra });
const record = (id: string, layout: string, type_line: string) => ({ id, layout, type_line }) as unknown as CardRecord;
const stand = (uid: string, owner?: string, width?: number): Mat => ({ uid, kind: 'stand', scryfallId: '', name: 'Stand', art: '', x: 0, y: 400, yaw: 0, ...(owner ? { owner } : {}), ...(width ? { width } : {}) });

/** The crown (`crown`) judging for a room with players at these ranks. */
function room(ranks: Record<string, Rank>, opts: { locked?: boolean } = {}) {
  const store = new Store();
  store.addCards([card('a'), card('b'), card('tok', { scryfallId: 'stok' }), card('down', { faceUp: false }), card('down2', { faceUp: false }), card('onSam', { stand: 'st' })]);
  store.addRecords([record('sa', 'normal', 'Instant'), record('stok', 'token', 'Token Creature — Goblin')]);
  store.addMat({ uid: 'st', kind: 'stand', scryfallId: '', name: 'Sam', art: '', x: 0, y: 400, yaw: 0, owner: 'sam' });
  store.addMat({ uid: 'mat', scryfallId: 'm', name: 'Mat', art: '', x: 0, y: 0, yaw: 0 });
  const r = new RoomState('TEST22');
  const players: Player[] = [{ id: 'crown', nickname: 'Ann', colour: '#e63946', rank: 'everything', side: 0, connected: true, joinedAt: 1, isCrown: true, isMaker: true }];
  let t = 2;
  for (const [id, rank] of Object.entries(ranks)) players.push({ id, nickname: id, colour: '#4895ef', rank, side: 0, connected: true, joinedAt: t++, isCrown: false, isMaker: false });
  r.apply({ t: 'welcome', me: 'crown', crown: 'crown', maker: 'crown', rank: 'everything', settings: { ...defaultRoomSettings('T'), locked: !!opts.locked, password: false }, code: 'TEST22', players, chat: [], seq: 0 });
  const sent: ClientMsg[] = [];
  const sync = {
    app: { store, rest: null },
    online: { room: r },
    session: { send: (m: ClientMsg) => sent.push(m) },
    inbox: { touched: new Map<string, number>(), applyRemote: (op: Op) => store.remote(() => applyToStore(store, op)) },
    outbox: { flush: () => {} },
    presence: { holders: new Map<string, string>(), lastPoses: () => [] },
    refusedToast: () => {},
  } as unknown as RoomSync;
  const judge = new Authority(sync);
  judge.start();
  let n = 0;
  /** Propose an op from a player; what the crown answered. */
  const propose = (from: string, op: Op, pre?: Record<string, number>): string => {
    const before = sent.length;
    judge.judge({ t: 'propose', id: `p${++n}`, from, op, ...(pre ? { pre } : {}) });
    const m = sent.slice(before).find((x) => x.t === 'confirm' || x.t === 'refuse');
    return !m ? 'none' : m.t === 'confirm' ? 'ok' : (m as Extract<ClientMsg, { t: 'refuse' }>).reason;
  };
  return { store, sync, judge, sent, propose };
}

describe('the crown judges by rank (ONLINE.md 6.2)', () => {
  it('lets Move move cards and refuses View', () => {
    const { propose } = room({ vic: 'view', mo: 'move' });
    expect(propose('mo', { t: 'move', moves: [{ uid: 'a', x: 10 }] })).toBe('ok');
    expect(propose('vic', { t: 'move', moves: [{ uid: 'a', x: 20 }] })).toBe('rank');
  });

  it('needs Cards to add a card, Tokens to add a token', () => {
    const { propose, store } = room({ mo: 'move', tk: 'tokens', cd: 'cards' });
    store.addRecords([record('snew', 'normal', 'Creature'), record('stk2', 'token', 'Token')]);
    expect(propose('tk', { t: 'add', cards: [card('n1', { scryfallId: 'snew' })] })).toBe('rank');
    expect(propose('tk', { t: 'add', cards: [card('n2', { scryfallId: 'stk2' })] })).toBe('ok');
    expect(propose('cd', { t: 'add', cards: [card('n3', { scryfallId: 'snew' })] })).toBe('ok');
    expect(propose('mo', { t: 'add', cards: [card('n4', { scryfallId: 'stk2' })] })).toBe('rank');
  });

  it('lets Tokens remove token cards only (O67)', () => {
    const { propose } = room({ tk: 'tokens' });
    expect(propose('tk', { t: 'remove', uids: ['a'] })).toBe('rank');
    expect(propose('tk', { t: 'remove', uids: ['tok'] })).toBe('ok');
  });

  it('keeps the table, the name and replace for the crown', () => {
    const { propose } = room({ ev: 'everything' });
    expect(propose('ev', { t: 'table', name: 'Mine now' })).toBe('crownOnly');
    expect(propose('ev', { t: 'replace', table: { name: 'x', cards: [], named: [], spreads: [], mats: [], dice: [], basics: new Store().basics } })).toBe('crownOnly');
  });

  it('refuses every table op below the crown while the table is locked (O51)', () => {
    const { propose } = room({ ev: 'everything' }, { locked: true });
    expect(propose('ev', { t: 'move', moves: [{ uid: 'a', x: 1 }] })).toBe('locked');
  });

  it('needs Tokens to add or remove dice, Move to roll them', () => {
    const { propose, store } = room({ mo: 'move', tk: 'tokens' });
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }]);
    expect(propose('mo', { t: 'dice', set: [{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 5 }] })).toBe('ok');
    expect(propose('mo', { t: 'dice', set: [{ uid: 'd2', x: 0, y: 0, z: 10, yaw: 0, value: 1 }] })).toBe('rank');
    expect(propose('mo', { t: 'dice', remove: ['d1'] })).toBe('rank');
    expect(propose('tk', { t: 'dice', remove: ['d1'] })).toBe('ok');
  });
});

describe('holds (8.4)', () => {
  it('first grab wins; nobody else moves or grabs what is in a hand', () => {
    const { propose } = room({ p1: 'move', p2: 'move' });
    expect(propose('p1', { t: 'grab', uids: ['a'] })).toBe('ok');
    expect(propose('p2', { t: 'grab', uids: ['a'] })).toBe('held');
    expect(propose('p2', { t: 'move', moves: [{ uid: 'a', x: 5 }] })).toBe('held');
    expect(propose('p1', { t: 'move', moves: [{ uid: 'a', x: 5 }] })).toBe('ok');
    // Landed: anyone may take it now.
    expect(propose('p2', { t: 'grab', uids: ['a'] })).toBe('ok');
  });

  it('adds to a hand: cards and dice grabbed together are both held (O100)', () => {
    const { propose, store } = room({ p1: 'move', p2: 'move' });
    store.setDice([{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }]);
    expect(propose('p1', { t: 'grab', uids: ['a'] })).toBe('ok');
    expect(propose('p1', { t: 'grab', uids: [], dice: ['d1'] })).toBe('ok');
    expect(propose('p2', { t: 'move', moves: [{ uid: 'a', x: 5 }] })).toBe('held');
    expect(propose('p2', { t: 'dice', set: [{ uid: 'd1', x: 5, y: 0, z: 10, yaw: 0, value: 1 }] })).toBe('held');
    expect(propose('p1', { t: 'release', uids: ['a'], dice: ['d1'] })).toBe('ok');
    expect(propose('p2', { t: 'move', moves: [{ uid: 'a', x: 5 }] })).toBe('ok');
  });
});

describe('the review fixes', () => {
  it('ends the sender\'s hold when its landing is refused, so the card never hangs (reviews 5, 11)', () => {
    const { propose, sent, judge } = room({ sam: 'move', pat: 'move' });
    expect(propose('pat', { t: 'grab', uids: ['a'] })).toBe('ok');
    expect(judge.heldBy.get('a')).toBe('pat');
    // Pat lets go over Sam's stand: refused, and the hold goes with a release on Pat's behalf.
    expect(propose('pat', { t: 'move', moves: [{ uid: 'a', stand: 'st' }] })).toBe('stand');
    expect(judge.heldBy.has('a')).toBe(false);
    const release = sent.filter((m) => m.t === 'confirm').at(-1) as Extract<ClientMsg, { t: 'confirm' }>;
    expect(release).toMatchObject({ by: 'pat', op: { t: 'release', uids: ['a'] } });
    expect(propose('sam', { t: 'grab', uids: ['a'] })).toBe('ok');
  });

  it('puts back the printing of a card someone deleted without seeing it, when they undo (review 6)', () => {
    const { propose, store } = room({ cd: 'cards' });
    expect(propose('cd', { t: 'remove', uids: ['down'] })).toBe('ok');
    expect(propose('cd', { t: 'add', cards: [{ ...card('down', { faceUp: false }), scryfallId: 'hidden' }] })).toBe('ok');
    expect(store.cards.get('down')!.scryfallId).toBe('sdown');
    // A hidden card the crown never kept is refused, not written over everyone's table.
    expect(propose('cd', { t: 'add', cards: [{ ...card('nobody'), scryfallId: 'hidden' }] })).toBe('unknown');
  });

  it('refuses an add that names a card already on the table (review 14)', () => {
    const { propose, store } = room({ tk: 'tokens' });
    expect(propose('tk', { t: 'add', cards: [card('onSam', { scryfallId: 'stok' })] })).toBe('unknown');
    expect(store.cards.get('onSam')!.stand).toBe('st');
  });

  it('lets nobody but the crown take or give away another player\'s stand (review 8)', () => {
    const { propose } = room({ ev: 'everything' });
    expect(propose('ev', { t: 'mat', set: [stand('st', 'ev')] })).toBe('stand');
    expect(propose('ev', { t: 'mat', set: [stand('st')] })).toBe('stand');
    // Nor by turning it into a playmat of their own, or a playmat into a stand (review N5).
    const { kind: _kind, ...asMat } = stand('st', 'ev');
    expect(propose('ev', { t: 'mat', set: [asMat] })).toBe('crownOnly');
    expect(propose('ev', { t: 'mat', set: [{ uid: 'mat', kind: 'stand', scryfallId: 'm', name: 'Mat', art: '', x: 0, y: 0, yaw: 0, owner: 'ev' }] })).toBe('crownOnly');
  });

  it('counts the whole op for the cap and one full stand (review 15)', () => {
    const { propose, store } = room({ cd: 'cards', mo: 'move' });
    store.addRecords([record('sx', 'normal', 'Instant')]);
    store.addCards(Array.from({ length: 4000 }, (_, i) => card('f' + i)));
    const many = (from: number) => Array.from({ length: 600 }, (_, i) => card('n' + (from + i), { scryfallId: 'sx' }));
    expect(propose('cd', { t: 'batch', ops: [{ t: 'add', cards: many(0) }, { t: 'add', cards: many(600) }] })).toBe('cap');
    expect(propose('mo', { t: 'mat', set: [stand('fa', 'mo'), stand('fb', 'mo')] })).toBe('oneStand');
    expect(propose('mo', { t: 'mat', set: [stand('fa', 'mo')] })).toBe('ok');
    expect(propose('mo', { t: 'mat', set: [stand('sm', 'mo', 112.5)] })).toBe('ok');
    // Widening the small stand into a second full one is a second full stand.
    expect(propose('mo', { t: 'mat', set: [stand('sm', 'mo')] })).toBe('oneStand');
  });

  it('keeps the crown\'s own Load file of a table past the cap off the room (review 12)', () => {
    const { store, sync, judge, sent } = room({});
    const big = { name: 'Big', cards: Array.from({ length: 5001 }, (_, i) => card('b' + i)), named: [], spreads: [], mats: [], dice: [], basics: store.basics };
    judge.own('x1', { t: 'replace', table: big }, null, {});
    expect(sent.some((m) => m.t === 'confirm')).toBe(false);
    void sync;
  });
});

describe('stands (6.3)', () => {
  it('lets only the owner touch a stand and its cards', () => {
    const { propose } = room({ sam: 'move', pat: 'everything' });
    expect(propose('pat', { t: 'move', moves: [{ uid: 'onSam', stand: null, x: 0 }] })).toBe('stand');
    expect(propose('pat', { t: 'move', moves: [{ uid: 'a', stand: 'st' }] })).toBe('stand');
    expect(propose('pat', { t: 'grab', uids: ['onSam'] })).toBe('stand');
    expect(propose('sam', { t: 'move', moves: [{ uid: 'onSam', stand: null, x: 0 }] })).toBe('ok');
    expect(propose('pat', { t: 'mat', set: [stand('st', 'sam')].map((m) => ({ ...m, x: 99, name: 'Sam' })) })).toBe('stand');
  });

  it('allows one full stand each, small stands unlimited (O27)', () => {
    const { propose } = room({ sam: 'move' });
    expect(propose('sam', { t: 'mat', set: [stand('st2', 'sam')] })).toBe('oneStand');
    expect(propose('sam', { t: 'mat', set: [stand('sm1', 'sam', 112.5)] })).toBe('ok');
    expect(propose('sam', { t: 'mat', set: [stand('sm2', 'sam', 112.5)] })).toBe('ok');
  });

  it('needs Everything to spawn or remove a playmat, or to spill another\'s stand', () => {
    const { propose } = room({ mo: 'move', ev: 'everything' });
    expect(propose('mo', { t: 'mat', set: [{ uid: 'm2', scryfallId: 'x', name: 'M', art: '', x: 0, y: 0, yaw: 0 }] })).toBe('rank');
    expect(propose('mo', { t: 'mat', remove: ['mat'] })).toBe('rank');
    expect(propose('mo', { t: 'mat', set: [{ uid: 'mat', scryfallId: 'm', name: 'Mat', art: '', x: 50, y: 0, yaw: 0, life: 12 }] })).toBe('ok');
    expect(propose('mo', { t: 'mat', spill: ['st'] })).toBe('rank');
    expect(propose('ev', { t: 'mat', spill: ['st'] })).toBe('ok');
  });

  it('lays a spill out: the cards face down in front, the stand gone', () => {
    const { propose, store, sent } = room({ ev: 'everything' });
    expect(propose('ev', { t: 'mat', spill: ['st'] })).toBe('ok');
    expect(store.mats.has('st')).toBe(false);
    const c = store.cards.get('onSam')!;
    expect(c.stand).toBeUndefined();
    expect(c.faceUp).toBe(false);
    const confirm = sent.find((m) => m.t === 'confirm') as Extract<ClientMsg, { t: 'confirm' }>;
    // Laid out as [move, mat spill]: the move first, so the server still has the stand for its spill line (5.5).
    expect(confirm.op.t).toBe('batch');
    const parts = (confirm.op as Extract<Op, { t: 'batch' }>).ops;
    expect(parts.map((o) => o.t)).toEqual(['move', 'mat']);
    expect(parts[1]).toEqual({ t: 'mat', spill: ['st'] });
  });

  it('takes a spill laid out by the spiller: the stand removed and its cards moved off, in one batch', () => {
    const { propose, store } = room({ mo: 'move', ev: 'everything' });
    const spill: Op = { t: 'batch', ops: [{ t: 'mat', remove: ['st'] }, { t: 'move', moves: [{ uid: 'onSam', stand: null, x: 0, y: 300, faceUp: false }] }] };
    expect(propose('mo', spill)).toBe('rank');
    expect(propose('ev', spill)).toBe('ok');
    expect(store.cards.get('onSam')!.stand).toBeUndefined();
  });

  it('lets a player claim an unowned stand at Move when they own no full stand', () => {
    const { propose, store } = room({ pat: 'move' });
    store.addMat(stand('free'));
    expect(propose('pat', { t: 'mat', set: [stand('free', 'pat')] })).toBe('ok');
  });
});

describe('snapshots for the mirror (10.2)', () => {
  it('sends one every 30 seconds only when something changed since the last', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const { propose, sent, judge } = room({ mo: 'move' });
      const parts = () => sent.filter((m) => m.t === 'snapshot').length;
      vi.advanceTimersByTime(31_000);
      expect(parts()).toBe(0);
      expect(propose('mo', { t: 'move', moves: [{ uid: 'a', x: 1 }] })).toBe('ok');
      vi.advanceTimersByTime(30_000);
      expect(parts()).toBeGreaterThan(0);
      const after = parts();
      vi.advanceTimersByTime(30_000);
      expect(parts()).toBe(after);
      judge.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the cap, undo and shuffles', () => {
  it('refuses an add past 5,000 cards (O43)', () => {
    const { propose, store } = room({ cd: 'cards' });
    store.addRecords([record('sx', 'normal', 'Instant')]);
    store.addCards(Array.from({ length: 4994 }, (_, i) => card('f' + i)));
    expect(store.cards.size).toBe(5000);
    expect(propose('cd', { t: 'add', cards: [card('over', { scryfallId: 'sx' })] })).toBe('cap');
  });

  it('refuses an undo when someone else touched those cards since (8.6)', () => {
    const { propose, judge } = room({ mo: 'move' });
    judge.confirmed({ t: 'move', moves: [{ uid: 'a', x: 3 }] }, 'other', 7);
    expect(propose('mo', { t: 'move', moves: [{ uid: 'a', x: 1 }] }, { a: 5 })).toBe('touched');
    expect(propose('mo', { t: 'move', moves: [{ uid: 'a', x: 1 }] }, { a: 7 })).toBe('ok');
  });

  it('lets an undo past the undoer\'s own later op, but not past one the crown applied and has not seen echoed (reviews 10, 20)', () => {
    const { propose, judge } = room({ mo: 'move', p2: 'move' });
    judge.confirmed({ t: 'move', moves: [{ uid: 'b', x: 3 }] }, 'mo', 9);
    expect(propose('mo', { t: 'move', moves: [{ uid: 'b', x: 1 }] }, { b: 5 })).toBe('ok');
    // p2's move is applied by the crown; its echo has not come back yet.
    expect(propose('p2', { t: 'move', moves: [{ uid: 'a', x: 50 }] })).toBe('ok');
    expect(propose('mo', { t: 'move', moves: [{ uid: 'a', x: 0 }] }, { a: 0 })).toBe('touched');
  });

  it('re-keys hidden cards after a shuffle, keeping face-up ones (7.2)', () => {
    const { propose, store, sent } = room({ mo: 'move' });
    expect(propose('mo', { t: 'move', shuffle: true, moves: [{ uid: 'down', x: 5 }, { uid: 'down2', x: 5 }, { uid: 'a', x: 5 }] })).toBe('ok');
    expect(store.cards.has('down')).toBe(false);
    expect(store.cards.has('down2')).toBe(false);
    expect(store.cards.has('a')).toBe(true);
    expect(store.cards.size).toBe(6);
    const rekey = sent.filter((m) => m.t === 'confirm').at(-1) as Extract<ClientMsg, { t: 'confirm' }>;
    expect(rekey.by).toBe('crown');
    expect(rekey.op.t).toBe('batch');
  });

  it('does not re-key an ordinary move', () => {
    const { propose, store } = room({ mo: 'move' });
    expect(propose('mo', { t: 'move', moves: [{ uid: 'down', x: 5 }, { uid: 'down2', x: 5 }] })).toBe('ok');
    expect(store.cards.has('down')).toBe(true);
  });
});
