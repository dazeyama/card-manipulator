// Cards in hand (decision 250): while the mouse is over a card stand, a small
// badge in the life counter's style floats just off its slope's top-left
// corner, counting the cards on it.

import type { App } from '../app';
import type { Mats } from '../mats';
import { isStand, RIDGE, SLOPE_START, STAND_H, STAND_W, standWorld } from '../state/stand';
import { h } from './dom';
import { offCorner } from './lifeCounter';

/** Smaller than the life badge (56 mm): its size at the corner, and on screen, px. */
const BADGE_MM = 36;
const BADGE_MIN_PX = 30;
const BADGE_MAX_PX = 96;

export class HandCount {
  private readonly el: HTMLDivElement;
  private readonly num: HTMLSpanElement;
  private shown = -1;

  constructor(private readonly app: App, private readonly mats: Mats) {
    this.num = h('span', { class: 'life-num' });
    this.el = h('div', { class: 'life-badge hand-badge', hidden: '' }, this.num, h('span', { class: 'hand-label' }, 'in hand'));
    app.overlay.append(this.el);
    app.onFrame(() => this.frame());
  }

  private frame(): void {
    const store = this.app.store;
    const id = this.mats.hovered;
    const m = id ? store.mats.get(id) : undefined;
    if (!m || !isStand(m) || this.mats.dragging) {
      this.el.hidden = true;
      return;
    }
    const at = this.mats.drawnAt(m.uid) ?? m;
    const s = { ...m, x: at.x, y: at.y, yaw: at.yaw };
    // The slope's top-left corner, at the ridge, with the ridge and the slope's left edge from it.
    const k = { ...standWorld(s, -STAND_W / 2, RIDGE), z: STAND_H };
    if (!this.app.rig.inFront(k.x, k.y, k.z)) {
      this.el.hidden = true;
      return;
    }
    const along = { ...standWorld(s, STAND_W / 2, RIDGE), z: STAND_H };
    const down = { ...standWorld(s, -STAND_W / 2, SLOPE_START), z: 0 };
    const { p, size } = offCorner(this.app.rig, k, along, down, BADGE_MM, BADGE_MIN_PX, BADGE_MAX_PX);
    this.el.hidden = false;
    this.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    this.el.style.width = this.el.style.height = `${size.toFixed(0)}px`;
    this.el.style.fontSize = `${(size * 0.42).toFixed(1)}px`;
    let n = 0;
    for (const c of store.cards.values()) if (c.stand === m.uid) n++;
    if (n !== this.shown) {
      this.shown = n;
      this.num.textContent = String(n);
    }
  }
}
