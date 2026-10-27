// The mouse grammar (spec Section 16). Each press becomes one gesture; the
// gesture decides what moving and releasing mean.

import * as THREE from 'three';
import type { App } from '../app';
import { marqueeCards, pickCard } from '../render/picking';
import { toggle } from '../state/selection';

const DRAG_THRESHOLD = 4;

export interface Mods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; grab: THREE.Vector3; button: number }
  | { kind: 'right-pending'; x: number; y: number; onCard: string | null }
  | { kind: 'orbit'; x: number; y: number }
  | { kind: 'card-press'; uid: string; x: number; y: number; mods: Mods }
  | { kind: 'empty-press'; x: number; y: number; mods: Mods }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; mode: 'replace' | 'add' | 'subtract'; base: Set<string> }
  /** A drag owned by another module (card drags, Phase 4). */
  | { kind: 'custom'; move: (x: number, y: number, e: PointerEvent) => void; up: (x: number, y: number, e: PointerEvent) => void; cancel: () => void };

export type CustomGesture = Extract<Gesture, { kind: 'custom' }>;

/** Hooks other modules plug into the grammar. */
export interface MouseHooks {
  /** A left-drag started on a card. Return a custom gesture to own it, or null. */
  cardDrag?: (uid: string, x: number, y: number, mods: Mods) => CustomGesture | null;
  /** Right-click without dragging on a card (flip, spec 10.5). */
  rightClickCard?: (uid: string) => void;
  /** Double-click on a card (spread, spec 10.6). */
  doubleClickCard?: (uid: string) => void;
  /** The hovered card changed. */
  hover?: (uid: string | null) => void;
}

export class MouseInput {
  private gesture: Gesture = { kind: 'none' };
  spaceDown = false;
  readonly hooks: MouseHooks = {};
  hovered: string | null = null;
  private readonly marqueeEl: HTMLDivElement;
  private lastClick = { uid: '', at: 0 };
  private lastMiddle = { x: 0, y: 0, at: 0 };

  constructor(private readonly app: App) {
    const el = app.canvas.parentElement!;
    this.marqueeEl = document.createElement('div');
    this.marqueeEl.className = 'marquee';
    this.marqueeEl.hidden = true;
    app.overlay.append(this.marqueeEl);
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointerenter', () => (app.pointer.inside = true));
    el.addEventListener('pointerleave', () => {
      app.pointer.inside = false;
      this.setHover(null);
    });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Middle-click autoscroll would steal the pan.
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    app.canvas.tabIndex = 0;
  }

  /** Hand the current press to a gesture owned by another module (badge presses). */
  startGesture(g: CustomGesture): void {
    this.gesture = g;
    this.setHover(null);
  }

  get busy(): boolean {
    return this.gesture.kind !== 'none';
  }

  /** Esc: cancel a drag or marquee in progress. Returns true if something was cancelled. */
  cancel(): boolean {
    const g = this.gesture;
    if (g.kind === 'custom') g.cancel();
    if (g.kind === 'marquee') {
      this.app.store.setSelection(g.base);
      this.marqueeEl.hidden = true;
    }
    this.gesture = { kind: 'none' };
    return g.kind === 'custom' || g.kind === 'marquee';
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private mods(e: PointerEvent | MouseEvent): Mods {
    return { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private down(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target !== this.app.canvas && !target.classList.contains('overlay')) return;
    const { x, y } = this.local(e);
    this.app.pointer.x = x;
    this.app.pointer.y = y;
    this.app.canvas.focus({ preventScroll: true });
    if (e.button === 1) {
      // Double middle-click returns to the current default view.
      const now = performance.now();
      const m = this.lastMiddle;
      if (now - m.at < 350 && Math.hypot(x - m.x, y - m.y) < 8) {
        this.lastMiddle = { x: 0, y: 0, at: 0 };
        this.app.rig.reset();
        e.preventDefault();
        return;
      }
      this.lastMiddle = { x, y, at: now };
    }
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      const grab = this.app.rig.screenToPlane(x, y, 0);
      if (grab) this.gesture = { kind: 'pan', grab, button: e.button };
      e.preventDefault();
      return;
    }
    const onCard = pickCard(this.app.rig, this.app.layer, x, y);
    if (e.button === 2) {
      this.gesture = { kind: 'right-pending', x, y, onCard };
      return;
    }
    if (e.button !== 0) return;
    if (onCard) {
      // Double-click toggles a spread (spec 10.6).
      const now = performance.now();
      if (this.lastClick.uid === onCard && now - this.lastClick.at < 350 && this.hooks.doubleClickCard) {
        this.lastClick = { uid: '', at: 0 };
        this.hooks.doubleClickCard(onCard);
        return;
      }
      this.lastClick = { uid: onCard, at: now };
      this.gesture = { kind: 'card-press', uid: onCard, x, y, mods: this.mods(e) };
    } else {
      this.gesture = { kind: 'empty-press', x, y, mods: this.mods(e) };
    }
  }

  private move(e: PointerEvent): void {
    const { x, y } = this.local(e);
    this.app.pointer.x = x;
    this.app.pointer.y = y;
    if (this.app.pointer.inside) {
      const p = this.app.rig.screenToPlane(x, y, 0);
      if (p) {
        this.app.lastTablePoint.x = p.x;
        this.app.lastTablePoint.y = p.y;
      }
    }
    const g = this.gesture;
    switch (g.kind) {
      case 'none':
        if (this.app.pointer.inside) this.setHover(pickCard(this.app.rig, this.app.layer, x, y));
        break;
      case 'pan':
        this.app.rig.panTo(g.grab, x, y);
        break;
      case 'right-pending':
        if (!g.onCard && Math.hypot(x - g.x, y - g.y) > DRAG_THRESHOLD) this.gesture = { kind: 'orbit', x, y };
        break;
      case 'orbit':
        this.app.rig.orbit(x - g.x, y - g.y);
        this.gesture = { kind: 'orbit', x, y };
        break;
      case 'card-press':
        if (Math.hypot(x - g.x, y - g.y) > DRAG_THRESHOLD) {
          const custom = this.hooks.cardDrag?.(g.uid, g.x, g.y, g.mods) ?? null;
          this.gesture = custom ?? { kind: 'none' };
          this.setHover(null);
          if (custom) custom.move(x, y, e);
        }
        break;
      case 'empty-press':
        if (Math.hypot(x - g.x, y - g.y) > DRAG_THRESHOLD) {
          const mode = g.mods.shift ? 'add' : g.mods.ctrl ? 'subtract' : 'replace';
          this.gesture = { kind: 'marquee', x0: g.x, y0: g.y, x1: x, y1: y, mode, base: new Set(this.app.store.selection) };
          this.updateMarquee();
        }
        break;
      case 'marquee':
        g.x1 = x;
        g.y1 = y;
        this.updateMarquee();
        break;
      case 'custom':
        g.move(x, y, e);
        break;
    }
  }

  private up(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    const store = this.app.store;
    switch (g.kind) {
      case 'card-press':
        // Ctrl has no click meaning on a card (spec 9.1, decision 23).
        if (g.mods.ctrl) break;
        if (g.mods.shift) toggle(store, [g.uid]);
        else store.setSelection([g.uid]);
        break;
      case 'empty-press':
        if (!g.mods.shift && !g.mods.ctrl) store.clearSelection();
        break;
      case 'marquee':
        this.marqueeEl.hidden = true;
        break;
      case 'right-pending':
        if (g.onCard && e.button === 2) this.hooks.rightClickCard?.(g.onCard);
        break;
      case 'custom':
        g.up(x, y, e);
        break;
    }
  }

  private updateMarquee(): void {
    const g = this.gesture;
    if (g.kind !== 'marquee') return;
    const el = this.marqueeEl;
    el.hidden = false;
    el.style.left = `${Math.min(g.x0, g.x1)}px`;
    el.style.top = `${Math.min(g.y0, g.y1)}px`;
    el.style.width = `${Math.abs(g.x1 - g.x0)}px`;
    el.style.height = `${Math.abs(g.y1 - g.y0)}px`;
    el.classList.toggle('subtract', g.mode === 'subtract');
    const inside = marqueeCards(this.app.rig, this.app.layer, { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
    let next: Iterable<string>;
    if (g.mode === 'replace') next = inside;
    else if (g.mode === 'add') next = new Set([...g.base, ...inside]);
    else {
      const out = new Set(g.base);
      for (const u of inside) out.delete(u);
      next = out;
    }
    this.app.store.setSelection(next);
  }

  setHover(uid: string | null): void {
    if (uid === this.hovered) return;
    if (this.hovered) this.app.layer.setHovered(this.hovered, false);
    this.hovered = uid;
    if (uid) this.app.layer.setHovered(uid, true);
    this.hooks.hover?.(uid);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.app.rig.zoomAt(x, y, Math.exp(delta * 0.0015));
  }
}
