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
  | { kind: 'middle-pending'; x: number; y: number; onCard: string | null }
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
  /** Middle-click without dragging on a card (flip, spec 10.5). */
  middleClickCard?: (uid: string) => void;
  /** A middle press while cards are held: return true if it flipped them (decision 179). */
  middleWhileHolding?: () => boolean;
  /** A right press while cards are held: return true if it dropped one (decision 180). */
  rightWhileHolding?: () => boolean;
  /** Double-click on a card (spread, spec 10.6). */
  doubleClickCard?: (uid: string) => void;
  /** The hovered card changed. */
  hover?: (uid: string | null) => void;
  /** A left press where no card is: a playmat may take it (decision 144). */
  matPress?: (x: number, y: number, mods: Mods) => CustomGesture | null;
}

export class MouseInput {
  private gesture: Gesture = { kind: 'none' };
  spaceDown = false;
  readonly hooks: MouseHooks = {};
  hovered: string | null = null;
  private readonly marqueeEl: HTMLDivElement;
  private lastClick = { uid: '', at: 0 };
  private lastRight = { x: 0, y: 0, at: 0 };
  /** A Ctrl + click has checked a card in or out since Ctrl went down: the cursor shows the tick (decision 170). */
  ctrlChecking = false;

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
    // A middle press while the left button holds cards flips them, as F does (decision 179).
    // Browsers send no pointerdown for a second button, only mousedown, so listen for that.
    // A right press drops the hand's bottom card (decision 180).
    window.addEventListener('mousedown', (e) => {
      if (!(e.buttons & 1)) return;
      if (e.button === 1 && this.hooks.middleWhileHolding?.()) e.preventDefault();
      if (e.button === 2 && this.hooks.rightWhileHolding?.()) e.preventDefault();
    }, true);
    app.canvas.tabIndex = 0;
    // Letting go of Ctrl ends the checking.
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') this.ctrlChecking = false;
    });
    window.addEventListener('blur', () => (this.ctrlChecking = false));
  }

  /** Hand the current press to a gesture owned by another module (badge presses). */
  startGesture(g: CustomGesture): void {
    this.gesture = g;
    this.setHover(null);
  }

  get busy(): boolean {
    return this.gesture.kind !== 'none';
  }

  /** What the mouse is doing now (for the cursor, decision 116). */
  get gestureKind(): Gesture['kind'] {
    return this.gesture.kind;
  }

  /** While a marquee is drawn: whether it replaces, adds to or takes from the selection. */
  get marqueeMode(): 'replace' | 'add' | 'subtract' | null {
    return this.gesture.kind === 'marquee' ? this.gesture.mode : null;
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
    // Mid-drag, the right button drops cards from the hand (decision 180) and must not pan.
    if (e.button === 2 && this.gesture.kind === 'custom') return;
    if (e.button === 2) {
      // Double right-click straightens the view to the current preset's angle, staying put.
      const now = performance.now();
      const m = this.lastRight;
      if (now - m.at < 350 && Math.hypot(x - m.x, y - m.y) < 8) {
        this.lastRight = { x: 0, y: 0, at: 0 };
        this.app.rig.straighten();
        e.preventDefault();
        return;
      }
      this.lastRight = { x, y, at: now };
    }
    // Right-drag pans (decision 88), as does Space + left-drag.
    if (e.button === 2 || (e.button === 0 && this.spaceDown)) {
      const grab = this.app.rig.screenToPlane(x, y, 0);
      if (grab) this.gesture = { kind: 'pan', grab, button: e.button };
      e.preventDefault();
      return;
    }
    const onCard = pickCard(this.app.rig, this.app.layer, x, y);
    if (e.button === 1) {
      // Mid-drag, the middle button flips the hand (decision 179) and must not end the drag.
      if (this.gesture.kind === 'custom') return;
      this.gesture = { kind: 'middle-pending', x, y, onCard };
      e.preventDefault();
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
      this.gesture = this.hooks.matPress?.(x, y, this.mods(e)) ?? { kind: 'empty-press', x, y, mods: this.mods(e) };
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
      case 'middle-pending':
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
          const mode = g.mods.ctrl ? 'add' : g.mods.shift ? 'subtract' : 'replace';
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
        // Shift has no click meaning on a card (spec 9.1, decisions 23 and 88).
        if (g.mods.shift) break;
        if (g.mods.ctrl) {
          toggle(store, [g.uid]);
          this.ctrlChecking = true;
        } else store.setSelection([g.uid]);
        break;
      case 'empty-press':
        if (!g.mods.shift && !g.mods.ctrl) store.clearSelection();
        break;
      case 'marquee':
        this.marqueeEl.hidden = true;
        break;
      case 'middle-pending':
        if (g.onCard && e.button === 1) this.hooks.middleClickCard?.(g.onCard);
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
