// Every paper printing of a basic land, snow-covered ones included, for the
// Choose basics dialog (decision 210). One search per basic, newest first,
// through the serialized queue; kept for the session, and the card data goes
// into the cache so a chosen printing spawns without asking again.

import type { BasicName, Printing } from '../state/basics';
import type { CardRecord } from '../state/types';
import { putRecords, trimCard, type ScryfallCard } from './cardData';
import { scryfall } from './client';

interface SearchPage {
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
}

const lists = new Map<BasicName, Promise<Printing[]>>();

/** Every printing of a basic, newest first. Fetched once a session; a failure is tried again next time. */
export function printingsOf(basic: BasicName): Promise<Printing[]> {
  let list = lists.get(basic);
  if (!list) {
    list = fetchPrintings(basic);
    list.catch(() => lists.delete(basic));
    lists.set(basic, list);
  }
  return list;
}

async function fetchPrintings(basic: BasicName): Promise<Printing[]> {
  const q = `(!"${basic}" or !"Snow-Covered ${basic}") game:paper`;
  let next: string | null = `/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released&dir=desc`;
  const records: CardRecord[] = [];
  const out: Printing[] = [];
  while (next) {
    const page: SearchPage | null = await scryfall.getJson<SearchPage>(next, { kind: 'search' });
    if (!page) break;
    for (const c of page.data) {
      records.push(trimCard(c));
      out.push({ name: c.name, set: c.set, setName: c.set_name, number: c.collector_number, foil: (c.finishes ?? []).includes('foil') });
    }
    next = page.has_more ? page.next_page ?? null : null;
  }
  void putRecords(records);
  return out;
}
