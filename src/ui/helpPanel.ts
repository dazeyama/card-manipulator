// The full controls reference (decision 135): a popover from the ? button in
// the top bar, or the ? key. Esc or a click elsewhere closes it. The context
// hint line in the play space shows just what matters now; this lists it all.

import { h } from './dom';

type Line = [string, string, string];

// Text in [brackets] is a key or mouse button, drawn as a keycap chip (decision 136).
const GROUPS: [string, Line[]][] = [
  ['Hold', [
    ['🧲', '[Shift]', 'while dragging, sweep up the cards you pass over'],
    ['📐', '[Ctrl]', 'Tidy mode while held: drops land squared at 90°'],
    ['🔗', '[Alt] + [Drag]', 'move the selection in formation'],
    ['🔢', '[Alt]', 'show every pile’s count'],
  ]],
  ['Mouse', [
    ['🖐️', '[Drag] a card', 'pick it up, or the whole selection'],
    ['⬚', '[Drag] on table', 'select; [Ctrl] adds, [Shift] takes away'],
    ['👆', '[Click]', 'select a card; [Ctrl] + [Click] toggles it'],
    ['📚', '[Drag] a pile’s number', 'lift the whole pile (hold [Alt] to see numbers)'],
    ['🃏', '[Middle-click]', 'flip a card'],
    ['📖', '[Double-click]', 'spread a pile, or restack it'],
    ['↔️', '[Right-drag]', 'pan (or [Space] + [Drag]); [Double right-click] straightens the view'],
    ['🔄', '[Middle-drag]', 'orbit'],
    ['🔍', '[Wheel]', 'zoom toward the cursor'],
  ]],
  ['Keys', [
    ['📚', '[S]', 'stack · [S] [S] shuffles'],
    ['🃏', '[F]', 'flip · [F] [F] faces all up'],
    ['🔃', '[R]', 'turn 90° · [R] [R] stands upright'],
    ['🧹', '[T]', 'tidy'],
    ['🪟', '[X]', 'spread, or restack'],
    ['📊', '[C]', 'curve by mana value · [Shift] + [C] by colour'],
    ['📐', '[Shift] + [T]', 'Tidy mode on or off'],
    ['🎥', '[V]', 'camera angle · [Z] frames · [Home] resets'],
    ['🏷️', '[N]', 'name a pile'],
    ['🗑️', '[Delete]', 'remove to the tray'],
    ['🔎', '[Ctrl] + [F] or [/]', 'search the table'],
    ['💾', '[Ctrl] + [S]', 'save · [Ctrl] + [E] exports · [Ctrl] + [A] selects all'],
    ['❓', '[?]', 'this list'],
  ]],
];

/** Text with [bracketed] keys as keycap chips. */
function withKeys(text: string): (string | HTMLElement)[] {
  return text.split(/\[([^\]]+)\]/).map((part, i) => (i % 2 ? h('kbd', { class: 'keycap' }, part) : part)).filter((part) => part !== '');
}

export class HelpPanel {
  private readonly el: HTMLDivElement;

  constructor() {
    this.el = h('div', { class: 'help-panel', hidden: '' },
      h('div', { class: 'help-head' }, h('span', { class: 'pe-title' }, 'Controls'), h('span', { class: 'muted small' }, 'Keys act on the selection, or on the pile under the cursor.')),
      ...GROUPS.map(([title, lines]) =>
        h('div', { class: 'help-group' },
          h('div', { class: 'help-group-title' }, title),
          ...lines.map(([icon, keys, what]) => h('div', { class: 'help-line' }, h('span', { class: 'help-icon' }, icon), h('span', { class: 'help-keys' }, ...withKeys(keys)), h('span', { class: 'help-what' }, ...withKeys(what)))),
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
