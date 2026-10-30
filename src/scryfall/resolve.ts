// Decklist lines to printings through POST /cards/collection, 75 identifiers
// a call (spec 5.1, 12.2).

import type { DeckEntry } from '../io/decklist';
import { nameFaces } from '../io/decklist';
import { fold } from '../query/text';
import type { CardRecord } from '../state/types';
import { scryfall } from './client';
import { findToken } from './tokens';
import { getRecords, putRecords, trimCard, type ScryfallCard } from './cardData';
import { DAY, kvGet, kvSet } from './db';
import { nameIndex, type NameIndex } from './names';

type Identifier = { name: string } | { name: string; set: string } | { set: string; collector_number: string };

export interface ResolvedEntry {
  entry: DeckEntry;
  record: CardRecord;
}

export interface Resolution {
  resolved: ResolvedEntry[];
  unresolved: DeckEntry[];
}

const BATCH = 75;
/** At most this many unfound lines are tried as tokens, one search each (decision 263). */
const TOKEN_TRIES = 30;
/** Identifier to printing id, so a list resolved before spawns again without the network. */
const MAP_KEY = 'resolve.ids.v1';
const MAP_AGE = 7 * DAY;
type IdMap = Record<string, { id: string; at: number }>;

/** The identifier Scryfall is asked for. Names go as the catalog spells them (front face for multi-face cards). */
export function identifierFor(entry: DeckEntry, index: NameIndex | null): Identifier {
  if (entry.set && entry.number) return { set: entry.set, collector_number: entry.number };
  const canonical = index?.canonical(entry.name) ?? null;
  const name = canonical ? nameFaces(canonical)[0] : nameFaces(entry.name)[0];
  return entry.set ? { name, set: entry.set } : { name };
}

/** True if the Scryfall card answers this identifier. */
export function matches(card: ScryfallCard, id: Identifier): boolean {
  if ('collector_number' in id) {
    return card.set.toLowerCase() === id.set.toLowerCase() && card.collector_number.toLowerCase() === id.collector_number.toLowerCase();
  }
  const want = fold(id.name);
  const names = [card.name, ...nameFaces(card.name), ...(card.card_faces ?? []).map((f) => f.name)].map(fold);
  if (!names.includes(want)) return false;
  return 'set' in id ? card.set.toLowerCase() === id.set.toLowerCase() : true;
}

export async function resolveEntries(entries: DeckEntry[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<Resolution> {
  let index: NameIndex | null = null;
  try {
    index = await nameIndex();
  } catch {
    // Without the catalog, names go to Scryfall as typed.
  }
  const ids = entries.map((e) => identifierFor(e, index));
  const resolved: ResolvedEntry[] = [];
  const unresolved: DeckEntry[] = [];
  const records: CardRecord[] = [];

  // Lines resolved in the last week come straight from the local cache.
  const map: IdMap = (await kvGet<IdMap>(MAP_KEY))?.value ?? {};
  const now = Date.now();
  const keys = ids.map((id) => JSON.stringify(id).toLowerCase());
  const known = await getRecords(keys.map((k) => (map[k] && now - map[k].at < MAP_AGE ? map[k].id : '')).filter(Boolean));
  const todo: number[] = [];
  keys.forEach((k, i) => {
    const rec = map[k] ? known.get(map[k].id) : undefined;
    if (rec) resolved.push({ entry: entries[i], record: rec });
    else todo.push(i);
  });
  onProgress?.(entries.length - todo.length, entries.length);

  for (let start = 0; start < todo.length; start += BATCH) {
    const idx = todo.slice(start, start + BATCH);
    const batchIds = idx.map((i) => ids[i]);
    const batchEntries = idx.map((i) => entries[i]);
    const res = await scryfall.postJson<{ data: ScryfallCard[]; not_found: Identifier[] }>('/cards/collection', { identifiers: batchIds }, { signal });
    const taken = new Array<boolean>(batchIds.length).fill(false);
    for (const card of res.data) {
      const i = batchIds.findIndex((id, k) => !taken[k] && matches(card, id));
      if (i === -1) continue;
      taken[i] = true;
      const record = trimCard(card);
      records.push(record);
      resolved.push({ entry: batchEntries[i], record });
      map[keys[idx[i]]] = { id: record.id, at: now };
    }
    batchEntries.forEach((e, k) => {
      if (!taken[k]) unresolved.push(e);
    });
    onProgress?.(entries.length - todo.length + Math.min(todo.length, start + BATCH), entries.length);
  }
  // Lines no card answers may be tokens ("3 Treasure", "2 Goblin Token"), which the
  // card lookup leaves out: ask for those by name, a few at most (decision 263).
  if (unresolved.length) {
    const left: DeckEntry[] = [];
    for (const [k, e] of unresolved.entries()) {
      const token = k < TOKEN_TRIES ? await findToken(e.name, e.set).catch(() => null) : null;
      if (!token) {
        left.push(e);
        continue;
      }
      records.push(token);
      resolved.push({ entry: e, record: token });
      map[JSON.stringify(identifierFor(e, index)).toLowerCase()] = { id: token.id, at: now };
    }
    unresolved.length = 0;
    unresolved.push(...left);
  }
  if (records.length) await kvSet(MAP_KEY, map);
  // Keep the list's own order.
  const order = new Map(entries.map((e, i) => [e, i]));
  resolved.sort((a, b) => order.get(a.entry)! - order.get(b.entry)!);
  await putRecords(records);
  return { resolved, unresolved };
}

/** Fetch records by Scryfall id (save files missing their cardData, spec 6.3). */
export async function fetchByIds(ids: string[]): Promise<CardRecord[]> {
  const out: CardRecord[] = [];
  for (let start = 0; start < ids.length; start += BATCH) {
    const res = await scryfall.postJson<{ data: ScryfallCard[] }>('/cards/collection', { identifiers: ids.slice(start, start + BATCH).map((id) => ({ id })) });
    out.push(...res.data.map((c) => trimCard(c)));
  }
  await putRecords(out);
  return out;
}
