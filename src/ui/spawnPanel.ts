// The spawn panel (spec 12.1): List and Card tabs, arrival, face and where.

import type { App } from '../app';
import { parseDecklist, type DeckEntry } from '../io/decklist';
import { isSetCode, loadSets, nameIndex } from '../scryfall/names';
import { resolveEntries, type ResolvedEntry } from '../scryfall/resolve';
import { spawnCards, type SpawnItem } from '../spawn';
import type { Finish } from '../state/types';
import { toast } from './toasts';
import { h } from './dom';


export class SpawnPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<string, { button: HTMLButtonElement; pane: HTMLElement }>();
  /** Extra tabs added by later features (Query, spec 12.1). */
  readonly tabBar: HTMLElement;
  private resolved: ResolvedEntry[] = [];
  private unresolved: DeckEntry[] = [];
  private listPreview!: HTMLElement;
  private listSpawn!: HTMLButtonElement;
  private listText!: HTMLTextAreaElement;
  /** Panel-wide controls. */
  readonly controls: HTMLElement;
  /** The removed tray lives at the bottom (spec 10.8). */
  readonly trayHost: HTMLElement;

  constructor(private readonly app: App, host: HTMLElement) {
    this.el = h('aside', { class: 'panel spawn-panel' });
    const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-title' }, 'Spawn'));
    const collapse = h('button', { class: 'icon-btn', title: 'Collapse panel' }, '‹');
    collapse.addEventListener('click', () => {
      this.el.classList.toggle('collapsed');
      collapse.textContent = this.el.classList.contains('collapsed') ? '›' : '‹';
      app.resize();
    });
    head.append(collapse);
    this.tabBar = h('div', { class: 'tabs' });
    this.body = h('div', { class: 'panel-body' });
    this.controls = this.buildControls();
    this.trayHost = h('div', { class: 'tray-host' });
    this.el.append(head, this.tabBar, this.body, this.controls, this.trayHost);
    host.append(this.el);

    this.addTab('list', 'List', this.buildList());
    this.addTab('card', 'Card', this.buildCard());
    this.show('list');
    // Warm the set list and name catalog in the background.
    loadSets().catch(() => {});
    nameIndex().catch(() => {});
  }

  addTab(id: string, label: string, pane: HTMLElement): void {
    const button = h('button', { class: 'tab' }, label);
    button.addEventListener('click', () => this.show(id));
    this.tabBar.append(button);
    pane.classList.add('tab-pane');
    this.body.append(pane);
    this.tabs.set(id, { button, pane });
  }

  show(id: string): void {
    for (const [k, t] of this.tabs) {
      t.button.classList.toggle('active', k === id);
      t.pane.hidden = k !== id;
    }
  }

  options(): { arrival: 'messy' | 'stack'; faceUp: boolean; where: 'cursor' | 'center' } {
    const s = this.app.store.settings;
    return { arrival: s.arrival, faceUp: s.spawnFaceUp, where: s.spawnWhere };
  }

  private buildControls(): HTMLElement {
    const s = this.app.store.settings;
    const arrival = h('select', { 'aria-label': 'Arrival' }, h('option', { value: 'messy' }, 'Messy pile'), h('option', { value: 'stack' }, 'Neat stack'));
    arrival.value = s.arrival;
    arrival.addEventListener('change', () => this.app.store.updateSettings({ arrival: arrival.value as 'messy' | 'stack' }));
    const face = h('select', { 'aria-label': 'Face' }, h('option', { value: 'up' }, 'Face up'), h('option', { value: 'down' }, 'Face down'));
    face.value = s.spawnFaceUp ? 'up' : 'down';
    face.addEventListener('change', () => this.app.store.updateSettings({ spawnFaceUp: face.value === 'up' }));
    const where = h('select', { 'aria-label': 'Where' }, h('option', { value: 'center' }, 'Centre of view'), h('option', { value: 'cursor' }, 'Last cursor spot'));
    where.value = s.spawnWhere;
    where.addEventListener('change', () => this.app.store.updateSettings({ spawnWhere: where.value as 'cursor' | 'center' }));
    this.app.store.events.on('settings', () => {
      arrival.value = this.app.store.settings.arrival;
      face.value = this.app.store.settings.spawnFaceUp ? 'up' : 'down';
      where.value = this.app.store.settings.spawnWhere;
    });
    return h('div', { class: 'spawn-controls' },
      h('label', {}, h('span', {}, 'Arrival'), arrival),
      h('label', {}, h('span', {}, 'Face'), face),
      h('label', {}, h('span', {}, 'Where'), where),
    );
  }

  // ---- List tab ----

  private buildList(): HTMLElement {
    this.listText = h('textarea', { class: 'decklist', placeholder: '4 Lightning Bolt\n1 Sol Ring (C21) 263 *F*\n…', spellcheck: 'false' });
    const parse = h('button', { class: 'btn' }, 'Parse');
    this.listSpawn = h('button', { class: 'btn primary', disabled: '' }, 'Spawn');
    const clear = h('button', { class: 'btn ghost' }, 'Clear');
    this.listPreview = h('div', { class: 'preview' });
    parse.addEventListener('click', () => void this.parseList(parse));
    this.listSpawn.addEventListener('click', () => this.spawnList());
    clear.addEventListener('click', () => {
      this.listText.value = '';
      this.resolved = [];
      this.unresolved = [];
      this.renderPreview();
    });
    this.listText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void this.parseList(parse);
    });
    return h('div', {}, this.listText, h('div', { class: 'row' }, parse, this.listSpawn, clear), this.listPreview);
  }

  private async parseList(button: HTMLButtonElement): Promise<void> {
    try {
      await loadSets();
    } catch {
      // Without the set list a bare set code is read only before a number.
    }
    const parsed = parseDecklist(this.listText.value, { isSetCode: (c) => isSetCode(c) ?? /\d/.test(c) });
    if (!parsed.entries.length) {
      toast('No card lines found', 'warn');
      return;
    }
    button.disabled = true;
    this.listPreview.textContent = `Resolving ${parsed.cards} cards on ${parsed.entries.length} lines…`;
    try {
      const res = await resolveEntries(parsed.entries, (done, total) => {
        this.listPreview.textContent = `Resolving… ${done} of ${total} lines`;
      });
      this.resolved = res.resolved;
      this.unresolved = res.unresolved;
    } catch (err) {
      toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
    } finally {
      button.disabled = false;
      this.renderPreview();
    }
  }

  private renderPreview(): void {
    const p = this.listPreview;
    p.replaceChildren();
    const cards = this.resolved.reduce((n, r) => n + r.entry.count, 0);
    this.listSpawn.disabled = cards === 0;
    this.listSpawn.textContent = cards ? `Spawn ${cards}` : 'Spawn';
    if (!this.resolved.length && !this.unresolved.length) return;
    p.append(h('div', { class: 'preview-sum' }, `${cards} cards ready on ${this.resolved.length} lines` + (this.unresolved.length ? ` · ${this.unresolved.length} not found` : '')));
    for (const e of this.unresolved) p.append(this.unresolvedRow(e));
    const list = h('div', { class: 'resolved-list' });
    for (const r of this.resolved.slice(0, 400)) {
      list.append(h('div', { class: 'resolved' }, `${r.entry.count} ${r.record.name}`, h('span', { class: 'muted' }, ` ${r.record.set.toUpperCase()} ${r.record.collector_number}${r.entry.finish !== 'nonfoil' ? ' ✦' : ''}`)));
    }
    if (this.resolved.length > 400) list.append(h('div', { class: 'muted' }, `… and ${this.resolved.length - 400} more lines`));
    p.append(list);
  }

  private unresolvedRow(entry: DeckEntry): HTMLElement {
    const input = h('input', { class: 'fix', value: entry.text, 'aria-label': 'Fix this line' });
    const retry = h('button', { class: 'btn small' }, 'Retry');
    const drop = h('button', { class: 'btn small ghost', title: 'Clear this line' }, '✕');
    const row = h('div', { class: 'unresolved' }, h('div', { class: 'bad' }, `Line ${entry.lines.join(', ')}: ${entry.text}`), h('div', { class: 'row' }, input, retry, drop));
    const run = async () => {
      const parsed = parseDecklist(input.value, { isSetCode: (c) => isSetCode(c) ?? /\d/.test(c) });
      if (!parsed.entries.length) return;
      retry.disabled = true;
      try {
        const res = await resolveEntries(parsed.entries.map((e) => ({ ...e, lines: entry.lines })));
        if (res.resolved.length) {
          this.unresolved = this.unresolved.filter((u) => u !== entry);
          this.resolved.push(...res.resolved);
          this.renderPreview();
        } else {
          row.classList.add('shake');
          setTimeout(() => row.classList.remove('shake'), 400);
          toast('Still not found', 'warn');
        }
      } finally {
        retry.disabled = false;
      }
    };
    retry.addEventListener('click', () => void run());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void run();
    });
    drop.addEventListener('click', () => {
      this.unresolved = this.unresolved.filter((u) => u !== entry);
      this.renderPreview();
    });
    return row;
  }

  private spawnList(): void {
    if (!this.resolved.length) return;
    const items: SpawnItem[] = this.resolved.map((r) => ({ record: r.record, finish: r.entry.finish, count: r.entry.count }));
    const uids = spawnCards(this.app, items, this.options());
    toast(`Spawned ${uids.length} cards`, 'ok');
    this.resolved = [];
    this.renderPreview();
  }

  // ---- Card tab ----

  private buildCard(): HTMLElement {
    const name = h('input', { class: 'grow', placeholder: 'Card name', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Card name' });
    const list = h('div', { class: 'suggest', hidden: '' });
    const set = h('input', { class: 'short', placeholder: 'Set', 'aria-label': 'Set code' });
    const num = h('input', { class: 'short', placeholder: 'No.', 'aria-label': 'Collector number' });
    const qty = h('input', { class: 'short', type: 'number', min: '1', max: '400', value: '1', 'aria-label': 'Quantity' });
    const finish = h('select', { 'aria-label': 'Finish' }, h('option', { value: 'nonfoil' }, 'Nonfoil'), h('option', { value: 'foil' }, 'Foil'), h('option', { value: 'etched' }, 'Etched'));
    const go = h('button', { class: 'btn primary' }, 'Spawn');
    let active = -1;
    let items: string[] = [];

    const renderSuggest = () => {
      list.replaceChildren(...items.map((s, i) => {
        const b = h('div', { class: 'suggest-item' + (i === active ? ' active' : '') }, s);
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          name.value = s;
          list.hidden = true;
        });
        return b;
      }));
      list.hidden = items.length === 0;
    };
    let timer = 0;
    name.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const idx = await nameIndex();
          items = idx.suggest(name.value, 8);
          active = -1;
          renderSuggest();
        } catch {
          // catalog unavailable: no autocomplete
        }
      }, 80);
    });
    name.addEventListener('keydown', (e) => {
      if (!list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        renderSuggest();
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0) {
          name.value = items[active];
          list.hidden = true;
        } else void spawn();
      } else if (e.key === 'Escape') list.hidden = true;
    });
    name.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));

    const spawn = async () => {
      const n = name.value.trim();
      if (!n && !(set.value.trim() && num.value.trim())) return;
      const entry: DeckEntry = {
        count: Math.max(1, Math.min(400, parseInt(qty.value, 10) || 1)),
        name: n,
        set: set.value.trim().toLowerCase() || undefined,
        number: num.value.trim() || undefined,
        finish: finish.value as Finish,
        lines: [1],
        text: n,
      };
      go.disabled = true;
      try {
        const res = await resolveEntries([entry]);
        if (!res.resolved.length) {
          toast(`Not found: ${n}${entry.set ? ` (${entry.set.toUpperCase()}${entry.number ? ' ' + entry.number : ''})` : ''}`, 'warn');
          return;
        }
        const r = res.resolved[0];
        spawnCards(this.app, [{ record: r.record, finish: entry.finish, count: entry.count }], this.options());
        toast(`Spawned ${entry.count} × ${r.record.name}`, 'ok');
      } catch (err) {
        toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener('click', () => void spawn());
    return h('div', { class: 'card-tab' },
      h('div', { class: 'suggest-wrap' }, name, list),
      h('div', { class: 'row' }, set, num, qty, finish),
      h('div', { class: 'row' }, go),
      h('p', { class: 'muted small' }, 'Leave set and number empty for the default printing. Set alone picks a printing from that set.'),
    );
  }
}
