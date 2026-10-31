// What goes out to the room (ONLINE.md 8.6, 11.2). The store tells the outbox
// every local change as an op and its inverse; the writes one action makes
// (all in one turn of the event loop) go as one op, a `batch` when there are
// several. The change is already on this browser's table (O63): the op waits
// as pending until the crown confirms it (dropped) or refuses it (its inverse
// is applied, except to what someone else has changed since, which keeps the
// newer state). The crown's own ops are confirmed on the spot, never pending.

import type { App } from '../app';
import { land, type Landing } from '../commands';
import { newUid } from '../state/store';
import { spillOps } from './authority';
import type { Op } from '../../shared/ops';
import { cardsTouched, diceTouched } from '../../shared/ops';
import { byteLength, type RefuseReason } from '../../shared/protocol';
import type { RoomSync } from './connect';

interface Pending {
  id: string;
  op: Op;
  /** What takes the op back off this table; null for a hold, which changes no table. */
  inverse: Op | null;
  cards: Set<string>;
  dice: Set<string>;
  /** Uids someone else's confirmed op touched while this one waited. */
  others: Set<string>;
  /** Run when the crown refuses it (a refused grab drops the cards back). */
  refused?: (reason: RefuseReason) => void;
}

/**
 * At most this many cards in one add, remove or move (O104): a whole cube
 * spawned, or a layout of the whole table, goes out as several ops, each
 * judged and confirmed on its own, so no message comes near the server's 1 MiB.
 */
export const OP_CARDS = 1000;
/** A turn's batch bigger than this goes out change by change instead, each split as above. */
const BATCH_MAX_BYTES = 900 * 1024;

/** The room's outbox for each app, while it is in a room. */
const boxes = new WeakMap<App, Outbox>();

/** This app's outbox, or null offline. */
export function outboxOf(app: App): Outbox | null {
  return boxes.get(app) ?? null;
}

export class Outbox {
  private queue: { op: Op; inverse: Op }[] = [];
  private queued = false;
  private readonly pending = new Map<string, Pending>();
  /** The undo precondition for the next op sent (8.6), set by undo. */
  pre: Record<string, number> | null = null;

  constructor(private readonly sync: RoomSync) {
    boxes.set(sync.app, this);
  }

  stop(): void {
    if (boxes.get(this.sync.app) === this) boxes.delete(this.sync.app);
    this.queue = [];
    this.pending.clear();
  }

  /** The store's hook: one local change. Every change of the same turn goes in one op. */
  readonly record = (op: Op, inverse: Op): void => {
    this.queue.push({ op, inverse });
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => this.flush());
  };

  /** Send what this turn changed now, rather than at the end of the turn. */
  flush(): void {
    this.queued = false;
    const q = this.queue;
    this.queue = [];
    // Until the room's table has arrived, this table is about to be replaced: nothing of it goes out.
    if (!q.length || this.sync.inbox.loading) return;
    const pre = this.pre;
    this.pre = null;
    if (q.length > 1) {
      const op: Op = { t: 'batch', ops: q.map((x) => x.op) };
      if (byteLength(JSON.stringify(op)) <= BATCH_MAX_BYTES) {
        this.send(op, { t: 'batch', ops: q.map((x) => x.inverse).reverse() }, pre ? { pre } : {});
        return;
      }
    }
    // One change, or a turn too big to go as one: each change on its own, big ones in parts (O104).
    for (const x of q) {
      for (const [op, inverse] of splitOp(x.op, x.inverse)) this.send(op, inverse, pre ? { pre: preFor(pre, op) } : {});
    }
  }

  /**
   * Propose an op that is already on this table. The crown's go straight out
   * as confirmed; anyone else's wait for the crown.
   */
  send(op: Op, inverse: Op | null, opts: { pre?: Record<string, number>; refused?: (reason: RefuseReason) => void } = {}): string {
    const id = newUid('o');
    const { session, online, authority } = this.sync;
    if (online.room.isCrown) {
      authority.own(id, op, inverse, opts);
      return id;
    }
    this.pending.set(id, { id, op, inverse, cards: new Set(cardsTouched(op)), dice: new Set(diceTouched(op)), others: new Set(), refused: opts.refused });
    session.send({ t: 'op', id, op, ...(opts.pre ? { pre: opts.pre } : {}) });
    return id;
  }

  /** Ask for a hold on cards and dice picked up (8.4): they are in your hand at once; `refused` drops them back. */
  grab(uids: string[], dice: string[], refused: (reason: RefuseReason) => void): void {
    if (!uids.length && !dice.length) return;
    this.flush();
    this.send({ t: 'grab', uids, ...(dice.length ? { dice } : {}) }, null, { refused });
  }

  /** The hand emptied without landing (Esc, a cancelled drag). */
  release(uids: string[], dice: string[] = []): void {
    if (!uids.length && !dice.length) return;
    this.flush();
    this.send({ t: 'release', uids, ...(dice.length ? { dice } : {}) }, null);
  }

  /**
   * A confirmed op came back. True if it was one of mine, now done: if
   * someone else's op touched the same things while it waited, the crown
   * applied mine after theirs, so it is applied again to agree with it.
   */
  confirmed(id: string | undefined, by: string, op: Op): boolean {
    if (!id || by !== this.sync.online.room.me) return false;
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    // Applied again if someone else's op came first, or if the crown confirmed it differently (a spill it laid out).
    if (p.others.size || JSON.stringify(op) !== JSON.stringify(p.op)) this.sync.inbox.applyRemote(op, by, true);
    return true;
  }

  /**
   * Spill stands (6.3): proposed to the crown, which lays the cards out (it
   * knows them all); meanwhile they are laid out here the same way, face down
   * in front of each stand, and the crown's layout replaces it when confirmed.
   */
  spill(uids: string[]): void {
    this.flush();
    const { app, online, inbox } = this.sync;
    const store = app.store;
    const stands = uids.map((u) => store.mats.get(u)).filter((m) => !!m);
    if (!stands.length) return;
    const on = new Set(stands.map((m) => m!.uid));
    const cards = [...store.cards.values()].filter((c) => c.stand && on.has(c.stand));
    const inverse: Op = { t: 'batch', ops: [
      { t: 'mat', set: stands.map((m) => ({ ...m! })) },
      { t: 'move', moves: cards.map((c) => ({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw, faceUp: c.faceUp, stand: c.stand ?? null })) },
    ] };
    inbox.applyRemote({ t: 'batch', ops: spillOps(store, [...on], app) }, online.room.me, true);
    this.send({ t: 'mat', spill: [...on] }, inverse);
  }

  /** Someone else's confirmed op: note what it touched in every op of mine still waiting. */
  othersTouched(op: Op): void {
    if (!this.pending.size) return;
    const cards = cardsTouched(op);
    const dice = diceTouched(op);
    for (const p of this.pending.values()) {
      for (const u of cards) if (p.cards.has(u)) p.others.add(u);
      for (const u of dice) if (p.dice.has(u)) p.others.add(u);
    }
  }

  /** The crown said no: take my change back off the table, but not from what others changed since. */
  refused(id: string, reason: RefuseReason): void {
    const p = this.pending.get(id);
    if (!p) return;
    const later = [...this.pending.values()];
    later.splice(0, later.indexOf(p) + 1);
    this.pending.delete(id);
    if (p.inverse) {
      let back = without(p.inverse, p.others);
      // A later op of mine still waiting on the same things takes this op's before-state with its own, to apply
      // after it if it is refused too, so the earliest state wins and refusals in any order end where the crown is (review 16).
      if (back) {
        const handed = new Set<string>();
        for (const u of [...p.cards, ...p.dice]) {
          const q = later.find((x) => x.cards.has(u) || x.dice.has(u));
          if (!q || !q.inverse) continue;
          const part = keepOnly(back, (v) => v === u);
          if (!part) continue;
          q.inverse = { t: 'batch', ops: [q.inverse, part] };
          handed.add(u);
        }
        if (handed.size) back = without(back, handed);
      }
      if (back) this.sync.inbox.applyRemote(back, this.sync.online.room.me);
    }
    p.refused?.(reason);
    this.sync.refusedToast(reason, p.op);
  }

  /** A fresh snapshot replaced the table: nothing of mine is waiting any more. */
  clear(): void {
    this.queue = [];
    this.pending.clear();
  }

  /** The seq of the last confirmed op that touched a card or die, as this browser saw it (8.6), 0 for none. */
  seenSeq(uid: string): number {
    return this.sync.inbox.touched.get(uid) ?? 0;
  }

  /** Ops of mine not yet confirmed (for tests and the dev tools). */
  get waiting(): number {
    return this.pending.size;
  }
}

/**
 * Spill stands (6.3, O31): their cards face down in a messy pile in front of
 * each, the stands gone. In a room, anyone but the crown proposes it and the
 * crown lays it out; offline, and for the crown, it is laid out here through
 * the store like any change (undo covers it offline).
 */
export function spillStands(app: App, uids: string[]): void {
  const box = outboxOf(app);
  if (box && app.online && !app.online.room.isCrown) {
    box.spill(uids);
    return;
  }
  for (const op of spillOps(app.store, uids, app)) {
    if (op.t === 'move') land(app, op.moves as Landing[], { arc: 8, keepSide: true });
    else if (op.t === 'mat') for (const u of op.spill ?? []) app.store.spillMat(u);
  }
}

/** An op without the parts that touch these uids (cards, dice, mats, piles); null if nothing is left. */
export function without(op: Op, skip: Set<string>): Op | null {
  return skip.size ? keepOnly(op, (u) => !skip.has(u)) : op;
}

/** An op with only the card and die parts whose uids pass `keep`; null if nothing is left. Other ops come back whole. */
function keepOnly(op: Op, keep: (uid: string) => boolean): Op | null {
  switch (op.t) {
    case 'add': {
      const cards = op.cards.filter((c) => keep(c.uid));
      return cards.length ? { ...op, cards } : null;
    }
    case 'remove':
    case 'grab':
    case 'release': {
      const uids = op.uids.filter(keep);
      const dice = 'dice' in op && op.dice ? op.dice.filter(keep) : undefined;
      return uids.length || dice?.length ? { ...op, uids, ...(dice ? { dice } : {}) } : null;
    }
    case 'move': {
      const moves = op.moves.filter((m) => keep(m.uid));
      return moves.length ? { ...op, moves } : null;
    }
    case 'dice': {
      const set = op.set?.filter((d) => keep(d.uid));
      const remove = op.remove?.filter(keep);
      return set?.length || remove?.length ? { t: 'dice', ...(set?.length ? { set } : {}), ...(remove?.length ? { remove } : {}) } : null;
    }
    case 'batch': {
      const ops = op.ops.map((o) => keepOnly(o, keep)).filter((o): o is Op => !!o);
      return ops.length ? { t: 'batch', ops } : null;
    }
    default:
      return op;
  }
}

/**
 * An add, remove or move of more than `size` cards as several of at most
 * `size`, each with the part of the inverse that takes it back (O104). Other
 * ops come back whole.
 */
export function splitOp(op: Op, inverse: Op | null, size = OP_CARDS): [Op, Op | null][] {
  let groups: string[][];
  let part: (uids: string[]) => Op;
  if (op.t === 'add' && op.cards.length > size) {
    groups = chunk(op.cards.map((c) => c.uid), size);
    part = (uids) => keepOnly(op, inSet(uids))!;
  } else if (op.t === 'remove' && op.uids.length > size) {
    groups = chunk(op.uids, size);
    part = (uids) => ({ t: 'remove', uids });
  } else if (op.t === 'move' && op.moves.length > size) {
    groups = chunk(op.moves.map((m) => m.uid), size);
    part = (uids) => keepOnly(op, inSet(uids))!;
  } else return [[op, inverse]];
  return groups.map((uids) => [part(uids), inverse ? keepOnly(inverse, inSet(uids)) : null]);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function inSet(uids: string[]): (uid: string) => boolean {
  const set = new Set(uids);
  return (u) => set.has(u);
}

/** An undo's precondition for one part of it: only the uids that part touches. */
function preFor(pre: Record<string, number>, op: Op): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of [...cardsTouched(op), ...diceTouched(op)]) if (u in pre) out[u] = pre[u];
  return out;
}
