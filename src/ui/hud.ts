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

/** A command on the bar (decision 301): its emoji, its key, its name, and what it does for the hover title. */
export type HudAction = { icon: string; key: string; label: string; title: string; run: () => void };

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
    // A group's menu closes on a press anywhere outside it, and on Esc, which then doesn't reach the table.
    window.addEventListener('pointerdown', (e) => {
      if (this.menu && !(e.target instanceof Node && this.menu.el.parentElement?.contains(e.target))) this.closeMenu();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (!this.menu || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.closeMenu();
    }, true);
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

  /** A command as an icon button with its key in the corner (decision 301). */
  addAction(a: HudAction): HTMLButtonElement {
    const b = this.iconButton(a);
    this.buttons.append(b);
    return b;
  }

  /**
   * A group of commands, grouped as on the radial menu (decision 301): the
   * button does the first, and ▴ beside it opens all of them upward, with
   * `extras` (tick rows) under a line.
   */
  addGroup(name: string, actions: HudAction[], extras: HTMLElement[] = [], icon = actions[0].icon): { main: HTMLButtonElement; rows: HTMLButtonElement[] } {
    const main = this.iconButton({ ...actions[0], icon });
    main.title += ` · ${name}: the rest under ▴`;
    const more = h('button', { class: 'btn small hud-more', title: `${name}: ${actions.map((a) => a.label).join(', ')}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '▴');
    const menu = h('div', { class: 'hud-menu', role: 'menu' }, h('div', { class: 'hud-menu-title' }, name));
    menu.hidden = true;
    const rows = actions.map((a) => {
      const row = h('button', { class: 'hud-menu-item', role: 'menuitem', title: a.title },
        h('span', { class: 'hud-menu-icon' }, a.icon),
        h('span', { class: 'hud-menu-label' }, a.label),
        h('kbd', {}, a.key),
      );
      row.addEventListener('click', () => {
        this.closeMenu();
        a.run();
      });
      menu.append(row);
      return row;
    });
    if (extras.length) menu.append(h('div', { class: 'hud-menu-sep' }), ...extras);
    const group = h('div', { class: 'hud-group' }, main, more, menu);
    more.addEventListener('click', () => (this.menu?.el === menu ? this.closeMenu() : this.showMenu(menu, more)));
    this.buttons.append(group);
    return { main, rows };
  }

  /** A tick row for a group's menu, such as Split creatures; the caller keeps its `on` class current. */
  tickRow(icon: string, label: string, title: string, run: () => void): HTMLButtonElement {
    const row = h('button', { class: 'hud-menu-item hud-menu-tick', role: 'menuitemcheckbox', title },
      h('span', { class: 'hud-menu-icon' }, icon),
      h('span', { class: 'hud-menu-label' }, label),
      h('span', { class: 'hud-menu-check' }, '✓'),
    );
    // Stays open, so the tick is seen to change.
    row.addEventListener('click', run);
    return row;
  }

  private iconButton(a: HudAction): HTMLButtonElement {
    const b = h('button', { class: 'btn small hud-icon', title: `${a.label}: ${a.title}`, 'aria-label': a.label },
      h('span', { class: 'hud-icon-emoji' }, a.icon),
      h('span', { class: 'hud-icon-key' }, a.key),
    );
    b.addEventListener('click', a.run);
    return b;
  }

  private menu: { el: HTMLElement; more: HTMLButtonElement } | null = null;

  private showMenu(el: HTMLElement, more: HTMLButtonElement): void {
    this.closeMenu();
    this.menu = { el, more };
    el.hidden = false;
    more.classList.add('on');
    more.setAttribute('aria-expanded', 'true');
    // Opened from the left edge of its group, or from the right edge when it would leave the window.
    el.style.left = '0';
    el.style.right = '';
    if (el.getBoundingClientRect().right > window.innerWidth - 8) {
      el.style.left = 'auto';
      el.style.right = '0';
    }
  }

  private closeMenu(): void {
    if (!this.menu) return;
    const { el, more } = this.menu;
    this.menu = null;
    el.hidden = true;
    more.classList.remove('on');
    more.setAttribute('aria-expanded', 'false');
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
