// How dice look (decision 255): a chunky white rounded cube with bold black
// pips and the stand's cartoon outline along its edges (blue when selected),
// casting and catching shadows. Each die is drawn where the store has it,
// unless something is carrying it (a drag or a roll), which sets its pose.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACCENT, type App } from '../app';
import { DIE_SIZE, dieTurn, FACE_VALUES, type Die } from '../state/dice';
import { outlineMaterial } from './standMesh';

/** Pip spots for each number, on a 3 x 3 grid from -1 to 1. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function faceTexture(value: number): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfbf8';
  g.fillRect(0, 0, n, n);
  g.fillStyle = '#111';
  // The 1 is a big bold pip, as on most dice.
  // Chunky pips (decision 258), as close to the edges as the rounding allows.
  const r = value === 1 ? n * 0.17 : n * 0.11;
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(n / 2 + x * n * 0.26, n / 2 + y * n * 0.26, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

interface Drawn {
  group: THREE.Group;
  edges: LineSegments2;
}

export class DiceLayer {
  private readonly group = new THREE.Group();
  private readonly geometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_SIZE * 0.14);
  private readonly materials = FACE_VALUES.map((v) => new THREE.MeshLambertMaterial({ map: faceTexture(v) }));
  private readonly edgeGeometry = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(new THREE.BoxGeometry(DIE_SIZE * 0.985, DIE_SIZE * 0.985, DIE_SIZE * 0.985)));
  private readonly black = outlineMaterial(0x000000, 4);
  private readonly blue = outlineMaterial(ACCENT, 5);
  private readonly drawn = new Map<string, Drawn>();
  /** Dice whose pose something else is setting (a drag or a roll). */
  readonly carried = new Set<string>();

  constructor(private readonly app: App) {
    app.view.scene.add(this.group);
    app.store.events.on('dice', () => this.sync());
    app.store.events.on('reset', () => this.sync());
  }

  /** Match the meshes to the store's dice. */
  sync(): void {
    const dice = this.app.store.dice;
    for (const [uid, d] of this.drawn) {
      if (!dice.has(uid)) {
        this.group.remove(d.group);
        this.drawn.delete(uid);
        this.carried.delete(uid);
      }
    }
    for (const die of dice.values()) {
      let d = this.drawn.get(die.uid);
      if (!d) {
        const body = new THREE.Mesh(this.geometry, this.materials);
        body.castShadow = true;
        body.receiveShadow = true;
        const edges = new LineSegments2(this.edgeGeometry, this.black);
        const group = new THREE.Group();
        group.add(body, edges);
        this.group.add(group);
        d = { group, edges };
        this.drawn.set(die.uid, d);
      }
      if (!this.carried.has(die.uid)) this.place(die.uid, die);
    }
  }

  /** Draw a die lying as the store has it. */
  place(uid: string, die: Die): void {
    const d = this.drawn.get(uid);
    if (!d) return;
    d.group.position.set(die.x, die.y, die.z);
    d.group.quaternion.copy(dieTurn(die.value, die.yaw));
  }

  /** Draw a die at any pose (a drag or a roll in progress). */
  pose(uid: string, p: { x: number; y: number; z: number }, q: THREE.Quaternion): void {
    const d = this.drawn.get(uid);
    if (!d) return;
    d.group.position.set(p.x, p.y, p.z);
    d.group.quaternion.copy(q);
  }

  /** Where a die is drawn now. */
  drawnAt(uid: string): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
    const d = this.drawn.get(uid);
    return d ? { position: d.group.position, quaternion: d.group.quaternion } : null;
  }

  setSelected(uids: Set<string>): void {
    for (const [uid, d] of this.drawn) d.edges.material = uids.has(uid) ? this.blue : this.black;
  }

  /** The die under a screen point, nearest first, or null. */
  pick(sx: number, sy: number): string | null {
    const ray = new THREE.Raycaster();
    ray.ray.copy(this.app.rig.rayFrom(sx, sy));
    let best: string | null = null, bestT = Infinity;
    const box = new THREE.Box3();
    const local = new THREE.Ray();
    const inv = new THREE.Matrix4();
    const hit = new THREE.Vector3();
    box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(DIE_SIZE, DIE_SIZE, DIE_SIZE));
    for (const [uid, d] of this.drawn) {
      d.group.updateMatrixWorld();
      inv.copy(d.group.matrixWorld).invert();
      local.copy(ray.ray).applyMatrix4(inv);
      if (!local.intersectBox(box, hit)) continue;
      const t = hit.applyMatrix4(d.group.matrixWorld).distanceTo(ray.ray.origin);
      if (t < bestT) {
        bestT = t;
        best = uid;
      }
    }
    return best;
  }
}
