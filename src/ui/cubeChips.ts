// The cube chips (decision 321): along the top of the play space, mirroring
// the control hints along the bottom, a chip for each CubeCobra cube with
// cards on the table: CubeCobra's icon, the cube's name, its size and a link
// to it. In a room everyone sees them (the cube list travels as the `cubes`
// op, O113). The ? panel's "Hide cube chips" hides them, remembered in this
// browser.

import type { App } from '../app';
import { cubeLinkText, cubesOnTable, cubeUrl } from '../state/cubes';
import type { CubeInfo } from '../state/types';
import { h } from './dom';

const HIDDEN_KEY = 'cubeChips.hidden';
/** CubeCobra's own icon, from their site like the cube data. */
const ICON = 'https://cubecobra.com/content/favicon.ico';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export class CubeChips {
  private readonly el: HTMLDivElement;
  private shown = '';
  private off = readHidden();

  /** The ? panel's "Hide cube chips". */
  get hidden(): boolean {
    return this.off;
  }

  set hidden(on: boolean) {
    this.off = on;
    try {
      localStorage.setItem(HIDDEN_KEY, on ? '1' : '0');
    } catch {
      // Private window or blocked storage: it just isn't remembered.
    }
    this.update();
  }

  constructor(private readonly app: App) {
    this.el = h('div', { class: 'cube-chips' });
    app.overlay.append(this.el);
    const ev = app.store.events;
    const update = () => this.update();
    ev.on('added', update);
    ev.on('removed', update);
    ev.on('reset', update);
    ev.on('cubes', update);
    this.update();
  }

  private update(): void {
    const cubes = this.off ? [] : cubesOnTable(this.app.store.cubes.values(), this.app.store.cards.values());
    const signature = JSON.stringify(cubes);
    if (signature === this.shown) return;
    this.shown = signature;
    this.el.hidden = !cubes.length;
    this.el.replaceChildren(...cubes.map((c) => this.chip(c)));
  }

  private chip(cube: CubeInfo): HTMLElement {
    const icon = h('img', { class: 'cube-chip-icon', src: ICON, alt: '', width: '16', height: '16' });
    // Their icon didn't load: a cube in its place.
    icon.addEventListener('error', () => icon.replaceWith(h('span', { class: 'cube-chip-icon' }, '🧊')), { once: true });
    return h('div', { class: 'cube-chip', title: `${cube.name} on CubeCobra` },
      icon,
      h('span', { class: 'cube-chip-name' }, cube.name),
      h('span', { class: 'cube-chip-size' }, `${cube.size.toLocaleString()} cards`),
      h('a', { class: 'cube-chip-link', href: cubeUrl(cube.id), target: '_blank', rel: 'noopener' }, cubeLinkText(cube.id)),
    );
  }
}
