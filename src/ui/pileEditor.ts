// The pencil on a pile's badge (spec 11.3): name a pile, give it a filter,
// rename, un-name, or delete an empty named pile's outline.

import type { App } from '../app';
import { h } from './dom';
import { toast } from './toasts';

export class PileEditor {
  private readonly el: HTMLDivElement;
  private pileId: string | null = null;
  /** A bin made by N that is removed again if the editor is cancelled. */
  private fresh = false;
  private readonly name: HTMLInputElement;
  private readonly filter: HTMLInputElement;
  private readonly error: HTMLDivElement;
  private readonly unnameBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly title: HTMLDivElement;

  constructor(private readonly app: App) {
    this.title = h('div', { class: 'pe-title' });
    this.name = h('input', { placeholder: 'Name, e.g. Keep', 'aria-label': 'Pile name', spellcheck: 'false' });
    this.filter = h('input', { class: 'mono', placeholder: 'Filter (optional), e.g. t:creature', 'aria-label': 'Pile filter', spellcheck: 'false' });
    this.error = h('div', { class: 'pe-error' });
    const save = h('button', { class: 'btn primary small' }, 'Save');
    this.unnameBtn = h('button', { class: 'btn small', title: 'Make it an ordinary pile again' }, 'Un-name');
    this.deleteBtn = h('button', { class: 'btn small danger', title: 'Remove this empty pile' }, 'Delete');
    const cancel = h('button', { class: 'btn small ghost' }, 'Cancel');
    this.el = h('div', { class: 'pile-editor', hidden: '' },
      this.title,
      h('label', {}, h('span', {}, 'Name'), this.name),
      h('label', {}, h('span', {}, 'Filter'), this.filter),
      this.error,
      h('div', { class: 'row' }, save, this.unnameBtn, this.deleteBtn, h('span', { class: 'grow' }), cancel),
    );
    document.body.append(this.el);
    save.addEventListener('click', () => this.save());
    cancel.addEventListener('click', () => this.close());
    this.unnameBtn.addEventListener('click', () => {
      if (this.pileId) app.named.unname(this.pileId);
      this.close();
    });
    this.deleteBtn.addEventListener('click', () => {
      if (this.pileId) app.named.remove(this.pileId);
      this.close();
    });
    for (const input of [this.name, this.filter]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.save();
        if (e.key === 'Escape') this.close();
      });
    }
    this.filter.addEventListener('input', () => {
      this.error.textContent = app.named.checkFilter(this.filter.value) ?? '';
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.badge-btn')) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open for a pile (or empty named pile), placed near a screen point. */
  open(pileId: string, near: { x: number; y: number }, fresh = false): void {
    if (this.pileId && this.pileId !== pileId) this.close();
    this.fresh = fresh;
    const store = this.app.store;
    const named = store.named.get(pileId);
    const pile = store.piles.get(pileId);
    const count = pile?.cardUids.length ?? 0;
    this.pileId = pileId;
    this.title.textContent = named ? `${named.name} · ${count ? `${count} card${count === 1 ? '' : 's'}` : 'empty'}` : `Name this pile of ${count}`;
    this.name.value = named?.name ?? '';
    this.filter.value = named?.filter ?? '';
    this.error.textContent = '';
    this.unnameBtn.hidden = !named;
    this.deleteBtn.hidden = !named || this.app.named.hasCards(pileId);
    this.el.hidden = false;
    const w = 300;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, near.x - w / 2));
    const top = Math.max(8, Math.min(window.innerHeight - 200, near.y + 14));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.name.focus();
    this.name.select();
  }

  close(): void {
    if (this.fresh && this.pileId) this.app.named.unname(this.pileId);
    this.fresh = false;
    this.el.hidden = true;
    this.pileId = null;
    this.app.canvas.focus();
  }

  private save(): void {
    if (!this.pileId) return;
    const err = this.app.named.promote(this.pileId, this.name.value, this.filter.value || null);
    if (err) {
      this.error.textContent = err;
      return;
    }
    this.fresh = false;
    toast(`Named ${this.name.value.trim()}${this.filter.value.trim() ? ` with filter \`${this.filter.value.trim()}\`` : ''}`, 'ok');
    this.close();
  }
}
