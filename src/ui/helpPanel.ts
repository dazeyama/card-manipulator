// The full controls reference (decision 135): a popover from the ? button in
// the top bar, or the ? key. Esc or a click elsewhere closes it. The context
// hint line in the play space shows just what matters now; this lists it all.

import { h } from './dom';
import type { ContextHints } from './hints';

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
    ['📖', 'Double-click', 'tap a card, its stack, or the selection it is in, a quarter turn; again untaps back to 0° (X spreads)'],
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
    ['🎴', 'H', 'fan like a hand of cards · H again stacks it'],
    ['🏆', 'E', 'columns by EDHREC rank · E E by CubeCobra Elo · E again stacks them back'],
    ['🖐️', '1 – 9', 'draw that many from the pile under the cursor, then click to lay them out as a hand, face up'],
    ['🔢', '0', 'draw any number: type how many (a whole sealed pool), then click'],
    ['📐', 'Shift + T', 'Tidy mode on or off'],
    ['🎥', 'V', 'camera angle · Z frames · Home resets'],
    ['🏷️', 'N', 'name a pile'],
    ['🗑️', 'Delete', 'remove to the tray'],
    ['🔎', 'Ctrl + F or /', 'search the table'],
    ['👆', 'P', 'or the finger button by the search box: then click the table to move the selection (or the pile under the cursor) there as a stack · P again switches to face down, like a pack, and back · Esc cancels'],
    ['↩️', 'Ctrl + Z', 'undo the last move or action · again to redo it (one step)'],
    ['📋', 'Ctrl + C', 'copy the selection · Ctrl + V pastes it at the cursor, as a messy pile (any decklist pastes too)'],
    ['💾', 'Ctrl + S', 'save · Ctrl + E exports · Ctrl + A selects all'],
    ['❓', '?', 'this list'],
  ]],
];

export class HelpPanel {
  private readonly el: HTMLDivElement;

  constructor(hints: ContextHints) {
    // Hide the hint line along the bottom of the table (decision 234).
    const hide = h('input', { type: 'checkbox' });
    hide.checked = hints.hidden;
    hide.addEventListener('change', () => (hints.hidden = hide.checked));
    this.el = h('div', { class: 'help-panel', hidden: '' },
      h('div', { class: 'help-head' }, h('span', { class: 'pe-title' }, 'Controls'), h('span', { class: 'muted small' }, 'Keys act on the selection, or on the pile under the cursor.')),
      h('label', { class: 'inline help-hide' }, hide, 'Hide control hints'),
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
