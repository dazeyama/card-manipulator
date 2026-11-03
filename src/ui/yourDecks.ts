// Your decks on the List tab (decision 360): every deck saved by sleeving it,
// newest first, with its sleeve, card count and when it was saved. Spawn
// brings one back in its sleeves as a neat face-down stack, ready to shuffle;
// ✏️ renames it, 🗑 deletes it (no Edit, decision 369).

import type { App } from '../app';
import { parseDecklist } from '../io/decklist';
import { deckList, deleteDeck, listDecks, onDecksChanged, renameDeck, type DeckInfo } from '../io/savedDecks';
import { savedAgo } from '../io/saveSlots';
import { resolveEntries } from '../scryfall/resolve';
import { spawnCards, type SpawnOptions } from '../spawn';
import { isArtSleeve, sleeveName } from '../state/sleeves';
import { confirmDialog, textDialog } from './confirm';
import { h } from './dom';
import { toast } from './toasts';

export interface YourDecksDeps {
  /** The spawn panel's options, for where the deck lands. */
  options: () => SpawnOptions;
}

export function buildYourDecks(app: App, deps: YourDecksDeps): HTMLElement {
  const list = h('div', { class: 'your-decks-list' });
  const el = h('div', { class: 'panel-section your-decks' }, h('div', { class: 'panel-section-title' }, 'Your decks'), list);

  const render = async () => {
    const decks = await listDecks().catch(() => [] as DeckInfo[]);
    const now = Date.now();
    list.replaceChildren(...(decks.length ? decks.map((d) => row(d, now)) : [h('div', { class: 'muted small' }, 'Sleeve a deck to keep it here: drop a sleeve pack on it (Accessories tab, or U).')]));
  };

  const row = (d: DeckInfo, now: number): HTMLElement => {
    const swatch = h('div', { class: 'deck-swatch', title: `${sleeveName(d.sleeve, d.artName)} sleeves` });
    if (isArtSleeve(d.sleeve)) {
      swatch.style.backgroundImage = `url("${d.sleeve}")`;
      swatch.classList.add('art');
    } else swatch.style.background = d.sleeve;
    const spawn = h('button', { class: 'btn small primary', title: `Spawn ${d.name} in its sleeves, face down and stacked` }, 'Spawn');
    const rename = h('button', { class: 'btn small ghost', title: 'Rename' }, '✏️');
    const drop = h('button', { class: 'btn small ghost', title: 'Delete this deck' }, '🗑');
    spawn.addEventListener('click', () => void spawnDeck(d, spawn));
    rename.addEventListener('click', () => void (async () => {
      const name = (await textDialog('Rename the deck:', { value: d.name, ok: 'Rename', maxLength: 60 }))?.trim();
      if (!name || name === d.name) return;
      await renameDeck(d.id, name);
      // Its cards on the table go by the new name too, so deck: still finds them (decision 368).
      const moves = [...app.store.cards.values()].filter((c) => c.deck?.toLowerCase() === d.name.toLowerCase()).map((c) => ({ uid: c.uid, deck: name }));
      if (moves.length) app.store.moveCards(moves);
    })());
    drop.addEventListener('click', () => void (async () => {
      if (await confirmDialog(`Delete the deck ${d.name}?`, 'Delete')) await deleteDeck(d.id);
    })());
    return h('div', { class: 'deck-row' },
      swatch,
      h('div', { class: 'deck-text' },
        h('div', { class: 'deck-name', title: d.name }, d.name),
        h('div', { class: 'muted small' }, `${d.cards.toLocaleString()} cards · ${savedAgo(d.savedAt, now)}`)),
      h('div', { class: 'deck-btns' }, spawn, rename, drop));
  };

  /** Spawn a saved deck: its cards looked up as a list's are, landing sleeved, face down, as a neat stack. */
  const spawnDeck = async (d: DeckInfo, button: HTMLButtonElement) => {
    const text = await deckList(d.id);
    if (!text) {
      toast(`${d.name} has no cards saved`, 'warn');
      return;
    }
    button.disabled = true;
    try {
      const { entries } = parseDecklist(text);
      const { resolved, unresolved } = await resolveEntries(entries);
      const uids = spawnCards(app, resolved.map((r) => ({ record: r.record, finish: r.entry.finish, count: r.entry.count })), {
        ...deps.options(), arrival: 'stack', faceUp: false, sleeve: d.sleeve, deck: d.name,
      });
      if (!uids.length) return;
      const missed = unresolved.reduce((n, u) => n + u.count, 0);
      toast(`Spawned ${d.name}: ${uids.length.toLocaleString()} cards, sleeved${missed ? `; ${missed} not found` : ''}`, missed ? 'warn' : 'ok', 2600);
    } catch (err) {
      toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
    } finally {
      button.disabled = false;
    }
  };

  onDecksChanged(() => void render());
  void render();
  // The times ("5 min ago") stay current.
  window.setInterval(() => void render(), 60_000);
  return el;
}
