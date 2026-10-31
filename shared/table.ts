// The plain table a room shares (ONLINE.md 8.1): cards, named piles, spreads,
// mats, dice, basics and the table's name, as JSON-ready arrays. It is the
// shape behind the client's Store, the server's mirror, a snapshot and the
// `replace` op. Piles (detected) and the selection are not part of it: every
// browser works them out from positions.
//
// Shared code imports only *types* from src/ (no DOM, no Three, no Workers
// types at run time), so the Worker's bundle stays free of the client.

import type { CardSnap } from '../src/state/history';
import type { Spread } from '../src/state/store';
import type { Mat, NamedPile } from '../src/state/types';
import type { Die } from '../src/state/dice';
import { defaultBasics, type Basics } from '../src/state/basics';

export type { CardSnap, Spread, Mat, NamedPile, Die, Basics };

export interface TableState {
  name: string;
  cards: CardSnap[];
  named: NamedPile[];
  spreads: Spread[];
  mats: Mat[];
  dice: Die[];
  basics: Basics;
}

/**
 * The scryfallId of a card whose identity this browser may not know
 * (ONLINE.md 7.2): the server writes it, with finish 'nonfoil', into what it
 * sends a player who may not see the card.
 */
export const HIDDEN = 'hidden';

/** An empty table, as New table leaves it. */
export function emptyTable(name = 'Untitled table'): TableState {
  return { name, cards: [], named: [], spreads: [], mats: [], dice: [], basics: defaultBasics() };
}
