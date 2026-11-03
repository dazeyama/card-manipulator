// Sleeves on the Playmat tab (decision 360): pick a color, or type a card for
// art sleeves, and Spawn pack lays a sleeve pack in the middle of the view.
// Shift + U drops a pack of the last sleeves chosen at the cursor. Drop a pack
// on a deck to sleeve it (src/sleeves.ts).

import type { App } from '../app';
import type { Dice } from '../dice';
import { DARK_COLOURS, DIE_COLOURS } from '../state/dice';
import { COLOUR_NAMES, DEFAULT_SLEEVE, sleeveName } from '../state/sleeves';
import { h } from './dom';
import { findArt } from './playmatTab';

/** The sleeves a pack holds: a color, or art with its card's name. */
export interface PackSleeve {
  color?: string;
  art?: string;
  artName?: string;
}

const LAST_KEY = 'sleeves.last';

/** The last sleeves chosen (Shift + U drops a pack of these), kept in this browser. */
function readLast(): PackSleeve {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as PackSleeve | null;
    if (v && (typeof v.color === 'string' || typeof v.art === 'string')) return v;
  } catch {
    // No storage here: the default.
  }
  return { color: DEFAULT_SLEEVE };
}

let last: PackSleeve = readLast();

function remember(s: PackSleeve): void {
  last = s;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(s));
  } catch {
    // Not kept: fine.
  }
}

/** Shift + U (decision 360): a pack of the last sleeves chosen, at a spot. */
export function dropLastPack(dice: Dice, at: { x: number; y: number }): void {
  dice.spawnPack(at, last);
}

export function buildSleevesSection(app: App, dice: Dice): HTMLElement {
  let color = last.color ?? DEFAULT_SLEEVE;
  const swatches: HTMLButtonElement[] = [];
  const line = h('input', { class: 'grow', placeholder: 'Or a card for art sleeves: Ragavan (MH2) 138', spellcheck: 'false', 'aria-label': 'Card for art sleeves' });
  if (last.art && last.artName) line.value = last.artName;
  const go = h('button', { class: 'btn primary', title: 'A pack of sleeves in the middle of the view: drop it on a deck to sleeve it' }, 'Spawn pack');
  const status = h('div', { class: 'muted small' });
  const mark = () => {
    for (const b of swatches) b.classList.toggle('on', !line.value.trim() && b.dataset.color === color);
  };
  const swatch = (c: string) => {
    const b = h('button', { class: 'die-swatch sleeve-swatch', title: COLOUR_NAMES[c] ?? c, 'aria-label': `${COLOUR_NAMES[c] ?? c} sleeves` });
    b.dataset.color = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      color = c;
      line.value = '';
      mark();
    });
    swatches.push(b);
    return b;
  };
  line.addEventListener('input', mark);

  const spawn = async () => {
    const at = { x: app.rig.target.x, y: app.rig.target.y };
    const text = line.value.trim();
    if (!text) {
      remember({ color });
      dice.spawnPack(at, { color });
      status.textContent = `A pack of ${sleeveName(color).toLowerCase()} sleeves: drop it on a deck.`;
      return;
    }
    go.disabled = true;
    status.textContent = 'Finding the card…';
    try {
      const found = await findArt(text);
      if ('error' in found) {
        status.textContent = found.error;
        return;
      }
      const s = { art: found.art, artName: found.name };
      remember(s);
      dice.spawnPack(at, s);
      status.textContent = `A pack of ${found.name} art sleeves (${found.where}): drop it on a deck.`;
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void spawn());
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void spawn();
  });
  const el = h('div', { class: 'panel-section' },
    h('div', { class: 'panel-section-title' }, 'Sleeves'),
    h('div', { class: 'die-swatches sleeve-swatches' }, ...DIE_COLOURS.map(swatch)),
    h('div', { class: 'die-swatches sleeve-swatches' }, ...DARK_COLOURS.map(swatch)),
    h('div', { class: 'row' }, line),
    h('div', { class: 'row' }, go),
    h('p', { class: 'muted small' }, 'Drop a pack on a deck to sleeve it; the deck is saved under List. Face down, sleeved cards show the sleeve; Shift + F raises a double-faced card’s back face, U takes sleeves off, Shift + U drops another pack.'),
    status,
  );
  mark();
  return el;
}
