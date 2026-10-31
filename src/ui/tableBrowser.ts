// The public table browser (ONLINE.md 12.5, O13, O14): the rooms set to
// Public or Public + password, refreshed every 10 seconds while open and by
// Refresh, filtered by All · Cube · Play. Each row shows the name, players
// (3/8, or Full), 🔒 for a password, the crown, the tag, the card count and
// how long the room has been up, with Join and a ⋯ menu holding Report.
// Opened by Tables in the Online panel or Join a table on the welcome note;
// a box at the bottom takes a link or code for an unlisted room.

import { MAX_PLAYERS, type LobbyRow, type Tag } from '../../shared/protocol';
import { roomToast } from '../online/guard';
import { getIdentity } from '../online/identity';
import { codeFromText, publicRooms, reportRoom, type RoomRoute } from '../online/link';
import { confirmDialog } from './confirm';
import { h } from './dom';

export type TagFilter = 'all' | Tag;

/** How long a room has been up, short (12.5): "just now", "12 min", "2 h", "3 d". */
export function upFor(since: number, now: number): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** The rows a chip shows, in the server's order (players, then age). */
export function filterRows(rows: LobbyRow[], tag: TagFilter): LobbyRow[] {
  return tag === 'all' ? rows : rows.filter((r) => r.tag === tag);
}

const REFRESH_MS = 10_000;

export class TableBrowser {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly chips = new Map<TagFilter, HTMLButtonElement>();
  private filter: TagFilter = 'all';
  private rows: LobbyRow[] = [];
  private timer = 0;
  private menu: HTMLElement | null = null;

  constructor(private readonly onJoin: (route: RoomRoute) => void) {
    const close = h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close' }, '✕');
    close.addEventListener('click', () => this.close());
    const refresh = h('button', { class: 'btn small', title: 'Look again now' }, '↻ Refresh');
    refresh.addEventListener('click', () => void this.load());
    const chipRow = h('div', { class: 'chips browser-chips' });
    for (const [f, label] of [['all', 'All'], ['cube', 'Cube'], ['play', 'Play']] as [TagFilter, string][]) {
      const c = h('button', { class: 'chip' }, label);
      c.addEventListener('click', () => {
        this.filter = f;
        this.render();
      });
      this.chips.set(f, c);
      chipRow.append(c);
    }
    this.status = h('span', { class: 'muted small' });
    this.list = h('div', { class: 'browser-list' });
    // An unlisted room: its link or code.
    const code = h('input', { class: 'grow', placeholder: 'Have a link or code? Paste it here', spellcheck: 'false', 'aria-label': 'Room link or code' });
    const go = h('button', { class: 'btn small' }, 'Join');
    const byCode = () => {
      const r = codeFromText(code.value);
      if (!r) {
        roomToast('That is not a room link or code (six letters and numbers, like 7KQ2MX)', 'warn');
        return;
      }
      this.close();
      this.onJoin(r);
    };
    go.addEventListener('click', byCode);
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') byCode();
    });
    this.el = h('div', { class: 'table-browser', role: 'dialog', 'aria-label': 'Public tables' },
      h('div', { class: 'online-head' }, h('span', { class: 'panel-title' }, 'Public tables'), close),
      h('div', { class: 'browser-bar' }, chipRow, h('span', { class: 'grow' }), this.status, refresh),
      this.list,
      h('div', { class: 'row browser-code' }, code, go),
    );
    this.el.hidden = true;
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });
    document.body.append(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (this.menu && !(e.target instanceof Node && this.menu.contains(e.target))) this.closeMenu();
    }, true);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.render();
    void this.load();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.load(), REFRESH_MS);
  }

  close(): void {
    this.el.hidden = true;
    clearInterval(this.timer);
    this.timer = 0;
    this.closeMenu();
  }

  private async load(): Promise<void> {
    this.status.textContent = 'Looking…';
    const r = await publicRooms();
    if (typeof r === 'string') {
      this.status.textContent = r === 'quota' ? 'Rooms are back after midnight UTC' : 'The room server can’t be reached';
      return;
    }
    this.rows = r;
    this.status.textContent = '';
    this.render();
  }

  private render(): void {
    for (const [f, c] of this.chips) c.classList.toggle('on', f === this.filter);
    const rows = filterRows(this.rows, this.filter);
    if (!rows.length) {
      this.list.replaceChildren(h('p', { class: 'muted browser-empty' }, 'No public tables right now. Go online and set yours to Public to be the first.'));
      return;
    }
    const now = Date.now();
    this.list.replaceChildren(...rows.map((r) => this.row(r, now)));
  }

  private row(r: LobbyRow, now: number): HTMLElement {
    const max = r.max || MAX_PLAYERS;
    const full = r.players >= max;
    const join = h('button', { class: 'btn small primary' }, 'Join');
    join.disabled = full;
    join.title = full ? 'The room is full' : r.password ? 'Join: it asks for the password' : 'Join this table';
    join.addEventListener('click', () => {
      this.close();
      this.onJoin({ kind: 'room', code: r.code });
    });
    const more = h('button', { class: 'icon-btn', title: 'Report', 'aria-label': `More for ${r.name}` }, '⋯');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMenu(more, r);
    });
    return h('div', { class: 'browser-row' },
      h('div', { class: 'browser-main' },
        h('div', { class: 'browser-name' }, r.name, ...(r.password ? [h('span', { class: 'browser-lock', title: 'Password' }, ' 🔒')] : [])),
        h('div', { class: 'muted small' }, `hosted by ${r.crown || 'someone'} · ${r.cards.toLocaleString()} card${r.cards === 1 ? '' : 's'} · up ${upFor(r.since, now)}`),
      ),
      h('span', { class: `browser-tag tag-${r.tag}` }, r.tag === 'play' ? 'Play' : 'Cube'),
      h('span', { class: 'browser-players' + (full ? ' full' : '') }, full ? 'Full' : `${r.players}/${max}`),
      join,
      more,
    );
  }

  private openMenu(anchor: HTMLElement, r: LobbyRow): void {
    this.closeMenu();
    const report = h('button', { class: 'menu-item danger' }, 'Report this table');
    report.addEventListener('click', async () => {
      this.closeMenu();
      if (!(await confirmDialog(`Report ${r.name}? Three reports hide a table until the site’s owner looks.`, 'Report'))) return;
      const res = await reportRoom(r.code, getIdentity().token);
      if (res === 'ok') roomToast('Reported. Thank you.', 'ok');
      else if (res === 'closed') roomToast('That table has closed', 'info');
      else if (res === 'rate') roomToast('Too many reports from here: try again later', 'warn');
      else roomToast('Could not reach the room server', 'error');
    });
    const pop = h('div', { class: 'player-menu' }, report);
    const b = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, b.right - 190)}px`;
    pop.style.top = `${b.bottom + 4}px`;
    document.body.append(pop);
    this.menu = pop;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
