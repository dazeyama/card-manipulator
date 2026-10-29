// The IndexedDB cache of trimmed card records (spec 5.3).

import type { CardRecord } from '../state/types';
import { db } from './db';

export { isDfc, trimCard, type ScryfallCard } from './trim';

export async function getRecords(ids: string[]): Promise<Map<string, CardRecord>> {
  const out = new Map<string, CardRecord>();
  try {
    const tx = (await db()).transaction('cards');
    await Promise.all(ids.map(async (id) => {
      const r = await tx.store.get(id);
      if (r) out.set(id, r);
    }));
  } catch (err) {
    console.warn('Card cache read failed', err);
  }
  return out;
}

export async function putRecords(records: CardRecord[]): Promise<void> {
  if (!records.length) return;
  try {
    const tx = (await db()).transaction('cards', 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
  } catch (err) {
    console.warn('Card cache write failed', err);
  }
}
