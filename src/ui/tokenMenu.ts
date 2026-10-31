// A card's tokens (decision 264): T T over a card opens a small menu beside
// the cursor listing the tokens that card makes, from its Scryfall data; each
// click spawns one beside the card, and the menu stays open for more. Esc or
// a click elsewhere closes it.

import type { App } from '../app';
import { tokensMadeBy } from '../scryfall/tokens';
import { spawnCards, type SpawnOptions } from '../spawn';
import { CARD_W, type CardRecord } from '../state/types';
import { h } from './dom';
import { toast } from './toasts';

export class TokenMenu {
  private readonly el: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly title: HTMLDivElement;
  /** The card asked about, to spawn beside; and a count of spawns, to fan them out a little. */
  private card = '';
  private made = 0;

  constructor(private readonly app: App, private readonly options: () => SpawnOptions) {
    this.title = h('div', { class: 'pe-title' });
    this.list = h('div', { class: 'token-list' });
    this.el = h('div', { class: 'token-menu', hidden: '' }, this.title, this.list);
    document.body.append(this.el);
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

  close(): void {
    this.el.hidden = true;
  }

  /** Open for a card, beside a point on screen (page pixels). */
  async open(uid: string, at: { x: number; y: number }): Promise<void> {
    const store = this.app.store;
    const card = store.cards.get(uid);
    // A card hidden from this browser in a room makes nothing it can show (ONLINE.md 7.3).
    const record = card && store.recordOf(card);
    if (!card || !record) return;
    this.card = uid;
    this.made = 0;
    this.title.textContent = `${record.name.split(' // ')[0]} makes`;
    this.list.replaceChildren(h('div', { class: 'muted small' }, 'Asking Scryfall…'));
    this.el.hidden = false;
    this.el.style.left = `${Math.min(at.x + 14, window.innerWidth - 300)}px`;
    this.el.style.top = `${Math.min(at.y + 10, window.innerHeight - 200)}px`;
    let tokens;
    try {
      tokens = await tokensMadeBy(card.scryfallId);
    } catch {
      if (this.card === uid) this.list.replaceChildren(h('div', { class: 'muted small' }, 'Scryfall could not be reached.'));
      return;
    }
    if (this.card !== uid || this.el.hidden) return;
    if (!tokens.length) {
      this.list.replaceChildren(h('div', { class: 'muted small' }, 'No tokens Scryfall knows of. The Card tab’s Tokens search has every token.'));
      return;
    }
    this.list.replaceChildren(...tokens.map((t) => {
      const pt = t.power !== undefined && t.toughness !== undefined ? ` ${t.power}/${t.toughness}` : '';
      const row = h('button', { class: 'token-row', title: 'Spawn one beside the card' }, `${t.name}${pt} · ${t.type_line}`);
      if (t.image_small) row.prepend(h('img', { class: 'token-thumb', src: t.image_small, alt: '' }));
      row.addEventListener('click', () => this.spawn(t));
      return row;
    }));
  }

  /** One token beside the card, each next one a little further along, so they don't all land on one spot. */
  private spawn(record: CardRecord): void {
    const card = this.app.store.cards.get(this.card);
    if (!card) return this.close();
    const c = Math.cos(card.yaw), s = Math.sin(card.yaw);
    const along = CARD_W + 10 + (this.made % 6) * 12;
    this.made++;
    // On the table beside it; for a card on a stand, whose spot is on the slope, where the mouse last was on the table.
    const at = card.stand ? this.app.lastTablePoint : { x: card.x + along * c, y: card.y + along * s };
    spawnCards(this.app, [{ record, finish: 'nonfoil', count: 1 }], { ...this.options(), at: { x: at.x, y: at.y } });
    toast(`Spawned a ${record.name} token`, 'ok', 1200);
  }
}
