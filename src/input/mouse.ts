// The mouse grammar (spec Section 16). Each press becomes one gesture; the
// gesture decides what moving and releasing mean.

import * as THREE from 'three';
import type { App } from '../app';
import { pickCard } from '../render/picking';

const DRAG_THRESHOLD = 4;

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; grab: THREE.Vector3; button: number }
  | { kind: 'right-pending'; x: number; y: number; onCard: string | null }
  | { kind: 'orbit'; x: number; y: number };

export class MouseInput {
  private gesture: Gesture = { kind: 'none' };
  spaceDown = false;

  constructor(private readonly app: App) {
    const el = app.canvas.parentElement!;
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointerenter', () => (app.pointer.inside = true));
    el.addEventListener('pointerleave', () => (app.pointer.inside = false));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Middle-click autoscroll would steal the pan.
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.target !== this.app.canvas && !(e.target as HTMLElement).closest('.overlay')) return;
    const { x, y } = this.local(e);
    this.app.pointer.x = x;
    this.app.pointer.y = y;
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      const grab = this.app.rig.screenToPlane(x, y, 0);
      if (grab) this.gesture = { kind: 'pan', grab, button: e.button };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      const onCard = pickCard(this.app.rig, this.app.layer, x, y);
      this.gesture = { kind: 'right-pending', x, y, onCard };
      return;
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
      case 'pan':
        this.app.rig.panTo(g.grab, x, y);
        break;
      case 'right-pending':
        if (!g.onCard && Math.hypot(x - g.x, y - g.y) > DRAG_THRESHOLD) {
          this.gesture = { kind: 'orbit', x, y };
        }
        break;
      case 'orbit':
        this.app.rig.orbit(x - g.x, y - g.y);
        this.gesture = { kind: 'orbit', x, y };
        break;
    }
  }

  private up(_e: PointerEvent): void {
    this.gesture = { kind: 'none' };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.app.rig.zoomAt(x, y, Math.exp(delta * 0.0015));
  }
}
