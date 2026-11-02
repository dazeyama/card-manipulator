// Tidy stacks settle (decision 349). A neat stack is drawn at its cards'
// heights, one card on the next from the table up, so when cards leave from
// under it (pulled out, dealt from the bottom, cut) the cards above were left
// hanging in the air. After each pile detection that follows a change of this
// browser's user, a neat stack with a gap in its heights drops onto what is
// left under it. Messy piles already rest on what is under them.

import type { App } from './app';
import { land } from './commands';
import { remoteHeld } from './state/remoteHeld';
import { CARD_T } from './state/types';

/** How far off its place in the stack a card may be before the stack counts as having a gap, mm. */
const GAP = 0.05;

/**
 * The heights a neat stack's cards should have, bottom first, given the heights
 * they have (sorted, bottom first): one card thickness apart from the table up.
 * Null when they already are.
 */
export function settledHeights(zs: number[]): number[] | null {
  const want = zs.map((_, k) => CARD_T / 2 + k * CARD_T);
  return zs.some((z, k) => Math.abs(z - want[k]) > GAP) ? want : null;
}

export class StackSettler {
  /** This browser's user changed cards since the last detection: another player's changes are theirs to settle. */
  private dirty = false;

  constructor(private readonly app: App) {
    const store = app.store;
    const note = () => {
      if (store.origin !== 'remote') this.dirty = true;
    };
    store.events.on('moved', note);
    store.events.on('removed', note);
    store.events.on('added', note);
  }

  /** After piles are detected (pileSync): drop every neat stack with a gap onto what is under it. */
  settle(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const store = this.app.store;
    const held = this.app.motion.held;
    for (const pile of store.piles.values()) {
      if (pile.kind !== 'stack' || pile.cardUids.length < 1) continue;
      const cards = pile.cardUids.map((u) => store.cards.get(u)!).filter(Boolean).sort((a, b) => a.z - b.z);
      // Cards in someone's hand are theirs until they land.
      if (cards.some((c) => held.has(c.uid) || remoteHeld.has(c.uid))) continue;
      const want = settledHeights(cards.map((c) => c.z));
      if (!want) continue;
      // Only the cards that are off their place drop; a short fall, all together.
      const drops = cards.flatMap((c, k) => (Math.abs(c.z - want[k]) > 1e-4 ? [{ uid: c.uid, x: c.x, y: c.y, z: want[k], yaw: c.yaw }] : []));
      land(this.app, drops, { duration: 180, stagger: 0, keepSide: true });
    }
  }
}
