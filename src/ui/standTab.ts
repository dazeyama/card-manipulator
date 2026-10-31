// The card stand's spawner (decisions 220, 235): a section of the Spawn
// panel's Playmat tab. A wooden wedge that holds cards up at 25 degrees facing
// you, with a name plate on its back for the player across the table.
// One full stand per player at a time, offline too (O27, O32): the button
// says so while you have one. In a room the plate reads your nickname unless
// you type another name (ONLINE.md 6.3).

import type { App } from '../app';
import type { Mats } from '../mats';
import { getIdentity } from '../online/identity';
import { SMALL_STAND_NAME, SMALL_STAND_W, STAND_W } from '../state/stand';
import { h } from './dom';

export function buildStandSection(app: App, mats: Mats): HTMLElement {
  const name = h('input', { class: 'grow', placeholder: 'Name on the plate', maxlength: '60', spellcheck: 'false', 'aria-label': 'Name on the plate' });
  const goTitle = 'A wooden wedge for your hand: drop cards on it';
  const go = h('button', { class: 'btn primary', title: goTitle }, 'Spawn stand');
  // The same stand at a quarter of the width, for scrying a few cards (decisions 282, 283).
  const halfTitle = 'A quarter as wide: for looking at a few cards, like scry';
  const half = h('button', { class: 'btn', title: halfTitle }, 'Small stand');
  const at = () => ({ x: app.rig.target.x, y: app.rig.target.y });
  // In a room the plate reads your nickname unless you typed something else.
  const plate = () => name.value.trim() || (app.online ? getIdentity().nickname : '');
  const spawn = () => mats.spawnStand(plate(), at());
  go.addEventListener('click', spawn);
  // The small stand reads "Scry" whatever the name field says; its ✏️ changes the word (decision 285).
  half.addEventListener('click', () => mats.spawnStand(SMALL_STAND_NAME, at(), SMALL_STAND_W));
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !go.disabled) spawn();
  });
  // Kept in step with the table and the room: the one-stand rule and the rank (Move) say no with a title.
  const draft = { uid: '', kind: 'stand' as const, scryfallId: '', name: '', art: '', x: 0, y: 0, yaw: 0 };
  let shown = '';
  app.onFrame(() => {
    const full = mats.standSpawnBlock({ ...draft, width: STAND_W });
    const small = app.online ? mats.standSpawnBlock({ ...draft, width: SMALL_STAND_W }) : null;
    const nick = app.online ? getIdentity().nickname : '';
    const key = `${full}|${small}|${nick}`;
    if (key === shown) return;
    shown = key;
    go.disabled = !!full;
    go.title = full ?? goTitle;
    half.disabled = !!small;
    half.title = small ?? halfTitle;
    name.placeholder = nick ? `Name on the plate (${nick})` : 'Name on the plate';
  });
  return h('div', { class: 'panel-section' },
    h('div', { class: 'panel-section-title' }, 'Card stand'),
    h('div', { class: 'row' }, name),
    h('div', { class: 'row' }, go, half),
    h('p', { class: 'muted small' }, 'A wooden wedge that holds cards up so you can see them. Drop cards on it; the name plate faces the other player.'),
  );
}
