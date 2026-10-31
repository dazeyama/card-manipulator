// Rank gating in the browser (ONLINE.md 6.4, the first of three layers): keys
// that would change the table show a toast ("Move or higher needed", "The
// table is locked", "Only Sam can touch that stand") and do nothing; buttons
// are greyed with a title saying what is needed and refuse clicks; the mouse
// grammar refuses to begin a drag of what you may not move, while a plain
// click still selects. Honest clients never send an op they may not. The
// crown's judge (authority.ts) and the server are the other two layers.
//
// Offline everything is allowed, except the one-full-stand rule, which holds
// offline too (O32) and lives with the stand buttons.

import type { App } from '../app';
import type { CustomGesture, MouseInput } from '../input/mouse';
import { addAction, refusal, removeAction, type Action, type PieceRecord } from '../../shared/permissions';
import { MAX_CARDS } from '../../shared/protocol';
import { isStand } from '../state/stand';
import type { Mat } from '../state/types';
import { toast, type ToastKind } from '../ui/toasts';

let app: App | null = null;

/** One toast per message for its two seconds, never a stack of the same one (12.4). */
const lastToast = new Map<string, number>();
export function roomToast(message: string, kind: ToastKind = 'info'): void {
  const now = performance.now();
  if (now - (lastToast.get(message) ?? -Infinity) < 2000) return;
  lastToast.set(message, now);
  toast(message, kind, 2000);
}

/** Actions that only look: they work while reconnecting and while the table is locked. */
const LOOKING = new Set<Action>(['camera', 'hover', 'inspect', 'search', 'refine', 'select', 'chat', 'download']);

/** Why I may not do this right now, in the toast's words, or null when I may (always offline). */
export function whyNot(action: Action): string | null {
  const room = app?.online?.room;
  if (!room) return null;
  // While the socket is down the table is read-only (4.7).
  if (!room.connected && !LOOKING.has(action)) return 'Reconnecting… the table is read-only for now';
  return refusal(room.isCrown ? 'crown' : room.rank, action, { locked: room.locked, downloads: room.downloads });
}

/** May I do this now? Says why not with a toast unless `quiet`. */
export function allowedNow(action: Action, quiet = false): boolean {
  const why = whyNot(action);
  if (why && !quiet) roomToast(why, 'warn');
  return !why;
}

/** Why I may not touch this stand (6.3): it is another player's, or nobody's yet. Null offline and for the owner. */
export function standWhyNot(m: Mat | undefined): string | null {
  const room = app?.online?.room;
  if (!room || !m || !isStand(m) || m.owner === room.me) return null;
  if (!m.owner) return 'This stand has no owner: Claim it first';
  return `Only ${room.nameOf(m.owner)} can touch that stand`;
}

export function mayTouchStand(m: Mat | undefined, quiet = false): boolean {
  const why = standWhyNot(m);
  if (why && !quiet) roomToast(why, 'warn');
  return !why;
}

/**
 * The cards a command may act on (6.3): in a room, those on a stand this
 * player may not touch are left out, the crown's own included (the crown's UI
 * hides what anyone's would, 7.1), with one toast when any were. Offline, all.
 */
export function touchable(uids: string[], quiet = false): string[] {
  if (!app?.online) return uids;
  const store = app.store;
  const out: string[] = [];
  const refused = new Map<string, string>();
  for (const u of uids) {
    const stand = store.cards.get(u)?.stand;
    const why = stand ? standWhyNot(store.mats.get(stand)) : null;
    if (why) refused.set(stand!, why);
    else out.push(u);
  }
  if (refused.size && !quiet) {
    const [why] = refused.values();
    roomToast(refused.size === 1 ? `${why}: those cards were left out` : 'Cards on other players’ stands were left out', 'warn');
  }
  return out;
}

/** May I move these cards: Move rank, and the owner of any stand they lie on? */
export function mayMoveCards(uids: Iterable<string>, quiet = false): boolean {
  if (!app?.online) return true;
  if (!allowedNow('move', quiet)) return false;
  const store = app.store;
  const seen = new Set<string>();
  for (const u of uids) {
    const stand = store.cards.get(u)?.stand;
    if (!stand || seen.has(stand)) continue;
    seen.add(stand);
    if (!mayTouchStand(store.mats.get(stand), quiet)) return false;
  }
  return true;
}

/** May I spawn these cards: Tokens for tokens and basic lands, Cards for the rest (O25, O60, O67), under the 5,000-card cap (O43)? */
export function maySpawn(records: PieceRecord[], count: number, quiet = false): boolean {
  if (!app?.online) return true;
  if (!allowedNow(addAction(records), quiet)) return false;
  if (app.store.cards.size + count > MAX_CARDS) {
    if (!quiet) roomToast(`The table is full: ${MAX_CARDS.toLocaleString()} cards`, 'warn');
    return false;
  }
  return true;
}

/**
 * May I remove these cards (removing follows adding, O25)? Judged on the ones
 * actually removed: cards on stands I may not touch are left out (touchable).
 */
export function mayRemoveCards(uids: string[], quiet = false): boolean {
  if (!app?.online) return true;
  uids = touchable(uids, true);
  if (!uids.length) return true;
  const store = app.store;
  // The real records, as the judge sees them: rank is about what the cards are, not what I may see.
  const records = uids.map((u) => {
    const c = store.cards.get(u);
    return c ? store.records.get(c.scryfallId) : undefined;
  });
  return allowedNow(removeAction(records), quiet);
}

/** The action a key's command is (6.2), for the keys that change the table; null for looking and personal keys. */
export function keyAction(name: string): Action | null {
  if (name === 'ctrl+e' || name === 'ctrl+s') return 'download';
  if (name === 'ctrl+z') return 'move';
  if (name === 'd') return 'diceAdd';
  if (name === 'n') return 'named';
  // Shift + T is your own Tidy mode, a personal setting (O44).
  if (name === 'shift+t') return null;
  // Stack, spread, tidy, curve and colours, ranks, fan, turn or roll, flip, place, draw or set a die.
  if (/^(shift\+)?[sxtcehrfp0-9]$/.test(name)) return 'move';
  // Looking (Esc, Ctrl + A, Ctrl + F, /, V, Home, Z, ?) and personal keys (M, Shift + T) need nothing.
  return null;
}

export class Guard {
  private readonly gated: { el: HTMLElement; why: () => string | null; title: string; hide: boolean }[] = [];

  constructor(readonly owner: App) {
    app = owner;
  }

  /** The keyboard's hook (KeyboardInput.guard): may this key's command run? Toasts why not. */
  key = (name: string): boolean => {
    if (!this.owner.online) return true;
    if (name === 'delete' || name === 'backspace') return this.mayDelete();
    const action = keyAction(name);
    return !action || allowedNow(action);
  };

  /** Delete removes the selected dice, else the selected cards, else the playmat under the cursor (main.ts removeSelection). */
  private mayDelete(): boolean {
    const a = this.owner;
    const store = a.store;
    const dice = a.dice;
    if (dice && (dice.selected.size || (!store.selection.size && dice.hovered))) {
      if (!allowedNow('diceRemove')) return false;
      if (!store.selection.size) return true;
    }
    if (!store.selection.size) {
      const uid = a.mats?.movable;
      const m = uid ? store.mats.get(uid) : undefined;
      if (!m) return true;
      if (!isStand(m)) return allowedNow('matRemove');
      return m.owner && m.owner === a.online?.room.me ? allowedNow('standRemoveOwn') : allowedNow('standSpill');
    }
    return mayRemoveCards([...store.selection]);
  }

  /**
   * Grey a button by rank: its title says what is needed, and clicks are refused
   * with the toast. With `hide` it is hidden instead (Downloads off hides the save and
   * export buttons, 4.3).
   */
  gate(el: HTMLElement, action: Action | (() => string | null), hide = false): void {
    const why = typeof action === 'function' ? action : () => whyNot(action);
    this.gated.push({ el, why, title: el.title, hide });
    el.addEventListener('click', (e) => {
      const reason = why();
      if (!reason) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      roomToast(reason, 'warn');
    }, true);
    this.refresh();
  }

  /** Bring every gated button in step with the room (on any rank, lock, crown or connection change). */
  refresh(): void {
    for (const g of this.gated) {
      const reason = g.why();
      g.el.classList.toggle('guarded', !!reason);
      g.el.setAttribute('aria-disabled', String(!!reason));
      g.el.title = reason ?? g.title;
      if (g.hide) g.el.hidden = !!reason;
    }
  }

  /**
   * Wrap the mouse grammar's starts (spec 16): a drag of cards, dice or a mat
   * that you may not move does not begin (a click still selects); a middle-click
   * flip, a double-click turn and the wheel's die number need Move.
   */
  wrapMouse(mouse: MouseInput): void {
    const h = mouse.hooks;
    const store = this.owner.store;
    const cardDrag = h.cardDrag;
    if (cardDrag) h.cardDrag = (uid, x, y, mods) => {
      const moving = store.selection.has(uid) ? [...store.selection] : [uid];
      return mayMoveCards(moving) ? cardDrag(uid, x, y, mods) : null;
    };
    const middle = h.middleClickCard;
    // Flips and turns go through Commands, which leaves out cards on stands you may not touch.
    if (middle) h.middleClickCard = (uid) => {
      if (allowedNow('move')) middle(uid);
    };
    const double = h.doubleClickCard;
    if (double) h.doubleClickCard = (uid, before) => {
      if (allowedNow('move')) double(uid, before);
    };
    const wheel = h.wheelObject;
    if (wheel) h.wheelObject = (x, y, up, shift) => {
      if (this.owner.online && this.owner.dice?.hovered && !allowedNow('dice')) return true;
      return wheel(x, y, up, shift);
    };
    const object = h.objectPress;
    if (object) h.objectPress = (x, y, mods) => clickOnly(object(x, y, mods), x, y, () => allowedNow('dice'));
    const mat = h.matPress;
    if (mat) h.matPress = (x, y, mods) => {
      const uid = this.owner.mats?.movableAt(x, y);
      const m = uid ? store.mats.get(uid) : undefined;
      return clickOnly(mat(x, y, mods), x, y, () => {
        if (!m) return true;
        if (isStand(m)) return allowedNow('standOwn') && mayTouchStand(m);
        return allowedNow('mat');
      });
    };
  }
}

/** A press whose drag is refused: clicks still work, moves say why once and do nothing. */
function clickOnly(g: CustomGesture | null, sx: number, sy: number, may: () => boolean): CustomGesture | null {
  if (!g || !app?.online) return g;
  let checked: boolean | null = null;
  return {
    ...g,
    move: (x, y, e) => {
      // Asked once the press becomes a drag (past the 4 px every press allows a click).
      if (checked === null && Math.hypot(x - sx, y - sy) > 4) checked = may();
      if (checked !== false) g.move(x, y, e);
    },
  };
}
