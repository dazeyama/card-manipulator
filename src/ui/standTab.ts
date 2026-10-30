// The card stand's spawner (decisions 220, 235): a section of the Spawn
// panel's Playmat tab. A wooden wedge that holds cards up at 25 degrees facing
// you, with a name plate on its back for the player across the table.

import type { App } from '../app';
import type { Mats } from '../mats';
import { HALF_STAND_W } from '../state/stand';
import { h } from './dom';

export function buildStandSection(app: App, mats: Mats): HTMLElement {
  const name = h('input', { class: 'grow', placeholder: 'Name on the plate', maxlength: '60', spellcheck: 'false', 'aria-label': 'Name on the plate' });
  const go = h('button', { class: 'btn primary' }, 'Spawn stand');
  // The same stand at half the width (decision 282).
  const half = h('button', { class: 'btn' }, 'Half-width stand');
  const spawn = (width?: number) => mats.spawnStand(name.value.trim(), { x: app.rig.target.x, y: app.rig.target.y }, width);
  go.addEventListener('click', () => spawn());
  half.addEventListener('click', () => spawn(HALF_STAND_W));
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') spawn();
  });
  return h('div', { class: 'panel-section' },
    h('div', { class: 'panel-section-title' }, 'Card stand'),
    h('div', { class: 'row' }, name),
    h('div', { class: 'row' }, go, half),
    h('p', { class: 'muted small' }, 'A wooden wedge that holds cards up so you can see them. Drop cards on it; the name plate faces the other player.'),
  );
}
