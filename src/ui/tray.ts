// The Removed tray (spec 10.8): Delete moves cards here; they can be spawned
// back in the same session. It lives in memory and empties when the page closes.

import type { App } from '../app';
import { spawnCards } from '../spawn';
import { touchable } from '../online/guard';
import { HIDDEN } from '../../shared/table';
import type { Card, Finish } from '../state/types';
import { h } from './dom';

/** The one key every hidden removed card shares: no identity, no finish (ONLINE.md 7.3). */
const HIDDEN_KEY = 'hidden|nonfoil';

interface Entry {
  scryfallId: string;
  finish: Finish;
  faceUp: boolean;
  count: number;
  /** Hidden from this browser when removed (rooms, ONLINE.md 7.3): listed as "Hidden card". */
  hidden?: boolean;
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
    const store = this.app.store;
    // In a room, cards on a stand this player may not touch stay (ONLINE.md 6.3).
    const list = touchable([...uids]);
    const hidden = new Set(list.filter((u) => {
      const c = store.cards.get(u);
      return c && !store.canSee(c);
    }));
    const removed: Card[] = store.removeCards(list);
    for (const c of removed) {
      // A hidden card is kept without its identity, on every browser, the crown's too (7.3): one row, never spawned back.
      const secret = hidden.has(c.uid);
      const key = secret ? HIDDEN_KEY : `${c.scryfallId}|${c.finish}`;
      const e = this.entries.get(key);
      if (e) e.count++;
      else this.entries.set(key, secret ? { scryfallId: HIDDEN, finish: 'nonfoil', faceUp: false, count: 1, hidden: true } : { scryfallId: c.scryfallId, finish: c.finish, faceUp: c.faceUp, count: 1 });
    }
    this.render();
    return removed.length;
  }

  /** Undo brought these removed cards back to the table: they leave the tray (decision 204). */
  take(cards: { scryfallId: string; finish: Finish }[]): void {
    for (const c of cards) {
      const plain = `${c.scryfallId}|${c.finish}`;
      const key = this.entries.has(plain) ? plain : HIDDEN_KEY;
      const e = this.entries.get(key);
      if (!e) continue;
      if (--e.count <= 0) this.entries.delete(key);
    }
    this.render();
  }

  private spawnBack(keys: string[]): void {
    // Hidden cards can't come back (that would show them); the rest only if their record is here.
    const restore = keys.filter((k) => {
      const e = this.entries.get(k);
      return e && !e.hidden && this.app.store.records.has(e.scryfallId);
    });
    const items = restore.map((k) => {
      const e = this.entries.get(k)!;
      return { record: this.app.store.records.get(e.scryfallId)!, finish: e.finish, count: e.count };
    });
    if (!items.length) return;
    for (const k of restore) this.entries.delete(k);
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
      .map(([k, e]) => ({ k, e, name: e.hidden ? 'Hidden card' : this.app.store.records.get(e.scryfallId)?.name ?? '…' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.list.replaceChildren(
      ...rows.map(({ k, e, name }) => {
        const back = h('button', { class: 'btn small ghost', title: e.hidden ? 'A hidden card can’t be spawned back' : 'Spawn back' }, '↩');
        back.disabled = !!e.hidden;
        back.addEventListener('click', () => this.spawnBack([k]));
        return h('div', { class: 'tray-row' }, h('span', {}, `${e.count} ${name}${e.finish !== 'nonfoil' && !e.hidden ? ' ✦' : ''}`), back);
      }),
    );
  }
}
