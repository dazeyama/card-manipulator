// How dice look (decision 255): a chunky white rounded cube with bold black
// pips and the stand's cartoon outline along its edges (blue when selected),
// casting and catching shadows. A d20 is an icosahedron with a bold number on
// each face, and any die can take a color (decision 278), its pips or numbers
// white when the color is dark. Each die is drawn where the store has it,
// unless something is carrying it (a drag or a roll), which sets its pose.

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ACCENT, type App } from '../app';
import { D20_RADIUS, D20_VALUES, d20Geometry, d20Yaw, DIE_SIZE, dieSize, DIE_WHITE, dieTurn, faceOf, FACE_VALUES, isDark, type Die } from '../state/dice';
import { outlineMaterial } from './standMesh';
import { remoteHeld } from '../state/remoteHeld';

/** Pip spots for each number, on a 3 x 3 grid from -1 to 1. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** The ink on a die of this color: near black, or near white on a dark die. */
function inkOn(color: string): string {
  return isDark(color) ? '#f4f1ea' : '#111';
}

/** The graphics mode's anisotropic filtering, and every dice texture made, to update when it changes (decision 287). */
let anisotropy = 8;
const textures = new Set<THREE.Texture>();

/** Follow the graphics mode's anisotropic filtering (decision 287). */
export function setDiceAnisotropy(n: number): void {
  anisotropy = n;
  for (const t of textures) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  textures.add(tex);
  tex.addEventListener('dispose', () => textures.delete(tex));
  return tex;
}

function faceTexture(value: number, color: string): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, n, n);
  g.fillStyle = inkOn(color);
  // The 1 is a big bold pip, as on most dice.
  // Chunky pips (decision 258), as close to the edges as the rounding allows.
  const r = value === 1 ? n * 0.17 : n * 0.11;
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(n / 2 + x * n * 0.26, n / 2 + y * n * 0.26, r, 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c);
}

/** A d20's faces in one texture: a 5 x 4 grid of triangles, 1 to 20, each number bold in the middle of its own. */
const D20_COLS = 5;
const D20_ROWS = 4;
/** Each face's corners in its grid cell (u, v from its bottom left), counter-clockwise as the faces are. */
const D20_TRI: [number, number][] = [[0.5, 0.95], [0.05, 0.17], [0.95, 0.17]];

function d20Texture(color: string): THREE.CanvasTexture {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * D20_COLS;
  c.height = cell * D20_ROWS;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = inkOn(color);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let v = 1; v <= 20; v++) {
    const col = (v - 1) % D20_COLS, row = Math.floor((v - 1) / D20_COLS);
    // The middle of the face's triangle, the canvas counting down from the top.
    const cx = (col + 0.5) * cell, cy = (row + 1 - (D20_TRI[0][1] + D20_TRI[1][1] + D20_TRI[2][1]) / 3) * cell;
    const text = String(v);
    g.font = `900 ${cell * (text.length > 1 ? 0.34 : 0.42)}px "Arial Black", Arial, sans-serif`;
    g.fillText(text, cx, cy);
    // 6 and 9 underlined, so they read the right way up.
    if (v === 6 || v === 9) g.fillRect(cx - cell * 0.09, cy + cell * 0.17, cell * 0.18, cell * 0.045);
  }
  return canvasTexture(c);
}

/** The d20's shape with each face mapped onto its number's triangle in the texture. */
function d20Body(): THREE.BufferGeometry {
  const geo = d20Geometry();
  const uv = new Float32Array((geo.getAttribute('position').count / 3) * 6);
  D20_VALUES.forEach((v, f) => {
    const col = (v - 1) % D20_COLS, row = Math.floor((v - 1) / D20_COLS);
    D20_TRI.forEach(([u, w], k) => {
      uv[f * 6 + k * 2] = (col + u) / D20_COLS;
      uv[f * 6 + k * 2 + 1] = 1 - (row + 1 - w) / D20_ROWS;
    });
  });
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * A number no d20 face has (decision 279): drawn on a thin triangle laid over
 * the face it rests on, in the die's color, so the face shows that number.
 */
function numberTexture(value: number, color: string): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, n, n);
  g.fillStyle = inkOn(color);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = value.toLocaleString();
  // As big as fits across the triangle at its middle.
  const px = Math.min(n * 0.42, (n * 0.55) / (text.length * 0.58));
  g.font = `900 ${px}px "Arial Black", Arial, sans-serif`;
  const mid = (D20_TRI[0][1] + D20_TRI[1][1] + D20_TRI[2][1]) / 3;
  g.fillText(text, n / 2, (1 - mid) * n);
  return canvasTexture(c);
}

/** The triangle over one of a d20's faces, a hair out from it, mapped onto a whole number texture. */
function faceDecal(face: number): THREE.BufferGeometry {
  const pos = d20Geometry().getAttribute('position');
  const pts = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, face * 3 + k));
  const out = pts[0].clone().add(pts[1]).add(pts[2]).normalize().multiplyScalar(0.08);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x + out.x, p.y + out.y, p.z + out.z]), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(D20_TRI.flat(), 2));
  geo.computeVertexNormals();
  return geo;
}

interface Drawn {
  group: THREE.Group;
  body: THREE.Mesh;
  edges: LineSegments2;
  /** Its kind and color as drawn, to notice a change. */
  look: string;
  /** A d20's number that no face has, laid over the face it rests on, and what it shows (decision 279). */
  decal?: THREE.Mesh;
  decalKey?: string;
}

export class DiceLayer {
  private readonly group = new THREE.Group();
  private readonly geometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_SIZE * 0.14);
  private readonly d20Geometry = d20Body();
  /** Materials for each kind and color, made when first needed. */
  private readonly materials = new Map<string, THREE.Material | THREE.Material[]>();
  private readonly edgeGeometry = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(new THREE.BoxGeometry(DIE_SIZE * 0.985, DIE_SIZE * 0.985, DIE_SIZE * 0.985)));
  private readonly d20Edges = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(d20Geometry(D20_RADIUS * 0.995)));
  private readonly black = outlineMaterial(0x000000, 4);
  private readonly blue = outlineMaterial(ACCENT, 5);
  private readonly drawn = new Map<string, Drawn>();
  private selected = new Set<string>();
  /** Another player's color on dice they select or hold (ONLINE.md 5.4). */
  private readonly tints = new Map<string, string>();
  private readonly tinted = new Map<string, ReturnType<typeof outlineMaterial>>();
  /** Dice whose pose something else is setting (a drag or a roll). */
  readonly carried = new Set<string>();

  constructor(private readonly app: App) {
    app.view.scene.add(this.group);
    app.store.events.on('dice', () => this.sync());
    app.store.events.on('reset', () => this.sync());
  }

  private materialFor(die: Die): THREE.Material | THREE.Material[] {
    const color = die.color ?? DIE_WHITE;
    const key = `${die.kind ?? 'd6'}:${color}`;
    let m = this.materials.get(key);
    if (!m) {
      m = die.kind === 'd20'
        ? new THREE.MeshLambertMaterial({ map: d20Texture(color) })
        : FACE_VALUES.map((v) => new THREE.MeshLambertMaterial({ map: faceTexture(v, color) }));
      this.materials.set(key, m);
    }
    return m;
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
      const look = `${die.kind ?? 'd6'}:${die.color ?? DIE_WHITE}`;
      let d = this.drawn.get(die.uid);
      if (d && d.look !== look) {
        // Another color, or another kind of die: drawn afresh.
        this.group.remove(d.group);
        d = undefined;
      }
      if (!d) {
        const d20 = die.kind === 'd20';
        const body = new THREE.Mesh(d20 ? this.d20Geometry : this.geometry, this.materialFor(die));
        body.castShadow = true;
        body.receiveShadow = true;
        const edges = new LineSegments2(d20 ? this.d20Edges : this.edgeGeometry, this.outlineFor(die.uid));
        const group = new THREE.Group();
        group.add(body, edges);
        this.group.add(group);
        const was = this.drawn.get(die.uid)?.group;
        if (was) {
          group.position.copy(was.position);
          group.quaternion.copy(was.quaternion);
        }
        d = { group, body, edges, look };
        this.drawn.set(die.uid, d);
      }
      this.decorate(d, die);
      if (!this.carried.has(die.uid)) this.place(die.uid, die);
    }
  }

  /** A d20 set to a number no face has shows it over the face it rests on (decision 279). */
  private decorate(d: Drawn, die: Die): void {
    const custom = die.kind === 'd20' && (die.value < 1 || die.value > 20);
    const key = custom ? `${die.value}:${die.color ?? DIE_WHITE}` : undefined;
    if (key === d.decalKey) return;
    if (d.decal) {
      d.group.remove(d.decal);
      d.decal.geometry.dispose();
      (d.decal.material as THREE.MeshLambertMaterial).map?.dispose();
      (d.decal.material as THREE.Material).dispose();
      d.decal = undefined;
    }
    d.decalKey = key;
    if (!custom) return;
    d.decal = new THREE.Mesh(faceDecal(faceOf(die.value, 'd20')), new THREE.MeshLambertMaterial({ map: numberTexture(die.value, die.color ?? DIE_WHITE) }));
    d.decal.receiveShadow = true;
    d.group.add(d.decal);
  }

  /** Draw a die lying as the store has it: a d20 always the right way up (decision 279). */
  place(uid: string, die: Die): void {
    const d = this.drawn.get(uid);
    if (!d) return;
    d.group.position.set(die.x, die.y, die.z);
    d.group.quaternion.copy(dieTurn(die.value, die.kind === 'd20' ? d20Yaw(die.side) : die.yaw, die.kind));
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
    this.selected = new Set(uids);
    for (const [uid, d] of this.drawn) d.edges.material = this.outlineFor(uid);
  }

  /** Outline a die in another player's color (`#rrggbb`), or not (null). Your own selection stays blue. */
  setTint(uid: string, color: string | null): void {
    if ((this.tints.get(uid) ?? null) === color) return;
    if (color) this.tints.set(uid, color);
    else this.tints.delete(uid);
    const d = this.drawn.get(uid);
    if (d) d.edges.material = this.outlineFor(uid);
  }

  private outlineFor(uid: string): ReturnType<typeof outlineMaterial> {
    if (this.selected.has(uid)) return this.blue;
    const tint = this.tints.get(uid);
    if (!tint) return this.black;
    let m = this.tinted.get(tint);
    if (!m) this.tinted.set(tint, (m = outlineMaterial(new THREE.Color(tint), 5)));
    return m;
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
    for (const [uid, d] of this.drawn) {
      // Another player's dice in hand or rolling are theirs until they land (ONLINE.md 8.4).
      if (remoteHeld.has(uid)) continue;
      const size = d.look.startsWith('d20') ? dieSize('d20') : DIE_SIZE;
      box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(size, size, size));
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
