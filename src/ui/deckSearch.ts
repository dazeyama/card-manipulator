// Search a pile without spreading it (decision 310). L over a face-up pile, or
// L L over a face-down one (a deck), opens a small box at the cursor listing
// its cards: filter them with the query language, switch to their pictures,
// and rest the cursor on one to see it in Inspect. Clicking one takes it out
// the way P does (click where it goes; P again for face down), and when that
// is done, or the box is closed, the pile is shuffled if "Shuffle when done"
// is ticked. In a room a face-down pile is shown to the searcher alone, while
// everyone is told in chat and sees it glow in the searcher's color.

import type { App } from '../app';
import { compileQuery } from '../query/evaluate';
import { queryCard } from '../state/selection';
import type { Card, CardRecord } from '../state/types';
import { h } from './dom';

export type DeckSearchDeps = {
  /** Rest the cursor on a card: Inspect shows it (null: back to what the mouse is over). */
  inspect: (uid: string | null) => void;
  /** Take a card out as P does: pointer mode for it. */
  point: (uids: string[]) => void;
  /** S S on these cards. */
  shuffle: (uids: string[]) => void;
};

/** How long to wait for the room to show a face-down pile before saying it can't. */
const ROOM_WAIT_MS = 5000;

export class DeckSearch {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly query: HTMLInputElement;
  private readonly pictures: HTMLInputElement;
  private readonly shuffleBox: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly list: HTMLDivElement;
  /** The pile being searched; empty when no search is open. */
  private pile: string[] = [];
  /** A room search asked for (face-down cards shown to me alone). */
  private roomSearch = false;
  /** The card taken out, while P places it; the search ends when it lands or is canceled. */
  private taking: string | null = null;
  private waitTimer = 0;
  private placeTimer = 0;
  /** When it opened: the L of an L L typed just after is not a filter. */
  private openedAt = 0;
  /** Stops listening to the room's searches when this one ends. */
  private unlisten: (() => void) | null = null;

  constructor(private readonly app: App, private readonly deps: DeckSearchDeps) {
    this.title = h('div', { class: 'pe-title' });
    this.query = h('input', { class: 'grow', placeholder: 'Filter, e.g. bolt, t:creature, mv<=2', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Filter the pile' });
    this.pictures = h('input', { type: 'checkbox' });
    this.shuffleBox = h('input', { type: 'checkbox' });
    this.shuffleBox.checked = true;
    const close = h('button', { class: 'btn small', title: 'Close (Esc)' }, 'Close');
    this.status = h('div', { class: 'muted small' });
    this.list = h('div', { class: 'deck-list' });
    this.el = h('div', { class: 'token-menu deck-search' },
      h('div', { class: 'row tight deck-head' }, this.title, close),
      h('div', { class: 'row' }, this.query),
      h('div', { class: 'row deck-ticks' },
        h('label', {}, this.pictures, ' Pictures'),
        h('label', { title: 'When the search is over, S S the pile' }, this.shuffleBox, ' Shuffle when done'),
      ),
      this.status,
      this.list,
    );
    this.el.hidden = true;
    document.body.append(this.el);

    this.query.addEventListener('input', () => this.render());
    this.query.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'l' && performance.now() - this.openedAt < 400) e.preventDefault();
    });
    this.pictures.addEventListener('change', () => this.render());
    close.addEventListener('click', () => this.end());
    this.list.addEventListener('pointerleave', () => this.deps.inspect(null));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) {
        e.stopImmediatePropagation();
        this.end();
      }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.end();
    }, true);
    // Cards shown or hidden by the room, or their card data arriving: list them again.
    app.store.events.on('records', () => this.refresh());
    app.store.events.on('removed', () => this.refresh());
  }

  get open(): boolean {
    return this.pile.length > 0;
  }

  /**
   * Search these cards, opening at a point on screen (page pixels). `faceDown`:
   * L L, which may look through face-down cards; in a room, the room shows them.
   */
  start(pile: string[], faceDown: boolean, at: { x: number; y: number }): void {
    const store = this.app.store;
    const cards = pile.filter((u) => store.cards.has(u));
    // The same pile again (L then L L): look through its face-down cards too, without starting over.
    if (this.open && cards.length === this.pile.length && cards.every((u) => this.pile.includes(u))) {
      if (faceDown && !this.roomSearch) this.askRoom();
      return this.render();
    }
    if (this.open) this.end();
    this.pile = cards;
    if (!this.pile.length) return;
    if (faceDown) this.askRoom();
    this.query.value = '';
    this.shuffleBox.checked = true;
    this.shuffleBox.parentElement!.hidden = this.pile.length < 2;
    this.el.hidden = false;
    this.el.style.left = `${Math.max(8, Math.min(at.x + 14, window.innerWidth - 380))}px`;
    this.el.style.top = `${Math.max(8, Math.min(at.y + 10, window.innerHeight - 480))}px`;
    this.openedAt = performance.now();
    this.render();
    this.query.focus();
  }

  /** In a room, ask to be shown the pile's face-down cards (they are hidden from everyone, ONLINE.md 7.1). */
  private askRoom(): void {
    const store = this.app.store;
    const online = this.app.online;
    const hidden = this.pile.filter((u) => !store.canSee(store.cards.get(u)!));
    this.roomSearch = !!online && hidden.length > 0;
    if (this.roomSearch) {
      // The room says the search is on after it has shown me the cards: list them then.
      this.unlisten = online!.room.events.on('searches', () => this.refresh());
      online!.session.send({ t: 'search', uids: this.pile });
      this.waitTimer = window.setTimeout(() => {
        if (this.open && !this.visible().length) this.status.textContent = 'The room could not show this pile: its server may need updating.';
      }, ROOM_WAIT_MS);
    }
  }

  /** The search is over: the room stops showing the pile, and it is shuffled if ticked. */
  end(): void {
    if (!this.open) return;
    clearTimeout(this.waitTimer);
    clearInterval(this.placeTimer);
    this.unlisten?.();
    this.unlisten = null;
    const store = this.app.store;
    const rest = this.pile.filter((u) => u !== this.taking && store.cards.has(u));
    const shuffle = this.shuffleBox.checked;
    if (this.roomSearch) this.app.online?.session.send({ t: 'search', uids: [] });
    this.pile = [];
    this.taking = null;
    this.roomSearch = false;
    this.el.hidden = true;
    this.list.replaceChildren();
    this.deps.inspect(null);
    if (document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)) document.activeElement.blur();
    this.app.canvas.focus();
    if (shuffle && rest.length > 1) this.deps.shuffle(rest);
  }

  /** The pile's cards this browser may see, top card first. */
  private visible(): Card[] {
    const store = this.app.store;
    return this.pile.map((u) => store.cards.get(u)).filter((c): c is Card => !!c && store.canSee(c) && !!store.recordOf(c)).sort((a, b) => b.z - a.z);
  }

  private refresh(): void {
    if (this.open && !this.el.hidden) this.render();
  }

  private render(): void {
    const store = this.app.store;
    const live = this.pile.filter((u) => store.cards.has(u)).length;
    this.title.textContent = `Search · ${live} card${live === 1 ? '' : 's'}`;
    let cards = this.visible();
    const typed = this.query.value.trim();
    if (typed) {
      const compiled = compileQuery(typed);
      if (!compiled.ok) {
        this.status.textContent = compiled.error;
        this.list.replaceChildren();
        return;
      }
      cards = cards.filter((c) => compiled.test(queryCard(store, c)));
    }
    const unseen = live - this.visible().length;
    this.status.textContent = unseen && !this.roomSearch
      ? `${unseen} face-down card${unseen === 1 ? '' : 's'} not shown: L L searches face-down piles.`
      : unseen ? 'Asking the room to show you the pile…'
      : `${cards.length} shown${typed ? ` of ${live}` : ''}, top card first. Click one to take it out.`;
    this.list.classList.toggle('pictures', this.pictures.checked);
    this.list.replaceChildren(...cards.map((c) => this.item(c, store.recordOf(c)!)));
  }

  /** One card: a row, or its picture. Resting on it shows it in Inspect; a click takes it out. */
  private item(card: Card, r: CardRecord): HTMLElement {
    const name = r.name.split(' // ')[0];
    const el = this.pictures.checked
      ? h('button', { class: 'deck-pic', title: name }, r.image_small ? h('img', { src: r.image_small, alt: name, loading: 'lazy' }) : name)
      : h('button', { class: 'token-row deck-row', title: 'Take it out: then click where it goes' },
        h('span', { class: 'deck-name' }, name),
        h('span', { class: 'deck-type' }, r.type_line.split(' — ')[0]),
      );
    el.addEventListener('pointerenter', () => this.deps.inspect(card.uid));
    el.addEventListener('click', () => this.take(card.uid));
    return el;
  }

  /** Take a card out as P does; the search ends once it has been placed or P is canceled. */
  private take(uid: string): void {
    this.taking = uid;
    this.el.hidden = true;
    this.deps.inspect(null);
    this.app.canvas.focus();
    this.deps.point([uid]);
    this.placeTimer = window.setInterval(() => {
      if (!this.app.placing) this.end();
    }, 150);
  }
}
