// Life counters (decision 239): every playmat has a life total, a chunky
// cartoon badge floating over its top-left corner, always facing you and
// sized with the mat. Click +1, right-click -1, the wheel either way, Shift
// for 5 at a time; hold a button to keep counting. Ctrl + click types a
// number, middle-click resets to 20. Quick changes add up in a bubble beside
// it; the number pops green or red, and at 5 or less it stays red.

import type { App } from '../app';
import { MAT_T, type Mats } from '../mats';
import { isStand } from '../state/stand';
import { MAT_H, MAT_W, type Mat } from '../state/types';
import { numberDialog } from './confirm';
import { h } from './dom';

/** A new playmat's life. */
export const START_LIFE = 20;
/** At this or less the number shows red. */
const LOW_LIFE = 5;
/** The badge's size on the mat, mm, and the smallest it gets on screen, px. */
const BADGE_MM = 56;
const BADGE_MIN_PX = 40;
const BADGE_MAX_PX = 150;
/** Its centre, in from the mat's top-left corner, mm. */
const INSET = 44;
/** Holding a button: the first repeat after this long, then one this often, ms. */
const HOLD_MS = 400;
const REPEAT_MS = 120;
/** The change bubble fades this long after the last change, ms. */
const BUBBLE_MS = 1500;

interface Badge {
  el: HTMLDivElement;
  num: HTMLSpanElement;
  skull: HTMLSpanElement;
  bubble: HTMLSpanElement;
  /** The change shown in the bubble, and when it fades. */
  delta: number;
  fade: number;
  shown: number;
}

export function lifeOf(m: Mat): number {
  return m.life ?? START_LIFE;
}

export class LifeCounters {
  private readonly badges = new Map<string, Badge>();
  private hold = 0;

  constructor(private readonly app: App, private readonly mats: Mats) {
    app.onFrame(() => this.frame());
    const stop = () => {
      clearTimeout(this.hold);
      clearInterval(this.hold);
      this.hold = 0;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
  }

  private badgeFor(m: Mat): Badge {
    let b = this.badges.get(m.uid);
    if (b) return b;
    const num = h('span', { class: 'life-num' });
    const skull = h('span', { class: 'life-skull', hidden: '' }, '💀');
    const bubble = h('span', { class: 'life-delta' });
    const el = h('div', { class: 'life-badge', title: 'Life: click +1, right-click −1, wheel up or down; Shift for 5. Hold to keep counting. Ctrl + click to type a number, middle-click resets to 20.' }, skull, num, bubble);
    b = { el, num, skull, bubble, delta: 0, fade: 0, shown: NaN };
    const uid = m.uid;
    el.addEventListener('pointerdown', (e) => {
      // The badge's own clicks: nothing under it on the table sees them.
      e.stopPropagation();
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      if (e.button === 1) return this.set(uid, START_LIFE);
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) return this.ask(uid);
      if (e.button !== 0 && e.button !== 2) return;
      const by = e.button === 0 ? step : -step;
      this.change(uid, by);
      // Held: a pause, then it keeps counting until let go.
      clearTimeout(this.hold);
      this.hold = window.setTimeout(() => {
        this.hold = window.setInterval(() => this.change(uid, by), REPEAT_MS);
      }, HOLD_MS);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.deltaY) return;
      this.change(uid, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
    }, { passive: false });
    this.app.overlay.append(el);
    this.badges.set(uid, b);
    return b;
  }

  private change(uid: string, by: number): void {
    const m = this.app.store.mats.get(uid);
    if (!m) return;
    const b = this.badges.get(uid);
    if (b) {
      b.delta += by;
      b.fade = performance.now() + BUBBLE_MS;
      // The pop: green up, red down, restarted on every change.
      b.num.classList.remove('gain', 'loss');
      void b.num.offsetWidth;
      b.num.classList.add(by > 0 ? 'gain' : 'loss');
    }
    this.app.store.setMatLife(uid, lifeOf(m) + by);
  }

  private set(uid: string, life: number): void {
    const b = this.badges.get(uid);
    if (b) b.delta = 0;
    this.app.store.setMatLife(uid, life);
  }

  private ask(uid: string): void {
    const m = this.app.store.mats.get(uid);
    if (!m) return;
    void numberDialog('Set life to:', { min: -999, max: 9999, value: lifeOf(m), ok: 'Set' }).then((r) => {
      if (r) this.set(uid, r.value);
    });
  }

  private frame(): void {
    const store = this.app.store;
    const rig = this.app.rig;
    const now = performance.now();
    for (const [uid, b] of this.badges) {
      const m = store.mats.get(uid);
      if (!m || isStand(m)) {
        b.el.remove();
        this.badges.delete(uid);
      }
    }
    for (const m of store.mats.values()) {
      if (isStand(m)) continue;
      const b = this.badgeFor(m);
      // Following the mat as it is drawn, mid-drag too.
      const at = this.mats.drawnAt(m.uid) ?? m;
      const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
      const a = -MAT_W / 2 + INSET, d = MAT_H / 2 - INSET;
      const x = at.x + a * c - d * s, y = at.y + a * s + d * c;
      if (!rig.inFront(x, y, MAT_T)) {
        b.el.hidden = true;
        continue;
      }
      b.el.hidden = false;
      const p = rig.worldToScreen(x, y, MAT_T);
      // As big as BADGE_MM on the mat looks here, within limits.
      const q = rig.worldToScreen(x + BADGE_MM, y, MAT_T);
      const size = Math.max(BADGE_MIN_PX, Math.min(BADGE_MAX_PX, Math.hypot(q.x - p.x, q.y - p.y)));
      b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
      b.el.style.width = b.el.style.height = `${size.toFixed(0)}px`;
      b.el.style.fontSize = `${(size * 0.44).toFixed(1)}px`;
      const life = lifeOf(m);
      if (life !== b.shown) {
        b.shown = life;
        b.num.textContent = String(life);
        // Long numbers shrink to fit the badge.
        b.num.style.fontSize = String(life).length > 2 ? `${(2 / String(life).length) * 100 + 10}%` : '';
        b.el.classList.toggle('low', life <= LOW_LIFE);
        b.skull.hidden = life > 0;
      }
      // The running change, until it fades.
      const showing = b.delta !== 0 && now < b.fade;
      if (!showing && b.delta && now >= b.fade) b.delta = 0;
      b.bubble.textContent = b.delta > 0 ? `+${b.delta}` : `${b.delta}`;
      b.bubble.classList.toggle('show', showing);
      b.bubble.classList.toggle('gain', b.delta > 0);
      b.bubble.classList.toggle('loss', b.delta < 0);
    }
  }
}
