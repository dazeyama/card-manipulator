import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { slopesOf } from '../src/state/rest';
import { arcHand } from '../src/state/fan';
import {
  alignTo, fitOnStand, FRONT_GAP, fromSlope, inFrontOf, liftOntoSlope, underStand, LIP_H, onStand, profileHeight, raySlope, SLOPE, SLOPE_LEN, SLOPE_START, slopePose,
  STAND_D, STAND_H, STAND_W, standHeightAt, standLocal, standTopUnder, unrollPoint,
} from '../src/state/stand';
import { CARD_H, CARD_T, CARD_W, type Mat } from '../src/state/types';

const stand = (x = 0, y = 0, yaw = 0): Mat => ({ uid: 's', kind: 'stand', scryfallId: '', name: 'Sarah', art: '', x, y, yaw });

describe('card stand shape (decision 220)', () => {
  it('has a lip, a 25 degree slope and a steeper back', () => {
    expect(profileHeight(0, -STAND_D / 2 + 2)).toBe(LIP_H);
    expect(STAND_H).toBeGreaterThan(60);
    expect(STAND_H).toBeLessThan(80);
    const heights = Array.from({ length: 201 }, (_, i) => profileHeight(0, -100 + i));
    expect(Math.max(...heights)).toBeCloseTo(STAND_H, 0);
    expect(profileHeight(0, STAND_D / 2)).toBeCloseTo(0, 6);
    expect(profileHeight(STAND_W, 0)).toBe(0);
  });

  it('turns with the stand', () => {
    const s = stand(100, 50, Math.PI / 2);
    expect(onStand(s, 100, 50)).toBe(true);
    expect(onStand(s, 100, 50 + STAND_W / 2 - 5)).toBe(true);
    expect(onStand(s, 100 + STAND_D / 2 + 5, 50)).toBe(false);
    expect(standHeightAt(s, 100, 50)).toBeCloseTo(profileHeight(0, 0), 6);
  });

  it('knows the top of the stand under a card', () => {
    const s = stand();
    expect(standTopUnder(s, { x: 0, y: 0, yaw: 0 }, CARD_W / 2, CARD_H / 2)).toBeGreaterThan(30);
    expect(standTopUnder(s, { x: 1000, y: 0, yaw: 0 }, CARD_W / 2, CARD_H / 2)).toBe(0);
  });
});

describe('the slope as a second table (decision 221)', () => {
  it('lays a card flat on the slope, at its height above it', () => {
    const s = stand();
    // 60 mm up the slope (unrolled), lying on it.
    const pose = slopePose(s, { x: 0, y: SLOPE_START + 60, z: CARD_T / 2, yaw: 0 });
    expect(pose.tiltX).toBeCloseTo(SLOPE, 6);
    expect(pose.tiltY).toBeCloseTo(0, 6);
    // The card's underside is on the slope's surface under its centre.
    const under = pose.z - (CARD_T / 2) / Math.cos(SLOPE);
    const { b } = standLocal(s, pose.x, pose.y);
    expect(under).toBeCloseTo(profileHeight(0, b), 3);
    // A card one thickness higher sits one thickness further out from the slope.
    const next = slopePose(s, { x: 0, y: SLOPE_START + 60, z: CARD_T * 1.5, yaw: 0 });
    expect(Math.hypot(next.x - pose.x, next.y - pose.y, next.z - pose.z)).toBeCloseTo(CARD_T, 6);
  });

  it('turns a card within the slope, with the stand turned too', () => {
    const s = stand(0, 0, Math.PI / 2);
    const pose = slopePose(s, { x: -(SLOPE_START + 60), y: 0, z: CARD_T / 2, yaw: Math.PI / 2 + 0.3 });
    // Its face's normal is the slope's normal, whatever its own turn.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.tiltX, pose.tiltY, pose.yaw, 'ZXY'));
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    // The slope rises toward the stand's back, which is -x for a stand turned a quarter.
    expect(n.z).toBeCloseTo(Math.cos(SLOPE), 6);
    expect(n.x).toBeCloseTo(Math.sin(SLOPE), 6);
    // Picking's slope maths agrees with the pose's tilt.
    expect(Number.isFinite(slopesOf(pose.tiltX, pose.tiltY).gt)).toBe(true);
  });

  it('meets a ray on the slope and gives the spot there, unrolled', () => {
    const s = stand();
    // Straight down onto the slope's middle, seen from above.
    const b = SLOPE_START + 50;
    const hit = raySlope(s, { x: 10, y: b, z: 500 }, { x: 0, y: 0, z: -1 })!;
    expect(hit.x).toBeCloseTo(10, 6);
    expect(hit.y).toBeCloseTo(SLOPE_START + 50 / Math.cos(SLOPE), 6);
    expect(unrollPoint(s, 10, b)!.y).toBeCloseTo(hit.y, 6);
    // Missing the slope: beside the stand, or behind the ridge.
    expect(raySlope(s, { x: STAND_W, y: b, z: 500 }, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(raySlope(s, { x: 0, y: STAND_D / 2 - 5, z: 500 }, { x: 0, y: 0, z: -1 })).toBeNull();
  });

  it('keeps a card that would hang off the slope on it', () => {
    const s = stand();
    const [p] = fitOnStand(s, [{ x: STAND_W, y: SLOPE_START, yaw: 0 }])!;
    expect(p.x).toBeCloseTo(STAND_W / 2 - CARD_W / 2, 6);
    expect(p.y).toBeCloseTo(SLOPE_START + CARD_H / 2, 6);
  });

  it('fits a hand the slope wide, and not a layout too big for it (decision 222)', () => {
    const s = stand();
    for (const n of [2, 7, 15, 30]) {
      const hand = arcHand(n, STAND_W, { x: 0, y: SLOPE_LEN / 2 });
      const ext = (p: { yaw: number }, w: number, h: number) => Math.abs(Math.cos(p.yaw)) * w + Math.abs(Math.sin(p.yaw)) * h;
      // Edge to edge exactly the slope's width.
      const left = Math.min(...hand.map((p) => p.x - ext(p, CARD_W / 2, CARD_H / 2)));
      const right = Math.max(...hand.map((p) => p.x + ext(p, CARD_W / 2, CARD_H / 2)));
      expect(right - left).toBeCloseTo(STAND_W, 3);
      expect(fitOnStand(s, fromSlope(s, hand))).not.toBeNull();
    }
    // A wide grid doesn't fit: it goes in front of the stand, centred, clear of it.
    const big = Array.from({ length: 12 }, (_, i) => ({ x: (i - 5.5) * 70, y: SLOPE_START + 80, yaw: 0 }));
    expect(fitOnStand(s, big)).toBeNull();
    const front = inFrontOf(s, big);
    expect(front.every((p) => !underStand(s, p))).toBe(true);
    expect((front[0].x + front[11].x) / 2).toBeCloseTo(0, 6);
    expect(Math.max(...front.map((p) => p.y))).toBeCloseTo(-STAND_D / 2 - FRONT_GAP - CARD_H / 2, 6);
  });

  it('finds cards under a stand and lifts them onto its slope', () => {
    const s = stand();
    expect(underStand(s, { x: 0, y: 0, yaw: 0 })).toBe(true);
    // Overlapping its front edge only a little still counts.
    expect(underStand(s, { x: 0, y: -STAND_D / 2 - CARD_H / 2 + 10, yaw: 0 })).toBe(true);
    expect(underStand(s, { x: 0, y: -STAND_D / 2 - CARD_H / 2 - 5, yaw: 0 })).toBe(false);
    // Under the back: up at the top of the slope; under the lip: at its foot.
    expect(liftOntoSlope(s, 0, STAND_D / 2 - 1).y).toBeCloseTo(SLOPE_START + SLOPE_LEN, 6);
    expect(liftOntoSlope(s, 0, -STAND_D / 2).y).toBeCloseTo(SLOPE_START, 6);
  });

  it('turns a layout to a stand', () => {
    const out = alignTo([{ x: 10, y: 0, yaw: 0 }], { x: 0, y: 0 }, Math.PI / 2);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(10, 6);
    expect(out[0].yaw).toBeCloseTo(Math.PI / 2, 6);
  });
});
