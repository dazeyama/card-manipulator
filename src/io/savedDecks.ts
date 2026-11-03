// Your decks (decision 360): every sleeving saves the pile it sleeved as a
// deck, a snapshot of its exact printings and finishes with its sleeve, kept
// in this browser's IndexedDB beside autosave and the save slots. The List
// tab lists them; Spawn brings one back sleeved, face down, as a neat stack.

import { kvGet, kvSet } from '../scryfall/db';
import { newUid } from '../state/store';

/** What the List tab shows of a saved deck; its decklist is kept apart. */
export interface DeckInfo {
  id: string;
  name: string;
  cards: number;
  savedAt: number;
  /** Its sleeve: a color `#rrggbb` or an art crop's URL (src/state/sleeves.ts). */
  sleeve: string;
  /** The art's card name, for an art sleeve. */
  artName?: string;
}

const INDEX_KEY = 'deck.v1.index';
const listKey = (id: string) => `deck.v1.${id}`;

/** Listeners told when the decks change, so the List tab redraws. */
const listeners = new Set<() => void>();

export function onDecksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(): void {
  for (const fn of listeners) fn();
}

/** The saved decks, newest first. */
export async function listDecks(): Promise<DeckInfo[]> {
  const list = (await kvGet<DeckInfo[]>(INDEX_KEY))?.value ?? [];
  return [...list].sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Save a deck: a new one, or in place of the one with the same name (case
 * aside). Returns its info.
 */
export async function saveDeck(name: string, list: string, cards: number, sleeve: string, artName?: string): Promise<DeckInfo> {
  const decks = await listDecks();
  const same = decks.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const info: DeckInfo = { id: same?.id ?? newUid('k'), name, cards, savedAt: Date.now(), sleeve, ...(artName ? { artName } : {}) };
  await kvSet(listKey(info.id), { list });
  await kvSet(INDEX_KEY, [info, ...decks.filter((d) => d.id !== info.id)]);
  changed();
  return info;
}

/** A saved deck's decklist, or null if it is gone. */
export async function deckList(id: string): Promise<string | null> {
  return (await kvGet<{ list: string }>(listKey(id)))?.value?.list ?? null;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  const decks = await listDecks();
  await kvSet(INDEX_KEY, decks.map((d) => (d.id === id ? { ...d, name } : d)));
  changed();
}

export async function deleteDeck(id: string): Promise<void> {
  const decks = await listDecks();
  await kvSet(INDEX_KEY, decks.filter((d) => d.id !== id));
  await kvSet(listKey(id), null);
  changed();
}
