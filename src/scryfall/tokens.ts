// Tokens from Scryfall (decision 263). Scryfall counts tokens as extras, which
// every other search leaves out (decision 31); these ask for them by name,
// every printing, newest first, through the serialized search queue.

import type { CardRecord } from '../state/types';
import { scryfall } from './client';
import { putRecords, trimCard, type ScryfallCard } from './cardData';

interface SearchPage {
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

/** At most this many printings come back for one search. */
const MAX_RESULTS = 350;

/**
 * The Scryfall query for what is typed (pure, tested): every word in the
 * token's name, except "token" itself; "1/1" asks for that power and toughness.
 */
export function tokenQuery(typed: string): string | null {
  const parts = ['t:token'];
  for (const w of typed.trim().split(/\s+/).filter(Boolean)) {
    if (/^tokens?$/i.test(w)) continue;
    const pt = /^(\d+|\*)\/(\d+|\*)$/.exec(w);
    if (pt) parts.push(`pow=${pt[1]}`, `tou=${pt[2]}`);
    else parts.push(`name:"${w.replace(/"/g, '')}"`);
  }
  return parts.length > 1 ? parts.join(' ') : null;
}

/** A token line's name, without a trailing "token" ("Goblin Token" is a Goblin). */
export function tokenName(name: string): string {
  return name.replace(/\s+tokens?$/i, '').trim();
}

async function search(q: string, cap: number, signal?: AbortSignal): Promise<CardRecord[]> {
  const out: CardRecord[] = [];
  let next: string | null = `/cards/search?q=${encodeURIComponent(q)}&unique=prints&include_extras=true&order=released&dir=desc`;
  while (next && out.length < cap) {
    const page: SearchPage | null = await scryfall.getJson<SearchPage>(next, { kind: 'search', signal });
    if (!page) break;
    for (const c of page.data) if (out.length < cap) out.push(trimCard(c));
    next = page.has_more ? page.next_page ?? null : null;
  }
  void putRecords(out);
  return out;
}

/** Token printings matching what is typed, newest first. */
export async function searchTokens(typed: string, signal?: AbortSignal): Promise<CardRecord[]> {
  const q = tokenQuery(typed);
  return q ? search(q, MAX_RESULTS, signal) : [];
}

/** The newest token printing with exactly this name (in this set, if given), for list lines; null if none. */
export async function findToken(name: string, set?: string): Promise<CardRecord | null> {
  const n = tokenName(name);
  if (!n) return null;
  const q = `t:token !"${n.replace(/"/g, '')}"${set ? ` set:${set}` : ''}`;
  const found = await search(q, 1);
  return found[0] ?? null;
}
