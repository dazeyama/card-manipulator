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
import { popLift } from './rest';
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
 * Where a ray meets the plane of a stand's slope, in the slope's own frame:
 * across (a) and up the slope along it (s, 0 just behind the lip). Off the
 * slope too, for boxes drawn past its edge; null if it never meets the plane.
 */
export function raySlopeLocal(m: Mat, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): { a: number; s: number } | null {
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
  return { a: o.a + da * k, s: (o.b + db * k - SLOPE_START) / Math.cos(SLOPE) };
}

/**
 * Where a ray first meets a stand's slope, as a model spot on it (the slope
 * unrolled), or null if it misses the slope.
 */
export function raySlope(m: Mat, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): { x: number; y: number } | null {
  const hit = raySlopeLocal(m, origin, dir);
  if (!hit || Math.abs(hit.a) > STAND_W / 2 || hit.s < 0 || hit.s > SLOPE_LEN) return null;
  return standWorld(m, hit.a, SLOPE_START + hit.s);
}

/** A spot given in the slope's own frame (across, up the slope; yaw upright to the stand) as a model spot on it. */
export function fromSlope<T extends Footprint>(m: Mat, spots: T[]): T[] {
  return spots.map((p) => ({ ...p, ...standWorld(m, p.x, SLOPE_START + p.y), yaw: p.yaw + m.yaw }));
}

/** The whole slope as a box in its own frame, for layouts that fill it. */
export const SLOPE_BOX = { minX: -STAND_W / 2, maxX: STAND_W / 2, minY: 0, maxY: SLOPE_LEN };

/** A model spot on a slope (the slope unrolled), `h` above it, in the world: for drawing outlines on it. */
export function slopePoint(m: Mat, x: number, y: number, h: number): { x: number; y: number; z: number } {
  const { a, b } = standLocal(m, x, y);
  const s = b - SLOPE_START;
  const at = standWorld(m, a, SLOPE_START + s * Math.cos(SLOPE) - h * Math.sin(SLOPE));
  return { ...at, z: s * Math.sin(SLOPE) + h * Math.cos(SLOPE) };
}

/** A point on the slope's surface, seen from above, as a model spot on it (the slope unrolled); null off the slope. */
export function unrollPoint(m: Mat, x: number, y: number): { x: number; y: number } | null {
  const { a, b } = standLocal(m, x, y);
  if (Math.abs(a) > STAND_W / 2 || b < SLOPE_START - 4 || b > RIDGE) return null;
  return standWorld(m, a, SLOPE_START + Math.max(0, b - SLOPE_START) / Math.cos(SLOPE));
}

/**
 * Keep cards on a stand's slope (decisions 221, 222): a group laid out there
 * slides in whole so every card sits fully on the slope, above the lip. A
 * group too big for the slope doesn't fit: null. Spots are model spots (the
 * slope unrolled), in order; the result keeps their order and turns.
 */
export function fitOnStand<T extends Footprint>(m: Mat, spots: T[]): T[] | null {
  if (!spots.length) return spots;
  const local = spots.map((p) => {
    const { a, b } = standLocal(m, p.x, p.y);
    const r = p.yaw - m.yaw;
    const ca = Math.abs(Math.cos(r)), sa = Math.abs(Math.sin(r));
    return { a, s: b - SLOPE_START, ea: ca * (CARD_W / 2) + sa * (CARD_H / 2), es: sa * (CARD_W / 2) + ca * (CARD_H / 2) };
  });
  // Slide the group into range; too big for it (allowing for rounding), no fit.
  const fit = (lo: number, hi: number, pos: number[], ext: number[]) => {
    const low = Math.min(...pos.map((p, i) => p - ext[i])), high = Math.max(...pos.map((p, i) => p + ext[i]));
    if (high - low > hi - lo + 0.5) return null;
    const shift = low < lo ? lo - low : high > hi ? hi - high : 0;
    return pos.map((p) => p + shift);
  };
  const as = fit(-STAND_W / 2, STAND_W / 2, local.map((l) => l.a), local.map((l) => l.ea));
  const ss = fit(0, SLOPE_LEN, local.map((l) => l.s), local.map((l) => l.es));
  if (!as || !ss) return null;
  return spots.map((p, i) => ({ ...p, ...standWorld(m, as[i], SLOPE_START + ss[i]) }));
}

/** The gap between a stand's front and a layout put on the table in front of it, mm (decision 222). */
export const FRONT_GAP = 12;

/**
 * A layout too big for a stand's slope goes on the table just in front of the
 * stand instead (decision 222): the same shape, centred across the stand, its
 * far edge FRONT_GAP in front of the stand's lip.
 */
export function inFrontOf<T extends Footprint>(m: Mat, spots: T[]): T[] {
  if (!spots.length) return spots;
  const local = spots.map((p) => {
    const { a, b } = standLocal(m, p.x, p.y);
    const r = p.yaw - m.yaw;
    const ca = Math.abs(Math.cos(r)), sa = Math.abs(Math.sin(r));
    return { a, b, ea: ca * (CARD_W / 2) + sa * (CARD_H / 2), eb: sa * (CARD_W / 2) + ca * (CARD_H / 2) };
  });
  const minA = Math.min(...local.map((l) => l.a - l.ea)), maxA = Math.max(...local.map((l) => l.a + l.ea));
  const maxB = Math.max(...local.map((l) => l.b + l.eb));
  const da = -(minA + maxA) / 2, db = -STAND_D / 2 - FRONT_GAP - maxB;
  return spots.map((p, i) => ({ ...p, ...standWorld(m, local[i].a + da, local[i].b + db) }));
}

/** True if any part of a card on the table lies over a stand's footprint (decision 222). */
export function underStand(m: Mat, card: { x: number; y: number; yaw: number }): boolean {
  const c = Math.cos(card.yaw), s = Math.sin(card.yaw);
  for (const u of [-1, 0, 1]) {
    for (const v of [-1, 0, 1]) {
      const px = (u * (CARD_W / 2 - 2)), py = (v * (CARD_H / 2 - 2));
      const { a, b } = standLocal(m, card.x + px * c - py * s, card.y + px * s + py * c);
      if (Math.abs(a) < STAND_W / 2 && Math.abs(b) < STAND_D / 2) return true;
    }
  }
  return false;
}

/**
 * Where a card found under a stand goes on its slope (decision 222): the spot
 * on the slope above where it lies, the lip and the back counting as the
 * slope's ends. A model spot (the slope unrolled).
 */
export function liftOntoSlope(m: Mat, x: number, y: number): { x: number; y: number } {
  const { a, b } = standLocal(m, x, y);
  const s = Math.min(SLOPE_LEN, Math.max(0, (b - SLOPE_START) / Math.cos(SLOPE)));
  return standWorld(m, Math.max(-STAND_W / 2, Math.min(STAND_W / 2, a)), SLOPE_START + s);
}

/**
 * How far a hovered card on a stand pops up (decision 223): as high as clears
 * the cards lying over it on the slope, judged by their stacking there (the
 * slope unrolled), not by how high they are drawn, since cards further up the
 * slope are drawn higher. Returned as a straight-up lift, which takes it that
 * far off the slope.
 */
export function slopePopLift(me: { x: number; y: number; z: number; yaw: number }, others: Iterable<{ x: number; y: number; z: number; yaw: number }>): number {
  const flat = (c: { x: number; y: number; z: number; yaw: number }) => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, tiltX: 0, tiltY: 0 });
  return popLift(flat(me), [...others].map(flat)) / Math.cos(SLOPE);
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
