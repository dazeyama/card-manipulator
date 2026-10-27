// Selection commands (spec 9): select, add, toggle, refine and table search.

import { compileQuery, type QueryCard } from '../query/evaluate';
import type { Store } from './store';
import type { Card } from './types';

/** The query view of one card. */
export function queryCard(store: Store, card: Card): QueryCard {
  return {
    card,
    record: store.records.get(card.scryfallId),
    selected: store.selection.has(card.uid),
    pileName: namedPileOf(store, card),
  };
}

export function namedPileOf(store: Store, card: Card): string | null {
  if (!card.pileId) return null;
  return store.named.get(card.pileId)?.name ?? store.piles.get(card.pileId)?.name ?? null;
}

export type QueryOutcome = { ok: true; matches: string[]; scope: number } | { ok: false; error: string };

/** Cards in scope that match: the selection if any, else the whole table (spec 9.3, 9.6). */
export function runQuery(store: Store, query: string, scope: 'auto' | 'selection' | 'table' = 'auto'): QueryOutcome {
  const compiled = compileQuery(query);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  const useSelection = scope === 'selection' || (scope === 'auto' && store.selection.size > 0);
  const pool: Card[] = useSelection
    ? [...store.selection].map((u) => store.cards.get(u)!).filter(Boolean)
    : [...store.cards.values()];
  const matches = pool.filter((c) => compiled.test(queryCard(store, c))).map((c) => c.uid);
  return { ok: true, matches, scope: pool.length };
}

/** Refine the selection, or search the table when nothing is selected. Returns the outcome. */
export function applyQuery(store: Store, query: string): QueryOutcome {
  const out = runQuery(store, query);
  if (out.ok) store.setSelection(out.matches);
  return out;
}

export function selectAll(store: Store): void {
  store.setSelection(store.cards.keys());
}

export function toggle(store: Store, uids: string[]): void {
  const allIn = uids.every((u) => store.selection.has(u));
  if (allIn) store.removeFromSelection(uids);
  else store.addToSelection(uids);
}

/** Count of distinct piles (or loose cards) the selection touches. */
export function pilesTouched(store: Store, uids: Iterable<string>): number {
  const piles = new Set<string>();
  for (const u of uids) {
    const c = store.cards.get(u);
    if (!c) continue;
    piles.add(c.pileId && store.piles.has(c.pileId) ? c.pileId : `loose:${u}`);
  }
  return piles.size;
}

export interface SelectionSummary {
  count: number;
  /** W U B R G and C (colourless) counts. */
  pips: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>;
  /** Mana value histogram: 0, 1, … 6, 7+. */
  mv: number[];
  /** Distinct piles (two or more cards) the selection touches. */
  piles: number;
  /** Selected cards not in any pile. */
  loose: number;
  /** The pile's name when every selected card is in one named pile. */
  pileName: string | null;
}

export function summarize(store: Store): SelectionSummary {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const mv = new Array<number>(8).fill(0);
  let pileName: string | null | undefined;
  const pileIds = new Set<string>();
  let loose = 0;
  for (const u of store.selection) {
    const c = store.cards.get(u);
    if (!c) continue;
    if (c.pileId && store.piles.has(c.pileId)) pileIds.add(c.pileId);
    else loose++;
    const name = namedPileOf(store, c);
    pileName = pileName === undefined ? name : pileName === name ? name : null;
    const r = store.records.get(c.scryfallId);
    if (!r) continue;
    if (!r.colors.length) pips.C++;
    for (const col of r.colors) if (col in pips) pips[col as keyof typeof pips]++;
    if (!/\bland\b/i.test(r.type_line.split('//')[0])) mv[Math.min(7, Math.floor(r.cmc))]++;
  }
  return { count: store.selection.size, pips, mv, piles: pileIds.size, loose, pileName: pileName ?? null };
}
