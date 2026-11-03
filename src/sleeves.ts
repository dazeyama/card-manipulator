// Sleeves on the table (decision 360, SLEEVES.md): a sleeve pack let go over
// cards sleeves the pile there (or the selection, if that card is selected)
// and is used up; every sleeving saves the pile to Your decks. Also marks
// double-faced cards for rooms (ONLINE.md O119), whose server never sees
// card records.

import type { App } from './app';
import { groupLines, type ExportCard } from './io/exportDecklist';
import { listDecks, saveDeck } from './io/savedDecks';
import { allowedNow, touchable } from './online/guard';
import { isDfc } from './scryfall/trim';
import type { Die } from './state/dice';
import { deckNameFor, isArtSleeve, packSleeve } from './state/sleeves';
import { CARD_H, CARD_W, type Card } from './state/types';
import { toast } from './ui/toasts';
import { confirmDialog, textDialog } from './ui/confirm';

/** Install the pack drop and the double-faced marks. */
export function installSleeves(app: App): void {
  app.dice!.packDrop = (pack, x, y) => dropPack(app, pack, x, y);
  // Cards whose card data arrives later (a loaded table, a room's snapshot) are marked then.
  let queued = false;
  app.store.events.on('records', () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      markDfcs(app);
    });
  });
}

/**
 * Mark double-faced cards that aren't yet (ONLINE.md O119): offline at once;
 * in a room only the crown, who knows every card, and as an op so the server
 * learns which cards are public unsleeved.
 */
export function markDfcs(app: App): void {
  const store = app.store;
  const online = app.online;
  if (online && !online.room.isCrown) return;
  const missing = [...store.cards.values()].filter((c) => {
    if (c.dfc) return false;
    const r = store.records.get(c.scryfallId);
    return !!r && isDfc(r);
  });
  if (!missing.length) return;
  if (!online) for (const c of missing) c.dfc = true;
  else store.moveCards(missing.map((c) => ({ uid: c.uid, dfc: true as const })));
}

/** The card drawn on top at a spot on the table, if any (cards on stands where they are drawn). */
function cardAt(app: App, x: number, y: number): string | null {
  let best: string | null = null;
  let top = -Infinity;
  app.layer.forEach((uid, p) => {
    if (!app.store.cards.has(uid)) return;
    const dx = x - p.x, dy = y - p.y;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    if (Math.abs(dx * c + dy * s) > CARD_W / 2 || Math.abs(-dx * s + dy * c) > CARD_H / 2) return;
    if (p.z > top) {
      top = p.z;
      best = uid;
    }
  });
  return best;
}

/** A pack let go at (x, y): over a card, its pile (or the selection) is sleeved and the pack goes. */
function dropPack(app: App, pack: Die, x: number, y: number): boolean {
  const store = app.store;
  const hit = cardAt(app, x, y);
  // In a room: Move to sleeve, and Tokens to use the pack up, as for taking a die away (O120).
  if (!hit || !allowedNow('move') || !allowedNow('diceRemove')) return false;
  const uids = touchable(store.selection.has(hit) ? [...store.selection] : store.pileOf(hit)?.cardUids.slice() ?? [hit]);
  if (!uids.length) return false;
  // The pack waits over the deck while its name is asked, then goes as the cards are sleeved.
  void sleeveCards(app, uids, packSleeve(pack), pack.artName, pack.uid);
  return true;
}

/**
 * Put every one of these cards in this sleeve, replacing any they wear, and
 * offer to save them as a deck (decisions 360, 367): the name is asked first,
 * so the sleeving, the pack going and the cards' deck name (`deck:`, decision
 * 368) land together as one action, one Ctrl + Z.
 */
export async function sleeveCards(app: App, uids: string[], sleeve: string, artName?: string, pack?: string): Promise<void> {
  const store = app.store;
  let cards = uids.map((u) => store.cards.get(u)).filter((c): c is Card => !!c);
  if (!cards.length) return;
  const named = await askDeckName(app, cards);
  // Only the cards still here.
  cards = cards.filter((c) => store.cards.get(c.uid) === c);
  if (pack) store.removeDice([pack]);
  store.moveCards(cards.map((c) => ({ uid: c.uid, sleeve, deck: named?.name ?? null })));
  if (!named) return;
  try {
    await saveDeck(named.name, named.list, cards.length, sleeve, isArtSleeve(sleeve) ? artName : undefined);
    toast(`${named.replaces ? 'Updated' : 'Saved'} ${named.name} in your decks (List tab) · search deck:${/\s/.test(named.name) ? `"${named.name}"` : named.name}`, 'ok', 3600);
  } catch (err) {
    toast(`Sleeved, but couldn't save the deck: ${String((err as Error).message ?? err)}`, 'warn', 4000);
  }
}

/**
 * The name to save sleeved cards under in Your decks (decision 367), asked in a
 * small window suggesting the pile's name, the cube's, or the next "Deck N", with
 * the snapshot of their printings; null for Don't save. A name already saved
 * asks before replacing it. In a room nothing is asked unless this player may
 * see every card, so nothing hidden is kept.
 */
async function askDeckName(app: App, cards: Card[]): Promise<{ name: string; list: string; replaces: boolean } | null> {
  const store = app.store;
  const n = cards.length;
  const said = `Sleeving ${n.toLocaleString()} card${n === 1 ? '' : 's'}`;
  const hidden = cards.filter((c) => !store.recordOf(c)).length;
  if (hidden) {
    toast(`Sleeved ${n.toLocaleString()} cards. Not saved to your decks: ${hidden.toLocaleString()} card${hidden === 1 ? ' is' : 's are'} hidden from you`, 'info', 3600);
    return null;
  }
  const list: ExportCard[] = cards.map((c) => {
    const r = store.recordOf(c)!;
    return { name: r.name, set: r.set, number: r.collector_number, finish: c.finish };
  });
  const piles = new Set(cards.map((c) => c.pileId));
  const [pileId] = piles;
  const pileName = piles.size === 1 && pileId ? store.named.get(pileId)?.name ?? null : null;
  const cubes = new Set(cards.map((c) => c.cube));
  const [cube] = cubes;
  const cubeName = cubes.size === 1 && cube ? store.cubes.get(cube)?.name ?? null : null;
  const existing = (await listDecks().catch(() => [])).map((d) => d.name);
  let name = deckNameFor(pileName, cubeName, existing).name;
  for (;;) {
    const typed = (await textDialog(`${said}. Name the deck to keep it in Your decks:`, { value: name, ok: 'Save deck', cancel: 'Don’t save', maxLength: 60 }))?.trim();
    if (typed === undefined) {
      toast(`Sleeved ${n.toLocaleString()} cards; not saved to your decks`, 'info', 2200);
      return null;
    }
    if (!typed) continue;
    name = typed;
    const replaces = existing.some((d) => d.toLowerCase() === name.toLowerCase());
    // A name already saved: replace it, or pick another.
    if (!replaces || (await confirmDialog(`Your decks already has ${name}. Replace it with these ${n.toLocaleString()} cards?`, 'Replace'))) {
      return { name, list: groupLines(list, true).join('\n') + '\n', replaces };
    }
  }
}
