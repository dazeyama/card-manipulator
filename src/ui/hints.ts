// The Controls list at the foot of the Spawn panel (decisions 132, 133): one
// line per control, an icon, the keys, and what they do.

import { h } from './dom';

/**
 * Control hints at the foot of the Spawn panel (decisions 132, 133): an icon, the keys,
 * and what they do. Hold keys first, as they match the cursor's emoji.
 */
const HINTS: [string, string, string][] = [
  ['🧲', 'Hold Shift', 'sweep up cards while dragging'],
  ['📐', 'Hold Ctrl', 'Tidy mode while held'],
  ['🔗', 'Alt + drag', 'move cards in formation'],
  ['🔢', 'Hold Alt', 'show every pile’s count'],
  ['↔️', 'Right-drag', 'pan · Space + drag too'],
  ['🔄', 'Middle-drag', 'orbit · middle-click flips'],
  ['📖', 'Double-click', 'spread a pile, or restack it'],
  ['📚', 'S', 'stack · S S shuffles'],
  ['🃏', 'F', 'flip · F F faces all up'],
  ['🔃', 'R', 'turn 90° · R R upright'],
  ['🧹', 'T', 'tidy · Shift + T Tidy mode'],
  ['🪟', 'X', 'spread'],
  ['📊', 'C', 'curve · Shift + C by colour'],
  ['🎥', 'V', 'camera angle · Z frames'],
  ['🗑️', 'Delete', 'remove to the tray'],
];

/** The Controls section. */
export function controlHints(): HTMLElement {
  return h('div', { class: 'hints' },
    h('div', { class: 'hints-title' }, 'Controls'),
    ...HINTS.map(([icon, keys, what]) => h('div', { class: 'hint' }, h('span', { class: 'hint-icon' }, icon), h('span', { class: 'hint-keys' }, keys), h('span', { class: 'hint-what' }, what))),
    h('div', { class: 'hint-note' }, 'Keys act on the selection, or on the pile under the cursor.'),
  );
}
