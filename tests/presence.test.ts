import { describe, expect, it } from 'vitest';
import { lerpPose, poseAt } from '../src/online/presence';
import { cardPose6, composeStream, fitStream, POSES_MAX, SELECTION_MAX } from '../src/online/streams';
import { byteLength, MAX_MESSAGE_BYTES } from '../shared/protocol';
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

describe('a stream stays under the 64 KB a message may be (O104)', () => {
  // Uids as the app makes them: a letter, the time in base 36, a counter and a random tail.
  const uid = (i: number) => `c${(1793420000000 + i).toString(36)}${i.toString(36)}${(i * 7919 % 1296).toString(36)}`;
  const pose = (i: number): Pose6 => [-1234.5 + i, 987.6 - i, 12.3, -3.14, 3.14, -0.25];

  it('carries a 2,000-card hold and a 5,000-card selection within the limit', () => {
    const hold = Array.from({ length: 2000 }, (_, i): [string, Pose6] => [uid(i), pose(i)]);
    const sel = Array.from({ length: 5000 }, (_, i) => uid(i));
    const out = fitStream(composeStream(1, [-1234.5, 678.9], hold, [], sel));
    expect(byteLength(JSON.stringify({ t: 'stream', ...out }))).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(Object.keys(out.hold ?? {})).toHaveLength(POSES_MAX);
    // The top of the hand is what goes: the last cards held.
    expect(out.hold![uid(1999)]).toBeDefined();
    expect(out.hold![uid(0)]).toBeUndefined();
    expect(out.sel).toHaveLength(SELECTION_MAX);
  });

  it('sends flights before the hand, within the same cap', () => {
    const fly = Array.from({ length: 80 }, (_, i): [string, Pose6] => [`f${i}`, pose(i)]);
    const hold = Array.from({ length: 1000 }, (_, i): [string, Pose6] => [uid(i), pose(i)]);
    const out = composeStream(0, undefined, hold, fly);
    expect(Object.keys(out.fly ?? {})).toHaveLength(80);
    expect(Object.keys(out.hold ?? {})).toHaveLength(POSES_MAX - 80);
  });
});
