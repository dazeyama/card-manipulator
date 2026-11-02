// Selection feedback at a distance (spec 9.7): when zoomed far out a
// highlighted card is a few pixels, so selected cards also get a small
// constant-size dot. One points draw call for any number of cards.

import * as THREE from 'three';
import type { App } from '../app';

/** Show the dots once the view is wider than this many millimeters. */
const FAR_WIDTH = 1500;

export class SelectionMarkers {
  private readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private capacity = 0;
  private dirty = true;

  constructor(private readonly app: App, accent: THREE.Color) {
    const mat = new THREE.PointsMaterial({ color: accent, size: 7, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.95 });
    this.points = new THREE.Points(this.geometry, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    app.view.scene.add(this.points);
    const mark = () => (this.dirty = true);
    for (const ev of ['selection', 'moved', 'removed', 'reset'] as const) app.store.events.on(ev, mark);
    app.onFrame(() => this.update());
  }

  private update(): void {
    const far = this.app.rig.visibleWidth() > FAR_WIDTH;
    this.points.visible = far && this.app.store.selection.size > 0;
    if (!this.points.visible) return;
    // Follow animations too while anything is moving.
    if (!this.dirty && !this.app.motion.busy && !this.app.motion.held.size) return;
    this.dirty = false;
    const sel = this.app.store.selection;
    if (sel.size > this.capacity) {
      this.capacity = Math.max(64, sel.size * 2);
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3));
    }
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    let i = 0;
    for (const uid of sel) {
      const p = this.app.layer.pose(uid);
      if (!p) continue;
      pos.setXYZ(i++, p.x, p.y, p.z + 1);
    }
    pos.needsUpdate = true;
    this.geometry.setDrawRange(0, i);
  }
}
