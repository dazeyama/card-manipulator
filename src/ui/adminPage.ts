// The owner's admin page (ONLINE.md 12.8, O15): `#/admin` asks for the admin
// key once per browser session (kept in sessionStorage), then lists every
// open room, listed or not, with its code, name, players, visibility,
// reports and age, and Delist (or Relist) and Close. Plain, for the owner.

import type { AdminRow } from '../../shared/protocol';
import { roomToast } from '../online/guard';
import { adminAction, adminRooms, setHash } from '../online/link';
import { confirmDialog, textDialog } from './confirm';
import { h } from './dom';
import { upFor } from './tableBrowser';

const KEY = 'online.adminKey';

function storedKey(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function storeKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(KEY, key);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Asked again next time.
  }
}

export class AdminPage {
  private el: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private key: string | null = null;
  private readonly stopKeys = (e: KeyboardEvent) => {
    if (this.el && !(e.target instanceof Node && this.el.contains(e.target))) e.stopImmediatePropagation();
  };

  get isOpen(): boolean {
    return this.el !== null;
  }

  async open(): Promise<void> {
    if (!this.el) this.build();
    this.key = storedKey();
    if (!this.key) this.key = await textDialog('The admin key (kept for this browser session):', { value: '', ok: 'Open', maxLength: 200 });
    if (!this.key) {
      this.close();
      return;
    }
    await this.load();
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.body = null;
    window.removeEventListener('keydown', this.stopKeys, true);
    setHash('');
  }

  private build(): void {
    const refresh = h('button', { class: 'btn small' }, '↻ Refresh');
    refresh.addEventListener('click', () => void this.load());
    const forget = h('button', { class: 'btn small', title: 'Forget the key for this session' }, 'Forget key');
    forget.addEventListener('click', () => {
      storeKey(null);
      this.close();
    });
    const back = h('button', { class: 'btn small primary' }, 'Back to the table');
    back.addEventListener('click', () => this.close());
    this.body = h('div', { class: 'admin-body' }, h('p', { class: 'muted' }, 'Loading…'));
    this.el = h('div', { class: 'admin-page' },
      h('div', { class: 'admin-head' }, h('h2', {}, 'Rooms'), h('span', { class: 'grow' }), refresh, forget, back),
      this.body,
    );
    document.body.append(this.el);
    window.addEventListener('keydown', this.stopKeys, true);
  }

  private async load(): Promise<void> {
    const key = this.key;
    if (!key || !this.body) return;
    const rows = await adminRooms(key);
    if (rows === 'key') {
      storeKey(null);
      this.body.replaceChildren(h('p', { class: 'join-error' }, 'That key is not the admin key.'));
      const again = h('button', { class: 'btn small' }, 'Try another key');
      again.addEventListener('click', () => void this.open());
      this.body.append(again);
      return;
    }
    if (typeof rows === 'string') {
      this.body.replaceChildren(h('p', { class: 'join-error' }, rows === 'quota' ? 'The room server is over its free daily limit.' : 'The room server can’t be reached.'));
      return;
    }
    storeKey(key);
    this.render(rows);
  }

  private render(rows: AdminRow[]): void {
    if (!this.body) return;
    if (!rows.length) {
      this.body.replaceChildren(h('p', { class: 'muted' }, 'No rooms are open.'));
      return;
    }
    const now = Date.now();
    const head = h('tr', {}, ...['Code', 'Name', 'Players', 'Visibility', 'Reports', 'Up', ''].map((t) => h('th', {}, t)));
    const body = rows.map((r) => {
      const listing = h('button', { class: 'btn small' }, r.delisted ? 'Relist' : 'Delist');
      listing.addEventListener('click', () => void this.act(r, r.delisted ? 'relist' : 'delist'));
      const close = h('button', { class: 'btn small danger' }, 'Close');
      close.addEventListener('click', async () => {
        if (await confirmDialog(`Close ${r.name} (${r.code}) for everyone in it?`, 'Close room')) void this.act(r, 'close');
      });
      const vis = r.visibility === 'password' ? 'Public + 🔒' : r.visibility === 'public' ? 'Public' : 'Unlisted';
      return h('tr', { class: r.delisted ? 'delisted' : '' },
        h('td', {}, h('code', {}, r.code)),
        h('td', {}, r.name, h('div', { class: 'muted small' }, `crown ${r.crown || '?'} · ${r.cards.toLocaleString()} cards · ${r.tag}${r.locked ? ' · locked' : ''}`)),
        h('td', {}, `${r.players}/${r.max}`),
        h('td', {}, vis, ...(r.delisted ? [h('div', { class: 'join-error' }, 'delisted')] : [])),
        h('td', {}, String(r.reports)),
        h('td', {}, upFor(r.since, now)),
        h('td', { class: 'admin-actions' }, listing, close),
      );
    });
    this.body.replaceChildren(h('table', { class: 'admin-table' }, h('thead', {}, head), h('tbody', {}, ...body)));
  }

  private async act(r: AdminRow, action: 'delist' | 'relist' | 'close'): Promise<void> {
    if (!this.key) return;
    const res = await adminAction(this.key, r.code, action);
    if (res === 'ok') roomToast(action === 'close' ? `Closed ${r.code}` : action === 'delist' ? `Delisted ${r.code}` : `Relisted ${r.code}`, 'ok');
    else roomToast(res === 'key' ? 'The admin key was refused' : 'The room server can’t be reached', 'error');
    await this.load();
  }
}
