// Named piles (spec 11.3): promote, rename, un-name, delete an empty one,
// each pile's own filter, and the empty outlines that act as sorting bins.

import type { App } from './app';
import { compileQuery } from './query/evaluate';
import { queryCard } from './state/selection';
import { newUid } from './state/store';
import { CARD_H, CARD_W, type NamedPile } from './state/types';

export class NamedPiles {
  constructor(private readonly app: App) {}

  get(id: string): NamedPile | undefined {
    return this.app.store.named.get(id);
  }

  /** Give a pile a name (and optionally a filter). Returns an error message, or null. */
  promote(pileId: string, name: string, filter: string | null): string | null {
    const store = this.app.store;
    const clean = name.trim();
    if (!clean) return 'A named pile needs a name';
    const err = this.checkFilter(filter);
    if (err) return err;
    const clash = [...store.named.values()].find((n) => n.id !== pileId && n.name.toLowerCase() === clean.toLowerCase());
    if (clash) return `There is already a pile called ${clash.name}`;
    const pile = store.piles.get(pileId);
    const existing = store.named.get(pileId);
    const sp = store.spreads.get(pileId);
    const anchor = pile?.anchor ?? existing?.anchor ?? sp?.anchor ?? { x: 0, y: 0 };
    const yaw = existing?.yaw ?? sp?.yaw ?? (pile ? store.cards.get(pile.cardUids[0])?.yaw ?? 0 : 0);
    store.named.set(pileId, { id: pileId, name: clean, filter: filter?.trim() || null, anchor: { ...anchor }, yaw });
    // Cards of the pile now belong to it by name.
    for (const u of pile?.cardUids ?? []) {
      const c = store.cards.get(u);
      if (c) c.pileId = pileId;
    }
    if (sp) sp.pileId = pileId;
    if (pile) {
      pile.name = clean;
      pile.filter = filter?.trim() || null;
    }
    store.events.emit('piles', undefined);
    return null;
  }

  /** Back to an emergent pile (spec 11.3: un-naming). */
  unname(id: string): void {
    const store = this.app.store;
    store.named.delete(id);
    const pile = store.piles.get(id);
    if (pile) {
      pile.name = null;
      pile.filter = null;
    }
    const sp = store.spreads.get(id);
    if (sp) sp.pileId = null;
    store.events.emit('piles', undefined);
  }

  /** Delete an empty named pile's outline (decision 27). */
  remove(id: string): void {
    if (this.hasCards(id)) return;
    this.unname(id);
  }

  hasCards(id: string): boolean {
    const store = this.app.store;
    if (store.piles.get(id)?.cardUids.length) return true;
    for (const c of store.cards.values()) if (c.pileId === id) return true;
    return false;
  }

  /** Named piles with no cards left: drawn as outlines on the table. */
  empty(): NamedPile[] {
    const withCards = new Set<string>();
    for (const c of this.app.store.cards.values()) if (c.pileId) withCards.add(c.pileId);
    return [...this.app.store.named.values()].filter((n) => !withCards.has(n.id));
  }

  /** An empty named pile whose outline contains the table point. */
  outlineAt(x: number, y: number): NamedPile | null {
    for (const n of this.empty()) {
      const dx = x - n.anchor.x;
      const dy = y - n.anchor.y;
      const c = Math.cos(-n.yaw), s = Math.sin(-n.yaw);
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if (Math.abs(lx) <= CARD_W / 2 + 4 && Math.abs(ly) <= CARD_H / 2 + 4) return n;
    }
    return null;
  }

  /** A new, empty named pile at a table spot (a bin prepared before sorting). */
  createEmpty(name: string, at: { x: number; y: number }, filter: string | null = null): string | null {
    const id = newUid('p');
    const store = this.app.store;
    store.named.set(id, { id, name: '', filter: null, anchor: { ...at }, yaw: 0 });
    const err = this.promote(id, name, filter);
    if (err) {
      store.named.delete(id);
      return err;
    }
    return null;
  }

  checkFilter(filter: string | null): string | null {
    if (!filter?.trim()) return null;
    const c = compileQuery(filter);
    return c.ok ? null : c.error;
  }

  /** Split cards dropped on a named pile into those its filter accepts and rejects (spec 11.3). */
  sort(targetId: string, uids: string[]): { accepted: string[]; rejected: string[] } {
    const store = this.app.store;
    const n = store.named.get(targetId);
    if (!n?.filter) return { accepted: uids, rejected: [] };
    const compiled = compileQuery(n.filter);
    if (!compiled.ok) return { accepted: uids, rejected: [] };
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const u of uids) {
      const c = store.cards.get(u);
      if (c && compiled.test(queryCard(store, c))) accepted.push(u);
      else rejected.push(u);
    }
    return { accepted, rejected };
  }
}
