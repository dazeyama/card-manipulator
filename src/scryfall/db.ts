// The app's IndexedDB: card records (spec 5.3), cached catalogs and the autosave.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CardRecord } from '../state/types';

interface Schema extends DBSchema {
  cards: { key: string; value: CardRecord };
  kv: { key: string; value: { at: number; value: unknown } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('card-manipulator', 1, {
    upgrade(d) {
      d.createObjectStore('cards', { keyPath: 'id' });
      d.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<{ at: number; value: T } | undefined> {
  try {
    return (await (await db()).get('kv', key)) as { at: number; value: T } | undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('kv', { at: Date.now(), value }, key);
  } catch (err) {
    console.warn('IndexedDB write failed', err);
  }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/**
 * The stored copy if younger than maxAgeMs, otherwise a fresh download,
 * falling back to a stale copy if the download fails (pricing tool's
 * storedOrDownload, on IndexedDB because the name catalog is large).
 */
export async function storedOrDownload<T>(key: string, maxAgeMs: number, download: () => Promise<T>): Promise<T> {
  const stored = await kvGet<T>(key);
  if (stored && Date.now() - stored.at < maxAgeMs) return stored.value;
  try {
    const value = await download();
    await kvSet(key, value);
    return value;
  } catch (err) {
    if (stored) return stored.value;
    throw err;
  }
}
