// Card stands (decision 220): a wooden wedge, 450 x 200 mm, that cards lie on
// at a 25 degree slope facing you, with a small lip along the front, and a
// steeper 60 degree back carrying a name plate for the player across the
// table. A stand is a kind of playmat in the store (it moves, turns, locks and
// saves like one); this is its shape. Pure geometry, tested without a browser.

import type { Resting } from './rest';
import { CARD_T, type Mat } from './types';

/** Width across, and depth front to back, mm. */
export const STAND_W = 450;
export const STAND_D = 200;
/** The lip along the front edge that stops cards sliding off: its depth and height, mm. */
export const LIP_D = 8;
export const LIP_H = 6;
/** The front slope the cards lie on, and the back that carries the name plate. */
export const SLOPE = (25 * Math.PI) / 180;
export const BACK = (60 * Math.PI) / 180;
/** How far back the slope runs, and how high the ridge is, mm. */
export const SLOPE_RUN = (STAND_D - LIP_D) / (1 + Math.tan(SLOPE) / Math.tan(BACK));
export const STAND_H = SLOPE_RUN * Math.tan(SLOPE);
/** Where (front to back, from the stand's centre) the slope starts and the ridge is. */
export const SLOPE_START = -STAND_D / 2 + LIP_D;
export const RIDGE = SLOPE_START + SLOPE_RUN;

export function isStand(m: Mat): boolean {
  return m.kind === 'stand';
}

/** A table point in a stand's own frame: across (a) and front to back (b, positive toward the back). */
export function standLocal(m: Mat, x: number, y: number): { a: number; b: number } {
  const dx = x - m.x, dy = y - m.y;
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return { a: dx * c + dy * s, b: -dx * s + dy * c };
}

/** A point in a stand's own frame back on the table. */
export function standWorld(m: Mat, a: number, b: number): { x: number; y: number } {
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return { x: m.x + a * c - b * s, y: m.y + a * s + b * c };
}

/** True if a table point lies on the stand's footprint. */
export function onStand(m: Mat, x: number, y: number): boolean {
  const { a, b } = standLocal(m, x, y);
  return Math.abs(a) <= STAND_W / 2 && Math.abs(b) <= STAND_D / 2;
}

/** Height of the stand's surface above a point in its own frame: the lip, the slope or the back; 0 off it. */
export function profileHeight(a: number, b: number): number {
  if (Math.abs(a) > STAND_W / 2 || Math.abs(b) > STAND_D / 2) return 0;
  if (b < SLOPE_START) return LIP_H;
  if (b <= RIDGE) return Math.max(0, (b - SLOPE_START) * Math.tan(SLOPE));
  return (STAND_D / 2 - b) * Math.tan(BACK);
}

/** Height of a stand's surface above a table point. */
export function standHeightAt(m: Mat, x: number, y: number): number {
  const { a, b } = standLocal(m, x, y);
  return profileHeight(a, b);
}

/** The side profile, front to back, as (b, height) corners: for drawing and the physics. */
export function standProfile(): [number, number][] {
  return [
    [-STAND_D / 2, 0],
    [-STAND_D / 2, LIP_H],
    [SLOPE_START, LIP_H],
    [SLOPE_START, 0],
    [RIDGE, STAND_H],
    [STAND_D / 2, 0],
  ];
}

/**
 * The stand's surfaces as supports a card can rest on (rest.ts): the lip, the
 * front slope and the back, each a tilted rectangle. A card on the slope lies
 * at the slope's angle; one across the lip rests on the lip and the slope.
 */
export function standSupports(m: Mat): Resting[] {
  const part = (b0: number, b1: number, top: number, tilt: number): Resting => {
    const mid = (b0 + b1) / 2;
    const at = standWorld(m, 0, mid);
    // A support's z is its centre with the top face CARD_T / 2 above (rest.ts).
    return { ...at, yaw: m.yaw, z: top - CARD_T / 2, tiltX: tilt, tiltY: 0, hw: STAND_W / 2, hh: (b1 - b0) / 2 };
  };
  return [
    part(-STAND_D / 2, SLOPE_START, LIP_H, 0),
    part(SLOPE_START, RIDGE, STAND_H / 2, SLOPE),
    part(RIDGE, STAND_D / 2, STAND_H / 2, -BACK),
  ];
}

/** The highest point of a stand under a card's footprint, sampled over the card, mm. */
export function standTopUnder(m: Mat, at: { x: number; y: number; yaw: number }, halfW: number, halfH: number): number {
  const c = Math.cos(at.yaw), s = Math.sin(at.yaw);
  let top = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -3; j <= 3; j++) {
      const u = (i / 2) * halfW, v = (j / 3) * halfH;
      top = Math.max(top, standHeightAt(m, at.x + u * c - v * s, at.y + u * s + v * c));
    }
  }
  return top;
}
