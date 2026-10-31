// The single table store (spec 4.2): plain data, explicit mutation functions,
// and change events. Everything that changes the table goes through here.
//
// Rooms (ONLINE.md 11.1) rely on that: every mutation of table state tells
// `onLocalChange` the op it amounts to and the op that undoes it, while
// `origin` is 'local'. The room's outbox listens there; the inbox applies
// other players' ops with `origin` 'remote' (see `remote()`), so they are not
// sent back. Offline nothing listens and nothing extra is worked out.

import {
  DEFAULT_SETTINGS,
  type Card,
  type CardRecord,
  type NamedPile,
  type Pile,
  type Settings,
  type Mat,
} from './types';
import { defaultBasics, type Basics } from './basics';
import type { Die } from './dice';
import type { CardSnap } from './history';
import type { Op } from '../../shared/ops';
import type { TableState } from '../../shared/table';

export interface StoreEvents {
  /** Cards were created. */
  added: string[];
  /** Cards left the table. */
  removed: string[];
  /** Model positions, yaw or face changed. */
  moved: string[];
  /** Cards came to rest at new model positions: pile detection and autosave run (spec 11.1, 14.3). */
  settled: string[];
  selection: void;
  piles: void;
  records: string[];
  settings: void;
  name: void;
  /** The whole table was replaced (load, new table). */
  reset: void;
  /** A short message for the user (a merge of named piles, spec 11.4). */
  notice: string;
  /** Playmats were added, moved or removed (decision 144). */
  mats: void;
  /** The table's basic land printings changed (decision 210). */
  basics: void;
  /** A playmat's life total changed (decision 239). Not a table change for undo. */
  life: void;
  /** Dice were added, moved, rolled, set or removed (decision 255). */
  dice: void;
  /** Cards were given new uids (a shuffle of hidden cards, ONLINE.md 7.2): old uid, new uid. */
  renamed: [string, string][];
  /** A change from the room was applied (ONLINE.md 8.1): undo keeps it out of what it takes back. */
  room: Op;
}

type Listener<T> = (payload: T) => void;

export interface Spread {
  id: string;
  anchor: { x: number; y: number };
  yaw: number;
  /** Top card first, the order the stack had. */
  uids: string[];
  /** The named pile the stack was, if any (spec 11.4: the name stays on the anchor). */
  pileId: string | null;
}

export class Emitter<E> {
  private listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) (fn as Listener<E[K]>)(payload);
  }
}

let uidCounter = 0;
export function newUid(prefix = 'c'): string {
  uidCounter++;
  return `${prefix}${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/**
 * A change to one card: any of its pose and face fields, and (rooms, ONLINE.md
 * 8.2) the links a landing sets. Unset leaves a field as it is; null clears it.
 */
export interface CardMove {
  uid: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  faceUp?: boolean;
  /** The card stand it lies on (decision 221); null, the table. */
  stand?: string | null;
  /** The side that last moved it (decision 267); null, the near side. */
  side?: 0 | 1 | null;
  /** The named pile it belongs to (spec 11.3); null, none. */
  pileId?: string | null;
  /** The spread it is part of (spec 10.6); null, none. */
  spreadOf?: string | null;
  /** Where an X spread laid it (decision 160); null, not laid. */
  laidAt?: { x: number; y: number } | null;
}

/** Where a change to the table came from: this browser's user, or the room (ONLINE.md 11.1). */
export type Origin = 'local' | 'remote';

/** A card as a room and undo keep it: everything an action can change. */
export function snapCard(c: Card): CardSnap {
  return {
    uid: c.uid, scryfallId: c.scryfallId, finish: c.finish,
    x: c.x, y: c.y, z: c.z, yaw: c.yaw, faceUp: c.faceUp,
    pileId: c.pileId, spreadOf: c.spreadOf, laidAt: c.laidAt ? { ...c.laidAt } : undefined, stand: c.stand, side: c.side,
  };
}

/** The fields of a card a move names, as they are now: what undoes the move. */
function before(c: Card, m: CardMove): CardMove {
  const out: CardMove = { uid: c.uid };
  if (m.x !== undefined) out.x = c.x;
  if (m.y !== undefined) out.y = c.y;
  if (m.z !== undefined) out.z = c.z;
  if (m.yaw !== undefined) out.yaw = c.yaw;
  if (m.faceUp !== undefined) out.faceUp = c.faceUp;
  if (m.stand !== undefined) out.stand = c.stand ?? null;
  if (m.side !== undefined) out.side = c.side ?? null;
  if (m.pileId !== undefined) out.pileId = c.pileId;
  if (m.spreadOf !== undefined) out.spreadOf = c.spreadOf;
  if (m.laidAt !== undefined) out.laidAt = c.laidAt ? { ...c.laidAt } : null;
  return out;
}

const copyNamed = (p: NamedPile): NamedPile => ({ ...p, anchor: { ...p.anchor } });
const copySpread = (s: Spread): Spread => ({ ...s, anchor: { ...s.anchor }, uids: [...s.uids] });

/** One op, or a batch of several in order; null for none. */
function joined(ops: Op[]): Op | null {
  if (!ops.length) return null;
  return ops.length === 1 ? ops[0] : { t: 'batch', ops };
}

export class Store {
  readonly events = new Emitter<StoreEvents>();

  name = 'Untitled table';
  readonly cards = new Map<string, Card>();
  readonly records = new Map<string, CardRecord>();
  /** Detected piles, recomputed on settle (spec 11.1). */
  piles = new Map<string, Pile>();
  /** Named pile identities (spec 11.3). Change them through setNamed. */
  readonly named = new Map<string, NamedPile>();
  readonly selection = new Set<string>();
  /** Open spreads (spec 10.6): the stack's anchor and its cards, top card first. Change them through setSpreads. */
  readonly spreads = new Map<string, Spread>();
  settings: Settings = { ...DEFAULT_SETTINGS };

  // ---- rooms (ONLINE.md 11.1) ----

  /** Who is changing the table right now. The inbox sets 'remote' while it applies the room's ops. */
  origin: Origin = 'local';
  /** Told of every local change to the table: the op, and the op that undoes it. Set by the room's outbox. */
  onLocalChange: ((op: Op, inverse: Op) => void) | null = null;

  /** The next moveCards is a shuffle (S S, ONLINE.md 7.2): its op says so, for the crown to re-key hidden cards. */
  private shuffleNext = false;

  /** Mark the next moveCards as a shuffle's landing. */
  markShuffle(): void {
    this.shuffleNext = true;
  }

  /** A local change is being made and someone listens: work out its op. */
  private get tracking(): boolean {
    return this.origin === 'local' && !!this.onLocalChange;
  }

  private told(op: Op | null, inverse: Op | null): void {
    if (op && inverse && this.tracking) this.onLocalChange!(op, inverse);
  }

  /** Run `fn` as a change from the room, not the user (the inbox, a snapshot). */
  remote<T>(fn: () => T): T {
    const was = this.origin;
    this.origin = 'remote';
    try {
      return fn();
    } finally {
      this.origin = was;
    }
  }

  // ---- cards ----

  addCards(cards: Card[]): void {
    const tracking = this.tracking;
    const replaced: CardSnap[] = [];
    const fresh: string[] = [];
    if (tracking) {
      for (const c of cards) {
        const had = this.cards.get(c.uid);
        if (had) replaced.push(snapCard(had));
        else fresh.push(c.uid);
      }
    }
    for (const c of cards) this.cards.set(c.uid, c);
    this.events.emit('added', cards.map((c) => c.uid));
    if (tracking && cards.length) {
      const undo: Op[] = [];
      if (fresh.length) undo.push({ t: 'remove', uids: fresh });
      if (replaced.length) undo.push({ t: 'add', cards: replaced });
      this.told({ t: 'add', cards: cards.map(snapCard) }, joined(undo));
    }
  }

  removeCards(uids: Iterable<string>): Card[] {
    const removed: Card[] = [];
    let selectionChanged = false;
    for (const uid of uids) {
      const c = this.cards.get(uid);
      if (!c) continue;
      this.cards.delete(uid);
      removed.push(c);
      if (this.selection.delete(uid)) selectionChanged = true;
    }
    if (removed.length) this.events.emit('removed', removed.map((c) => c.uid));
    if (selectionChanged) this.events.emit('selection', undefined);
    if (removed.length) this.told({ t: 'remove', uids: removed.map((c) => c.uid) }, { t: 'add', cards: removed.map(snapCard) });
    return removed;
  }

  moveCards(moves: CardMove[]): void {
    const tracking = this.tracking;
    const shuffle = this.shuffleNext;
    this.shuffleNext = false;
    const done: CardMove[] = [];
    const undo: CardMove[] = [];
    const changed: string[] = [];
    for (const m of moves) {
      const c = this.cards.get(m.uid);
      if (!c) continue;
      if (tracking) {
        undo.push(before(c, m));
        done.push({ ...m, ...(m.laidAt ? { laidAt: { ...m.laidAt } } : {}) });
      }
      if (m.x !== undefined) c.x = m.x;
      if (m.y !== undefined) c.y = m.y;
      if (m.z !== undefined) c.z = m.z;
      if (m.yaw !== undefined) c.yaw = m.yaw;
      if (m.faceUp !== undefined) c.faceUp = m.faceUp;
      if (m.stand !== undefined) c.stand = m.stand ?? undefined;
      if (m.side !== undefined) c.side = m.side || undefined;
      if (m.pileId !== undefined) c.pileId = m.pileId;
      if (m.spreadOf !== undefined) c.spreadOf = m.spreadOf;
      if (m.laidAt !== undefined) c.laidAt = m.laidAt ? { ...m.laidAt } : undefined;
      changed.push(m.uid);
    }
    if (changed.length) this.events.emit('moved', changed);
    if (done.length) this.told({ t: 'move', moves: done.map(clean), ...(shuffle ? { shuffle: true } : {}) }, { t: 'move', moves: undo });
  }

  /**
   * Give cards new uids (a `reuid` after a shuffle of hidden cards, ONLINE.md
   * 7.2): in the cards, the spreads and the selection (dropped there), keeping
   * the table's order. Tells listeners through `renamed`.
   */
  renameCards(pairs: [string, string][]): void {
    const to = new Map(pairs.filter(([a, b]) => a !== b && this.cards.has(a)));
    if (!to.size) return;
    const all = [...this.cards.values()];
    this.cards.clear();
    for (const c of all) {
      const now = to.get(c.uid);
      if (now) c.uid = now;
      this.cards.set(c.uid, c);
    }
    for (const s of this.spreads.values()) s.uids = s.uids.map((u) => to.get(u) ?? u);
    let selectionChanged = false;
    for (const old of to.keys()) if (this.selection.delete(old)) selectionChanged = true;
    const done = [...to.entries()];
    this.events.emit('renamed', done);
    if (selectionChanged) this.events.emit('selection', undefined);
    this.told({ t: 'reuid', pairs: done }, { t: 'reuid', pairs: done.map(([a, b]) => [b, a]) });
  }

  /**
   * What this browser may know of some cards changed (a room's `reveal` and
   * `forget`, ONLINE.md 7.2): their printing and finish, or HIDDEN. Not a change
   * to the table, so nothing goes to the room; listeners hear it as new card
   * data for those printings, as the hidden gate does.
   */
  setIdentities(list: { uid: string; scryfallId: string; finish: Card['finish'] }[]): void {
    const ids = new Set<string>();
    for (const { uid, scryfallId, finish } of list) {
      const c = this.cards.get(uid);
      if (!c || (c.scryfallId === scryfallId && c.finish === finish)) continue;
      c.scryfallId = scryfallId;
      c.finish = finish;
      ids.add(scryfallId);
    }
    if (ids.size) this.events.emit('records', [...ids]);
  }

  // ---- card data ----

  addRecords(records: CardRecord[]): void {
    for (const r of records) this.records.set(r.id, r);
    if (records.length) this.events.emit('records', records.map((r) => r.id));
  }

  /**
   * May this browser show the card's identity (rooms, ONLINE.md 7.3)? Always
   * true offline; src/online/hidden.ts sets the room's gate.
   */
  canSee: (card: Card) => boolean = () => true;

  /**
   * The card's record as this browser may show it: undefined for a card hidden
   * here (7.3). Panels, exports, searches and layouts read cards through this;
   * the crown's judge reads `records` itself.
   */
  recordOf(card: Card): CardRecord | undefined {
    return this.canSee(card) ? this.records.get(card.scryfallId) : undefined;
  }

  // ---- selection ----

  setSelection(uids: Iterable<string>): void {
    this.selection.clear();
    for (const u of uids) if (this.cards.has(u)) this.selection.add(u);
    this.events.emit('selection', undefined);
  }

  addToSelection(uids: Iterable<string>): void {
    for (const u of uids) if (this.cards.has(u)) this.selection.add(u);
    this.events.emit('selection', undefined);
  }

  removeFromSelection(uids: Iterable<string>): void {
    for (const u of uids) this.selection.delete(u);
    this.events.emit('selection', undefined);
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.events.emit('selection', undefined);
  }

  // ---- piles ----

  setPiles(piles: Map<string, Pile>): void {
    this.piles = piles;
    for (const c of this.cards.values()) c.pileId = null;
    for (const p of piles.values()) {
      for (const uid of p.cardUids) {
        const c = this.cards.get(uid);
        if (c) c.pileId = p.id;
      }
    }
    this.events.emit('piles', undefined);
  }

  pileOf(uid: string): Pile | undefined {
    const c = this.cards.get(uid);
    return c?.pileId ? this.piles.get(c.pileId) : undefined;
  }

  /**
   * Named piles (spec 11.3): take away `remove`, then put each of `set` in by
   * its id. The one way named piles change, so a room hears of it. Emits `piles`.
   */
  setNamed(set: NamedPile[], remove: string[] = []): void {
    const tracking = this.tracking;
    const undoSet: NamedPile[] = [];
    const undoRemove: string[] = [];
    const removed: string[] = [];
    for (const id of remove) {
      const had = this.named.get(id);
      if (!had) continue;
      if (tracking) undoSet.push(copyNamed(had));
      this.named.delete(id);
      removed.push(id);
    }
    for (const p of set) {
      const had = this.named.get(p.id);
      if (tracking) {
        if (had) {
          if (!removed.includes(p.id)) undoSet.push(copyNamed(had));
        } else undoRemove.push(p.id);
      }
      this.named.set(p.id, copyNamed(p));
    }
    if (!set.length && !removed.length) return;
    this.events.emit('piles', undefined);
    this.told(
      { t: 'named', ...(set.length ? { set: set.map(copyNamed) } : {}), ...(removed.length ? { remove: removed } : {}) },
      { t: 'named', ...(undoSet.length ? { set: undoSet } : {}), ...(undoRemove.length ? { remove: undoRemove } : {}) },
    );
  }

  /**
   * Spreads (spec 10.6): take away `remove`, then put each of `set` in by its
   * id. The one way spreads change, so a room hears of it. Emits `piles`.
   */
  setSpreads(set: Spread[], remove: string[] = []): void {
    const tracking = this.tracking;
    const undoSet: Spread[] = [];
    const undoRemove: string[] = [];
    const removed: string[] = [];
    for (const id of remove) {
      const had = this.spreads.get(id);
      if (!had) continue;
      if (tracking) undoSet.push(copySpread(had));
      this.spreads.delete(id);
      removed.push(id);
    }
    for (const s of set) {
      const had = this.spreads.get(s.id);
      if (tracking) {
        if (had) {
          if (!removed.includes(s.id)) undoSet.push(copySpread(had));
        } else undoRemove.push(s.id);
      }
      this.spreads.set(s.id, copySpread(s));
    }
    if (!set.length && !removed.length) return;
    this.events.emit('piles', undefined);
    this.told(
      { t: 'spread', ...(set.length ? { set: set.map(copySpread) } : {}), ...(removed.length ? { remove: removed } : {}) },
      { t: 'spread', ...(undoSet.length ? { set: undoSet } : {}), ...(undoRemove.length ? { remove: undoRemove } : {}) },
    );
  }

  // ---- settings and name ----

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.events.emit('settings', undefined);
  }

  setName(name: string): void {
    const was = this.name;
    this.name = name.trim() || 'Untitled table';
    this.events.emit('name', undefined);
    if (this.name !== was) this.told({ t: 'table', name: this.name }, { t: 'table', name: was });
  }

  // ---- playmats (decision 144) ----

  readonly mats = new Map<string, Mat>();

  /** CubeCobra Elo by oracle id (decision 192), from spawned cubes; kept with the table. */
  readonly elo = new Map<string, number>();

  /** Learn Elo ratings. Tells listeners as for new card data, so panels and searches update. */
  setElo(entries: Iterable<[string, number]>): void {
    for (const [oracle, elo] of entries) this.elo.set(oracle, elo);
    this.events.emit('records', []);
  }

  /** A card's CubeCobra Elo, if known. */
  eloOf(card: Card): number | undefined {
    const r = this.records.get(card.scryfallId);
    return r ? this.elo.get(r.oracle_id) : undefined;
  }

  /** Which printing each basic land chip spawns (decision 210); kept with the table. */
  basics: Basics = defaultBasics();

  setBasics(basics: Basics): void {
    const was = this.basics;
    this.basics = basics;
    this.events.emit('basics', undefined);
    this.told({ t: 'basics', basics: JSON.parse(JSON.stringify(basics)) as Basics }, { t: 'basics', basics: was });
  }

  /** A mat changed in place: tell the room the whole mat, before and after. */
  private matChanged(m: Mat, was: Mat): void {
    this.told({ t: 'mat', set: [{ ...m }] }, { t: 'mat', set: [was] });
  }

  addMat(mat: Mat): void {
    const had = this.mats.get(mat.uid);
    this.mats.set(mat.uid, mat);
    this.events.emit('mats', undefined);
    this.told({ t: 'mat', set: [{ ...mat }] }, had ? { t: 'mat', set: [{ ...had }] } : { t: 'mat', remove: [mat.uid] });
  }

  moveMat(uid: string, x: number, y: number, yaw: number): void {
    const m = this.mats.get(uid);
    if (!m) return;
    const was = { ...m };
    m.x = x;
    m.y = y;
    m.yaw = yaw;
    this.events.emit('mats', undefined);
    this.matChanged(m, was);
  }

  /** Dice on the table (decision 255). */
  readonly dice = new Map<string, Die>();

  /** Add dice, or put them where these say (replacing any with the same uid). */
  setDice(dice: Die[]): void {
    if (!dice.length) return;
    const tracking = this.tracking;
    const undoSet: Die[] = [];
    const undoRemove: string[] = [];
    for (const d of dice) {
      if (tracking) {
        const had = this.dice.get(d.uid);
        if (had) undoSet.push({ ...had });
        else undoRemove.push(d.uid);
      }
      this.dice.set(d.uid, { ...d });
    }
    this.events.emit('dice', undefined);
    this.told(
      { t: 'dice', set: dice.map((d) => ({ ...d })) },
      { t: 'dice', ...(undoSet.length ? { set: undoSet } : {}), ...(undoRemove.length ? { remove: undoRemove } : {}) },
    );
  }

  removeDice(uids: Iterable<string>): void {
    const gone: Die[] = [];
    for (const u of uids) {
      const had = this.dice.get(u);
      if (had && this.dice.delete(u)) gone.push(had);
    }
    if (!gone.length) return;
    this.events.emit('dice', undefined);
    this.told({ t: 'dice', remove: gone.map((d) => d.uid) }, { t: 'dice', set: gone.map((d) => ({ ...d })) });
  }

  /** Every die exactly as given, the rest gone (undo, loading). */
  replaceDice(dice: Die[]): void {
    const was = [...this.dice.values()];
    this.dice.clear();
    for (const d of dice) this.dice.set(d.uid, { ...d });
    this.events.emit('dice', undefined);
    if (!this.tracking) return;
    const now = new Set(dice.map((d) => d.uid));
    const then = new Set(was.map((d) => d.uid));
    const gone = was.filter((d) => !now.has(d.uid)).map((d) => d.uid);
    const fresh = dice.filter((d) => !then.has(d.uid)).map((d) => d.uid);
    if (!dice.length && !gone.length) return;
    this.told(
      { t: 'dice', ...(dice.length ? { set: dice.map((d) => ({ ...d })) } : {}), ...(gone.length ? { remove: gone } : {}) },
      { t: 'dice', ...(was.length ? { set: was } : {}), ...(fresh.length ? { remove: fresh } : {}) },
    );
  }

  /** A playmat's life total (decision 239). */
  setMatLife(uid: string, life: number): void {
    const m = this.mats.get(uid);
    if (!m || m.life === life) return;
    const was = { ...m };
    m.life = life;
    this.events.emit('life', undefined);
    this.matChanged(m, was);
  }

  /** Show or hide a playmat's life total (decision 241). */
  setMatLifeHidden(uid: string, hidden: boolean): void {
    const m = this.mats.get(uid);
    if (!m || !!m.lifeHidden === hidden) return;
    const was = { ...m };
    m.lifeHidden = hidden;
    this.events.emit('life', undefined);
    this.matChanged(m, was);
  }

  /** A card stand's name plate text (decision 220). */
  setMatName(uid: string, name: string): void {
    const m = this.mats.get(uid);
    if (!m || m.name === name) return;
    const was = { ...m };
    m.name = name;
    this.events.emit('mats', undefined);
    this.matChanged(m, was);
  }

  setMatLocked(uid: string, locked: boolean): void {
    const m = this.mats.get(uid);
    if (!m) return;
    const was = { ...m };
    m.locked = locked;
    this.events.emit('mats', undefined);
    if (!!was.locked !== locked) this.matChanged(m, was);
  }

  /** A card stand's owner in a room (ONLINE.md 6.3); null leaves it unowned. */
  setMatOwner(uid: string, owner: string | null): void {
    const m = this.mats.get(uid);
    if (!m || (m.owner ?? null) === owner) return;
    const was = { ...m };
    if (owner) m.owner = owner;
    else delete m.owner;
    this.events.emit('mats', undefined);
    this.matChanged(m, was);
  }

  removeMat(uid: string): void {
    const had = this.mats.get(uid);
    if (!had || !this.mats.delete(uid)) return;
    this.events.emit('mats', undefined);
    this.told({ t: 'mat', remove: [uid] }, { t: 'mat', set: [{ ...had }] });
  }

  /**
   * Spill a card stand (ONLINE.md 6.3, O31): it goes, and any card still on it
   * lies on the table now (a spill lays its cards out first). A room hears
   * `mat {spill}`, so the server writes "Ann spilled Bea's stand" (5.5).
   */
  spillMat(uid: string): void {
    const had = this.mats.get(uid);
    if (!had) return;
    const off = [...this.cards.values()].filter((c) => c.stand === uid);
    for (const c of off) c.stand = undefined;
    this.mats.delete(uid);
    if (off.length) this.events.emit('moved', off.map((c) => c.uid));
    this.events.emit('mats', undefined);
    const undo: Op[] = [{ t: 'mat', set: [{ ...had }] }];
    if (off.length) undo.push({ t: 'move', moves: off.map((c) => ({ uid: c.uid, stand: uid })) });
    this.told({ t: 'mat', spill: [uid] }, joined(undo));
  }

  /** Remove every card, pile and selection. Card records stay cached. */
  clear(): void {
    const was = this.tracking ? this.table() : null;
    this.cards.clear();
    this.mats.clear();
    this.elo.clear();
    this.dice.clear();
    this.events.emit('dice', undefined);
    this.basics = defaultBasics();
    this.events.emit('basics', undefined);
    this.events.emit('mats', undefined);
    this.piles = new Map();
    this.named.clear();
    this.spreads.clear();
    this.selection.clear();
    this.events.emit('reset', undefined);
    if (was) this.told({ t: 'replace', table: this.table() }, { t: 'replace', table: was });
  }

  /**
   * The table as a room shares it (ONLINE.md 8.1): plain copies of the cards,
   * named piles, spreads, mats, dice, basics and name.
   */
  table(): TableState {
    return {
      name: this.name,
      cards: [...this.cards.values()].map(snapCard),
      named: [...this.named.values()].map(copyNamed),
      spreads: [...this.spreads.values()].map(copySpread),
      mats: [...this.mats.values()].map((m) => ({ ...m })),
      dice: [...this.dice.values()].map((d) => ({ ...d })),
      basics: JSON.parse(JSON.stringify(this.basics)) as Basics,
    };
  }

  /**
   * Replace the whole table with this one (a room's snapshot, New table or
   * Load file online, ONLINE.md 8.2 `replace`). Card records, Elo, settings and
   * the selection's meaning stay this browser's; the selection is cleared.
   * Tells listeners as a load does: reset, then added, mats, dice, basics,
   * name, piles and one settled for every card.
   */
  replaceTable(t: TableState): void {
    const was = this.tracking ? this.table() : null;
    this.cards.clear();
    this.mats.clear();
    this.dice.clear();
    this.named.clear();
    this.spreads.clear();
    this.piles = new Map();
    this.selection.clear();
    this.events.emit('reset', undefined);
    this.name = t.name.trim() || 'Untitled table';
    for (const p of t.named) this.named.set(p.id, copyNamed(p));
    for (const s of t.spreads) this.spreads.set(s.id, copySpread(s));
    const cards: Card[] = t.cards.map((c) => ({ ...c, laidAt: c.laidAt ? { ...c.laidAt } : undefined, pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null }));
    for (const c of cards) this.cards.set(c.uid, c);
    for (const m of t.mats) this.mats.set(m.uid, { ...m });
    for (const d of t.dice) this.dice.set(d.uid, { ...d });
    this.basics = JSON.parse(JSON.stringify(t.basics)) as Basics;
    this.events.emit('added', cards.map((c) => c.uid));
    this.events.emit('mats', undefined);
    this.events.emit('dice', undefined);
    this.events.emit('basics', undefined);
    this.events.emit('name', undefined);
    this.events.emit('selection', undefined);
    this.events.emit('settled', cards.map((c) => c.uid));
    this.events.emit('piles', undefined);
    if (was) this.told({ t: 'replace', table: this.table() }, { t: 'replace', table: was });
  }
}

/** A move with its unset fields left out, as it goes over the wire. */
function clean(m: CardMove): CardMove {
  const out: CardMove = { uid: m.uid };
  for (const k of ['x', 'y', 'z', 'yaw', 'faceUp', 'stand', 'side', 'pileId', 'spreadOf', 'laidAt'] as const) {
    if (m[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = m[k];
  }
  return out;
}
