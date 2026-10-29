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

  constructor(private readonly app: App, private readonly tray: RemovedTray, private readonly drag: DragController) {
    const store = app.store;
    const changed = () => {
      if (this.restoring || !this.pending) return;
      this.saved = this.pending;
      this.pending = null;
      this.undone = false;
    };
    store.events.on('added', changed);
    store.events.on('removed', changed);
    store.events.on('moved', changed);
    store.events.on('mats', changed);
    store.events.on('reset', () => {
      if (this.restoring) return;
      this.saved = this.pending = null;
    });
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
  swap(): 'undo' | 'redo' | null {
    if (!this.saved || this.drag.dragging) return null;
    const now = snapshot(this.app.store);
    const then = this.saved;
    if (sameTable(now, then)) return null;
    this.restoring = true;
    try {
      this.restore(now, then);
    } finally {
      this.restoring = false;
    }
    this.saved = now;
    this.pending = null;
    this.undone = !this.undone;
    return this.undone ? 'undo' : 'redo';
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
    // Piles, spreads and lie-flat marks as they were; positions fly back.
    for (const c of then.cards) {
      const card = store.cards.get(c.uid);
      if (!card) continue;
      card.pileId = c.pileId;
      card.spreadOf = c.spreadOf;
      card.laidAt = c.laidAt ? { ...c.laidAt } : undefined;
    }
    store.named.clear();
    for (const p of then.named) store.named.set(p.id, { ...p, anchor: { ...p.anchor } });
    store.spreads.clear();
    for (const s of then.spreads) store.spreads.set(s.id, { ...s, anchor: { ...s.anchor }, uids: [...s.uids] });
    this.restoreMats(then);
    if (d.move.length) {
      land(app, d.move.map((c) => ({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw, faceUp: c.faceUp })), { stagger: Math.min(1.5, 200 / d.move.length), arc: 6 });
    }
    store.events.emit('piles', undefined);
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
      }
    }
  }
}
