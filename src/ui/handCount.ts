// Cards in hand (decisions 250 to 252): while the mouse is over a card stand,
// a small red count with a thick black outline sits just inside its slope's
// top-left corner, counting the cards on it.

import type { App } from '../app';
import type { Mats } from '../mats';
import { isStand, SLOPE_LEN, SLOPE_START, slopePoint, STAND_W, standWorld } from '../state/stand';
import { h } from './dom';

/** Smaller than the life badge (56 mm): its size at the corner, and on screen, px. */
const BADGE_MM = 36;
const BADGE_MIN_PX = 30;
const BADGE_MAX_PX = 96;
/** Its centre, in from the slope's top-left corner, mm. */
const INSET = 24;

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
    // Just inside the slope's top-left corner, on the slope (decision 252).
    const spot = standWorld(s, -STAND_W / 2 + INSET, SLOPE_START + SLOPE_LEN - INSET);
    const k = slopePoint(s, spot.x, spot.y, 1);
    const rig = this.app.rig;
    if (!rig.inFront(k.x, k.y, k.z)) {
      this.el.hidden = true;
      return;
    }
    const p = rig.worldToScreen(k.x, k.y, k.z);
    const q = rig.worldToScreen(k.x + BADGE_MM, k.y, k.z);
    const size = Math.max(BADGE_MIN_PX, Math.min(BADGE_MAX_PX, Math.hypot(q.x - p.x, q.y - p.y)));
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
