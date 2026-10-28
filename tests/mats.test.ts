import { describe, expect, it } from 'vitest';
import { onMat } from '../src/mats';
import { MAT_H, MAT_W, type Mat } from '../src/state/types';

const mat = (yaw = 0): Mat => ({ uid: 'm1', scryfallId: 'x', name: 'Ragavan', art: '', x: 100, y: 50, yaw });

describe('playmats (decision 144)', () => {
  it('covers 61 by 35 cm around its centre', () => {
    expect(onMat(mat(), 100, 50)).toBe(true);
    expect(onMat(mat(), 100 + MAT_W / 2 - 1, 50 + MAT_H / 2 - 1)).toBe(true);
    expect(onMat(mat(), 100 + MAT_W / 2 + 1, 50)).toBe(false);
    expect(onMat(mat(), 100, 50 + MAT_H / 2 + 1)).toBe(false);
  });

  it('turns with the mat', () => {
    // A quarter turn: now 35 cm wide and 61 cm tall.
    const turned = mat(-Math.PI / 2);
    expect(onMat(turned, 100, 50 + MAT_W / 2 - 1)).toBe(true);
    expect(onMat(turned, 100 + MAT_H / 2 + 1, 50)).toBe(false);
  });
});
