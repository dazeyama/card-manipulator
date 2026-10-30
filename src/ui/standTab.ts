// The card stand's spawner (decisions 220, 235): a section of the Spawn
// panel's Playmat tab. A wooden wedge that holds cards up at 25 degrees facing
// you, with a name plate on its back for the player across the table.

import type { App } from '../app';
import type { Mats } from '../mats';
import { SMALL_STAND_NAME, SMALL_STAND_W } from '../state/stand';
import { h } from './dom';

export function buildStandSection(app: App, mats: Mats): HTMLElement {
  const name = h('input', { class: 'grow', placeholder: 'Name on the plate', maxlength: '60', spellcheck: 'false', 'aria-label': 'Name on the plate' });
  const go = h('button', { class: 'btn primary' }, 'Spawn stand');
  // The same stand at a quarter of the width, for scrying a few cards (decisions 282, 283).
  const half = h('button', { class: 'btn', title: 'A quarter as wide: for looking at a few cards, like scry' }, 'Small stand');
  const at = () => ({ x: app.rig.target.x, y: app.rig.target.y });
  const spawn = () => mats.spawnStand(name.value.trim(), at());
  go.addEventListener('click', spawn);
  // The small stand reads "Scry" whatever the name field says; its ✏️ changes the word (decision 285).
  half.addEventListener('click', () => mats.spawnStand(SMALL_STAND_NAME, at(), SMALL_STAND_W));
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
