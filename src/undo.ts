// One-step undo (decision 204). Every key press and every press of the mouse
// takes a snapshot of the table, kept aside; the first change to the table
// after it makes that snapshot the undo point. So clicks and keys that change
// nothing never cost the undo, and a held key or a drag is one step. Double
// taps (S S, F F, R R, X X, E E) keep the first press's snapshot, so they undo
// as one. Ctrl + Z swaps the table with the undo point: the cards fly back,
// removed cards return (and leave the Removed tray), spawned or pasted ones go;
// pressed again, it swaps forward, a redo. The selection and the camera aren't
// part of it, and loading a table or starting a new one forgets it.

import type { App } from './app';
import { land } from './commands';
import type { DragController } from './physics/feel';
import type { CardMove } from './state/store';
import { outboxOf } from './online/outbox';
import { cardsTouched, diceTouched, type Op } from '../shared/ops';
import { snapCard, type Store } from './state/store';
import { diffCards, sameTable, snapshot, type TableSnap } from './state/history';
import type { RemovedTray } from './ui/tray';

/** A second press of the same key within this long keeps the first press's snapshot. */
const DOUBLE_TAP_MS = 400;

export class Undo {
  /** The table as it was before the last change: what Ctrl + Z puts back. */
  private saved: TableSnap | null = null;
  /** The table at the last key or mouse press, waiting for a change to make it the undo point. */
  private pending: TableSnap | null = null;
  private lastKey = '';
  private lastEvent: KeyboardEvent | null = null;
  private lastKeyAt = 0;
  private restoring = false;
  /** The last swap was an undo, so the next one is a redo. */
  private undone = false;
  /** In a room, someone else changed what your last action changed (O41): Ctrl + Z says so instead of undoing. */
  private overtaken = false;

  constructor(private readonly app: App, private readonly tray: RemovedTray, private readonly drag: DragController) {
    const store = app.store;
    const changed = () => {
      // A change from the room is not this browser's action (ONLINE.md 8.6, O41).
      if (this.restoring || !this.pending || store.origin === 'remote') return;
      this.saved = this.pending;
      this.pending = null;
      this.undone = false;
      this.overtaken = false;
    };
    store.events.on('added', changed);
    store.events.on('removed', changed);
    store.events.on('moved', changed);
    store.events.on('mats', changed);
    store.events.on('flags', changed);
    store.events.on('dice', changed);
    store.events.on('reset', () => {
      if (this.restoring) return;
      this.saved = this.pending = null;
      this.overtaken = false;
    });
    // In a room, what others change is theirs: undo takes back only your own last action (O41),
    // and not at all once someone else has changed what it changed.
    store.events.on('roomBefore', (op) => {
      if (this.saved && changedByMe(this.saved, op, store)) this.overtaken = true;
    });
    store.events.on('room', (op) => this.fold(op));
    // Captured first, so the snapshot is taken before the key or press acts. Hotkeys
    // also call markKey just before they run (KeyboardInput.beforeKey).
    window.addEventListener('keydown', (e) => this.markKey(e), true);
    window.addEventListener('pointerdown', () => this.mark(), true);
    document.addEventListener('paste', () => this.mark(), true);
  }

  /** A key went down: keep the table aside, unless it's the second press of a double tap. */
  markKey(e: KeyboardEvent): void {
    if (e === this.lastEvent || e.repeat) return;
    this.lastEvent = e;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') return;
    const now = performance.now();
    const twice = key === this.lastKey && now - this.lastKeyAt < DOUBLE_TAP_MS;
    this.lastKey = key;
    this.lastKeyAt = now;
    if (!twice) this.mark();
  }

  /** Something may be about to change the table: keep its state aside. */
  mark(): void {
    if (this.restoring) return;
    this.pending = snapshot(this.app.store);
  }

  get canUndo(): boolean {
    return this.saved !== null;
  }

  /** Ctrl + Z: swap the table with the undo point. Says which it was, or null if there was nothing to swap. */
  swap(): 'undo' | 'redo' | 'touched' | null {
    if (!this.saved || this.drag.dragging) return null;
    // Someone else moved what your last action moved (8.6, 12.4): nothing to take back now.
    if (this.overtaken) {
      this.overtaken = false;
      this.saved = this.pending = null;
      return 'touched';
    }
    const now = snapshot(this.app.store);
    const then = this.saved;
    if (sameTable(now, then)) return null;
    // In a room (8.6, O41): the swap goes out with what this browser last saw of
    // everything it touches; the crown refuses it if anyone has touched them since.
    const box = outboxOf(this.app);
    const touched = this.app.online && box ? this.touched(now, then) : null;
    if (box && touched) {
      box.flush();
      box.pre = touched;
    }
    this.restoring = true;
    try {
      this.restore(now, then);
    } finally {
      this.restoring = false;
    }
    box?.flush();
    this.saved = now;
    this.pending = null;
    this.undone = !this.undone;
    return this.undone ? 'undo' : 'redo';
  }

  /**
   * Another player's change was applied: the kept snapshots take it on, for
   * everything it touched, so Ctrl + Z puts back only what this browser did.
   */
  private fold(op: Op): void {
    if (op.t === 'replace') {
      this.saved = this.pending = null;
      return;
    }
    for (const snap of [this.saved, this.pending]) if (snap) foldInto(snap, op, this.app.store);
  }

  /** For every card and die the swap changes, the seq of the last confirmed op that touched it here (8.6). */
  private touched(now: TableSnap, then: TableSnap): Record<string, number> {
    const d = diffCards(now, then);
    const uids = new Set([...d.add.map((c) => c.uid), ...d.remove, ...d.move.map((c) => c.uid)]);
    const dice = new Map(now.dice.map((x) => [x.uid, JSON.stringify(x)]));
    for (const x of then.dice) if (dice.get(x.uid) !== JSON.stringify(x)) uids.add(x.uid);
    for (const x of now.dice) if (!then.dice.some((y) => y.uid === x.uid)) uids.add(x.uid);
    const box = outboxOf(this.app);
    const out: Record<string, number> = {};
    for (const u of uids) out[u] = box?.seenSeq(u) ?? 0;
    return out;
  }

  private restore(now: TableSnap, then: TableSnap): void {
    const app = this.app;
    const store = app.store;
    // Cards still falling stop where the model has them.
    app.physics?.abandonAll();
    const d = diffCards(now, then);
    if (d.remove.length) store.removeCards(d.remove);
    if (d.add.length) {
      store.addCards(d.add.map((c) => ({ ...c, laidAt: c.laidAt ? { ...c.laidAt } : undefined })));
      this.tray.take(d.add);
    }
    // Piles, spreads and lie-flat marks as they were; positions fly back. All
    // through the store, so a room hears of it (ONLINE.md 11.1).
    const links: CardMove[] = [];
    for (const c of then.cards) {
      const card = store.cards.get(c.uid);
      if (!card) continue;
      const laid = (card.laidAt?.x !== c.laidAt?.x) || (card.laidAt?.y !== c.laidAt?.y);
      if (card.pileId === c.pileId && card.spreadOf === c.spreadOf && !laid && card.stand === c.stand && card.side === c.side) continue;
      links.push({ uid: c.uid, pileId: c.pileId, spreadOf: c.spreadOf, laidAt: c.laidAt ? { ...c.laidAt } : null, stand: c.stand ?? null, side: c.side ?? null });
    }
    if (links.length) store.moveCards(links);
    const named = new Set(then.named.map((p) => p.id));
    store.setNamed(then.named.filter((p) => JSON.stringify(store.named.get(p.id)) !== JSON.stringify(p)), [...store.named.keys()].filter((id) => !named.has(id)));
    const spreads = new Set(then.spreads.map((sp) => sp.id));
    store.setSpreads(then.spreads.filter((sp) => JSON.stringify(store.spreads.get(sp.id)) !== JSON.stringify(sp)), [...store.spreads.keys()].filter((id) => !spreads.has(id)));
    this.restoreMats(then);
    this.restoreFlags(then);
    // Dice as they were (decision 255): only those that differ, by uid, so no other die goes out with it (reviews 9, 17).
    const thenDice = new Map(then.dice.map((d) => [d.uid, d]));
    const changed = then.dice.filter((d) => JSON.stringify(store.dice.get(d.uid)) !== JSON.stringify(d));
    const gone = [...store.dice.keys()].filter((u) => !thenDice.has(u));
    if (gone.length) store.removeDice(gone);
    if (changed.length) store.setDice(changed);
    if (d.move.length) {
      land(app, d.move.map((c) => ({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw, faceUp: c.faceUp })), { stagger: Math.min(1.5, 200 / d.move.length), arc: 6, keepSide: true });
    }
    store.events.emit('piles', undefined);
  }

  /** Flags back as they were (decision 327): placed, moved, changed or taken away. */
  private restoreFlags(then: TableSnap): void {
    const store = this.app.store;
    const want = new Map((then.flags ?? []).map((f) => [f.uid, f]));
    const gone = [...store.flags.keys()].filter((uid) => !want.has(uid));
    const set = [...want.values()].filter((f) => JSON.stringify(store.flags.get(f.uid)) !== JSON.stringify(f));
    if (set.length || gone.length) store.setFlags(set.map((f) => ({ ...f })), gone);
  }

  private restoreMats(then: TableSnap): void {
    const store = this.app.store;
    const want = new Map(then.mats.map((m) => [m.uid, m]));
    for (const uid of [...store.mats.keys()]) if (!want.has(uid)) store.removeMat(uid);
    for (const m of then.mats) {
      const have = store.mats.get(m.uid);
      if (!have) store.addMat({ ...m });
      else {
        if (have.x !== m.x || have.y !== m.y || have.yaw !== m.yaw) store.moveMat(m.uid, m.x, m.y, m.yaw);
        if (!!have.locked !== !!m.locked) store.setMatLocked(m.uid, !!m.locked);
        if (have.name !== m.name) store.setMatName(m.uid, m.name);
      }
    }
  }
}

/** The cards, dice, mats, flags, named piles and spreads an op touches. */
function keysOf(op: Op): { cards: string[]; dice: string[]; mats: Set<string>; flags: Set<string>; named: Set<string>; spreads: Set<string> } {
  const mats = new Set<string>();
  const flags = new Set<string>();
  const named = new Set<string>();
  const spreads = new Set<string>();
  const walk = (o: Op) => {
    if (o.t === 'batch') o.ops.forEach(walk);
    else if (o.t === 'mat') [...(o.set ?? []).map((m) => m.uid), ...(o.remove ?? []), ...(o.spill ?? [])].forEach((u) => mats.add(u));
    else if (o.t === 'flag') [...(o.set ?? []).map((f) => f.uid), ...(o.remove ?? [])].forEach((u) => flags.add(u));
    else if (o.t === 'named') [...(o.set ?? []).map((p) => p.id), ...(o.remove ?? [])].forEach((u) => named.add(u));
    else if (o.t === 'spread') [...(o.set ?? []).map((s) => s.id), ...(o.remove ?? [])].forEach((u) => spreads.add(u));
  };
  walk(op);
  return { cards: cardsTouched(op), dice: diceTouched(op), mats, flags, named, spreads };
}

/**
 * Whether an op from the room touches something your last action changed:
 * something that differs between the kept table (before your action, with
 * others' changes folded in) and the table now.
 */
export function changedByMe(snap: TableSnap, op: Op, store: Store): boolean {
  const k = keysOf(op);
  const differ = <T>(list: T[], keys: Iterable<string>, key: (t: T) => string, now: (k: string) => unknown) => {
    const kept = new Map(list.map((t) => [key(t), t]));
    for (const id of keys) if (JSON.stringify(kept.get(id)) !== JSON.stringify(now(id))) return true;
    return false;
  };
  return differ(snap.cards, k.cards, (c) => c.uid, (u) => {
    const c = store.cards.get(u);
    return c ? snapCard(c) : undefined;
  })
    || differ(snap.dice, k.dice, (d) => d.uid, (u) => store.dice.get(u))
    || differ(snap.mats, k.mats, (m) => m.uid, (u) => store.mats.get(u))
    || differ(snap.flags ?? [], k.flags, (f) => f.uid, (u) => store.flags.get(u))
    || differ(snap.named, k.named, (p) => p.id, (id) => store.named.get(id))
    || differ(snap.spreads, k.spreads, (s) => s.id, (id) => store.spreads.get(id));
}

/** Bring a kept snapshot up to date with the store for everything an op touched (cards, dice, mats, named piles, spreads). */
export function foldInto(snap: TableSnap, op: Op, store: Store): void {
  // Each touched thing is replaced where it stands (as the store's Map keeps it), added at the end, or taken out.
  const sync = <T>(list: T[], keys: Iterable<string>, key: (t: T) => string, now: (k: string) => T | undefined): T[] => {
    const want = new Set(keys);
    if (!want.size) return list;
    const out: T[] = [];
    const seen = new Set<string>();
    for (const t of list) {
      const k = key(t);
      if (!want.has(k)) out.push(t);
      else {
        seen.add(k);
        const n = now(k);
        if (n !== undefined) out.push(n);
      }
    }
    for (const k of want) {
      if (seen.has(k)) continue;
      const t = now(k);
      if (t !== undefined) out.push(t);
    }
    return out;
  };
  const { mats, flags, named, spreads } = keysOf(op);
  snap.cards = sync(snap.cards, cardsTouched(op), (c) => c.uid, (u) => {
    const c = store.cards.get(u);
    return c ? snapCard(c) : undefined;
  });
  snap.dice = sync(snap.dice, diceTouched(op), (d) => d.uid, (u) => {
    const d = store.dice.get(u);
    return d ? { ...d } : undefined;
  });
  snap.mats = sync(snap.mats, mats, (m) => m.uid, (u) => {
    const m = store.mats.get(u);
    return m ? { ...m } : undefined;
  });
  snap.flags = sync(snap.flags ?? [], flags, (f) => f.uid, (u) => {
    const f = store.flags.get(u);
    return f ? { ...f } : undefined;
  });
  snap.named = sync(snap.named, named, (p) => p.id, (id) => {
    const p = store.named.get(id);
    return p ? { ...p, anchor: { ...p.anchor } } : undefined;
  });
  snap.spreads = sync(snap.spreads, spreads, (s) => s.id, (id) => {
    const s = store.spreads.get(id);
    return s ? { ...s, anchor: { ...s.anchor }, uids: [...s.uids] } : undefined;
  });
}
