// Dice (decision 255): 20 mm six-sided dice that sit on the table among the
// cards, saved with it. A die is its spot, its turn about the vertical, and
// the number on top; when rolled, physics tumbles it and the face that ends
// up on top is its number. Twenty-sided dice and colours since decision 278.
// Pure, tested without a browser.

import * as THREE from 'three';

/** A die's edge, mm; a d20 is as tall lying on a face. */
export const DIE_SIZE = 20;

/** What sort of die (decision 278): unset, six-sided. */
export type DieKind = 'd20';

export interface Die {
  uid: string;
  x: number;
  y: number;
  /** Height of its centre, mm: half its size above whatever it rests on. */
  z: number;
  /** Its turn about the vertical, radians. */
  yaw: number;
  /** The number on top, 1 to 6, or 1 to 20 on a d20. */
  value: number;
  /** The side of the table that last moved it (decision 267); unset, the near side. */
  side?: 0 | 1;
  /** A twenty-sided die (decision 278); unset, six-sided. */
  kind?: DieKind;
  /** Its colour, `#rrggbb` (decision 278); unset, white. */
  color?: string;
}

/** White, the six-sided dice's colour unless chosen. */
export const DIE_WHITE = '#fbfbf8';

/** The colours to choose from (decision 278): bright ones, then the dark ones a new d20 takes one of at random. */
export const DIE_COLOURS = ['#fbfbf8', '#e0443e', '#f08c2e', '#f2cf3a', '#4cae4f', '#3d7fd9', '#8a5cc7', '#e86aa6', '#1d1d1f'];
export const DARK_COLOURS = ['#7a1f24', '#1f3a6e', '#1f5a34', '#4a2a6e', '#1d5a5e', '#5a3a1e', '#2c2c30'];

/** Light or dark, for the colour of the pips and numbers on it: black on light, white on dark. */
export function isDark(color: string): boolean {
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

/** The highest number on a die. */
export function maxValue(kind?: DieKind): number {
  return kind === 'd20' ? 20 : 6;
}

/**
 * The number on each face of the die's own cube, in three.js's box face
 * order (+x, -x, +y, -y, +z, -z). Opposite faces add up to 7, as on any die.
 */
export const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const UP = new THREE.Vector3(0, 0, 1);

/** A d20's corner radius, mm: lying on a face, it stands DIE_SIZE tall, as a six-sided die does. */
export const D20_RADIUS = DIE_SIZE / 2 / 0.7946544722917661;

/** A d20's shape, three.js's icosahedron: its 20 faces in order, three corners each. */
export function d20Geometry(radius = D20_RADIUS): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(radius, 0);
}

/** Each face's outward normal, and the number on it: opposite faces add up to 21, as on a real d20. */
function d20Faces(): { normals: THREE.Vector3[]; values: number[] } {
  const pos = d20Geometry(1).getAttribute('position');
  const normals: THREE.Vector3[] = [];
  for (let f = 0; f < pos.count / 3; f++) {
    const c = new THREE.Vector3();
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
    normals.push(c.normalize());
  }
  const values = normals.map(() => 0);
  let next = 1;
  normals.forEach((n, i) => {
    if (values[i]) return;
    const j = normals.findIndex((m) => m.dot(n) < -0.999);
    values[i] = next;
    values[j] = 21 - next;
    next++;
  });
  return { normals, values };
}

const D20 = d20Faces();
/** The number on each of a d20's faces, in its geometry's face order. */
export const D20_VALUES = D20.values;

function facesOf(kind?: DieKind): { normals: THREE.Vector3[]; values: number[] } {
  return kind === 'd20' ? D20 : { normals: NORMALS, values: FACE_VALUES };
}

/** Gathered dice sit this far apart, edge to edge, mm (decision 256). */
export const GATHER_GAP = 1.5;

/**
 * Where `count` gathered dice sit about the cursor (decision 256): a tight,
 * nearly square block, rows of up to ceil(sqrt(count)), centred, first die at
 * the top left, as cards gather into one stack.
 */
export function gatherOffsets(count: number): { x: number; y: number }[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const step = DIE_SIZE + GATHER_GAP;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    // The last row centred on its own when it is short.
    const inRow = r === rows - 1 ? count - r * cols : cols;
    out.push({ x: (c - (inRow - 1) / 2) * step, y: ((rows - 1) / 2 - r) * step });
  }
  return out;
}

/** The number on top of a die turned this way: the face whose normal points most nearly up. */
export function valueUp(q: { x: number; y: number; z: number; w: number }, kind?: DieKind): number {
  const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const { normals, values } = facesOf(kind);
  let best = 0, bestUp = -Infinity;
  normals.forEach((n, i) => {
    const up = n.clone().applyQuaternion(rot).z;
    if (up > bestUp) {
      bestUp = up;
      best = i;
    }
  });
  return values[best];
}

/** How a die lies showing `value` on top, turned by `yaw` about the vertical. */
export function dieTurn(value: number, yaw: number, kind?: DieKind): THREE.Quaternion {
  const { normals, values } = facesOf(kind);
  const face = Math.max(0, values.indexOf(Math.min(maxValue(kind), Math.max(1, Math.round(value)))));
  const lie = new THREE.Quaternion().setFromUnitVectors(normals[face], UP);
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(lie);
}

/** The turn about the vertical of a die lying this way, for keeping it once it lands. */
export function yawOf(q: { x: number; y: number; z: number; w: number }, kind?: DieKind): number {
  const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const value = valueUp(rot, kind);
  // Undo the lie that brings that face up, and what is left is a turn about the vertical.
  const lie = dieTurn(value, 0, kind);
  const rest = rot.clone().multiply(lie.invert());
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(rest);
  return Math.atan2(x.y, x.x);
}
