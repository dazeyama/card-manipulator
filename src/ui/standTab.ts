// The Spawn panel's Stand tab (decision 220): a wooden card stand, a wedge
// that holds cards up at 25 degrees facing you, with a name plate on its back
// for the player across the table.

import type { App } from '../app';
import type { Mats } from '../mats';
import { h } from './dom';

export function buildStandTab(app: App, mats: Mats): HTMLElement {
  const name = h('input', { class: 'grow', placeholder: 'Name on the plate', maxlength: '60', spellcheck: 'false', 'aria-label': 'Name on the plate' });
  const go = h('button', { class: 'btn primary' }, 'Spawn stand');
  const spawn = () => mats.spawnStand(name.value.trim(), { x: app.rig.target.x, y: app.rig.target.y });
  go.addEventListener('click', spawn);
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') spawn();
  });
  return h('div', {},
    h('div', { class: 'row' }, name),
    h('div', { class: 'row' }, go),
    h('p', { class: 'muted small' }, 'A 45 × 20 cm wooden wedge whose 25° slope is a second little table, facing you: cards dragged over it tilt onto it and snap flat on it, and S, T, H, X, P and 1–9 lay them out there. The name plate on its back faces the player across the table. It moves like a playmat and always takes its cards along: drag it, R turns it, 🔒 locks it, ✏️ changes the name, Delete puts its cards down on the table.'),
  );
}
