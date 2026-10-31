import { describe, expect, it } from 'vitest';
import { lerpPose, poseAt } from '../src/online/presence';
import { cardPose6 } from '../src/online/streams';
import type { Pose6 } from '../shared/protocol';

describe('remote poses (ONLINE.md 8.3)', () => {
  const a: Pose6 = [0, 0, 10, 0, 0, 0];
  const b: Pose6 = [100, 50, 20, 1, Math.PI, 0.2];

  it('draws a pose between the two samples about the time asked', () => {
    const list = [{ at: 1000, pose: a }, { at: 1100, pose: b }];
    expect(poseAt(list, 1050)).toEqual(lerpPose(a, b, 0.5));
    expect(poseAt(list, 1050)![0]).toBeCloseTo(50);
    // Before the first sample, the first; after the last, the last (no guessing ahead).
    expect(poseAt(list, 900)).toEqual(a);
    expect(poseAt(list, 1500)).toEqual(b);
    expect(poseAt([], 1000)).toBeNull();
  });

  it('turns the short way round', () => {
    const p = lerpPose([0, 0, 0, 3.1, 0, 0], [0, 0, 0, -3.1, 0, 0], 0.5);
    expect(Math.abs(Math.abs(p[3]) - Math.PI)).toBeLessThan(0.01);
  });

  it('streams a card as its ZXY angles, rounded, the roll and tilt about its long axis together', () => {
    expect(cardPose6({ x: 1.234, y: -5.678, z: 0.15, yaw: 0.123456, roll: Math.PI, tiltX: 0.0149, tiltY: 0.01 })).toEqual([1.2, -5.7, 0.2, 0.12, 3.15, 0.01]);
  });
});
