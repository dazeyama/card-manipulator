// The top bar (spec 14.3): table name, and room for save, load, export and settings.

import type { App } from '../app';
import { VIEW_PRESETS } from '../render/camera';
import { h } from './dom';

const PRESET_KEY = 'card-manipulator.view-preset';

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

    // View angle (spec 7.2): cycles the presets; double middle-click straightens to the current one.
    try {
      const saved = Number(localStorage.getItem(PRESET_KEY));
      if (saved > 0 && saved < VIEW_PRESETS.length) app.rig.preset = saved;
    } catch {
      // No storage: start on the first preset.
    }
    const view = h('button', { class: 'btn small view-btn', title: 'Next camera angle (V). Double middle-click straightens back to it.' });
    let shown = -1;
    const syncView = () => {
      if (app.rig.preset === shown) return;
      shown = app.rig.preset;
      view.textContent = `View: ${VIEW_PRESETS[shown].name}`;
      try {
        localStorage.setItem(PRESET_KEY, String(shown));
      } catch {
        // Not remembered this time.
      }
    };
    view.addEventListener('click', () => app.rig.cycle());
    // The V key cycles too, so follow the rig rather than the button.
    app.onFrame(syncView);
    syncView();
    this.actions.append(view);

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
