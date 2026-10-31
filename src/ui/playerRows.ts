// The Online panel's player list (ONLINE.md 12.2 Players): one row per
// player in join order, with their swatch (yours opens a popover of the free
// colours, O18), nickname, the side they are on (↑ near, ↓ far), their rank,
// 👑 on the crown and "away" for a player whose browser has gone (O19).
// For the crown (O23): a rank picker on every other row, and a ⋯ menu with
// Pass crown, Kick, Ban and Give stand to… (4.5, 4.6, 6.3).

import { PLAYER_COLOURS, type Player } from '../../shared/protocol';
import { PICKABLE_RANKS, RANK_LABEL, type Rank } from '../../shared/permissions';
import type { App } from '../app';
import { isFullStand, isStand } from '../state/stand';
import type { Mat } from '../state/types';
import { confirmDialog } from './confirm';
import { setColour } from '../online/identity';
import type { RoomState } from '../online/room';
import type { Session } from '../online/session';
import { h } from './dom';

/** The colours no other seated player holds. */
export function freeColours(players: Player[], me: string): string[] {
  const taken = new Set(players.filter((p) => p.id !== me).map((p) => p.colour.toLowerCase()));
  return PLAYER_COLOURS.filter((c) => !taken.has(c.toLowerCase()));
}

export class PlayerRows {
  readonly el: HTMLElement;
  private room: RoomState | null = null;
  private session: Session | null = null;
  private stops: (() => void)[] = [];
  private popover: HTMLElement | null = null;

  constructor(private readonly app: App) {
    this.el = h('div', { class: 'player-rows' });
    document.addEventListener('pointerdown', (e) => {
      if (this.popover && !(e.target instanceof Node && this.popover.contains(e.target))) this.closePopover();
    }, true);
  }

  attach(room: RoomState | null, session: Session | null): void {
    for (const s of this.stops) s();
    this.stops = [];
    this.room = room;
    this.session = session;
    this.closePopover();
    if (room) {
      const render = () => this.render();
      this.stops.push(room.events.on('players', render), room.events.on('crown', render), room.events.on('me', render));
    }
    this.render();
  }

  render(): void {
    const room = this.room;
    if (!room) {
      this.el.replaceChildren();
      return;
    }
    const players = [...room.players].sort((a, b) => a.joinedAt - b.joinedAt);
    this.el.replaceChildren(...players.map((p) => this.row(p)));
  }

  private row(p: Player): HTMLElement {
    const room = this.room!;
    const mine = p.id === room.me;
    const swatch = h('button', { class: 'swatch' + (mine ? ' mine' : ''), title: mine ? 'Your colour: click for another free one' : p.nickname, 'aria-label': mine ? 'Change your colour' : `${p.nickname}'s colour` });
    swatch.style.background = p.colour;
    if (mine) swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPopover(swatch);
    });
    else swatch.disabled = true;
    const name = h('span', { class: 'player-name' }, p.nickname, ...(mine ? [h('span', { class: 'muted' }, ' (you)')] : []));
    const side = h('span', { class: 'player-side', title: p.side ? 'On the far side of the table' : 'On the near side of the table' }, p.side ? '↓' : '↑');
    const crown = p.isCrown ? h('span', { class: 'player-crown', title: 'The crown: the host of the room' }, '👑') : null;
    const rank = room.isCrown && !p.isCrown ? this.rankPicker(p) : h('span', { class: 'player-rank muted' }, p.isCrown ? 'Crown' : RANK_LABEL[p.rank]);
    const away = p.connected ? null : h('span', { class: 'player-away' }, 'away');
    const menu = room.isCrown && !mine ? this.menuButton(p) : null;
    const row = h('div', { class: 'player-row' + (p.connected ? '' : ' away') + (mine ? ' mine' : '') }, swatch, name, side, ...(crown ? [crown] : []), h('span', { class: 'grow' }), ...(away ? [away] : []), rank, ...(menu ? [menu] : []));
    row.dataset.player = p.id;
    return row;
  }

  /** The crown sets a player's rank (O21, O23). */
  private rankPicker(p: Player): HTMLSelectElement {
    const sel = h('select', { class: 'rank-picker', 'aria-label': `${p.nickname}'s rank`, title: 'What this player may do' });
    // Everything is hidden from the pickers (O111), unless the player already has it.
    for (const r of p.rank === 'everything' ? [...PICKABLE_RANKS, p.rank] : PICKABLE_RANKS) {
      const o = h('option', { value: r }, RANK_LABEL[r]);
      o.selected = r === p.rank;
      sel.append(o);
    }
    sel.addEventListener('change', () => this.session?.send({ t: 'rank', player: p.id, rank: sel.value as Rank }));
    return sel;
  }

  /** The crown's ⋯ menu on another player's row. */
  private menuButton(p: Player): HTMLButtonElement {
    const b = h('button', { class: 'icon-btn player-menu-btn', title: 'Pass the crown, kick, ban, give a stand', 'aria-label': `More for ${p.nickname}` }, '⋯');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMenu(b, p);
    });
    return b;
  }

  private openMenu(anchor: HTMLElement, p: Player): void {
    this.closePopover();
    const session = this.session;
    if (!session) return;
    const item = (label: string, run: () => void, danger = false) => {
      const el = h('button', { class: 'menu-item' + (danger ? ' danger' : '') }, label);
      el.addEventListener('click', () => {
        this.closePopover();
        run();
      });
      return el;
    };
    const items: HTMLElement[] = [
      item('👑 Pass crown', async () => {
        // What the old crown keeps is left unsaid for now (O112); was: `... You keep Cards.`
        if (await confirmDialog(`Pass the crown to ${p.nickname}?`, 'Pass crown')) session.send({ t: 'pass', player: p.id });
      }),
      item('Kick', () => session.send({ t: 'kick', player: p.id }), true),
      item('Ban', async () => {
        if (await confirmDialog(`Ban ${p.nickname}? They can't come back while the room is open.`, 'Ban')) session.send({ t: 'ban', player: p.id });
      }, true),
    ];
    // Give stand to…: an unowned stand to a player (a full stand only to one who owns none, O27).
    const store = this.app.store;
    const hasFull = [...store.mats.values()].some((m) => isFullStand(m) && m.owner === p.id);
    const unowned = [...store.mats.values()].filter((m: Mat) => isStand(m) && !m.owner && (!isFullStand(m) || !hasFull));
    for (const m of unowned) items.push(item(`Give stand “${m.name || 'unnamed'}”`, () => store.setMatOwner(m.uid, p.id)));
    const pop = h('div', { class: 'player-menu' }, ...items);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.right - 190)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    document.body.append(pop);
    this.popover = pop;
  }

  private openPopover(anchor: HTMLElement): void {
    this.closePopover();
    const room = this.room;
    if (!room) return;
    const mineNow = room.player(room.me)?.colour.toLowerCase();
    const free = freeColours(room.players, room.me).filter((c) => c.toLowerCase() !== mineNow);
    const pop = h('div', { class: 'colour-popover' });
    if (!free.length) pop.append(h('span', { class: 'muted small' }, 'Every colour is taken'));
    for (const c of free) {
      const b = h('button', { class: 'swatch', title: 'Take this colour', 'aria-label': `Colour ${c}` });
      b.style.background = c;
      b.addEventListener('click', () => {
        setColour(c);
        this.session?.send({ t: 'colour', colour: c });
        this.closePopover();
      });
      pop.append(b);
    }
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    document.body.append(pop);
    this.popover = pop;
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}
