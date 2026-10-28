// The inspect panel (spec 13): a large `normal` image and the card's text for
// the card under the cursor (after about 150 ms), or the one selected card.
// Double-faced cards show both faces. Click the image to pin it.

import type { App } from '../app';
import { setName } from '../scryfall/names';
import type { Card, CardRecord } from '../state/types';
import { h } from './dom';
import { PanelFold } from './panelFold';

const HOVER_MS = 150;

export class InspectPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  readonly fold: PanelFold;
  // undefined until the first render, so the empty state is drawn too.
  private shown: string | null | undefined = undefined;
  private pinned: string | null = null;
  private hovered: string | null = null;
  private timer = 0;

  constructor(private readonly app: App, host: HTMLElement) {
    this.body = h('div', { class: 'inspect-body' });
    const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, 'Inspect'));
    this.el = h('aside', { class: 'panel inspect-panel' }, head, this.body);
    // Collapse and pin buttons; using the table collapses the panel unless pinned (decision 137).
    // Pinned open by default (decision 138).
    this.fold = new PanelFold(app, this.el, 'right', 'inspect', true);
    head.append(this.fold.controls);
    host.append(this.el);
    app.store.events.on('selection', () => this.refresh());
    app.store.events.on('records', () => {
      const shown = this.shown;
      this.shown = null;
      if (shown) this.show(shown);
    });
    app.store.events.on('removed', (uids) => {
      if (this.pinned && uids.includes(this.pinned)) this.pinned = null;
      this.refresh();
    });
    this.refresh();
  }

  /** The hovered card changed (from the mouse). */
  hover(uid: string | null): void {
    this.hovered = uid;
    clearTimeout(this.timer);
    if (uid) this.timer = window.setTimeout(() => this.refresh(), HOVER_MS);
    else this.refresh();
  }

  private refresh(): void {
    if (this.pinned) return this.show(this.pinned);
    const store = this.app.store;
    const target = this.hovered ?? (store.selection.size === 1 ? [...store.selection][0] : null);
    this.show(target);
  }

  private show(uid: string | null): void {
    if (uid === this.shown) return;
    this.shown = uid;
    const card = uid ? this.app.store.cards.get(uid) : undefined;
    const r = card ? this.app.store.records.get(card.scryfallId) : undefined;
    if (!card || !r) {
      this.body.replaceChildren(h('p', { class: 'muted inspect-empty' }, 'Rest the cursor on a card to see it here. Click the image to pin it.'));
      return;
    }
    this.body.replaceChildren(...this.render(card, r));
  }

  private render(card: Card, r: CardRecord): HTMLElement[] {
    const out: HTMLElement[] = [];
    // Double-faced cards show both faces' images, stacked (spec 13).
    const images = r.back_image_normal ? [r.image_normal, r.back_image_normal] : [r.image_normal];
    const imgs = h('div', { class: 'inspect-images' + (this.pinned === card.uid ? ' pinned' : '') });
    for (const src of images) {
      if (!src) continue;
      const img = h('img', { src, alt: r.name, draggable: 'false' });
      img.addEventListener('click', () => {
        this.pinned = this.pinned === card.uid ? null : card.uid;
        this.shown = null;
        this.refresh();
      });
      imgs.append(img);
    }
    imgs.title = this.pinned === card.uid ? 'Pinned: click to unpin' : 'Click to pin';
    out.push(imgs);
    if (this.pinned === card.uid) out.push(h('div', { class: 'pin-note' }, '📌 Pinned · click the image to unpin'));

    const faces = r.faces.length ? r.faces : [{ name: r.name, mana_cost: r.mana_cost, type_line: r.type_line, oracle_text: r.oracle_text, colors: r.colors, power: r.power, toughness: r.toughness, loyalty: r.loyalty }];
    for (const f of faces) {
      const stats = f.power !== undefined && f.toughness !== undefined ? `${f.power}/${f.toughness}` : f.loyalty !== undefined ? `Loyalty ${f.loyalty}` : '';
      out.push(h('div', { class: 'face' },
        h('div', { class: 'face-head' }, h('strong', {}, f.name), manaCost(f.mana_cost)),
        h('div', { class: 'type-line' }, f.type_line),
        ...(f.oracle_text ? [oracle(f.oracle_text)] : []),
        ...(stats ? [h('div', { class: 'stats' }, stats)] : []),
      ));
    }
    const finish = card.finish === 'nonfoil' ? 'Nonfoil' : card.finish === 'foil' ? 'Foil' : 'Etched foil';
    out.push(h('div', { class: 'printing muted' },
      `${r.set_name || setName(r.set) || r.set.toUpperCase()} (${r.set.toUpperCase()}) #${r.collector_number} · ${cap(r.rarity)} · ${finish}${card.faceUp ? '' : ' · face down'}`));
    return out;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** {2}{R}{R} as small symbol pills. */
function manaCost(cost: string): HTMLElement {
  const wrap = h('span', { class: 'mana' });
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase();
    const cls = /^[WUBRGC]$/.test(sym) ? `sym sym-${sym.toLowerCase()}` : 'sym';
    wrap.append(h('span', { class: cls }, sym.replace('/', '')));
  }
  return wrap;
}

/** Oracle text with symbols inline and a paragraph per line. */
function oracle(text: string): HTMLElement {
  const box = h('div', { class: 'oracle' });
  for (const line of text.split('\n')) {
    const p = h('p', {});
    let last = 0;
    for (const m of line.matchAll(/\{([^}]+)\}/g)) {
      p.append(line.slice(last, m.index));
      const sym = m[1].toUpperCase();
      p.append(h('span', { class: /^[WUBRGC]$/.test(sym) ? `sym sym-${sym.toLowerCase()}` : 'sym' }, sym.replace('/', '')));
      last = (m.index ?? 0) + m[0].length;
    }
    p.append(line.slice(last));
    box.append(p);
  }
  return box;
}
