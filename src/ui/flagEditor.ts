// A flag's box (decision 327): its name, its filter and its color. It opens
// when a flag is placed, from the flag's ✏️, or a click on its cloth. Saving a
// filter turns away the cards in the zone that don't match it.

import type { App } from '../app';
import { compileQuery } from '../query/evaluate';
import { FLAG_COLOURS, type Flag } from '../state/flags';
import { h } from './dom';

/** Longest flag name: it is written on a small cloth. */
const NAME_MAX = 40;

export class FlagEditor {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly name: HTMLInputElement;
  private readonly filter: HTMLInputElement;
  private readonly error: HTMLDivElement;
  private readonly swatches: HTMLDivElement;
  private colour = FLAG_COLOURS[0];
  private uid: string | null = null;
  /** Just placed: Cancel takes it away again. */
  private fresh = false;

  constructor(private readonly app: App, private readonly hooks: { saved: (flag: Flag) => void; remove: (uid: string) => void }) {
    this.title = h('div', { class: 'pe-title' });
    this.name = h('input', { placeholder: 'Name, e.g. Keep', 'aria-label': 'Flag name', spellcheck: 'false', maxlength: String(NAME_MAX) });
    this.filter = h('input', { class: 'mono', placeholder: 'Filter (optional), e.g. t:creature', 'aria-label': 'Flag filter', spellcheck: 'false' });
    this.error = h('div', { class: 'pe-error' });
    this.swatches = h('div', { class: 'flag-swatches' });
    const save = h('button', { class: 'btn primary small' }, 'Save');
    const remove = h('button', { class: 'btn small danger', title: 'Take the flag away; its cards stay where they are' }, 'Delete');
    const cancel = h('button', { class: 'btn small ghost' }, 'Cancel');
    this.el = h('div', { class: 'pile-editor flag-editor', hidden: '' },
      this.title,
      h('label', {}, h('span', {}, 'Name'), this.name),
      h('label', {}, h('span', {}, 'Filter'), this.filter),
      this.error,
      h('div', { class: 'flag-colour-row' }, h('span', {}, 'Color'), this.swatches),
      h('div', { class: 'row' }, save, remove, h('span', { class: 'grow' }), cancel),
    );
    document.body.append(this.el);
    save.addEventListener('click', () => this.save());
    cancel.addEventListener('click', () => this.close());
    remove.addEventListener('click', () => {
      const uid = this.uid;
      this.fresh = false;
      this.close();
      if (uid) this.hooks.remove(uid);
    });
    this.filter.addEventListener('input', () => {
      const text = this.filter.value.trim();
      const c = text ? compileQuery(text) : null;
      this.error.textContent = c && !c.ok ? c.error : '';
    });
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.save();
      if (e.key === 'Escape') this.close();
    });
    window.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    }, true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Open for a flag, placed near a screen point (page pixels). */
  show(uid: string, near: { x: number; y: number }, fresh = false): void {
    const f = this.app.store.flags.get(uid);
    if (!f) return;
    if (this.uid && this.uid !== uid) this.close();
    this.uid = uid;
    this.fresh = fresh;
    this.title.textContent = fresh ? 'New flag' : f.name;
    this.name.value = f.name;
    this.filter.value = f.filter ?? '';
    this.error.textContent = '';
    this.colour = f.colour;
    this.drawSwatches();
    this.el.hidden = false;
    const w = 300;
    this.el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, near.x - w / 2))}px`;
    this.el.style.top = `${Math.max(8, Math.min(window.innerHeight - 240, near.y + 14))}px`;
    this.name.focus();
    this.name.select();
  }

  close(): void {
    if (this.el.hidden) return;
    const uid = this.uid;
    const fresh = this.fresh;
    this.el.hidden = true;
    this.uid = null;
    this.fresh = false;
    this.app.canvas.focus();
    if (fresh && uid) this.hooks.remove(uid);
  }

  private drawSwatches(): void {
    this.swatches.replaceChildren(...FLAG_COLOURS.map((c) => {
      const b = h('button', { class: 'flag-swatch' + (c === this.colour ? ' on' : ''), title: c, 'aria-label': `Color ${c}` });
      b.style.background = c;
      b.addEventListener('click', () => {
        this.colour = c;
        this.drawSwatches();
      });
      return b;
    }));
  }

  private save(): void {
    const f = this.uid ? this.app.store.flags.get(this.uid) : undefined;
    if (!f) return this.close();
    const name = this.name.value.trim().slice(0, NAME_MAX);
    if (!name) {
      this.error.textContent = 'A flag needs a name';
      return;
    }
    const text = this.filter.value.trim();
    if (text) {
      const c = compileQuery(text);
      if (!c.ok) {
        this.error.textContent = c.error;
        return;
      }
    }
    const next: Flag = { ...f, name, filter: text || null, colour: this.colour };
    this.fresh = false;
    this.close();
    this.app.store.setFlags([next]);
    this.hooks.saved(next);
  }
}
