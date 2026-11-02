import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { D20_RADIUS, D20_SIZE, D20_VALUES, d20Geometry, DIE_SIZE, dieTurn, faceOf, FACE_VALUES, gatherOffsets, isDark, maxValue, valueRange, valueUp, yawOf } from '../src/state/dice';

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

  it('gathers dice into a tight block about the cursor (decision 256)', () => {
    for (const n of [2, 4, 5, 9]) {
      const spots = gatherOffsets(n);
      expect(spots).toHaveLength(n);
      // Centered, and no two touching.
      expect(spots.reduce((s, p) => s + p.x, 0) / n).toBeCloseTo(0, 6);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        expect(Math.max(Math.abs(spots[i].x - spots[j].x), Math.abs(spots[i].y - spots[j].y))).toBeGreaterThanOrEqual(DIE_SIZE);
      }
      // Tight: within a block about sqrt(n) dice across.
      const span = Math.max(...spots.map((p) => Math.abs(p.x)));
      expect(span).toBeLessThanOrEqual(Math.ceil(Math.sqrt(n)) * DIE_SIZE);
    }
  });

  it('reads the face nearest up from a tumbled die', () => {
    // A 4 on top, knocked a little off level.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 0.3).multiply(dieTurn(4, 1));
    expect(valueUp(q)).toBe(4);
  });
});

describe('d20 (decision 278)', () => {
  it('numbers its 20 faces 1 to 20, opposite faces adding up to 21', () => {
    expect([...D20_VALUES].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(maxValue('d20')).toBe(20);
    expect(maxValue()).toBe(6);
  });

  it('shows the number it is set to, at any turn', () => {
    for (let v = 1; v <= 20; v++) {
      for (const yaw of [0, 0.7, -2.1]) {
        const q = dieTurn(v, yaw, 'd20');
        expect(valueUp(q, 'd20')).toBe(v);
        expect(Math.cos(yawOf(q, 'd20') - yaw)).toBeCloseTo(1, 5);
      }
    }
  });

  it('lies on a face D20_SIZE tall, bigger than a six-sided die (decision 279)', () => {
    const geo = d20Geometry();
    const pos = geo.getAttribute('position');
    const q = dieTurn(20, 0.4, 'd20');
    let low = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyQuaternion(q);
      low = Math.min(low, v.z);
    }
    expect(low).toBeCloseTo(-D20_SIZE / 2, 3);
    expect(D20_SIZE).toBeGreaterThanOrEqual(25);
    expect(D20_RADIUS).toBeGreaterThan(D20_SIZE / 2);
  });

  it('reads the right way up at no turn, whatever the number (decision 279)', () => {
    const pos = d20Geometry(1).getAttribute('position');
    for (let v = 1; v <= 20; v++) {
      const f = faceOf(v, 'd20');
      const corner = new THREE.Vector3().fromBufferAttribute(pos, f * 3);
      const mid = new THREE.Vector3();
      for (let k = 0; k < 3; k++) mid.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
      mid.divideScalar(3);
      // The number's top, toward the face's first corner, points across the table (+y).
      const up = corner.sub(mid).applyQuaternion(dieTurn(v, 0, 'd20'));
      expect(Math.atan2(up.y, up.x)).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it('takes any number from 0 to 999,999, shown on its nearest face (decision 279)', () => {
    expect(valueRange('d20')).toEqual({ min: 0, max: 999_999 });
    expect(valueRange()).toEqual({ min: 1, max: 6 });
    expect(valueUp(dieTurn(4321, 0, 'd20'), 'd20')).toBe(20);
    expect(valueUp(dieTurn(0, 0, 'd20'), 'd20')).toBe(1);
  });

  it('puts white numbers on dark dice and black on light ones', () => {
    expect(isDark('#1f3a6e')).toBe(true);
    expect(isDark('#fbfbf8')).toBe(false);
    expect(isDark('#f2cf3a')).toBe(false);
  });
});
