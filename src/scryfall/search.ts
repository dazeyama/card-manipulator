// Spawn from a Scryfall query (spec 5.1, 12.1): /cards/search, 175 a page,
// following next_page up to the cap. Extras never spawn (decision 31).

import type { CardRecord } from '../state/types';
import { scryfall } from './client';
import { putRecords, trimCard, type ScryfallCard } from './cardData';

interface SearchPage {
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

/** The query actually sent: the owner's query with extras excluded. */
export function withoutExtras(q: string): string {
  return `(${q.trim()}) -is:extra`;
}

function url(q: string): string {
  return `/cards/search?q=${encodeURIComponent(withoutExtras(q))}&unique=cards&order=name`;
}

/** How many cards the query matches, or 0 for none. Throws on a query Scryfall can't read. */
export async function searchCount(q: string, signal?: AbortSignal): Promise<number> {
  const res = await scryfall.request(`https://api.scryfall.com${url(q)}`, { kind: 'search', signal });
  if (res.status === 404) return 0;
  const body = (await res.json()) as SearchPage & { details?: string };
  if (res.status === 400) throw new Error(body.details ?? 'Scryfall could not read that query');
  if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
  return body.total_cards;
}

/** Up to `cap` matching cards, in name order. */
export async function searchCards(q: string, cap: number, onProgress?: (n: number) => void, signal?: AbortSignal): Promise<CardRecord[]> {
  const out: CardRecord[] = [];
  let next: string | null = url(q);
  while (next && out.length < cap) {
    const page: SearchPage | null = await scryfall.getJson<SearchPage>(next, { kind: 'search', signal });
    if (!page) break;
    for (const c of page.data) {
      if (out.length >= cap) break;
      out.push(trimCard(c));
    }
    onProgress?.(out.length);
    next = page.has_more ? page.next_page ?? null : null;
  }
  await putRecords(out);
  return out;
}
