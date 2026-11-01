// A floating token search (decision 308): T T over empty table opens a small
// box at the cursor; type a token's name, set how many, and a pick spawns them
// at that spot on the table and closes the box. Esc or a click elsewhere closes
// it too. The same Scryfall search as the Card tab's Tokens (decision 263).

import type { App } from '../app';
import { searchTokens } from '../scryfall/tokens';
import { spawnCards, type SpawnOptions } from '../spawn';
import type { CardRecord } from '../state/types';
import { h } from './dom';
import { toast } from './toasts';
import { tokenLabel } from './tokensUi';

/** At most this many printings show at once; typing narrows them. */
const LIST_MAX = 60;

export class TokenSearch {
  private readonly el: HTMLDivElement;
  private readonly name: HTMLInputElement;
  private readonly qty: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private readonly status: HTMLDivElement;
  /** Where the tokens land, on the table. */
  private spot = { x: 0, y: 0 };
  private timer = 0;
  private abort: AbortController | null = null;

  constructor(private readonly app: App, private readonly options: () => SpawnOptions) {
    this.name = h('input', { class: 'grow', placeholder: 'Token, e.g. treasure, goblin 1/1', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Token name' });
    this.qty = h('input', { class: 'short', type: 'number', min: '1', max: '400', value: '1', 'aria-label': 'How many tokens' });
    this.list = h('div', { class: 'token-list' });
    this.status = h('div', { class: 'muted small' });
    this.el = h('div', { class: 'token-menu token-search' }, h('div', { class: 'pe-title' }, 'Tokens'), h('div', { class: 'row' }, this.name, this.qty), this.status, this.list);
    this.el.hidden = true;
    document.body.append(this.el);

    this.name.addEventListener('input', () => this.search());
    // Enter spawns the newest match.
    this.name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.list.querySelector('.token-row') as HTMLButtonElement | null)?.click();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) {
        e.stopImmediatePropagation();
        this.close();
      }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    }, true);
  }

  /** Open at a point on screen (page pixels), to spawn at `spot` on the table. */
  open(at: { x: number; y: number }, spot: { x: number; y: number }): void {
    this.spot = { x: spot.x, y: spot.y };
    this.name.value = '';
    this.qty.value = '1';
    this.list.replaceChildren();
    this.status.textContent = 'Type a token’s name.';
    this.el.hidden = false;
    this.el.style.left = `${Math.max(8, Math.min(at.x + 14, window.innerWidth - 300))}px`;
    this.el.style.top = `${Math.max(8, Math.min(at.y + 10, window.innerHeight - 380))}px`;
    this.name.focus();
  }

  close(): void {
    clearTimeout(this.timer);
    this.abort?.abort();
    this.el.hidden = true;
    // The keyboard goes back to the table.
    if (document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)) document.activeElement.blur();
    this.app.canvas.focus();
  }

  private search(): void {
    clearTimeout(this.timer);
    this.abort?.abort();
    const typed = this.name.value.trim();
    if (typed.length < 2) {
      this.list.replaceChildren();
      this.status.textContent = 'Type a token’s name.';
      return;
    }
    // A pause in typing, then one search (the queue spaces searches out anyway).
    this.timer = window.setTimeout(async () => {
      const abort = (this.abort = new AbortController());
      this.status.textContent = 'Searching Scryfall…';
      try {
        this.show(await searchTokens(typed, abort.signal));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') this.status.textContent = 'Scryfall could not be reached.';
      }
    }, 450);
  }

  private show(found: CardRecord[]): void {
    this.list.replaceChildren(...found.slice(0, LIST_MAX).map((r) => {
      const row = h('button', { class: 'token-row', title: 'Spawn here' }, tokenLabel(r));
      if (r.image_small) row.prepend(h('img', { class: 'token-thumb', src: r.image_small, alt: '', loading: 'lazy' }));
      row.addEventListener('click', () => this.spawn(r));
      return row;
    }));
    this.status.textContent = found.length
      ? `${found.length >= 350 ? '350+' : found.length} printing${found.length === 1 ? '' : 's'}${found.length > LIST_MAX ? `, the newest ${LIST_MAX} shown` : ''}. Click one to spawn it.`
      : 'No token matches.';
  }

  /** That many at the spot, then close. */
  private spawn(record: CardRecord): void {
    const count = Math.max(1, Math.min(400, Math.round(Number(this.qty.value)) || 1));
    this.close();
    const made = spawnCards(this.app, [{ record, finish: 'nonfoil', count }], { ...this.options(), at: this.spot });
    if (made.length) toast(`Spawned ${count} × ${record.name} token${count === 1 ? '' : 's'}`, 'ok', 1500);
  }
}
