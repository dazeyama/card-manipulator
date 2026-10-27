// Empty named piles stay on the table as a labelled outline footprint, so a
// set of bins can be prepared before sorting (spec 11.3, decision 27).

import * as THREE from 'three';
import type { App } from '../app';
import { CARD_H, CARD_W } from '../state/types';
import { CORNER_R } from './cards';

function roundedRect(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const hw = CARD_W / 2 + 3;
  const hh = CARD_H / 2 + 3;
  const r = CORNER_R + 3;
  const corners: [number, number, number][] = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0));
    }
  }
  return pts;
}

export class Outlines {
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material = new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.75 });
  private readonly fill = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.05, depthWrite: false });
  private readonly fillGeo = new THREE.PlaneGeometry(CARD_W + 6, CARD_H + 6);
  private dirty = true;

  constructor(private readonly app: App) {
    this.geometry = new THREE.BufferGeometry().setFromPoints(roundedRect());
    app.view.scene.add(this.group);
    const mark = () => (this.dirty = true);
    for (const ev of ['piles', 'settled', 'removed', 'reset', 'added'] as const) app.store.events.on(ev, mark);
    app.onFrame(() => {
      if (this.dirty) {
        this.dirty = false;
        this.rebuild();
      }
    });
  }

  private rebuild(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    for (const n of this.app.named.empty()) {
      const line = new THREE.LineLoop(this.geometry, this.material);
      line.computeLineDistances();
      const plane = new THREE.Mesh(this.fillGeo, this.fill);
      const g = new THREE.Group();
      g.add(line, plane);
      g.position.set(n.anchor.x, n.anchor.y, 0.05);
      g.rotation.z = n.yaw;
      this.group.add(g);
    }
  }
}
