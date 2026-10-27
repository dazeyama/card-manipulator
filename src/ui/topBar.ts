// The top bar (spec 14.3): table name, and room for save, load, export and settings.

import type { App } from '../app';
import { h } from './dom';

export class TopBar {
  readonly el: HTMLElement;
  /** Buttons and toggles added by later features go here, right-aligned. */
  readonly actions: HTMLElement;
  private readonly status: HTMLElement;

  constructor(private readonly app: App, host: HTMLElement) {
    const name = h('input', { class: 'table-name', 'aria-label': 'Table name', spellcheck: 'false' });
    name.value = app.store.name;
    name.addEventListener('change', () => app.store.setName(name.value));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    app.store.events.on('name', () => (name.value = app.store.name));
    this.status = h('span', { class: 'status muted' });
    this.actions = h('div', { class: 'actions' });
    this.el = h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Card Manipulator'), name, this.status, this.actions);
    host.append(this.el);
    setInterval(() => this.refreshStatus(), 500);

    // Tidy drops (spec 15.4): every release lands squared up when on.
    const tidy = h('button', { class: 'btn small', title: 'When on, every drop lands squared up instead of messy' }, 'Tidy drops');
    const syncTidy = () => {
      tidy.classList.toggle('on', app.store.settings.tidyDrops);
      tidy.setAttribute('aria-pressed', String(app.store.settings.tidyDrops));
    };
    tidy.addEventListener('click', () => app.store.updateSettings({ tidyDrops: !app.store.settings.tidyDrops }));
    app.store.events.on('settings', syncTidy);
    syncTidy();
    this.actions.append(tidy);
  }

  private refreshStatus(): void {
    const n = this.app.store.cards.size;
    const waiting = this.app.images.pending;
    this.status.textContent = `${n.toLocaleString()} card${n === 1 ? '' : 's'}` + (waiting ? ` · loading ${waiting} images` : '');
  }
}
