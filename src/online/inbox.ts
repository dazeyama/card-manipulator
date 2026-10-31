// What comes in from the room (ONLINE.md 11.2): confirmed ops, reveals,
// forgets and snapshots, applied to the store as changes from the room
// (`store.remote`), never sent back. `applyToStore` is the store-side twin of
// shared/apply.ts's applyOp; tests/apply.test.ts proves they agree.

import type { Store } from '../state/store';
import { cardsTouched, diceTouched, type Op } from '../../shared/ops';
import { joinSnapshot, type ServerMsg, type SnapshotPart } from '../../shared/protocol';
import type { Card, Finish } from '../state/types';
import { isStand, slopePose } from '../state/stand';
import { HIDDEN, type CardSnap } from '../../shared/table';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
import type { RoomSync } from './connect';

/** A confirmed op as the server sends it. */
type OpMsg = Extract<ServerMsg, { t: 'op' }>;

/** How long a card takes to settle where a remote op put it: a held card eases in quickly (8.3). */
const LANDING_EASE_MS = 120;
const SETTLE_MS = 190;

/**
 * Apply an op to the store through its mutation methods, so every listener
 * (the renderer, piles, autosave) hears of it as it would of a local change.
 * Holds (`grab`, `release`) are not table state: presence keeps them. Runs as
 * the store's current origin: the inbox wraps it in `store.remote`.
 */
export function applyToStore(store: Store, op: Op): void {
  switch (op.t) {
    case 'add':
      store.addCards(op.cards.map((c): Card => ({ ...c, laidAt: c.laidAt ? { ...c.laidAt } : undefined, pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null })));
      return;
    case 'remove':
      store.removeCards(op.uids);
      return;
    case 'move':
      store.moveCards(op.moves);
      return;
    case 'grab':
    case 'release':
      return;
    case 'reuid':
      store.renameCards(op.pairs);
      return;
    case 'named':
      store.setNamed(op.set ?? [], op.remove ?? []);
      return;
    case 'spread':
      store.setSpreads(op.set ?? [], op.remove ?? []);
      return;
    case 'mat': {
      for (const m of op.set ?? []) store.addMat({ ...m });
      for (const uid of op.remove ?? []) store.removeMat(uid);
      for (const uid of op.spill ?? []) store.spillMat(uid);
      return;
    }
    case 'dice':
      if (op.set?.length) store.setDice(op.set);
      if (op.remove?.length) store.removeDice(op.remove);
      return;
    case 'basics':
      store.setBasics(JSON.parse(JSON.stringify(op.basics)) as typeof op.basics);
      return;
    case 'table':
      store.setName(op.name);
      return;
    case 'replace':
      store.replaceTable(op.table);
      return;
    case 'batch':
      for (const o of op.ops) applyToStore(store, o);
      return;
  }
}

/**
 * The room's incoming side (11.2): confirmed ops in seq order, snapshots, and
 * the touched-seq record undo's precondition reads (8.6).
 */
export class Inbox {
  /** The seq of the last confirmed op applied; -1 takes the next one as it comes (after a snapshot asked for). */
  seq = -1;
  /** For every card and die, the seq of the last confirmed op that touched it, as this browser saw it. */
  readonly touched = new Map<string, number>();
  private parts: SnapshotPart[] = [];
  /** Printings to fetch card data for: every browser resolves its own cards (O42). */
  private readonly wanted = new Set<string>();
  private fetchTimer = 0;
  /** Waiting for snapshot parts: a joiner after welcome, anyone after a gap. */
  private waitingForTable = false;
  /** Ops that came in while the welcome's snapshot was arriving. */
  private waiting: OpMsg[] = [];

  constructor(private readonly sync: RoomSync) {
    const app = sync.app;
    // Cards given new uids (a reuid) are drawn afresh under the new uid, where they were.
    app.store.events.on('renamed', (pairs) => {
      for (const [from, to] of pairs) {
        const pose = app.layer.pose(from);
        const card = app.store.cards.get(to);
        if (!pose || !card) continue;
        const keep = { ...pose };
        app.layer.remove(from);
        const { front, back } = app.slotsFor(card);
        app.layer.add(to, keep, front, back, card.finish !== 'nonfoil');
      }
    });
  }

  /** True while the room's table has not arrived yet: nothing local goes out meanwhile. */
  get loading(): boolean {
    return this.waitingForTable;
  }

  /** Welcomed (or welcomed back after a drop): ops count on from the welcome's seq. */
  welcome(seq: number): void {
    this.seq = seq;
    this.parts = [];
    this.waiting = [];
    this.waitingForTable = false;
  }

  /** The room's table follows the welcome: take it, crown or not (a joiner, a player back after a drop). */
  expectTable(): void {
    this.waitingForTable = true;
    this.parts = [];
  }

  /** youAreCrown (4.5): the full table follows in parts, then the queued proposals. */
  takeCrown(): void {
    // Whatever this browser judged before is stale now (review 18): the judge starts again once the table is here.
    this.sync.authority.stop();
    this.waitingForTable = true;
    this.parts = [];
  }

  /** A gap in seq (8.6): ask for the table afresh and wait for it. */
  private ask(): void {
    this.seq = -1;
    this.waitingForTable = true;
    this.parts = [];
    this.waiting = [];
    this.sync.session.send({ t: 'needSnapshot' });
  }

  snapshot(part: SnapshotPart): void {
    // The crown's own table is the room's truth: only one it asked for, or a handover, replaces it.
    // Anyone else takes any table the server sends (after a `replace`, 8.2).
    if (this.sync.online.room.isCrown && !this.waitingForTable) return;
    if (part.part === 0) this.parts = [];
    this.parts.push(part);
    const table = joinSnapshot(this.parts);
    if (!table) return;
    // Part 0 says which seq the table is current to; ops after it follow.
    const seq = this.parts.find((p) => p.part === 0)?.seq;
    this.parts = [];
    const app = this.sync.app;
    this.sync.outbox.clear();
    // Who holds what is not in the table: it carries on, for presence and a new crown's judge (review N7).
    const holds = new Map(this.sync.presence.holders);
    this.sync.presence.reset();
    app.physics?.abandonAll();
    app.store.remote(() => {
      app.store.replaceTable(table);
      this.settleDrawn(table.cards.map((c) => c.uid), new Set());
    });
    this.touched.clear();
    this.sync.presence.keepHolds(holds);
    this.need(table.cards.map((c) => c.scryfallId));
    if (seq !== undefined) this.seq = seq;
    this.waitingForTable = false;
    const waiting = this.waiting;
    this.waiting = [];
    for (const msg of waiting) this.op(msg);
    if (this.sync.online.room.isCrown) this.sync.authority.start();
    this.sync.tableArrived();
  }

  /** A confirmed op, in seq order. */
  op(msg: OpMsg): void {
    if (this.waitingForTable) {
      // Ops after the table it is waiting for follow it once it lands.
      this.waiting.push(msg);
      return;
    }
    if (this.seq >= 0 && msg.seq <= this.seq) return;
    if (this.seq >= 0 && msg.seq > this.seq + 1) return this.ask();
    this.seq = msg.seq;
    for (const u of cardsTouched(msg.op)) this.touched.set(u, msg.seq);
    for (const u of diceTouched(msg.op)) this.touched.set(u, msg.seq);
    const { outbox, online, presence, authority } = this.sync;
    presence.confirmed(msg.op, msg.by);
    authority.confirmed(msg.op, msg.by, msg.seq);
    if (outbox.confirmed(msg.id, msg.by, msg.op)) return;
    // The crown applied every op when it judged it (its own when it made it).
    if (online.room.isCrown) return;
    outbox.othersTouched(msg.op);
    this.applyRemote(msg.op, msg.by);
  }

  /**
   * Apply an op from the room to this table, as a change from the room, and
   * draw it: moved and added cards head for where they now lie, as a landing
   * does, a card that was in someone's hand easing there quickly.
   */
  applyRemote(op: Op, by: string, mine = false): void {
    const app = this.sync.app;
    const store = app.store;
    const eased = this.sync.presence.landing(op, by);
    if (!mine) store.events.emit('roomBefore', op);
    store.remote(() => {
      applyToStore(store, op);
      if (op.t !== 'replace') this.settleDrawn(cardsTouched(op), eased);
      else this.settleDrawn(op.table.cards.map((c) => c.uid), eased);
    });
    // Undo keeps others' changes out of what it takes back; my own op applied again is still mine.
    if (!mine) store.events.emit('room', op);
    this.need(addedCards(op).map((c) => c.scryfallId));
  }

  /** Cards I may now know (7.2): their printing and finish, and their card data when it comes. */
  reveal(cards: { uid: string; scryfallId: string; finish: Finish }[]): void {
    this.sync.app.store.setIdentities(cards);
    this.need(cards.map((c) => c.scryfallId));
  }

  /** Cards I may no longer know (7.2): an honest browser forgets them; they draw as backs. The crown never forgets. */
  forget(uids: string[]): void {
    if (this.sync.online.room.isCrown) return;
    this.sync.app.store.setIdentities(uids.map((uid) => ({ uid, scryfallId: HIDDEN, finish: 'nonfoil' })));
  }

  /** Fetch card data for printings this browser lacks: from its own cache, then Scryfall through the queue (O42). */
  private need(ids: Iterable<string>): void {
    const store = this.sync.app.store;
    for (const id of ids) if (id && id !== HIDDEN && !store.records.has(id)) this.wanted.add(id);
    if (!this.wanted.size || this.fetchTimer) return;
    this.fetchTimer = window.setTimeout(() => void this.fetchRecords(), 50);
  }

  private async fetchRecords(): Promise<void> {
    this.fetchTimer = 0;
    const store = this.sync.app.store;
    const ids = [...this.wanted].filter((id) => !store.records.has(id));
    this.wanted.clear();
    if (!ids.length) return;
    const cached = await getRecords(ids);
    store.addRecords([...cached.values()].filter((r) => !store.records.has(r.id)));
    const missing = ids.filter((id) => !store.records.has(id));
    if (!missing.length) return;
    try {
      store.addRecords(await fetchByIds(missing));
    } catch (err) {
      console.warn('Could not fetch card data for the room’s cards', err);
    }
  }

  /** Animate cards to where the store has them now and tell piles and resting (inside store.remote). */
  private settleDrawn(uids: string[], eased: Set<string>): void {
    const app = this.sync.app;
    const store = app.store;
    const live = uids.filter((u) => store.cards.has(u) && !app.motion.held.has(u));
    if (!live.length) return;
    app.physics?.release(live);
    for (const uid of live) {
      const card = store.cards.get(uid)!;
      const m = card.stand ? store.mats.get(card.stand) : undefined;
      const to = m && isStand(m) ? slopePose(m, card) : { x: card.x, y: card.y, z: card.z, yaw: card.yaw };
      app.motion.animate(uid, { ...to, roll: card.faceUp ? 0 : Math.PI }, { duration: eased.has(uid) ? LANDING_EASE_MS : SETTLE_MS });
    }
    store.events.emit('settled', live);
  }
}

/** The cards an op brings onto the table, with their printings. */
function addedCards(op: Op): CardSnap[] {
  switch (op.t) {
    case 'add':
      return op.cards;
    case 'replace':
      return op.table.cards;
    case 'batch':
      return op.ops.flatMap(addedCards);
    default:
      return [];
  }
}
