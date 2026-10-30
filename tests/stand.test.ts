import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { slopesOf } from '../src/state/rest';
import { fanLayout } from '../src/state/fan';
import {
  alignTo, fitOnStand, LIP_H, onStand, profileHeight, raySlope, SLOPE, SLOPE_LEN, SLOPE_START, slopePose,
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
    const [p] = fitOnStand(s, [{ x: STAND_W, y: SLOPE_START, yaw: 0 }]);
    expect(p.x).toBeCloseTo(STAND_W / 2 - CARD_W / 2, 6);
    expect(p.y).toBeCloseTo(SLOPE_START + CARD_H / 2, 6);
  });

  it('moves a fan in whole, and squeezes one too tall for the slope', () => {
    const s = stand();
    const fan = fanLayout(15, { x: 0, y: SLOPE_START + SLOPE_LEN / 2 });
    const fitted = fitOnStand(s, fan);
    expect(fitted).toHaveLength(15);
    // Every card lies within the slope, the lip below it.
    for (const p of fitted) {
      const r = Math.abs(Math.sin(p.yaw)) * (CARD_W / 2) + Math.abs(Math.cos(p.yaw)) * (CARD_H / 2);
      expect(p.y - r).toBeGreaterThanOrEqual(SLOPE_START - 1e-6);
      expect(p.y + r).toBeLessThanOrEqual(SLOPE_START + SLOPE_LEN + 1e-6);
    }
    // Across, it keeps its shape.
    expect(fitted[14].x - fitted[0].x).toBeCloseTo(fan[14].x - fan[0].x, 6);
  });

  it('turns a layout to a stand', () => {
    const out = alignTo([{ x: 10, y: 0, yaw: 0 }], { x: 0, y: 0 }, Math.PI / 2);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(10, 6);
    expect(out[0].yaw).toBeCloseTo(Math.PI / 2, 6);
  });
});
