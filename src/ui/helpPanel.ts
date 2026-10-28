// The full controls reference (decision 135): a popover from the ? button in
// the top bar, or the ? key. Esc or a click elsewhere closes it. The context
// hint line in the play space shows just what matters now; this lists it all.

import { h } from './dom';

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
    ['🃏', 'Middle-click', 'flip a card'],
    ['📖', 'Double-click', 'spread a pile, or restack it'],
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
    ['🪟', 'X', 'then click to spread there, or drag a box to fit them in it · X X spreads in place · X on a spread restacks it'],
    ['📊', 'C', 'curve by mana value · Shift + C by colour'],
    ['🎴', 'H', 'fan like a hand of cards · H again stacks it'],
    ['🖐️', '1 – 9', 'draw that many from the pile under the cursor, then click to lay them out as a hand, face up'],
    ['🔢', '0', 'draw any number: type how many (a whole sealed pool), then click'],
    ['📐', 'Shift + T', 'Tidy mode on or off'],
    ['🎥', 'V', 'camera angle · Z frames · Home resets'],
    ['🏷️', 'N', 'name a pile'],
    ['🗑️', 'Delete', 'remove to the tray'],
    ['🔎', 'Ctrl + F or /', 'search the table'],
    ['💾', 'Ctrl + S', 'save · Ctrl + E exports · Ctrl + A selects all'],
    ['❓', '?', 'this list'],
  ]],
];

export class HelpPanel {
  private readonly el: HTMLDivElement;

  constructor() {
    this.el = h('div', { class: 'help-panel', hidden: '' },
      h('div', { class: 'help-head' }, h('span', { class: 'pe-title' }, 'Controls'), h('span', { class: 'muted small' }, 'Keys act on the selection, or on the pile under the cursor.')),
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
