import { describe, expect, it } from 'vitest';
import { onMat, ridersOf } from '../src/mats';
import { Store } from '../src/state/store';
import { MAT_H, MAT_W, type Mat } from '../src/state/types';

const mat = (yaw = 0): Mat => ({ uid: 'm1', scryfallId: 'x', name: 'Ragavan', art: '', x: 100, y: 50, yaw });

describe('playmats (decision 144)', () => {
  it('covers 61 by 35 cm around its center', () => {
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

  it('carries the whole pile of any card on it, even past the edge (decision 147)', () => {
    const edge = 100 + MAT_W / 2;
    const cards = [
      { uid: 'on', x: edge - 30, y: 50, pileId: 'p1' },
      { uid: 'hanging', x: edge + 40, y: 50, pileId: 'p1' },
      { uid: 'alone-on', x: 100, y: 50, pileId: null },
      { uid: 'elsewhere', x: edge + 300, y: 50, pileId: 'p2' },
    ];
    expect(ridersOf(mat(), cards).sort()).toEqual(['alone-on', 'hanging', 'on']);
  });

  it('locks and unlocks, telling listeners (decision 154)', () => {
    const store = new Store();
    store.addMat(mat());
    let told = 0;
    store.events.on('mats', () => told++);
    store.setMatLocked('m1', true);
    expect(store.mats.get('m1')!.locked).toBe(true);
    store.setMatLocked('m1', false);
    expect(store.mats.get('m1')!.locked).toBe(false);
    expect(told).toBe(2);
  });
});
