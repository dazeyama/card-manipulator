// The radial menu on Space (decision 298, RADIAL.md). Hold Space: a ring of the
// main card actions opens around the cursor; move toward one and let go to do
// it, or further out for its variants. A quick tap leaves it open to click.
// Each action is its key, pressed where the menu opened, so it acts on what that
// key would: the selection, or the pile that was under the cursor.

import type { App } from '../app';
import { isTyping } from '../input/keyboard';
import { itemOf, itemSpan, NO_PICK, onRelease, outerStart, pick, RADIAL_MENU, scaledGeometry, type RadialGeometry, type RadialItem, type RadialPick, type RadialWedge } from '../input/radial';
import { CURSOR_PX, cursorSizeNow } from './cursorSize';

export type RadialHooks = {
  /** Not while cards or a playmat are held. */
  canOpen: () => boolean;
  /** The card under the cursor as the menu opens, handed back to `run`. */
  hovered: () => string | null;
  /** Is there a selection or a pile under the cursor for the card wedges to act on? */
  hasCards: () => boolean;
  /** May this key press run here (rank, in a room)? Asked without a toast. */
  allowed: (press: string) => boolean;
  /** Do an item, as its keys pressed at `at` (canvas pixels) over `hovered`. */
  run: (item: RadialItem, at: { x: number; y: number }, hovered: string | null) => void;
};

type Open = {
  /** Where it opened, in canvas pixels: the centre, and where the action happens. */
  x: number;
  y: number;
  hovered: string | null;
  cards: boolean;
  openedAt: number;
  g: RadialGeometry;
  s: number;
  /** Held Space and flicking, or tapped and waiting for a click. */
  mode: 'hold' | 'click';
  leftHole: boolean;
  pick: RadialPick;
};

const NS = 'http://www.w3.org/2000/svg';

/** An SVG ring segment between two radii and two angles (0 up, clockwise). */
function segment(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

/** A long label on two lines, split at the space nearest its middle. */
function lines(label: string): string[] {
  if (label.length <= 9 || !label.includes(' ')) return [label];
  let best = -1;
  for (let i = 0; i < label.length; i++) if (label[i] === ' ' && (best < 0 || Math.abs(i - label.length / 2) < Math.abs(best - label.length / 2))) best = i;
  return [label.slice(0, best), label.slice(best + 1)];
}

export class RadialMenu {
  private readonly svg: SVGSVGElement;
  private open: Open | null = null;
  /** The pointer press that closed or chose: its pointerup is swallowed too. */
  private swallowUp = false;

  constructor(private readonly app: App, private readonly hooks: RadialHooks) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('radial');
    this.svg.style.display = 'none';
    app.overlay.append(this.svg);

    window.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      if (e.key !== ' ' || isTyping()) return;
      if (!this.open && !this.app.pointer.inside) return;
      // Never a press on a focused button, nor a scroll.
      e.preventDefault();
      if (e.repeat) return;
      if (this.open) {
        if (this.open.mode === 'click') this.close();
        return;
      }
      if (this.hooks.canOpen()) this.show();
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.key !== ' ') return;
      const o = this.open;
      if (!o || o.mode !== 'hold') return;
      e.preventDefault();
      const what = onRelease(o.leftHole, performance.now() - o.openedAt);
      if (what === 'stay') {
        o.mode = 'click';
        this.draw();
      } else if (what === 'pick') this.choose();
      else this.close();
    }, true);
    window.addEventListener('pointermove', (e) => {
      if (this.open) this.track(e.clientX, e.clientY);
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.swallowUp = true;
      if (e.button !== 0) return this.close();
      this.track(e.clientX, e.clientY);
      this.choose();
    }, true);
    window.addEventListener('pointerup', (e) => {
      if (!this.swallowUp) return;
      this.swallowUp = false;
      e.stopImmediatePropagation();
    }, true);
    window.addEventListener('contextmenu', (e) => {
      if (this.open) e.preventDefault();
    }, true);
    window.addEventListener('blur', () => this.close());
  }

  get isOpen(): boolean {
    return !!this.open;
  }

  private show(): void {
    const s = Math.min(1.3, Math.max(0.8, CURSOR_PX[cursorSizeNow()] / 36));
    this.open = {
      x: this.app.pointer.x,
      y: this.app.pointer.y,
      hovered: this.hooks.hovered(),
      cards: this.hooks.hasCards(),
      openedAt: performance.now(),
      g: scaledGeometry(s),
      s,
      mode: 'hold',
      leftHole: false,
      pick: NO_PICK,
    };
    this.svg.style.display = '';
    this.draw();
  }

  close(): void {
    if (!this.open) return;
    this.open = null;
    this.svg.style.display = 'none';
    this.svg.replaceChildren();
  }

  /** The pointer moved to a point on the page. */
  private track(clientX: number, clientY: number): void {
    const o = this.open!;
    const r = this.app.canvas.getBoundingClientRect();
    const dx = clientX - r.left - o.x, dy = clientY - r.top - o.y;
    if (Math.hypot(dx, dy) >= o.g.hole) o.leftHole = true;
    const next = pick(RADIAL_MENU, dx, dy, o.g, o.pick);
    if (next.wedge === o.pick.wedge && next.item === o.pick.item) return;
    o.pick = next;
    this.draw();
  }

  /** May this wedge, or this item of it, be done here? */
  private enabled(w: RadialWedge, item: RadialItem): boolean {
    return (!w.cards || this.open!.cards) && item.presses.every((p) => this.hooks.allowed(p));
  }

  /** Do what the pointer is over, if anything, and close. */
  private choose(): void {
    const o = this.open!;
    const item = itemOf(RADIAL_MENU, o.pick);
    const ok = item && this.enabled(RADIAL_MENU[o.pick.wedge], item);
    this.close();
    if (ok) this.hooks.run(item, { x: o.x, y: o.y }, o.hovered);
  }

  private draw(): void {
    const o = this.open!;
    const { g, s } = o;
    const R = g.outer + 6 * s;
    Object.assign(this.svg.style, { left: `${o.x - R}px`, top: `${o.y - R}px`, width: `${2 * R}px`, height: `${2 * R}px` });
    this.svg.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
    const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element, text?: string) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, String(attrs[k]));
      if (text !== undefined) e.textContent = text;
      parent.append(e);
      return e;
    };
    const ring = document.createElementNS(NS, 'g');
    ring.classList.add('radial-ring');
    const count = RADIAL_MENU.length;
    const step = (Math.PI * 2) / count;
    const gap = 0.025;
    RADIAL_MENU.forEach((w, i) => {
      const on = i === o.pick.wedge;
      const ok = this.enabled(w, w.items[0]);
      const grp = el('g', { class: `radial-wedge${on && ok ? ' on' : ''}${ok ? '' : ' off'}` }, ring);
      const a0 = (i - 0.5) * step + gap, a1 = (i + 0.5) * step - gap, mid = i * step;
      el('path', { d: segment(g.innerFrom, g.inner, a0, a1) }, grp);
      const rm = (g.innerFrom + g.inner) / 2;
      const x = Math.sin(mid) * rm, y = -Math.cos(mid) * rm;
      el('text', { x, y: y - 13 * s, 'font-size': 15 * s }, grp, w.icon);
      el('text', { x, y: y + 4 * s, 'font-size': 11.5 * s, class: 'radial-label' }, grp, w.label);
      el('text', { x, y: y + 16.5 * s, 'font-size': 9 * s, class: 'radial-key' }, grp, w.items[0].key);
      if (w.items.length > 1 && ok) {
        const rd = g.inner - 7 * s;
        el('circle', { cx: Math.sin(mid) * rd, cy: -Math.cos(mid) * rd, r: 2.4 * s, class: 'radial-dot' }, grp);
      }
    });
    // The outer ring of the wedge the pointer is on, when it has one and can be used.
    const w = o.pick.wedge >= 0 ? RADIAL_MENU[o.pick.wedge] : null;
    if (w && w.items.length > 1 && this.enabled(w, w.items[0])) {
      const n = w.items.length, span = itemSpan(n), start = outerStart(o.pick.wedge, count, n);
      w.items.forEach((item, j) => {
        const ok = this.enabled(w, item);
        const grp = el('g', { class: `radial-item${j === o.pick.item && ok ? ' on' : ''}${ok ? '' : ' off'}` }, ring);
        const a0 = start + j * span + gap * 0.7, a1 = start + (j + 1) * span - gap * 0.7, mid = start + (j + 0.5) * span;
        el('path', { d: segment(g.outerFrom, g.outer, a0, a1) }, grp);
        const rm = (g.outerFrom + g.outer) / 2;
        const x = Math.sin(mid) * rm, y = -Math.cos(mid) * rm;
        const ls = lines(item.label);
        const top = y - (ls.length === 2 ? 11 : 6) * s;
        ls.forEach((l, k) => el('text', { x, y: top + k * 11.5 * s, 'font-size': 10.5 * s, class: 'radial-label' }, grp, l));
        el('text', { x, y: top + ls.length * 11.5 * s + 1.5 * s, 'font-size': 9 * s, class: 'radial-key' }, grp, item.key);
      });
    }
    el('circle', { cx: 0, cy: 0, r: g.hole - 4 * s, class: 'radial-hole' }, ring);
    const [l1, l2] = o.mode === 'hold' ? ['let go', 'to cancel'] : ['Esc', 'closes'];
    el('text', { x: 0, y: -6 * s, 'font-size': 9.5 * s, class: 'radial-hint' }, ring, l1);
    el('text', { x: 0, y: 7 * s, 'font-size': 9.5 * s, class: 'radial-hint' }, ring, l2);
    this.svg.replaceChildren(ring);
  }
}
