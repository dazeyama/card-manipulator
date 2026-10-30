// The single table store (spec 4.2): plain data, explicit mutation functions,
// and change events. Everything that changes the table goes through here.

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

export interface CardMove {
  uid: string;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  faceUp?: boolean;
}

export class Store {
  readonly events = new Emitter<StoreEvents>();

  name = 'Untitled table';
  readonly cards = new Map<string, Card>();
  readonly records = new Map<string, CardRecord>();
  /** Detected piles, recomputed on settle (spec 11.1). */
  piles = new Map<string, Pile>();
  /** Named pile identities (spec 11.3). */
  readonly named = new Map<string, NamedPile>();
  readonly selection = new Set<string>();
  /** Open spreads (spec 10.6): the stack's anchor and its cards, top card first. */
  readonly spreads = new Map<string, Spread>();
  settings: Settings = { ...DEFAULT_SETTINGS };

  // ---- cards ----

  addCards(cards: Card[]): void {
    for (const c of cards) this.cards.set(c.uid, c);
    this.events.emit('added', cards.map((c) => c.uid));
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
    return removed;
  }

  moveCards(moves: CardMove[]): void {
    const changed: string[] = [];
    for (const m of moves) {
      const c = this.cards.get(m.uid);
      if (!c) continue;
      if (m.x !== undefined) c.x = m.x;
      if (m.y !== undefined) c.y = m.y;
      if (m.z !== undefined) c.z = m.z;
      if (m.yaw !== undefined) c.yaw = m.yaw;
      if (m.faceUp !== undefined) c.faceUp = m.faceUp;
      changed.push(m.uid);
    }
    if (changed.length) this.events.emit('moved', changed);
  }

  // ---- card data ----

  addRecords(records: CardRecord[]): void {
    for (const r of records) this.records.set(r.id, r);
    if (records.length) this.events.emit('records', records.map((r) => r.id));
  }

  recordOf(card: Card): CardRecord | undefined {
    return this.records.get(card.scryfallId);
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

  // ---- settings and name ----

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.events.emit('settings', undefined);
  }

  setName(name: string): void {
    this.name = name.trim() || 'Untitled table';
    this.events.emit('name', undefined);
  }

  /** Remove every card, pile and selection. Card records stay cached. */
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
    this.basics = basics;
    this.events.emit('basics', undefined);
  }

  addMat(mat: Mat): void {
    this.mats.set(mat.uid, mat);
    this.events.emit('mats', undefined);
  }

  moveMat(uid: string, x: number, y: number, yaw: number): void {
    const m = this.mats.get(uid);
    if (!m) return;
    m.x = x;
    m.y = y;
    m.yaw = yaw;
    this.events.emit('mats', undefined);
  }

  /** A playmat's life total (decision 239). */
  setMatLife(uid: string, life: number): void {
    const m = this.mats.get(uid);
    if (!m || m.life === life) return;
    m.life = life;
    this.events.emit('life', undefined);
  }

  /** Show or hide a playmat's life total (decision 241). */
  setMatLifeHidden(uid: string, hidden: boolean): void {
    const m = this.mats.get(uid);
    if (!m || !!m.lifeHidden === hidden) return;
    m.lifeHidden = hidden;
    this.events.emit('life', undefined);
  }

  /** A card stand's name plate text (decision 220). */
  setMatName(uid: string, name: string): void {
    const m = this.mats.get(uid);
    if (!m || m.name === name) return;
    m.name = name;
    this.events.emit('mats', undefined);
  }

  setMatLocked(uid: string, locked: boolean): void {
    const m = this.mats.get(uid);
    if (!m) return;
    m.locked = locked;
    this.events.emit('mats', undefined);
  }

  removeMat(uid: string): void {
    if (this.mats.delete(uid)) this.events.emit('mats', undefined);
  }

  clear(): void {
    this.cards.clear();
    this.mats.clear();
    this.elo.clear();
    this.basics = defaultBasics();
    this.events.emit('basics', undefined);
    this.events.emit('mats', undefined);
    this.piles = new Map();
    this.named.clear();
    this.spreads.clear();
    this.selection.clear();
    this.events.emit('reset', undefined);
  }
}
