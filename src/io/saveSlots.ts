// Three save slots in this browser (decision 359), beside autosave's one
// table: Save opens them, each holding a table, its name, card count, when it
// was saved and a small picture of the view. Ctrl + S saves into the slot last
// saved to or loaded from. Kept in IndexedDB like autosave: this browser only.

import type { App } from '../app';
import { kvGet, kvSet } from '../scryfall/db';
import type { TableDoc } from '../state/types';
import { loadDoc, toDoc } from './saveFile';

export const SLOTS = 3;
/** The picture's width in pixels; its height follows the window. */
const THUMB_WIDTH = 240;

/** What the menu shows of a slot; the table itself is stored apart, read only to load it. */
export interface SlotInfo {
  n: number;
  name: string;
  cards: number;
  savedAt: number;
  /** A JPEG data URL of the view when it was saved, or '' if none could be taken. */
  thumb: string;
}

const infoKey = (n: number) => `slot.v1.${n}.info`;
const docKey = (n: number) => `slot.v1.${n}.doc`;
const LAST_KEY = 'slot.v1.last';

/** The slots, 1 to SLOTS, null where empty. */
export async function listSlots(): Promise<(SlotInfo | null)[]> {
  const out: (SlotInfo | null)[] = [];
  for (let n = 1; n <= SLOTS; n++) out.push((await kvGet<SlotInfo>(infoKey(n)))?.value ?? null);
  return out;
}

/** The slot Ctrl + S saves into: the last one saved to or loaded from, or null. */
export async function lastSlot(): Promise<number | null> {
  const n = (await kvGet<number>(LAST_KEY))?.value;
  return typeof n === 'number' && n >= 1 && n <= SLOTS ? n : null;
}

/** Save the table into slot n. Card data stays in the card cache, as for autosave. */
export async function saveSlot(app: App, n: number): Promise<SlotInfo> {
  const doc = toDoc(app, false);
  const info: SlotInfo = { n, name: app.store.name, cards: app.store.cards.size, savedAt: Date.now(), thumb: snapshot(app) };
  await kvSet(docKey(n), doc);
  await kvSet(infoKey(n), info);
  await kvSet(LAST_KEY, n);
  return info;
}

/** Load slot n onto the table. False if it is empty. */
export async function loadSlot(app: App, n: number): Promise<boolean> {
  const doc = (await kvGet<TableDoc>(docKey(n)))?.value;
  if (!doc?.cards) return false;
  await loadDoc(app, doc);
  await kvSet(LAST_KEY, n);
  return true;
}

/** A small picture of the view as it is now. */
function snapshot(app: App): string {
  try {
    // The drawing buffer is only valid right after a render, so render and copy in one go (as dev/shot.ts).
    app.view.render(app.rig.camera);
    const src = app.canvas;
    if (!src.width || !src.height) return '';
    const out = document.createElement('canvas');
    out.width = THUMB_WIDTH;
    out.height = Math.round((THUMB_WIDTH * src.height) / src.width);
    out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.75);
  } catch {
    return '';
  }
}

/** When a slot was saved, said briefly: "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function savedAgo(savedAt: number, now: number): string {
  const min = Math.floor((now - savedAt) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(savedAt).toLocaleDateString();
}
