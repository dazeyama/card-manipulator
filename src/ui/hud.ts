// The selection HUD along the bottom (spec 9.2): count, colour pips, mana
// value histogram, the filter box (refine / table search), quick chips and
// the command buttons.

import type { App } from '../app';
import { applyQuery, runQuery, summarize } from '../state/selection';
import { h } from './dom';
import { toast } from './toasts';

const CHIPS: { label: string; term: string; title?: string; cls?: string }[] = [
  { label: 'W', term: 'c:w', cls: 'pip-w' },
  { label: 'U', term: 'c:u', cls: 'pip-u' },
  { label: 'B', term: 'c:b', cls: 'pip-b' },
  { label: 'R', term: 'c:r', cls: 'pip-r' },
  { label: 'G', term: 'c:g', cls: 'pip-g' },
  { label: 'C', term: 'c:c', title: 'Colourless', cls: 'pip-c' },
  { label: 'M', term: 'c:m', title: 'Multicolour', cls: 'pip-m' },
  { label: 'Creature', term: 't:creature' },
  { label: 'Instant/Sorcery', term: '(t:instant or t:sorcery)' },
  { label: 'Artifact', term: 't:artifact' },
  { label: 'Enchantment', term: 't:enchantment' },
  { label: 'Planeswalker', term: 't:planeswalker' },
  { label: 'Land', term: 't:land' },
  { label: '0', term: 'mv=0', title: 'Mana value 0' },
  { label: '1', term: 'mv=1', title: 'Mana value 1' },
  { label: '2', term: 'mv=2', title: 'Mana value 2' },
  { label: '3', term: 'mv=3', title: 'Mana value 3' },
  { label: '4', term: 'mv=4', title: 'Mana value 4' },
  { label: '5', term: 'mv=5', title: 'Mana value 5' },
  { label: '6+', term: 'mv>=6', title: 'Mana value 6 or more' },
  // How the card lies on the table, not a trait of the card (decision 176).
  { label: 'Face up', term: 'is:faceup', title: 'Lying face up on the table', cls: 'chip-table' },
  { label: 'Face down', term: 'is:facedown', title: 'Lying face down on the table', cls: 'chip-table' },
];

export class Hud {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  /** Command buttons (Stack, Spread, Tidy, Flip, Export) are added here by later features. */
  readonly buttons: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly pipsEl: HTMLElement;
  private readonly histEl: HTMLElement;
  private readonly liveEl: HTMLElement;
  private readonly filterWrap: HTMLElement;
  private pending = false;
  /** True while a query is changing the selection, so the box keeps its text. */
  private applying = false;

  constructor(private readonly app: App, host: HTMLElement) {
    this.countEl = h('div', { class: 'hud-count' });
    this.pipsEl = h('div', { class: 'hud-pips', title: 'Colours in the selection' });
    this.histEl = h('div', { class: 'hud-hist', title: 'Mana value of the selection (lands left out): 0 to 7+' });
    this.input = h('input', { class: 'filter', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Filter' });
    this.liveEl = h('div', { class: 'filter-live' });
    this.filterWrap = h('div', { class: 'filter-wrap' }, this.input, this.liveEl);
    this.buttons = h('div', { class: 'hud-buttons' });
    const chips = h('div', { class: 'chips' });
    for (const c of CHIPS) {
      const b = h('button', { class: `chip ${c.cls ?? ''}`, title: `${c.title ?? c.label}: ${c.term}  (Ctrl-click to exclude)` }, c.label);
      b.addEventListener('click', (e) => this.chip(c.term, e.ctrlKey || e.metaKey));
      chips.append(b);
    }
    this.el = h('footer', { class: 'hud' },
      h('div', { class: 'hud-row' },
        this.countEl,
        this.pipsEl,
        this.histEl,
        this.filterWrap,
        this.buttons,
      ),
      chips,
    );
    host.append(this.el);

    this.input.addEventListener('input', () => this.live());
    this.input.addEventListener('keydown', (e) => {
      // Keys typed here never reach the table's shortcuts.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        // A search that worked hands the keyboard back to the table, so shortcuts act on the result (decision 136).
        if (this.apply()) {
          this.input.blur();
          app.canvas.focus();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.blur();
        app.canvas.focus();
      }
    });
    app.store.events.on('selection', () => {
      if (!this.applying) this.input.value = '';
      this.schedule();
    });
    app.store.events.on('records', () => this.schedule());
    app.store.events.on('reset', () => this.schedule());
    app.store.events.on('piles', () => this.schedule());
    this.render();
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** A button against the right end of the search box, before the match count (decisions 189, 190). */
  addBesideSearch(el: HTMLElement): void {
    this.input.after(el);
  }

  addButton(label: string, title: string, run: () => void): HTMLButtonElement {
    const b = h('button', { class: 'btn small', title }, label);
    b.addEventListener('click', run);
    this.buttons.append(b);
    return b;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private render(): void {
    const store = this.app.store;
    const s = summarize(store);
    if (s.count === 0) {
      this.countEl.replaceChildren(h('span', { class: 'muted' }, 'Nothing selected'));
    } else {
      const parts: string[] = [];
      if (s.piles > 1 || (s.piles === 1 && s.loose)) parts.push(`${s.piles} pile${s.piles === 1 ? '' : 's'}`);
      if (s.loose && s.piles) parts.push(`${s.loose} loose`);
      const where = s.pileName ? ` in ${s.pileName}` : parts.length ? ` across ${parts.join(' and ')}` : '';
      this.countEl.replaceChildren(h('strong', {}, `${s.count.toLocaleString()} card${s.count === 1 ? '' : 's'}`), ` selected${where}`);
    }
    this.pipsEl.replaceChildren(
      ...(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((k) => h('span', { class: `pip pip-${k.toLowerCase()}${s.pips[k] ? '' : ' zero'}`, title: k }, String(s.pips[k]))),
    );
    const max = Math.max(1, ...s.mv);
    this.histEl.replaceChildren(
      ...s.mv.map((n, i) => {
        const bar = h('span', { class: 'bar', title: `${i === 7 ? '7+' : i}: ${n}` });
        bar.style.height = `${Math.round((n / max) * 100)}%`;
        return h('span', { class: 'col' }, bar, h('span', { class: 'lbl' }, i === 7 ? '7+' : String(i)));
      }),
    );
    this.input.placeholder = s.count
      ? `Refine ${s.count.toLocaleString()} selected…  e.g. t:creature mv<=2`
      : `Search the table (${store.cards.size.toLocaleString()} cards)…  e.g. c:r`;
    this.live();
  }

  /** The live count as you type: "128 → 34 match" (spec 9.3). */
  private live(): void {
    const q = this.input.value.trim();
    this.liveEl.classList.remove('error');
    if (!q) {
      this.liveEl.textContent = '';
      return;
    }
    const out = runQuery(this.app.store, q);
    if (!out.ok) {
      // `term` in the message is shown as code.
      this.liveEl.replaceChildren(...out.error.split('`').map((part, i) => (i % 2 ? h('code', {}, part) : part)));
      this.liveEl.classList.add('error');
      return;
    }
    const sel = this.app.store.selection.size;
    // Cards hidden from this browser in a room are never searched (ONLINE.md 7.3).
    const hidden = sel && out.hidden ? ` · ${out.hidden.toLocaleString()} hidden card${out.hidden === 1 ? '' : 's'} not searched` : '';
    this.liveEl.textContent = (sel
      ? `${sel.toLocaleString()} → ${out.matches.length.toLocaleString()} match`
      : `${out.matches.length.toLocaleString()} of ${out.scope.toLocaleString()} match`) + hidden;
  }

  /** Enter: refine the selection, or search the table when nothing is selected. True if the query ran. */
  apply(): boolean {
    const q = this.input.value.trim();
    if (!q) return false;
    const wasTable = this.app.store.selection.size === 0;
    this.applying = true;
    const out = applyQuery(this.app.store, q);
    this.applying = false;
    if (!out.ok) {
      toast(out.error, 'error');
      return false;
    }
    if (wasTable && out.matches.length === 0) toast('Nothing on the table matches', 'warn');
    this.live();
    return true;
  }

  /** A quick chip appends its term and applies it (spec 9.5). Shift negates. */
  chip(term: string, negate: boolean): void {
    const t = negate ? `-${term}` : term;
    let q = this.input.value.trim();
    if (/\bor\b/i.test(q) && !/^\(.*\)$/.test(q)) q = `(${q})`;
    this.input.value = q ? `${q} ${t}` : t;
    this.apply();
  }
}
