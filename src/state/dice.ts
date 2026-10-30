// Dice (decision 255): 20 mm six-sided dice that sit on the table among the
// cards, saved with it. A die is its spot, its turn about the vertical, and
// the number on top; when rolled, physics tumbles it and the face that ends
// up on top is its number. Pure, tested without a browser.

import * as THREE from 'three';

/** A die's edge, mm. */
export const DIE_SIZE = 20;

export interface Die {
  uid: string;
  x: number;
  y: number;
  /** Height of its centre, mm: half its size above whatever it rests on. */
  z: number;
  /** Its turn about the vertical, radians. */
  yaw: number;
  /** The number on top, 1 to 6. */
  value: number;
}

/**
 * The number on each face of the die's own cube, in three.js's box face
 * order (+x, -x, +y, -y, +z, -z). Opposite faces add up to 7, as on any die.
 */
export const FACE_VALUES = [3, 4, 2, 5, 1, 6];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const UP = new THREE.Vector3(0, 0, 1);

/** The number on top of a die turned this way: the face whose normal points most nearly up. */
export function valueUp(q: { x: number; y: number; z: number; w: number }): number {
  const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = 0, bestUp = -Infinity;
  NORMALS.forEach((n, i) => {
    const up = n.clone().applyQuaternion(rot).z;
    if (up > bestUp) {
      bestUp = up;
      best = i;
    }
  });
  return FACE_VALUES[best];
}

/** How a die lies showing `value` on top, turned by `yaw` about the vertical. */
export function dieTurn(value: number, yaw: number): THREE.Quaternion {
  const face = Math.max(0, FACE_VALUES.indexOf(Math.min(6, Math.max(1, Math.round(value)))));
  const lie = new THREE.Quaternion().setFromUnitVectors(NORMALS[face], UP);
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(lie);
}

/** The turn about the vertical of a die lying this way, for keeping it once it lands. */
export function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const value = valueUp(rot);
  // Undo the lie that brings that face up, and what is left is a turn about the vertical.
  const lie = dieTurn(value, 0);
  const rest = rot.clone().multiply(lie.invert());
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(rest);
  return Math.atan2(x.y, x.x);
}
