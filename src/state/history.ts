// One-step undo (decision 204): a snapshot of what an action can change on
// the table, and the difference between two snapshots. Pure, tested without
// a browser; src/undo.ts takes the snapshots and puts one back.

import type { Spread, Store } from './store';
import type { Card, Mat, NamedPile } from './types';

/** A card as undo keeps it: everything an action can change. */
export type CardSnap = Pick<Card, 'uid' | 'scryfallId' | 'finish' | 'x' | 'y' | 'z' | 'yaw' | 'faceUp' | 'pileId' | 'spreadOf' | 'laidAt' | 'stand'>;

export interface TableSnap {
  cards: CardSnap[];
  named: NamedPile[];
  spreads: Spread[];
  mats: Mat[];
}

export function snapshot(store: Store): TableSnap {
  return {
    cards: [...store.cards.values()].map((c) => ({
      uid: c.uid, scryfallId: c.scryfallId, finish: c.finish,
      x: c.x, y: c.y, z: c.z, yaw: c.yaw, faceUp: c.faceUp,
      pileId: c.pileId, spreadOf: c.spreadOf, laidAt: c.laidAt ? { ...c.laidAt } : undefined, stand: c.stand,
    })),
    named: [...store.named.values()].map((p) => ({ ...p, anchor: { ...p.anchor } })),
    spreads: [...store.spreads.values()].map((s) => ({ ...s, anchor: { ...s.anchor }, uids: [...s.uids] })),
    mats: [...store.mats.values()].map((m) => ({ ...m })),
  };
}

/** What turns the table at `now` back into `then`: cards to add back, to take away, and to move. */
export interface CardDiff {
  add: CardSnap[];
  remove: string[];
  move: CardSnap[];
}

function same(a: CardSnap, b: CardSnap): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.faceUp === b.faceUp
    && a.pileId === b.pileId && a.spreadOf === b.spreadOf && a.stand === b.stand
    && a.laidAt?.x === b.laidAt?.x && a.laidAt?.y === b.laidAt?.y;
}

export function diffCards(now: TableSnap, then: TableSnap): CardDiff {
  const nowBy = new Map(now.cards.map((c) => [c.uid, c]));
  const thenBy = new Map(then.cards.map((c) => [c.uid, c]));
  return {
    add: then.cards.filter((c) => !nowBy.has(c.uid)),
    remove: now.cards.filter((c) => !thenBy.has(c.uid)).map((c) => c.uid),
    move: then.cards.filter((c) => {
      const n = nowBy.get(c.uid);
      return n !== undefined && !same(n, c);
    }),
  };
}

/** True if nothing an action can change differs between the two. */
export function sameTable(a: TableSnap, b: TableSnap): boolean {
  const d = diffCards(a, b);
  return !d.add.length && !d.remove.length && !d.move.length
    && JSON.stringify(a.named) === JSON.stringify(b.named)
    && JSON.stringify(a.spreads) === JSON.stringify(b.spreads)
    && JSON.stringify(a.mats) === JSON.stringify(b.mats);
}
