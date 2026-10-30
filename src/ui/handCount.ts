// Cards in hand (decisions 250 to 253): while the mouse is over a card stand,
// a small red count with a thick black outline sits just inside its slope's
// top-left corner, counting the cards on it; if a card lies there, it moves
// just outside the corner instead, so it never covers a card.

import type { App } from '../app';
import type { Mats } from '../mats';
import { isStand, RIDGE, SLOPE_LEN, SLOPE_START, slopePoint, STAND_H, STAND_W, standWorld } from '../state/stand';
import { CARD_H, CARD_W } from '../state/types';
import { h } from './dom';
import { offCorner } from './lifeCounter';

/** Smaller than the life badge (56 mm): its size at the corner, and on screen, px. */
const BADGE_MM = 36;
const BADGE_MIN_PX = 30;
const BADGE_MAX_PX = 96;
/** Its centre, in from the slope's top-left corner, mm (decision 253). */
const INSET = 13;
/** It keeps this far from any card on the slope, mm, or goes outside. */
const CLEAR = BADGE_MM / 2;

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
    // Just inside the slope's top-left corner, on the slope (decision 252)...
    const spot = standWorld(s, -STAND_W / 2 + INSET, SLOPE_START + SLOPE_LEN - INSET);
    const rig = this.app.rig;
    const cards = [...store.cards.values()].filter((c) => c.stand === m.uid);
    // ...unless a card lies there: then just outside the corner (decision 253).
    const blocked = cards.some((c) => {
      const dx = spot.x - c.x, dy = spot.y - c.y;
      const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
      const u = Math.abs(dx * co + dy * si) - CARD_W / 2, v = Math.abs(-dx * si + dy * co) - CARD_H / 2;
      return Math.hypot(Math.max(0, u), Math.max(0, v)) < CLEAR;
    });
    let p: { x: number; y: number };
    let size: number;
    if (blocked) {
      const k = { ...standWorld(s, -STAND_W / 2, RIDGE), z: STAND_H };
      const along = { ...standWorld(s, STAND_W / 2, RIDGE), z: STAND_H };
      const down = { ...standWorld(s, -STAND_W / 2, SLOPE_START), z: 0 };
      if (!rig.inFront(k.x, k.y, k.z)) {
        this.el.hidden = true;
        return;
      }
      ({ p, size } = offCorner(rig, k, along, down, BADGE_MM, BADGE_MIN_PX, BADGE_MAX_PX));
    } else {
      const k = slopePoint(s, spot.x, spot.y, 1);
      if (!rig.inFront(k.x, k.y, k.z)) {
        this.el.hidden = true;
        return;
      }
      p = rig.worldToScreen(k.x, k.y, k.z);
      const q = rig.worldToScreen(k.x + BADGE_MM, k.y, k.z);
      size = Math.max(BADGE_MIN_PX, Math.min(BADGE_MAX_PX, Math.hypot(q.x - p.x, q.y - p.y)));
    }
    this.el.hidden = false;
    this.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    this.el.style.width = this.el.style.height = `${size.toFixed(0)}px`;
    this.el.style.fontSize = `${(size * 0.42).toFixed(1)}px`;
    const n = cards.length;
    if (n !== this.shown) {
      this.shown = n;
      this.num.textContent = String(n);
    }
  }
}
