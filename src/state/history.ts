// One-step undo (decision 204): a snapshot of what an action can change on
// the table, and the difference between two snapshots. Pure, tested without
// a browser; src/undo.ts takes the snapshots and puts one back.
//
// The snapshot is the table as a room shares it (ONLINE.md 11.3: a TableSnap
// is a TableState), so undo and rooms speak the same shape.

import type { Store } from './store';
import type { Card } from './types';
import type { TableState } from '../../shared/table';

/** A card as undo keeps it: everything an action can change. */
export type CardSnap = Pick<Card, 'uid' | 'scryfallId' | 'finish' | 'x' | 'y' | 'z' | 'yaw' | 'faceUp' | 'pileId' | 'spreadOf' | 'laidAt' | 'stand' | 'side' | 'cube'>;

/** Cards, named piles, spreads, mats, dice, basics and the table's name. */
export type TableSnap = TableState;

export function snapshot(store: Store): TableSnap {
  return store.table();
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

/** True if nothing an action can change differs between the two (basics and the name are not undone). */
export function sameTable(a: TableSnap, b: TableSnap): boolean {
  const d = diffCards(a, b);
  return !d.add.length && !d.remove.length && !d.move.length
    && JSON.stringify(a.named) === JSON.stringify(b.named)
    && JSON.stringify(a.spreads) === JSON.stringify(b.spreads)
    && JSON.stringify(a.mats) === JSON.stringify(b.mats)
    && JSON.stringify(byUid(a.dice)) === JSON.stringify(byUid(b.dice));
}

/** Dice in uid order: the same dice in another order are the same dice (review 9). */
function byUid<T extends { uid: string }>(list: T[]): T[] {
  return [...list].sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
}
