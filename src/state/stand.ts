// Card stands (decisions 220, 221): a wooden wedge, 450 x 200 mm, whose 25
// degree slope is a second table, tilted toward you, with a small lip along
// the front and a steeper 60 degree back carrying a name plate for the player
// across the table. A stand is a kind of playmat in the store (it moves,
// turns, locks and saves like one).
//
// A card on a stand belongs to it (`Card.stand`). Its model position is the
// slope unrolled flat: across the stand as usual, and up the slope measured
// along the slope, from where the slope starts behind the lip; its height is
// above the slope. So stacking, piles and layouts work on a stand just as on
// the table, and `slopePose` turns that into where the card is drawn. Pure
// geometry, tested without a browser.

import * as THREE from 'three';
import type { Footprint } from './piles';
import { CARD_H, CARD_W, type Mat } from './types';

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
/** The slope's length along it, from behind the lip to the ridge, mm. */
export const SLOPE_LEN = SLOPE_RUN / Math.cos(SLOPE);
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

/** The highest point of a stand under a card's footprint, sampled over the card, mm: for carrying held cards over it. */
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

// ---- the slope as a table (decision 221) ----

/** A drawn pose: position, turn and tilt, as the card layer takes them. */
export interface SlopePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tiltX: number;
  tiltY: number;
}

const q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Where a card on a stand is drawn: its model spot (the slope unrolled) laid
 * onto the slope, `z` above it along the slope's normal, lying in the slope's
 * plane turned by its own yaw.
 */
export function slopePose(m: Mat, card: { x: number; y: number; z: number; yaw: number }): SlopePose {
  const { a, b } = standLocal(m, card.x, card.y);
  const s = b - SLOPE_START;
  const cos = Math.cos(SLOPE), sin = Math.sin(SLOPE);
  const at = standWorld(m, a, SLOPE_START + s * cos - card.z * sin);
  // Turned in the slope's plane, tilted with the slope, turned with the stand.
  q.setFromAxisAngle(Z, m.yaw);
  q.multiply(qa.setFromAxisAngle(X, SLOPE));
  q.multiply(qa.setFromAxisAngle(Z, card.yaw - m.yaw));
  e.setFromQuaternion(q, 'ZXY');
  return { x: at.x, y: at.y, z: s * sin + card.z * cos, yaw: e.z, tiltX: e.x, tiltY: e.y };
}

/**
 * Where a ray first meets a stand's slope, as a model spot on it (the slope
 * unrolled), or null if it misses the slope.
 */
export function raySlope(m: Mat, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): { x: number; y: number } | null {
  const o = standLocal(m, origin.x, origin.y);
  // The direction in the stand's frame (no translation).
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  const da = dir.x * c + dir.y * s, db = -dir.x * s + dir.y * c;
  // The slope's plane: height = (b - SLOPE_START) tan(SLOPE).
  const t = Math.tan(SLOPE);
  const den = dir.z - db * t;
  if (Math.abs(den) < 1e-9) return null;
  const k = ((o.b - SLOPE_START) * t - origin.z) / den;
  if (k <= 0) return null;
  const a = o.a + da * k, b = o.b + db * k;
  if (Math.abs(a) > STAND_W / 2 || b < SLOPE_START || b > RIDGE) return null;
  return standWorld(m, a, SLOPE_START + (b - SLOPE_START) / Math.cos(SLOPE));
}

/** A point on the slope's surface, seen from above, as a model spot on it (the slope unrolled); null off the slope. */
export function unrollPoint(m: Mat, x: number, y: number): { x: number; y: number } | null {
  const { a, b } = standLocal(m, x, y);
  if (Math.abs(a) > STAND_W / 2 || b < SLOPE_START - 4 || b > RIDGE) return null;
  return standWorld(m, a, SLOPE_START + Math.max(0, b - SLOPE_START) / Math.cos(SLOPE));
}

/**
 * Keep cards on a stand's slope (decision 221): a group laid out there moves
 * in whole so every card sits fully on the slope, above the lip, and squeezes
 * together along a side it is too big for. Spots are model spots (the slope
 * unrolled), in order; the result keeps their order and turns.
 */
export function fitOnStand<T extends Footprint>(m: Mat, spots: T[]): T[] {
  if (!spots.length) return spots;
  const local = spots.map((p) => {
    const { a, b } = standLocal(m, p.x, p.y);
    const r = p.yaw - m.yaw;
    const ca = Math.abs(Math.cos(r)), sa = Math.abs(Math.sin(r));
    return { a, s: b - SLOPE_START, ea: ca * (CARD_W / 2) + sa * (CARD_H / 2), es: sa * (CARD_W / 2) + ca * (CARD_H / 2) };
  });
  const fit = (lo: number, hi: number, pos: number[], ext: number[]) => {
    // Squeeze the centres together if the group is too big, then slide it into range.
    const minC = Math.min(...pos), maxC = Math.max(...pos), e = Math.max(...ext);
    const room = hi - lo - 2 * e;
    const k = maxC - minC > room && maxC > minC ? Math.max(0, room) / (maxC - minC) : 1;
    const mid = (minC + maxC) / 2;
    let out = pos.map((p) => mid + (p - mid) * k);
    const low = Math.min(...out.map((p, i) => p - ext[i])), high = Math.max(...out.map((p, i) => p + ext[i]));
    const shift = low < lo ? lo - low : high > hi ? hi - high : 0;
    out = out.map((p) => p + shift);
    return out;
  };
  const as = fit(-STAND_W / 2, STAND_W / 2, local.map((l) => l.a), local.map((l) => l.ea));
  const ss = fit(0, SLOPE_LEN, local.map((l) => l.s), local.map((l) => l.es));
  return spots.map((p, i) => ({ ...p, ...standWorld(m, as[i], SLOPE_START + ss[i]) }));
}

/** Turn a layout made for an upright table spot to a stand's turn: offsets about `centre`, and each card's yaw. */
export function alignTo<T extends Footprint>(spots: T[], centre: { x: number; y: number }, yaw: number): T[] {
  if (!yaw) return spots;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return spots.map((p) => {
    const dx = p.x - centre.x, dy = p.y - centre.y;
    return { ...p, x: centre.x + dx * c - dy * s, y: centre.y + dx * s + dy * c, yaw: p.yaw + yaw };
  });
}
