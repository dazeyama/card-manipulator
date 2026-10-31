// The hidden gate in the browser (ONLINE.md 7.3). A card's identity (its
// scryfallId and finish) may be known when it is face up and on no stand, or
// on a stand you own (7.1); everything else is hidden: other players' stands,
// unowned stands, and every face-down card off your stand, yours included
// (O30). Offline nothing is hidden (O32), except a card saved as hidden from
// a room (7.5), which stays a back forever.
//
// The rule is the same on every browser in a room: the crown's (which holds
// every identity) and the others' (which get HIDDEN from the server for what
// they may not know, and keep any identity a move of their own has just
// covered until the server's `forget` arrives). Every place that reads a
// card's identity goes through `store.recordOf` (undefined when hidden) or
// `store.canSee`; the drawn cards show backs on both faces, without foil.

import type { App } from '../app';
import type { Online } from '.';
import { HIDDEN } from '../../shared/table';
import type { Placed } from '../state/piles';
import { CARD_H, type Card, type Mat } from '../state/types';

export { HIDDEN };

/** May `me` know this card (7.1, the client's twin of shared/redact.ts canSee)? */
export function visibleTo(card: Pick<Card, 'scryfallId' | 'faceUp' | 'stand'>, mats: Map<string, Mat>, me: string): boolean {
  if (card.scryfallId === HIDDEN) return false;
  if (card.stand) return mats.get(card.stand)?.owner === me;
  return card.faceUp;
}

/**
 * Where the cards hidden from this browser go after a layout that sorts by
 * identity (C, C C, E): a face-down row under the layout, unsorted, each card
 * overlapping the last with its corner showing (7.3).
 */
export function hiddenRow(spots: Placed[], count: number, middle: { x: number; y: number }): Placed[] {
  if (!count) return [];
  const step = 24;
  const x0 = spots.length ? Math.min(...spots.map((s) => s.x)) : middle.x - ((count - 1) * step) / 2;
  const y = spots.length ? Math.min(...spots.map((s) => s.y)) - CARD_H - 16 : middle.y;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * step, y, yaw: 0, z: 0 }));
}

/** Split cards into those this browser may see and those hidden from it, keeping their order. */
export function splitHidden(app: App, uids: string[]): { seen: string[]; hidden: string[] } {
  const store = app.store;
  const seen: string[] = [];
  const hidden: string[] = [];
  for (const u of uids) {
    const c = store.cards.get(u);
    if (c && !store.canSee(c)) hidden.push(u);
    else seen.push(u);
  }
  return { seen, hidden };
}

/**
 * Keeps the gate and the drawn cards in step: sets the store's gate for the
 * room (or clears it offline), and redraws any card whose visibility changes
 * as backs on both faces with no foil, or as itself again.
 */
export class HiddenGate {
  /** Cards drawn as hidden right now. */
  private readonly drawnHidden = new Set<string>();

  constructor(private readonly app: App) {
    const store = app.store;
    store.canSee = (card) => card.scryfallId !== HIDDEN && (!app.online || app.online.canSee(card));
    app.images.gate = (card) => store.canSee(card);
    const ev = store.events;
    ev.on('added', (uids) => this.check(uids));
    ev.on('moved', (uids) => this.check(uids));
    // A stand's owner changed, or a stand moved or went: its cards may change.
    ev.on('mats', () => this.checkStands());
    // An identity arrived or was forgotten (reveal, forget): the cards with those ids.
    ev.on('records', (ids) => {
      const set = new Set(ids);
      this.check([...store.cards.values()].filter((c) => set.has(c.scryfallId)).map((c) => c.uid));
    });
    ev.on('removed', (uids) => uids.forEach((u) => this.drawnHidden.delete(u)));
    ev.on('reset', () => this.drawnHidden.clear());
  }

  /** A room was entered or left, or I was welcomed as someone: set its rule and redraw everything. */
  attach(online: Online | null): void {
    if (online) {
      const mats = this.app.store.mats;
      online.canSee = (card) => visibleTo(card, mats, online.room.me);
    }
    this.check([...this.app.store.cards.keys()]);
  }

  private checkStands(): void {
    const uids: string[] = [];
    for (const c of this.app.store.cards.values()) if (c.stand || this.drawnHidden.has(c.uid)) uids.push(c.uid);
    this.check(uids);
  }

  /** Redraw the cards whose visibility differs from how they are drawn. */
  check(uids: Iterable<string>): void {
    const app = this.app;
    const store = app.store;
    for (const uid of uids) {
      const card = store.cards.get(uid);
      if (!card || !app.layer.has(uid)) continue;
      const hidden = !store.canSee(card);
      if (hidden === this.drawnHidden.has(uid)) continue;
      if (hidden) this.drawnHidden.add(uid);
      else this.drawnHidden.delete(uid);
      const { front, back } = app.slotsFor(card);
      app.layer.setSlots(uid, front, back);
      app.layer.setFoil(uid, !hidden && card.finish !== 'nonfoil');
    }
  }
}
