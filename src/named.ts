// Named piles (spec 11.3): promote, rename, un-name, delete an empty one,
// each pile's own filter, and the empty outlines that act as sorting bins.
// A filtered pile holds only cards that match it (decision 322): a drop is
// sorted as it lands, and after every detection the cards this browser's
// user brought into a filtered pile any other way (a sweep, a layout, a draw,
// a spawn, a paste, a toss, a drop mid-motion) are turned away beside it.

import type { App } from './app';
import { inSpace, land, placeSequential } from './commands';
import { compileQuery } from './query/evaluate';
import { messyLayout } from './state/piles';
import { queryCard } from './state/selection';
import { newUid } from './state/store';
import { CARD_H, CARD_W, type NamedPile } from './state/types';

/** How far beside a pile turned-away cards land, and how much further each next try is. */
const AWAY = CARD_W + 28;
const AWAY_STEP = CARD_W + 20;

/**
 * Where cards a pile turns away should land: beside it along its own width,
 * right then left, a step further out each try, at the first spot clear of
 * every other card; the nearest spot when none is clear.
 */
export function clearSpot(anchor: { x: number; y: number }, yaw: number, others: { x: number; y: number }[]): { x: number; y: number } {
  const dir = { x: Math.cos(yaw), y: Math.sin(yaw) };
  const spot = (off: number) => ({ x: anchor.x + dir.x * off, y: anchor.y + dir.y * off });
  const free = (s: { x: number; y: number }) => others.every((c) => Math.abs(c.x - s.x) > CARD_W + 10 || Math.abs(c.y - s.y) > CARD_H + 10);
  for (let k = 0; k < 8; k++) {
    for (const side of [1, -1]) {
      const s = spot(side * (AWAY + k * AWAY_STEP));
      if (free(s)) return s;
    }
  }
  return spot(AWAY);
}

export class NamedPiles {
  /** Cards this browser's user added or moved since piles were last detected. */
  private touched = new Set<string>();
  /** A load or New table is putting cards down: no one placed them. */
  private loading = false;

  constructor(private readonly app: App) {
    const store = app.store;
    const note = (uids: string[]) => {
      // Another player's change is theirs to keep in line (their browser does it).
      if (store.origin === 'remote' || this.loading) return;
      for (const u of uids) this.touched.add(u);
    };
    store.events.on('moved', note);
    store.events.on('added', note);
    store.events.on('reset', () => {
      this.loading = true;
      queueMicrotask(() => (this.loading = false));
    });
  }

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
    // Through the store, so a room hears of it (ONLINE.md 11.1).
    store.setNamed([{ id: pileId, name: clean, filter: filter?.trim() || null, anchor: { ...anchor }, yaw }]);
    // Cards of the pile now belong to it by name.
    const members = (pile?.cardUids ?? []).filter((u) => store.cards.has(u));
    if (members.length) store.moveCards(members.map((u) => ({ uid: u, pileId })));
    if (sp && sp.pileId !== pileId) store.setSpreads([{ ...sp, pileId }]);
    if (pile) {
      pile.name = clean;
      pile.filter = filter?.trim() || null;
    }
    store.events.emit('piles', undefined);
    // A new or changed filter applies to the cards already in the pile.
    const { rejected } = this.sort(pileId, members);
    if (rejected.length) this.turnAway(rejected, pileId);
    return null;
  }

  /** Back to an emergent pile (spec 11.3: un-naming). */
  unname(id: string): void {
    const store = this.app.store;
    store.setNamed([], [id]);
    const pile = store.piles.get(id);
    if (pile) {
      pile.name = null;
      pile.filter = null;
    }
    const sp = store.spreads.get(id);
    if (sp?.pileId) store.setSpreads([{ ...sp, pileId: null }]);
    store.events.emit('piles', undefined);
  }

  /**
   * Named piles left with no cards go (decision 328): a named pile lives only
   * while it holds cards; flags are what stays empty. In a room the crown's
   * browser does this, so the room hears of it once.
   */
  dropEmpty(): void {
    const online = this.app.online;
    if (online && !online.room.isCrown) return;
    const gone = this.empty().map((n) => n.id);
    if (gone.length) this.app.store.setNamed([], gone);
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
    // Checked first, so a refused name never reaches the table (or a room).
    const err = this.checkName(id, name) ?? this.checkFilter(filter);
    if (err) return err;
    store.setNamed([{ id, name: '', filter: null, anchor: { ...at }, yaw: 0 }]);
    return this.promote(id, name, filter);
  }

  /** Whether a pile may take this name: not empty, and not another pile's. */
  checkName(id: string, name: string): string | null {
    const clean = name.trim();
    if (!clean) return 'A named pile needs a name';
    const clash = [...this.app.store.named.values()].find((n) => n.id !== id && n.name.toLowerCase() === clean.toLowerCase());
    return clash ? `There is already a pile called ${clash.name}` : null;
  }

  checkFilter(filter: string | null): string | null {
    if (!filter?.trim()) return null;
    const c = compileQuery(filter);
    return c.ok ? null : c.error;
  }

  /**
   * A test of whether a card may be in this named pile, or null when it takes
   * anything (no filter, or one that doesn't compile). A card this browser
   * can't see (rooms) can't be judged, so it may.
   */
  matcher(pileId: string): ((uid: string) => boolean) | null {
    const store = this.app.store;
    const n = store.named.get(pileId);
    if (!n?.filter) return null;
    const compiled = compileQuery(n.filter);
    if (!compiled.ok) return null;
    return (uid) => {
      const c = store.cards.get(uid);
      if (!c) return false;
      return !store.canSee(c) || compiled.test(queryCard(store, c));
    };
  }

  /** Split cards dropped on a named pile into those its filter accepts and rejects (spec 11.3). */
  sort(targetId: string, uids: string[]): { accepted: string[]; rejected: string[] } {
    const fits = this.matcher(targetId);
    if (!fits) return { accepted: uids, rejected: [] };
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const u of uids) (fits(u) ? accepted : rejected).push(u);
    return { accepted, rejected };
  }

  /**
   * After piles are detected (pileSync): every filtered pile that a card this
   * browser's user just added or moved now belongs to turns away the cards
   * that don't match, wherever they came from, including a pile they merged
   * with (decision 322). Cards still in a hand wait until they land.
   */
  keepFilters(): void {
    if (!this.touched.size) return;
    const touched = this.touched;
    this.touched = new Set();
    const store = this.app.store;
    for (const n of [...store.named.values()]) {
      if (!n.filter) continue;
      const pile = store.piles.get(n.id);
      if (!pile || !pile.cardUids.some((u) => touched.has(u))) continue;
      const rejected = this.sort(n.id, pile.cardUids).rejected.filter((u) => !this.app.motion.held.has(u));
      if (rejected.length) this.turnAway(rejected, n.id);
    }
  }

  /**
   * Cards a filtered pile won't take slide off beside it, with a short shake
   * and a notice (spec 11.3). They go to the first spot along the pile's side
   * with no other pile in it, so they never land in a second bin by accident.
   */
  turnAway(uids: string[], pileId: string): void {
    const app = this.app;
    const store = app.store;
    const n = store.named.get(pileId);
    const pile = store.piles.get(pileId);
    const first = store.cards.get(pile?.cardUids[0] ?? uids[0]);
    // Piles on a card stand are laid out in its slope's frame (decision 221).
    const stand = first?.stand ?? null;
    const anchor = pile?.anchor ?? n?.anchor ?? { x: first?.x ?? 0, y: first?.y ?? 0 };
    const yaw = n?.yaw ?? 0;
    const going = new Set(uids);
    const members = new Set(pile?.cardUids ?? []);
    const others = [...store.cards.values()].filter((c) => (c.stand ?? null) === stand && !going.has(c.uid) && !members.has(c.uid));
    const at = { ...clearSpot(anchor, yaw, others), yaw };
    const leaving = uids.filter((u) => store.cards.get(u)?.pileId === pileId);
    if (leaving.length) store.moveCards(leaving.map((u) => ({ uid: u, pileId: null })));
    const spots = messyLayout(uids.length, at).map((p) => ({ x: p.x, y: p.y, yaw: p.yaw }));
    inSpace(stand, () => land(app, placeSequential(app, uids, spots), { duration: 260, arc: 8 }));
    // The shake: a quick wobble once they have slid off.
    setTimeout(() => {
      for (const u of uids) {
        const pose = app.layer.pose(u);
        const c = store.cards.get(u);
        if (!pose || !c) continue;
        const base = c.yaw;
        app.motion.animate(u, { yaw: base + 0.12 }, {
          duration: 60,
          done: () => app.motion.animate(u, { yaw: base - 0.1 }, {
            duration: 70,
            done: () => app.motion.animate(u, { yaw: base }, { duration: 60 }),
          }),
        });
      }
    }, 270);
    const label = uids.length === 1 ? '1 card doesn’t' : `${uids.length} cards don’t`;
    store.events.emit('notice', `${label} match ${n?.name ?? 'the pile'}: \`${n?.filter ?? ''}\``);
  }
}
