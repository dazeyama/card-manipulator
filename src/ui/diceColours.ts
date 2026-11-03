// A die's color (decision 278): C over a die, or with dice selected, opens a
// small row of color swatches beside the cursor; a click paints the dice and
// closes it. Esc or a click elsewhere closes it too.

import type { Dice } from '../dice';
import { DARK_COLOURS, DIE_COLOURS } from '../state/dice';
import { COLOUR_NAMES } from '../state/sleeves';
import { h } from './dom';

const NAMES = COLOUR_NAMES;

export class DiceColours {
  private readonly el: HTMLDivElement;
  /** The dice the menu paints. */
  private uids: string[] = [];

  constructor(private readonly dice: Dice) {
    const swatch = (color: string) => {
      const b = h('button', { class: 'die-swatch', title: NAMES[color] ?? color, 'aria-label': NAMES[color] ?? color });
      b.style.background = color;
      b.addEventListener('click', () => {
        this.dice.paint(this.uids, color);
        this.close();
      });
      return b;
    };
    this.el = h('div', { class: 'die-colours', hidden: '' },
      h('div', { class: 'die-swatches' }, ...DIE_COLOURS.map(swatch)),
      h('div', { class: 'die-swatches' }, ...DARK_COLOURS.map(swatch)),
    );
    document.body.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) {
        e.stopImmediatePropagation();
        this.close();
      }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (!this.el.hidden && !this.el.contains(e.target as Node)) this.close();
    }, true);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
  }

  /** Open for these dice, beside a point on screen (page pixels). */
  show(uids: string[], at: { x: number; y: number }): void {
    this.uids = uids;
    this.el.hidden = false;
    this.el.style.left = `${Math.min(at.x + 14, window.innerWidth - 230)}px`;
    this.el.style.top = `${Math.min(at.y + 10, window.innerHeight - 90)}px`;
  }
}
