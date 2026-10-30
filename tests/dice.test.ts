import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dieTurn, FACE_VALUES, valueUp, yawOf } from '../src/state/dice';

describe('dice (decision 255)', () => {
  it('has opposite faces adding up to 7', () => {
    for (let i = 0; i < 6; i += 2) expect(FACE_VALUES[i] + FACE_VALUES[i + 1]).toBe(7);
    expect([...FACE_VALUES].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('shows the number it is set to, at any turn', () => {
    for (let v = 1; v <= 6; v++) {
      for (const yaw of [0, 0.7, -2.1]) {
        const q = dieTurn(v, yaw);
        expect(valueUp(q)).toBe(v);
        expect(Math.cos(yawOf(q) - yaw)).toBeCloseTo(1, 6);
      }
    }
  });

  it('reads the face nearest up from a tumbled die', () => {
    // A 4 on top, knocked a little off level.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 0.3).multiply(dieTurn(4, 1));
    expect(valueUp(q)).toBe(4);
  });
});
