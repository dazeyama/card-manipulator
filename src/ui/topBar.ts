// The top bar (spec 14.3): table name, and room for save, load, export and settings.

import type { App } from '../app';
import type { Graphics } from '../graphics';
import { VIEW_PRESETS } from '../render/camera';
import { h } from './dom';

const PRESET_KEY = 'card-manipulator.view-preset';

export class TopBar {
  readonly el: HTMLElement;
  /** Buttons and toggles added by later features go here, right-aligned. */
  readonly actions: HTMLElement;
  /** The table's name. In a room only the crown edits it; others see it as text (ONLINE.md 12.1). */
  readonly nameInput: HTMLInputElement;
  /** Rooms (ONLINE.md 12.1): the Go online / Online button and the avatar row, just right of the table name. */
  readonly roomSlot: HTMLElement;
  /** A thin line under the bar while a room's table arrives ("Joining: 2,000 of 4,300 cards", 4.4). */
  readonly progress: HTMLElement;
  private readonly status: HTMLElement;
  private readonly viewButton: HTMLButtonElement;

  constructor(private readonly app: App, host: HTMLElement) {
    const name = h('input', { class: 'table-name', 'aria-label': 'Table name', spellcheck: 'false' });
    this.nameInput = name;
    name.value = app.store.name;
    name.addEventListener('change', () => app.store.setName(name.value));
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    app.store.events.on('name', () => (name.value = app.store.name));
    this.status = h('span', { class: 'status muted' });
    this.actions = h('div', { class: 'actions' });
    this.roomSlot = h('div', { class: 'room-slot' });
    this.progress = h('div', { class: 'join-progress' });
    this.progress.hidden = true;
    this.el = h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Card Manipulator'), name, this.roomSlot, this.status, this.actions, this.progress);
    host.append(this.el);
    setInterval(() => this.refreshStatus(), 500);

    // View angle (spec 7.2): cycles the presets; double right-click straightens to the current one.
    try {
      const saved = Number(localStorage.getItem(PRESET_KEY));
      if (saved > 0 && saved < VIEW_PRESETS.length) app.rig.preset = saved;
    } catch {
      // No storage: start on the first preset.
    }
    const view = h('button', { class: 'btn small view-btn', title: 'Next camera angle (V). Double right-click straightens back to it.' });
    this.viewButton = view;
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

    // Tidy mode (spec 15.4, decision 98): everything lands squared up at quarter turns when on.
    // The setting keeps its old name, tidyDrops, so saved tables still load.
    const tidy = h('button', { class: 'btn small', title: 'Tidy mode (Shift + T): everything lands squared up at 90°, with the calmer drag feel. Off: messy and physical.' }, 'Tidy mode');
    const syncTidy = () => {
      tidy.classList.toggle('on', app.tidy);
      tidy.setAttribute('aria-pressed', String(app.store.settings.tidyDrops));
    };
    // Holding Ctrl turns Tidy mode on while it is held (decision 129): the button shows it.
    let held = false;
    app.onFrame(() => {
      if (app.ctrlHeld !== held) {
        held = app.ctrlHeld;
        syncTidy();
      }
    });
    tidy.addEventListener('click', () => app.store.updateSettings({ tidyDrops: !app.store.settings.tidyDrops }));
    app.store.events.on('settings', syncTidy);
    syncTidy();
    this.actions.append(tidy);

    // Mirror mode (decision 267): the far side of the table; lit while you sit there.
    const mirror = h('button', { class: 'btn small', title: 'Mirror mode (M): sit at the far side of the table. Cards you move from there turn to face you, and new things face you.' }, 'Mirror (M)');
    let mirrored = false;
    app.onFrame(() => {
      if (app.rig.mirrored === mirrored) return;
      mirrored = app.rig.mirrored;
      mirror.classList.toggle('on', mirrored);
      mirror.setAttribute('aria-pressed', String(mirrored));
    });
    mirror.addEventListener('click', () => app.rig.setMirrored(!app.rig.mirrored));
    this.actions.append(mirror);
  }

  /** Let the table's name be edited, or show it as text (a room's non-crown players, ONLINE.md 12.1). */
  setNameEditable(on: boolean): void {
    this.nameInput.readOnly = !on;
    this.nameInput.classList.toggle('readonly', !on);
    this.nameInput.title = on ? '' : 'Only the crown can rename the table';
  }

  /** Graphics mode (decision 152): a button beside the camera angle that switches High and Low. */
  addGraphics(graphics: Graphics): void {
    const btn = h('button', { class: 'btn small graphics-btn' });
    const sync = () => {
      const high = graphics.mode === 'high';
      btn.textContent = `Graphics: ${high ? 'High' : 'Low'}${graphics.lowered ? ' (auto)' : ''}`;
      btn.title = graphics.lowered
        ? 'Lowered by itself above 1,000 cards. Click for High anyway.'
        : high
          ? 'High: sharper rendering, shadows and close-ups. Click for Low.'
          : 'Low: the lighter rendering budget. Click for High.';
    };
    btn.addEventListener('click', () => graphics.toggle());
    graphics.onChange = sync;
    sync();
    this.viewButton.after(btn);
  }

  private refreshStatus(): void {
    const n = this.app.store.cards.size;
    const waiting = this.app.images.pending;
    this.status.textContent = `${n.toLocaleString()} card${n === 1 ? '' : 's'}` + (waiting ? ` · loading ${waiting} images` : '');
  }
}
