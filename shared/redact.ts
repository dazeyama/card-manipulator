// Hidden information on the server (ONLINE.md 7.1, 7.2, O28): who may know a
// card's identity, and stripping it from what a player is sent. A player may
// know a card when it is face up and not on a stand, or when it lies on a
// stand they own; everything else goes out as HIDDEN. The crown is sent
// everything (its browser is the authority) and is never redacted.
//
// A confirmed op is sent to each player redacted (`add`, `replace`), followed
// by the visibility diff for the cards it touched: `reveal` for cards that
// became visible to that player, `forget` for those that became hidden.
// Pure, tested in tests/redact.test.ts.

import { cardsTouched, type Op } from './ops';
import type { Finish } from '../src/state/types';
import { HIDDEN, type CardSnap, type Mat, type TableState } from './table';

/** A table's cards and mats by uid, built once per op and shared by every recipient. */
export interface TableView {
  cards: Map<string, CardSnap>;
  mats: Map<string, Mat>;
}

export function viewOf(table: TableState): TableView {
  return { cards: new Map(table.cards.map((c) => [c.uid, c])), mats: new Map(table.mats.map((m) => [m.uid, m])) };
}

/**
 * May this player know the card's identity (7.1)? An unsleeved double-faced
 * card is everyone's to see wherever it lies (O119): its back face is as plain
 * as its front, on a stand too, as in a real hand. Sleeves hide it again.
 */
export function canSee(card: CardSnap, mats: ReadonlyMap<string, Mat>, player: string): boolean {
  if (card.dfc && !card.sleeve) return true;
  if (card.stand) {
    // Only a stand's owner sees its cards, and only if the mat really is a stand (review N5).
    const m = mats.get(card.stand);
    return !!m && m.kind === 'stand' && m.owner === player;
  }
  return card.faceUp;
}

/** The card as a player who may not know it is sent it: no printing, no finish, nor that it has a back face; its sleeve shows. */
export function hideCard(card: CardSnap): CardSnap {
  const { dfc: _dfc, raised: _raised, ...rest } = card;
  return { ...rest, scryfallId: HIDDEN, finish: 'nonfoil' };
}

/** Cards with the identities this player may not know taken out. */
export function redactCards(cards: CardSnap[], mats: ReadonlyMap<string, Mat>, player: string): CardSnap[] {
  return cards.map((c) => (canSee(c, mats, player) ? c : hideCard(c)));
}

/** A whole table as this player may see it (snapshots, `replace`). */
export function redactTable(table: TableState, player: string): TableState {
  const mats = new Map(table.mats.map((m) => [m.uid, m]));
  return { ...table, cards: redactCards(table.cards, mats, player) };
}

/**
 * An op as this player may see it. Only `add` and `replace` carry identities;
 * an `add` is judged against the table after the op (`after`), so cards added
 * onto your own stand come through. Anything else goes out as it is.
 */
export function redactOp(op: Op, after: TableView, player: string): Op {
  switch (op.t) {
    case 'add':
      return { t: 'add', cards: redactCards(op.cards, after.mats, player) };
    case 'replace':
      return { t: 'replace', table: redactTable(op.table, player) };
    case 'batch':
      return { t: 'batch', ops: op.ops.map((o) => redactOp(o, after, player)) };
    case 'move':
      // The crown's double-faced marks (O119) only for the cards this player may see.
      if (!op.moves.some((m) => m.dfc)) return op;
      return {
        ...op,
        moves: op.moves.flatMap((m) => {
          if (!m.dfc) return [m];
          const c = after.cards.get(m.uid);
          if (c && canSee(c, after.mats, player)) return [m];
          const { dfc: _dfc, ...rest } = m;
          return Object.keys(rest).length > 1 ? [rest] : [];
        }),
      };
    default:
      return op;
  }
}

/** True if any part of the op carries identities, so it must be redacted per player. */
export function carriesIdentities(op: Op): boolean {
  if (op.t === 'add' || op.t === 'replace') return true;
  if (op.t === 'move') return op.moves.some((m) => m.dfc);
  return op.t === 'batch' && op.ops.some(carriesIdentities);
}

/** The stands a `mat` op changes or removes (a batch: all of its parts'). */
function standsTouched(op: Op, out: Set<string>): void {
  if (op.t === 'mat') {
    for (const m of op.set ?? []) out.add(m.uid);
    for (const u of op.remove ?? []) out.add(u);
    for (const u of op.spill ?? []) out.add(u);
  } else if (op.t === 'batch') for (const o of op.ops) standsTouched(o, out);
}

/**
 * The cards whose visibility the op may change: those it names, and every
 * card on a stand it changes the owner of, removes or spills (7.2). Cards it
 * adds are left out: the redacted `add` already carries what each player may know.
 */
export function affectedCards(op: Op, before: TableView, after: TableView): string[] {
  if (op.t === 'replace') return [];
  const uids = new Set(cardsTouched(op).filter((u) => before.cards.has(u) && after.cards.has(u)));
  const stands = new Set<string>();
  standsTouched(op, stands);
  if (stands.size) {
    for (const c of before.cards.values()) if (c.stand && stands.has(c.stand) && after.cards.has(c.uid)) uids.add(c.uid);
    for (const c of after.cards.values()) if (c.stand && stands.has(c.stand) && before.cards.has(c.uid)) uids.add(c.uid);
  }
  return [...uids];
}

export interface Visibility {
  reveal: { uid: string; scryfallId: string; finish: Finish }[];
  forget: string[];
}

/** What this player learns and must forget when the table goes from `before` to `after`, over these cards. */
export function visibilityDiff(before: TableView, after: TableView, uids: string[], player: string): Visibility {
  const out: Visibility = { reveal: [], forget: [] };
  for (const uid of uids) {
    const b = before.cards.get(uid);
    const a = after.cards.get(uid);
    if (!a || !b) continue;
    const was = canSee(b, before.mats, player);
    const now = canSee(a, after.mats, player);
    if (!was && now) out.reveal.push({ uid, scryfallId: a.scryfallId, finish: a.finish });
    else if (was && !now) out.forget.push(uid);
  }
  return out;
}
