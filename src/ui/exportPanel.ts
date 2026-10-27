// Export (spec 14.1, 14.2): the selection, one pile or the whole table as a
// decklist (copied to the clipboard, offered as .txt) or as CSV.

import type { App } from '../app';
import { csvText, type CsvCard } from '../io/exportCsv';
import { decklistText, type ExportGroup } from '../io/exportDecklist';
import { copyText, downloadText, slug } from '../io/download';
import { namedPileOf } from '../state/selection';
import { h } from './dom';
import { toast } from './toasts';

export class ExportPanel {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly preview: HTMLTextAreaElement;
  private readonly names: HTMLInputElement;
  private readonly sets: HTMLInputElement;
  private uids: string[] = [];
  private label = 'cards';

  constructor(private readonly app: App) {
    this.title = h('div', { class: 'pe-title' });
    this.names = h('input', { type: 'radio', name: 'export-format', value: 'names' });
    this.sets = h('input', { type: 'radio', name: 'export-format', value: 'sets' });
    this.preview = h('textarea', { class: 'export-preview', readonly: '', spellcheck: 'false', 'aria-label': 'Decklist' });
    const copy = h('button', { class: 'btn small primary' }, 'Copy');
    const txt = h('button', { class: 'btn small' }, 'Download .txt');
    const csv = h('button', { class: 'btn small' }, 'Download CSV');
    const close = h('button', { class: 'btn small ghost' }, 'Close');
    this.el = h('div', { class: 'pile-editor export-panel', hidden: '' },
      this.title,
      h('div', { class: 'row small' },
        h('label', { class: 'inline' }, this.names, ' 4 Lightning Bolt'),
        h('label', { class: 'inline' }, this.sets, ' 4 Lightning Bolt (M11) 149'),
      ),
      this.preview,
      h('div', { class: 'row' }, copy, txt, csv, h('span', { class: 'grow' }), close),
    );
    document.body.append(this.el);
    const onFormat = () => {
      app.store.updateSettings({ exportWithSet: this.sets.checked });
      this.render();
      void this.copy();
    };
    this.names.addEventListener('change', onFormat);
    this.sets.addEventListener('change', onFormat);
    copy.addEventListener('click', () => void this.copy());
    txt.addEventListener('click', () => downloadText(`${slug(this.label)}.txt`, this.preview.value));
    csv.addEventListener('click', () => downloadText(`${slug(this.label)}.csv`, csvText(this.csvCards()), 'text/csv'));
    close.addEventListener('click', () => this.close());
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.export-trigger')) this.close();
    });
  }

  /** Open for some cards, copying the decklist straight away (spec 14.1). */
  open(uids: string[], label: string, near?: { x: number; y: number }): void {
    if (!uids.length) {
      toast('Nothing to export: select some cards first', 'warn');
      return;
    }
    this.uids = uids;
    this.label = label;
    const withSet = this.app.store.settings.exportWithSet;
    this.sets.checked = withSet;
    this.names.checked = !withSet;
    this.render();
    this.el.hidden = false;
    const w = 380;
    const x = near ? near.x - w / 2 : window.innerWidth - w - 24;
    const y = near ? near.y + 12 : window.innerHeight - 380;
    this.el.style.width = `${w}px`;
    this.el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x))}px`;
    this.el.style.top = `${Math.max(8, Math.min(window.innerHeight - 340, y))}px`;
    void this.copy();
  }

  close(): void {
    this.el.hidden = true;
  }

  /** Cards grouped by pile: named piles by name, other piles numbered, loose cards together. */
  groups(): ExportGroup[] {
    const store = this.app.store;
    const byPile = new Map<string, ExportGroup>();
    let n = 0;
    for (const u of this.uids) {
      const c = store.cards.get(u);
      const r = c && store.records.get(c.scryfallId);
      if (!c || !r) continue;
      const name = namedPileOf(store, c);
      const key = c.pileId ?? 'loose';
      let g = byPile.get(key);
      if (!g) {
        g = { title: name ?? (c.pileId ? `Pile ${++n}` : 'Loose cards'), cards: [] };
        byPile.set(key, g);
      }
      g.cards.push({ name: r.name, set: r.set, number: r.collector_number, finish: c.finish });
    }
    return [...byPile.values()];
  }

  private csvCards(): CsvCard[] {
    const store = this.app.store;
    const out: CsvCard[] = [];
    for (const u of this.uids) {
      const c = store.cards.get(u);
      const r = c && store.records.get(c.scryfallId);
      if (!c || !r) continue;
      out.push({ pile: namedPileOf(store, c) ?? '', name: r.name, set: r.set, number: r.collector_number, finish: c.finish, scryfallId: r.id });
    }
    return out;
  }

  private render(): void {
    const groups = this.groups();
    const cards = groups.reduce((s, g) => s + g.cards.length, 0);
    this.title.textContent = `Export ${this.label}: ${cards} card${cards === 1 ? '' : 's'}${groups.length > 1 ? ` in ${groups.length} piles` : ''}`;
    this.preview.value = decklistText(groups, this.app.store.settings.exportWithSet);
  }

  private async copy(): Promise<void> {
    const ok = await copyText(this.preview.value);
    toast(ok ? 'Decklist copied to the clipboard' : 'Could not copy; use Download .txt', ok ? 'ok' : 'warn', 2200);
  }
}
