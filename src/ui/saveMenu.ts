// The Save button's menu (decision 359): three save slots in this browser,
// each with a picture, the table's name, its card count and when it was saved,
// to save into or load from; and the download of a table file below them.

import type { App } from '../app';
import { lastSlot, listSlots, loadSlot, savedAgo, saveSlot, type SlotInfo } from '../io/saveSlots';
import { confirmDialog } from './confirm';
import { h } from './dom';
import { toast } from './toasts';

export interface SaveMenuOptions {
  /** Download the table as a file (the Save button's old click). */
  download: () => void;
  /** May this player replace the table now (rooms: the crown's Load, ONLINE.md 6.4)? Says why if not. */
  canLoad: () => boolean;
}

export class SaveMenu {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private isOpen = false;

  constructor(private readonly app: App, private readonly anchor: HTMLElement, private readonly opts: SaveMenuOptions) {
    this.list = h('div', { class: 'save-slots' });
    const download = h('button', { class: 'menu-item', title: 'Download the table as a .json file, to keep or send' }, '⬇ Download as file');
    download.addEventListener('click', () => {
      this.close();
      opts.download();
    });
    this.el = h('div', { class: 'save-menu', role: 'menu' },
      h('div', { class: 'menu-head' }, 'Save slots · this browser'),
      this.list,
      h('div', { class: 'save-menu-foot' }, download, h('span', { class: 'muted small' }, 'Ctrl + S saves to the ★ slot')),
    );
    this.el.hidden = true;
    document.body.append(this.el);
    // Away from the menu, or Esc: it closes.
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !this.el.contains(e.target as Node) && !anchor.contains(e.target as Node)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else void this.open();
  }

  async open(): Promise<void> {
    await this.refresh();
    const r = this.anchor.getBoundingClientRect();
    this.el.hidden = false;
    // Under the Save button, kept on screen. The menu follows the UI size (`zoom`), which scales its left and top too.
    const zoom = parseFloat(getComputedStyle(this.el).zoom) || 1;
    const w = this.el.offsetWidth * zoom;
    this.el.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) / zoom}px`;
    this.el.style.top = `${(r.bottom + 6) / zoom}px`;
    this.isOpen = true;
  }

  close(): void {
    this.el.hidden = true;
    this.isOpen = false;
  }

  /** Ctrl + S: into the last slot used, without asking; the menu if none has been used yet. */
  async quickSave(): Promise<void> {
    const n = await lastSlot();
    if (n === null) {
      await this.open();
      toast('Pick a slot: Ctrl + S saves there from now on');
      return;
    }
    await this.save(n);
  }

  private async refresh(): Promise<void> {
    const slots = await listSlots();
    const last = await lastSlot();
    const now = Date.now();
    this.list.replaceChildren(...slots.map((s, i) => this.row(i + 1, s, last === i + 1, now)));
  }

  private row(n: number, s: SlotInfo | null, last: boolean, now: number): HTMLElement {
    const pic = s?.thumb ? h('img', { class: 'save-slot-pic', src: s.thumb, alt: '' }) : h('div', { class: 'save-slot-pic empty' }, String(n));
    const text = s
      ? h('div', { class: 'save-slot-text' },
        h('div', { class: 'save-slot-name', title: s.name }, `${last ? '★ ' : ''}${s.name}`),
        h('div', { class: 'muted small' }, `${s.cards.toLocaleString()} cards · ${savedAgo(s.savedAt, now)}`))
      : h('div', { class: 'save-slot-text' }, h('div', { class: 'save-slot-name muted' }, `${last ? '★ ' : ''}Slot ${n} · empty`));
    const save = h('button', { class: 'btn small primary', title: `Save the table in slot ${n}` }, 'Save here');
    save.addEventListener('click', () => void this.saveFromMenu(n, s));
    const load = h('button', { class: 'btn small', title: s ? `Load ${s.name} from slot ${n}` : 'Nothing saved here yet' }, 'Load');
    load.disabled = !s;
    load.addEventListener('click', () => void this.loadFromMenu(n, s));
    return h('div', { class: 'save-slot' + (last ? ' last' : '') }, pic, text, h('div', { class: 'save-slot-btns' }, save, load));
  }

  private async saveFromMenu(n: number, s: SlotInfo | null): Promise<void> {
    if (s && !(await confirmDialog(`Save over slot ${n}, ${s.name} (${s.cards.toLocaleString()} cards, saved ${savedAgo(s.savedAt, Date.now())})?`, 'Save over'))) return;
    await this.save(n);
    this.close();
  }

  private async save(n: number): Promise<void> {
    try {
      const info = await saveSlot(this.app, n);
      toast(`Saved ${info.name} to slot ${n} (${info.cards.toLocaleString()} cards)`, 'ok');
    } catch (err) {
      toast(`Couldn't save to slot ${n}: ${String((err as Error).message ?? err)}`, 'error');
    }
  }

  private async loadFromMenu(n: number, s: SlotInfo | null): Promise<void> {
    if (!s || !this.opts.canLoad()) return;
    const cards = this.app.store.cards.size;
    if (cards && !(await confirmDialog(`Replace the table (${cards.toLocaleString()} cards) with ${s.name} from slot ${n}?`, 'Load'))) return;
    this.close();
    if (await loadSlot(this.app, n)) toast(`Loaded ${s.name} from slot ${n}`, 'ok');
    else toast(`Slot ${n} is empty`, 'error');
  }
}
