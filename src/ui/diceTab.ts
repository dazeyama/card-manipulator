// Dice on the Accessories tab (decision 373): pick a color, then Spawn d6 or
// Spawn d20 lays one in the middle of the view, as D and D D do at the cursor.

import type { App } from '../app';
import type { Dice } from '../dice';
import { DARK_COLOURS, DIE_COLOURS, DIE_WHITE } from '../state/dice';
import { COLOUR_NAMES } from '../state/sleeves';
import { h } from './dom';

export function buildDiceSection(app: App, dice: Dice): HTMLElement {
  let color = DIE_WHITE;
  const swatches: HTMLButtonElement[] = [];
  const mark = () => {
    for (const b of swatches) b.classList.toggle('on', b.dataset.color === color);
  };
  const swatch = (c: string) => {
    const b = h('button', { class: 'die-swatch sleeve-swatch', title: COLOUR_NAMES[c] ?? c, 'aria-label': `${COLOUR_NAMES[c] ?? c} dice` });
    b.dataset.color = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      color = c;
      mark();
    });
    swatches.push(b);
    return b;
  };
  const d6 = h('button', { class: 'btn primary', title: 'A six-sided die in the middle of the view (D drops one at the cursor)' }, 'Spawn d6');
  const d20 = h('button', { class: 'btn', title: 'A twenty-sided die in the middle of the view (D D drops one at the cursor)' }, 'Spawn d20');
  const at = () => ({ x: app.rig.target.x, y: app.rig.target.y });
  d6.addEventListener('click', () => dice.spawn(at(), undefined, color));
  d20.addEventListener('click', () => dice.spawn(at(), 'd20', color));
  const el = h('div', { class: 'panel-section' },
    h('div', { class: 'panel-section-title' }, 'Dice'),
    h('div', { class: 'die-swatches sleeve-swatches' }, ...DIE_COLOURS.map(swatch)),
    h('div', { class: 'die-swatches sleeve-swatches' }, ...DARK_COLOURS.map(swatch)),
    h('div', { class: 'row' }, d6, d20),
    h('p', { class: 'muted small' }, 'Drag dice like cards; R rolls, 1–9 or the wheel sets the number, C recolors.'),
  );
  mark();
  return el;
}
