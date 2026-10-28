// The collapse and pin buttons in a side panel's head (decision 137). Using
// the play space collapses the side panels to give the table more room,
// unless a panel is pinned open with 📌; the pin is remembered per browser.

import type { App } from '../app';
import { h } from './dom';

export class PanelFold {
  /** The pin and collapse buttons, for the panel's head. */
  readonly controls: HTMLElement;
  private pinned = false;
  private readonly pin: HTMLButtonElement;
  private readonly collapse: HTMLButtonElement;

  /**
   * `side` is where the panel sits, which way its arrow points; `name` keys
   * the remembered pin; `pinnedByDefault` is the pin until the owner changes it.
   */
  constructor(private readonly app: App, private readonly panel: HTMLElement, private readonly side: 'left' | 'right', private readonly name: string, pinnedByDefault = false) {
    this.pin = h('button', { class: 'icon-btn pin-btn', title: 'Pin open: this panel stays open when you use the table' }, '📌');
    this.collapse = h('button', { class: 'icon-btn', title: 'Collapse panel' });
    this.pin.addEventListener('click', () => this.setPinned(!this.pinned));
    this.collapse.addEventListener('click', () => this.set(!panel.classList.contains('collapsed')));
    this.controls = h('div', { class: 'panel-head-buttons' }, this.pin, this.collapse);
    this.pinned = pinnedByDefault;
    try {
      const saved = localStorage.getItem(this.key);
      if (saved !== null) this.pinned = saved === '1';
    } catch {
      // No storage: the default.
    }
    this.syncButtons();
  }

  private get key(): string {
    return `card-manipulator.pin.${this.name}`;
  }

  private setPinned(on: boolean): void {
    this.pinned = on;
    try {
      localStorage.setItem(this.key, on ? '1' : '0');
    } catch {
      // Not remembered this time.
    }
    this.syncButtons();
  }

  /** Open or collapse the panel. */
  set(collapsed: boolean): void {
    if (collapsed === this.panel.classList.contains('collapsed')) return;
    this.panel.classList.toggle('collapsed', collapsed);
    this.syncButtons();
    this.app.resize();
  }

  /** The play space was used: collapse, unless pinned open. */
  autoCollapse(): void {
    if (!this.pinned) this.set(true);
  }

  private syncButtons(): void {
    const collapsed = this.panel.classList.contains('collapsed');
    // The arrow points the way the panel will move.
    const out = this.side === 'left' ? '›' : '‹', back = this.side === 'left' ? '‹' : '›';
    this.collapse.textContent = collapsed ? out : back;
    this.collapse.title = collapsed ? 'Open panel' : 'Collapse panel';
    this.pin.classList.toggle('on', this.pinned);
    this.pin.setAttribute('aria-pressed', String(this.pinned));
  }
}
