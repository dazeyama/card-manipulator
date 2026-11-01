// Tokens on the Card tab (decision 263): type a token's name (and "1/1" for
// its power and toughness), pick one of Scryfall's printings from the list,
// newest first, and it spawns that many, as the Card tab's Spawn does.

import type { App } from '../app';
import { searchTokens } from '../scryfall/tokens';
import { spawnCards, type SpawnOptions } from '../spawn';
import type { CardRecord } from '../state/types';
import { h } from './dom';
import { toast } from './toasts';

/** At most this many printings show at once; typing narrows them. */
const LIST_MAX = 100;

/** "Goblin 1/1 · R · Token Creature — Goblin · TC21 12": enough to tell printings apart. */
export function tokenLabel(r: CardRecord): string {
  const pt = r.power !== undefined && r.toughness !== undefined ? ` ${r.power}/${r.toughness}` : '';
  const colours = r.colors.length ? r.colors.join('') : 'C';
  return `${r.name}${pt} · ${colours} · ${r.type_line} · ${r.set.toUpperCase()} ${r.collector_number}`;
}

export function buildTokens(app: App, options: () => SpawnOptions): HTMLElement {
  const name = h('input', { class: 'grow', placeholder: 'Token, e.g. treasure, goblin 1/1', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Token name' });
  const qty = h('input', { class: 'short', type: 'number', min: '1', max: '400', value: '1', 'aria-label': 'How many tokens' });
  const list = h('div', { class: 'token-list' });
  const status = h('div', { class: 'muted small' });
  let timer = 0;
  let abort: AbortController | null = null;

  const spawn = (r: CardRecord) => {
    const count = Math.max(1, Math.min(400, Math.round(Number(qty.value)) || 1));
    spawnCards(app, [{ record: r, finish: 'nonfoil', count }], options());
    toast(`Spawned ${count} × ${r.name} token${count === 1 ? '' : 's'}`, 'ok');
  };
  const show = (found: CardRecord[]) => {
    const rows = found.slice(0, LIST_MAX).map((r) => {
      const row = h('button', { class: 'token-row', title: 'Spawn this token' }, tokenLabel(r));
      if (r.image_small) {
        const img = h('img', { class: 'token-thumb', src: r.image_small, alt: '', loading: 'lazy' });
        row.prepend(img);
      }
      row.addEventListener('click', () => spawn(r));
      return row;
    });
    list.replaceChildren(...rows);
    status.textContent = found.length
      ? `${found.length >= 350 ? '350+' : found.length} printing${found.length === 1 ? '' : 's'}${found.length > LIST_MAX ? `, the newest ${LIST_MAX} shown: type more to narrow` : ''}. Click one to spawn it.`
      : 'No token matches.';
  };
  name.addEventListener('input', () => {
    clearTimeout(timer);
    abort?.abort();
    const typed = name.value.trim();
    if (typed.length < 2) {
      list.replaceChildren();
      status.textContent = '';
      return;
    }
    // A pause in typing, then one search (the queue spaces searches out anyway).
    timer = window.setTimeout(async () => {
      abort = new AbortController();
      status.textContent = 'Searching Scryfall…';
      try {
        show(await searchTokens(typed, abort.signal));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') status.textContent = 'Scryfall could not be reached.';
      }
    }, 450);
  });
  // Enter spawns the newest match.
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (list.querySelector('.token-row') as HTMLButtonElement | null)?.click();
  });

  return h('div', { class: 'panel-section' },
    h('div', { class: 'panel-section-title' }, 'Tokens'),
    h('div', { class: 'row' }, name, qty),
    status,
    list,
  );
}
