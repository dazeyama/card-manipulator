// The full controls reference (decision 135): a popover from the ? button in
// the top bar, or the ? key. Esc or a click elsewhere closes it. The context
// hint line in the play space shows just what matters now; this lists it all.

import { h } from './dom';
import type { ContextHints } from './hints';
import { CURSOR_LABEL, cursorChoice, cursorSizeNow, setCursorChoice, type CursorChoice } from './cursorSize';

type Line = [string, string, string];

const GROUPS: [string, Line[]][] = [
  ['Hold', [
    ['🧲', 'Shift', 'while dragging, sweep up the cards you pass over'],
    ['📐', 'Ctrl', 'Tidy mode while held: drops land squared at 90°'],
    ['🔗', 'Alt + drag', 'move the selection in formation'],
    ['🔢', 'Alt', 'show every pile’s count'],
  ]],
  ['Mouse', [
    ['🖐️', 'Drag a card', 'pick it up, or the whole selection'],
    ['⬚', 'Drag on table', 'select; Ctrl adds, Shift takes away'],
    ['👆', 'Click', 'select a card; Ctrl + click toggles it'],
    ['📚', 'Drag a pile’s number', 'lift the whole pile (hold Alt to see numbers)'],
    ['🃏', 'Middle-click', 'flip a card, or the cards in your hand'],
    ['👇', 'Right-click or Space while holding', 'dealing: deal the bottom card (squared with Ctrl); hold to keep dealing, one every quarter second'],
    ['📖', 'Double-click', 'face up: tap the card, or the selection it is in, a quarter turn; again untaps back to 0°. Face down: select the whole stack (X spreads)'],
    ['↔️', 'Right-drag', 'pan (or Space + drag); double right-click straightens the view'],
    ['🔄', 'Middle-drag', 'orbit'],
    ['🔍', 'Wheel', 'zoom toward the cursor'],
    ['🟫', 'Drag a playmat', 'move it where no card is; Alt + drag carries its cards; R turns it, Delete removes it; its 📺 button opens a top-down mirror window, and 🔓 beside it locks it in place'],
  ]],
  ['Keys', [
    ['📚', 'S', 'stack · S S shuffles'],
    ['🃏', 'F', 'flip · F F faces all up'],
    ['🔃', 'R', 'turn 90° · R R stands upright'],
    ['🧹', 'T', 'tidy'],
    ['🪟', 'X', 'then click to spread there, or drag a box to fit them in it · X again switches to the reverse spread, each row right to left so the mana costs show, and back · X on a spread restacks it'],
    ['📊', 'C', 'curve by mana value · C C a column per colour, W U B R G, colourless, multicolour, lands · Shift + C a curve row per colour'],
    ['🎴', 'H', 'fan like a hand of cards · H again stacks it · H H on a stand makes the hand its usual size, not the slope\'s width'],
    ['🏆', 'E', 'columns by EDHREC rank · E E by CubeCobra Elo · E again stacks them back'],
    ['🖐️', '1 – 9', 'draw that many from the pile under the cursor, then click to lay them out as a hand, face up · Shift + 1 – 9 deals them face down'],
    ['🔢', '0', 'draw any number: type how many (a whole sealed pool), then click · Shift + 0 ticks Face down?'],
    ['📐', 'Shift + T', 'Tidy mode on or off'],
    ['🎥', 'V', 'camera angle · Z frames, Z again goes back · Home resets'],
    ['🏷️', 'N', 'name a pile'],
    ['🗑️', 'Delete', 'remove to the tray'],
    ['🔎', 'Ctrl + F or /', 'search the table'],
    ['👆', 'P', 'or the finger button by the search box: then click the table to move the selection (or the pile under the cursor) there as a stack · P again switches to face down, like a pack, and back · Esc cancels'],
    ['🪙', 'T T', 'over a card: the tokens it makes, from Scryfall; click one to spawn it beside the card'],
    ['🪞', 'M', 'mirror mode: sit at the far side of the table; cards you move from there turn to face you'],
    ['🎲', 'D', 'drop a die at the cursor, D D a d20; drag or select dice like cards; selected with cards, they move together, Alt keeps the layout · R rolls them · 1–9 or the wheel sets the number, 0 types one · C picks a colour · Delete removes'],
    ['↩️', 'Ctrl + Z', 'undo the last move or action · again to redo it (one step)'],
    ['📋', 'Ctrl + C', 'copy the selection · Ctrl + V pastes it at the cursor, as a messy pile (any decklist pastes too)'],
    ['💾', 'Ctrl + S', 'save · Ctrl + E exports · Ctrl + A selects all'],
    ['❓', '?', 'this list'],
  ]],
  // Rooms (ONLINE.md 13): no new keys; how sharing a table works.
  ['Online', [
    ['🌐', 'Go online', 'share your table by link: up to eight players, each with a cursor; the panel has the link, settings, players and chat · 🗂 Tables lists the public ones'],
    ['👑', 'Crown', 'the host: ranks, kicks, settings, Lock table; passed from a player’s ⋯ in the panel'],
    ['🪪', 'Ranks', 'View · Move · Tokens · Cards · Everything; the crown sets them'],
    ['🂠', 'Hidden', 'your stand’s cards and face-down cards show their backs to others; 👤 on a stand’s lip says whose it is'],
    ['🪞', 'M', 'cross to the far side of the table'],
  ]],
];

export class HelpPanel {
  private readonly el: HTMLDivElement;

  constructor(hints: ContextHints) {
    // Hide the hint line along the bottom of the table (decision 234).
    const hide = h('input', { type: 'checkbox' });
    hide.checked = hints.hidden;
    hide.addEventListener('change', () => (hints.hidden = hide.checked));
    // Cursor size (decision 289): Auto sizes to the screen; remembered in this browser.
    const size = h('select', { 'aria-label': 'Cursor size' });
    const fill = () => {
      size.replaceChildren(
        h('option', { value: 'auto' }, `Auto (${CURSOR_LABEL[cursorSizeNow('auto')]})`),
        ...(['small', 'medium', 'large'] as const).map((s) => h('option', { value: s }, CURSOR_LABEL[s])),
      );
      size.value = cursorChoice();
    };
    fill();
    size.addEventListener('change', () => setCursorChoice(size.value as CursorChoice));
    this.el = h('div', { class: 'help-panel', hidden: '' },
      h('div', { class: 'help-head' }, h('span', { class: 'pe-title' }, 'Controls'), h('span', { class: 'muted small' }, 'Keys act on the selection, or on the pile under the cursor.')),
      h('div', { class: 'help-options' },
        h('label', { class: 'inline help-hide' }, hide, 'Hide control hints'),
        h('label', { class: 'inline help-cursor' }, 'Cursor size', size),
      ),
      ...GROUPS.map(([title, lines]) =>
        h('div', { class: 'help-group' },
          h('div', { class: 'help-group-title' }, title),
          ...lines.map(([icon, keys, what]) => h('div', { class: 'help-line' }, h('span', { class: 'help-icon' }, icon), h('span', { class: 'help-keys' }, keys), h('span', { class: 'help-what' }, what))),
        ),
      ),
    );
    document.body.append(this.el);
    // Esc or a click elsewhere closes it, before anything else sees the key or click.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) {
        e.stopImmediatePropagation();
        this.close();
      }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (this.open && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.help-trigger')) this.close();
    }, true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
  }
}
