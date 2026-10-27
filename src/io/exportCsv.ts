// CSV export (spec 14.2): one row per distinct (pile, printing, finish) with
// a quantity, so it round-trips into the owner's CSV tools. Pure.

import type { Finish } from '../state/types';

export interface CsvCard {
  pile: string;
  name: string;
  set: string;
  number: string;
  finish: Finish;
  scryfallId: string;
}

export const CSV_HEADER = 'pile,quantity,name,set,collector_number,finish,scryfall_id';

export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(cards: CsvCard[]): string {
  const rows = new Map<string, { c: CsvCard; n: number }>();
  for (const c of cards) {
    const key = `${c.pile}|${c.scryfallId}|${c.finish}`;
    const r = rows.get(key);
    if (r) r.n++;
    else rows.set(key, { c, n: 1 });
  }
  const sorted = [...rows.values()].sort((a, b) => a.c.pile.localeCompare(b.c.pile) || a.c.name.localeCompare(b.c.name));
  const lines = sorted.map(({ c, n }) => [c.pile, n, c.name, c.set, c.number, c.finish, c.scryfallId].map(csvField).join(','));
  return [CSV_HEADER, ...lines].join('\r\n') + '\r\n';
}
