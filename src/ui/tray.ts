// The Removed tray (spec 10.8): Delete moves cards here; they can be spawned
// back in the same session. It lives in memory and empties when the page closes.

import type { App } from '../app';
import { spawnCards } from '../spawn';
import type { Card, Finish } from '../state/types';
import { h } from './dom';

interface Entry {
  scryfallId: string;
  finish: Finish;
  faceUp: boolean;
  count: number;
}

export class RemovedTray {
  private readonly entries = new Map<string, Entry>();
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;

  constructor(private readonly app: App, host: HTMLElement) {
    this.head = h('div', { class: 'tray-head' });
    this.list = h('div', { class: 'tray-list' });
    this.el = h('div', { class: 'tray' }, this.head, this.list);
    host.append(this.el);
    this.render();
  }

  get count(): number {
    let n = 0;
    for (const e of this.entries.values()) n += e.count;
    return n;
  }

  /** Remove cards from the table into the tray. */
  remove(uids: Iterable<string>): number {
    const removed: Card[] = this.app.store.removeCards(uids);
    for (const c of removed) {
      const key = `${c.scryfallId}|${c.finish}`;
      const e = this.entries.get(key);
      if (e) e.count++;
      else this.entries.set(key, { scryfallId: c.scryfallId, finish: c.finish, faceUp: c.faceUp, count: 1 });
    }
    this.render();
    return removed.length;
  }

  private spawnBack(keys: string[]): void {
    const items = keys
      .map((k) => this.entries.get(k)!)
      .filter((e) => e && this.app.store.records.has(e.scryfallId))
      .map((e) => ({ record: this.app.store.records.get(e.scryfallId)!, finish: e.finish, count: e.count }));
    if (!items.length) return;
    for (const k of keys) this.entries.delete(k);
    const s = this.app.store.settings;
    spawnCards(this.app, items, { arrival: s.arrival, faceUp: s.spawnFaceUp, where: s.spawnWhere });
    this.render();
  }

  private render(): void {
    const n = this.count;
    const all = h('button', { class: 'btn small', title: 'Spawn every removed card back' }, 'Spawn all back');
    all.disabled = n === 0;
    all.addEventListener('click', () => this.spawnBack([...this.entries.keys()]));
    this.head.replaceChildren(h('span', { class: 'tray-title' }, `Removed (${n})`), all);
    this.el.classList.toggle('empty', n === 0);
    const rows = [...this.entries.entries()]
      .map(([k, e]) => ({ k, e, name: this.app.store.records.get(e.scryfallId)?.name ?? '…' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.list.replaceChildren(
      ...rows.map(({ k, e, name }) => {
        const back = h('button', { class: 'btn small ghost', title: 'Spawn back' }, '↩');
        back.addEventListener('click', () => this.spawnBack([k]));
        return h('div', { class: 'tray-row' }, h('span', {}, `${e.count} ${name}${e.finish !== 'nonfoil' ? ' ✦' : ''}`), back);
      }),
    );
  }
}
