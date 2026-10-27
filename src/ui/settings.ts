// The settings panel (spec 7, 10.5, 12.1, 14.1, 15.4) and a small confirm dialog.

import type { App } from '../app';
import type { Settings } from '../state/types';
import { h } from './dom';

export class SettingsPanel {
  private readonly el: HTMLDivElement;

  constructor(app: App) {
    const s = () => app.store.settings;
    const set = (patch: Partial<Settings>) => app.store.updateSettings(patch);

    const tidy = h('input', { type: 'checkbox' });
    tidy.addEventListener('change', () => set({ tidyDrops: tidy.checked }));
    const arrival = select([['messy', 'Messy pile'], ['stack', 'Neat stack']], (v) => set({ arrival: v as Settings['arrival'] }));
    const face = select([['up', 'Face up'], ['down', 'Face down']], (v) => set({ spawnFaceUp: v === 'up' }));
    const where = select([['center', 'Centre of view'], ['cursor', 'Last cursor spot']], (v) => set({ spawnWhere: v as Settings['spawnWhere'] }));
    const flick = select([['off', 'Off'], ['normal', 'Normal'], ['sensitive', 'Sensitive']], (v) => set({ flick: v as Settings['flick'] }));
    const cap = h('input', { type: 'number', min: '1', max: '2000', step: '50', class: 'short' });
    cap.addEventListener('change', () => {
      const n = Math.max(1, Math.min(2000, Math.round(Number(cap.value) || 500)));
      cap.value = String(n);
      set({ queryCap: n });
    });
    const exportFmt = select([['names', '4 Lightning Bolt'], ['sets', '4 Lightning Bolt (M11) 149']], (v) => set({ exportWithSet: v === 'sets' }));

    const sync = () => {
      tidy.checked = s().tidyDrops;
      arrival.value = s().arrival;
      face.value = s().spawnFaceUp ? 'up' : 'down';
      where.value = s().spawnWhere;
      flick.value = s().flick;
      cap.value = String(s().queryCap);
      exportFmt.value = s().exportWithSet ? 'sets' : 'names';
    };
    app.store.events.on('settings', sync);

    const close = h('button', { class: 'btn small ghost' }, 'Close');
    close.addEventListener('click', () => this.close());
    this.el = h('div', { class: 'pile-editor settings-panel', hidden: '' },
      h('div', { class: 'pe-title' }, 'Settings'),
      row('Tidy drops', h('label', { class: 'inline' }, tidy, ' every drop lands squared up')),
      row('Spawn arrival', arrival),
      row('Spawn face', face),
      row('Spawn at', where),
      row('Flick to toss', flick),
      row('Query spawn cap', h('span', {}, cap, h('span', { class: 'muted small' }, '  cards (500 default, up to 2,000)'))),
      row('Decklist export', exportFmt),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), close),
    );
    document.body.append(this.el);
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.settings-trigger')) this.close();
    });
    sync();
  }

  toggle(anchor: HTMLElement): void {
    if (!this.el.hidden) return this.close();
    const r = anchor.getBoundingClientRect();
    this.el.hidden = false;
    this.el.style.width = '360px';
    this.el.style.left = `${Math.max(8, r.right - 360)}px`;
    this.el.style.top = `${r.bottom + 6}px`;
  }

  close(): void {
    this.el.hidden = true;
  }
}

function select(options: [string, string][], onChange: (v: string) => void): HTMLSelectElement {
  const el = h('select', {}, ...options.map(([v, label]) => h('option', { value: v }, label)));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function row(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'setting-row' }, h('span', { class: 'setting-label' }, label), control);
}

/** A small modal confirm (load file, new table: spec 14.3). */
export function confirmDialog(message: string, ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    const yes = h('button', { class: 'btn primary' }, ok);
    const no = h('button', { class: 'btn' }, 'Cancel');
    const box = h('div', { class: 'modal' }, h('p', {}, message), h('div', { class: 'row end' }, no, yes));
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    yes.focus();
    const done = (v: boolean) => {
      back.remove();
      resolve(v);
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    });
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) done(false);
    });
  });
}
