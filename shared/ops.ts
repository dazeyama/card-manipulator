// Ops (ONLINE.md 8.2): one change to the table, proposed by a player, judged
// by the crown's browser, stamped with a sequence number by the server and
// applied by everyone. shared/apply.ts is the one place an op changes a
// TableState; on the client the Store's mutation methods make them (11.1).

import type { CardMove } from '../src/state/store';
import type { Basics, CardSnap, CubeInfo, Die, Flag, Mat, NamedPile, Spread, TableState } from './table';

export type { CardMove };

export type Op =
  /** Spawn, paste, tray restore. */
  | { t: 'add'; cards: CardSnap[] }
  /** Delete, the Removed tray. */
  | { t: 'remove'; uids: string[] }
  /** Landings, flips, turns, layouts, deals. Clears holds on those uids. `shuffle` marks an S S (7.2: hidden cards get fresh uids after). */
  | { t: 'move'; moves: CardMove[]; shuffle?: boolean }
  /** A hold request (8.4): confirmed, the cards and dice are in your hand until they land. Not table state. */
  | { t: 'grab'; uids: string[]; dice?: string[] }
  /** The hand emptied without landing (Esc, cancel). */
  | { t: 'release'; uids: string[]; dice?: string[] }
  /** Crown only, after a shuffle of hidden cards (7.2): [old uid, new uid]. */
  | { t: 'reuid'; pairs: [string, string][] }
  | { t: 'named'; set?: NamedPile[]; remove?: string[] }
  | { t: 'spread'; set?: Spread[]; remove?: string[] }
  /** Spawn, move, lock, life, name, owner; `spill` removes stands with their cards dropped (6.3). */
  | { t: 'mat'; set?: Mat[]; remove?: string[]; spill?: string[] }
  /** Spawn, move, roll result, number, color. */
  | { t: 'dice'; set?: Die[]; remove?: string[] }
  | { t: 'basics'; basics: Basics }
  /** The CubeCobra cubes on the table (decision 321, O113): added or updated by id, or dropped. */
  | { t: 'cubes'; set?: CubeInfo[]; remove?: string[] }
  /** Flags (decision 327, O114): placed, moved or changed whole by uid, or taken away. */
  | { t: 'flag'; set?: Flag[]; remove?: string[] }
  /** Crown only: the table's name. */
  | { t: 'table'; name: string }
  /** Crown only: New table, Load file. */
  | { t: 'replace'; table: TableState }
  /**
   * **(agent, O93)** Several ops judged, confirmed and applied as one, in
   * order: an undo swap, a spill's `move` + `mat remove`, or any action that
   * writes the store more than once. Refused whole, rolled back whole.
   */
  | { t: 'batch'; ops: Op[] };

export type OpKind = Op['t'];

/** A confirmed op as everyone applies it: `seq` from the server, `by` the player whose op it was, `id` theirs. */
export interface ConfirmedOp {
  seq: number;
  by: string;
  id?: string;
  op: Op;
}

/**
 * The card uids an op names directly (a batch: all of its parts'). For the
 * server's visibility diffs (7.2) and the crown's touchedSeq (8.6). A `mat` op
 * also affects the cards on the stands it changes; that needs the table, so
 * callers add those themselves.
 */
export function cardsTouched(op: Op): string[] {
  switch (op.t) {
    case 'add':
      return op.cards.map((c) => c.uid);
    case 'remove':
      return [...op.uids];
    case 'move':
      return op.moves.map((m) => m.uid);
    case 'grab':
    case 'release':
      return [...op.uids];
    case 'reuid':
      return op.pairs.flatMap(([a, b]) => [a, b]);
    case 'spread':
      return (op.set ?? []).flatMap((s) => s.uids);
    case 'replace':
      return op.table.cards.map((c) => c.uid);
    case 'batch':
      return [...new Set(op.ops.flatMap(cardsTouched))];
    default:
      return [];
  }
}

/** The die uids an op names directly. */
export function diceTouched(op: Op): string[] {
  switch (op.t) {
    case 'dice':
      return [...(op.set ?? []).map((d) => d.uid), ...(op.remove ?? [])];
    case 'grab':
    case 'release':
      return [...(op.dice ?? [])];
    case 'replace':
      return op.table.dice.map((d) => d.uid);
    case 'batch':
      return [...new Set(op.ops.flatMap(diceTouched))];
    default:
      return [];
  }
}
