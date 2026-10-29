// Copy and paste cards (decision 202). Ctrl + C copies the selection as a
// decklist, each card's exact printing and finish, so it pastes into other
// tools too. Ctrl + V spawns the clipboard's cards at the cursor as a messy
// pile: the cards just copied straight away, any other decklist text through
// the same lookup as the List tab. Uses the browser's copy and paste events,
// so no clipboard permission is asked for.

import type { App } from '../app';
import { isTyping } from '../input/keyboard';
import { resolveEntries } from '../scryfall/resolve';
import { spawnCards, type SpawnItem, type SpawnOptions } from '../spawn';
import type { Finish } from '../state/types';
import { toast } from '../ui/toasts';
import { parseDecklist } from './decklist';
import { groupLines, type ExportCard } from './exportDecklist';

/** The decklist text for some cards: exact printings, identical ones merged with a count. */
export function copyText(cards: ExportCard[]): string {
  return cards.length ? groupLines(cards, true).join('\n') + '\n' : '';
}

export function installClipboard(app: App, spawnOptions: () => SpawnOptions): void {
  const store = app.store;
  /** What this table copied last, so pasting it needs no lookups. */
  let copied: { text: string; items: SpawnItem[] } | null = null;
  // Always at the cursor, as a messy pile (squared in Tidy mode, decision 98).
  const options = (): SpawnOptions => ({ ...spawnOptions(), arrival: 'messy', where: 'cursor' });

  document.addEventListener('copy', (e) => {
    if (isTyping() || !store.selection.size || !e.clipboardData) return;
    const items = new Map<string, SpawnItem>();
    const cards: ExportCard[] = [];
    for (const uid of store.selection) {
      const card = store.cards.get(uid);
      const record = card && store.records.get(card.scryfallId);
      if (!card || !record) continue;
      cards.push({ name: record.name, set: record.set, number: record.collector_number, finish: card.finish });
      const key = `${record.id}|${card.finish}`;
      const item = items.get(key);
      if (item) item.count++;
      else items.set(key, { record, finish: card.finish as Finish, count: 1 });
    }
    if (!cards.length) return;
    const text = copyText(cards);
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    copied = { text, items: [...items.values()] };
    toast(`Copied ${cards.length.toLocaleString()} card${cards.length === 1 ? '' : 's'}`, 'ok', 1600);
  });

  document.addEventListener('paste', (e) => {
    if (isTyping() || !e.clipboardData) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    e.preventDefault();
    if (copied && text === copied.text) {
      const uids = spawnCards(app, copied.items, options());
      toast(`Pasted ${uids.length.toLocaleString()} card${uids.length === 1 ? '' : 's'}`, 'ok', 1600);
      return;
    }
    void pasteList(text);
  });

  /** Text from elsewhere: read it as a decklist and look its cards up, as the List tab does. */
  async function pasteList(text: string): Promise<void> {
    const { entries } = parseDecklist(text);
    if (!entries.length) {
      toast('Nothing to paste: the clipboard holds no card list', 'warn');
      return;
    }
    try {
      const { resolved, unresolved } = await resolveEntries(entries);
      const uids = spawnCards(app, resolved.map((r) => ({ record: r.record, finish: r.entry.finish, count: r.entry.count })), options());
      const missed = unresolved.reduce((n, u) => n + u.count, 0);
      toast(`Pasted ${uids.length.toLocaleString()} card${uids.length === 1 ? '' : 's'}${missed ? `; ${missed} not found` : ''}`, missed ? 'warn' : 'ok', 2600);
    } catch (err) {
      toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
    }
  }
}
