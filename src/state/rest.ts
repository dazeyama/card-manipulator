// How a card comes to rest on the cards under it (decisions 99, 100). Cards
// keep their flat model height for ordering and pile detection; this works out
// the drawn pose they really rest in: as low as they can go as rigid cards,
// supported under their center, tilted where they lie across an edge. Pure
// geometry, so it is tested without a browser.

import { overlaps } from './piles';
import { CARD_H, CARD_T, CARD_W } from './types';

const HW = CARD_W / 2;
const HH = CARD_H / 2;

/** No resting card leans steeper than this (about 39 degrees). */
export const MAX_SLOPE = 0.8;

/** A card already resting: its center, turn and the tilt of its drawn pose. */
export interface Resting {
  x: number;
  y: number;
  yaw: number;
  /** Height of the drawn card's center. */
  z: number;
  tiltX: number;
  tiltY: number;
}

/** Where a card rests: its drawn center height and tilt (the pose's tiltX, tiltY). */
export interface Rest {
  z: number;
  tiltX: number;
  tiltY: number;
  /** Where it is drawn, when that isn't its model spot: on a card stand's slope (decision 221). */
  x?: number;
  y?: number;
  yaw?: number;
}

/**
 * A resting card may sit at most this far above its stacked height, mm
 * (decision 194)... 6 since decision 355: at 2, a curve laid partly over other
 * cards was held down into the tilted card under it, which then showed through.
 */
export const REST_SLACK = 6;

/**
 * ...because in a deep messy pile each card's tilt lifts the next a little more,
 * and over hundreds of cards that builds a tower many times the pile's real
 * height. Real cards bend and settle instead: a rest above the card's stacked
 * height plus REST_SLACK is lowered to it, and its tilt halved.
 */
export function capRest(rest: Rest, stackedZ: number): Rest {
  const cap = stackedZ + REST_SLACK;
  return rest.z <= cap ? rest : { z: cap, tiltX: rest.tiltX * 0.5, tiltY: rest.tiltY * 0.5 };
}

/** A drawn card, for the hover pop. */
interface Drawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tiltX: number;
  tiltY: number;
}

/** A hovered card always pops up at least this far, mm... */
export const POP_MIN = 2;
/** ...and clears the cards lying on it by this much, mm (decision 174), however many there are (decision 347). */
const POP_CLEAR = 0.6;

/**
 * How far to lift a hovered card so it shows whole (decision 174): above every
 * card overlapping it that lies higher, and never less than POP_MIN. No limit
 * (decision 347): however tall the stack and however far down the hovered
 * card, it becomes the top preview card. Tilts are measured where the cards
 * really overlap (decision 351): the top of each card above at the corners of
 * the overlap, against the hovered card's own bottom there, the same points
 * resting uses. (Before, every tilted card counted as raised by its full tilt
 * at its highest corner wherever that was, so a card under a slanted one could
 * pop several centimeters too high.)
 */
export function popLift(me: Drawn, others: Iterable<Drawn>): number {
  const above: Resting[] = [];
  for (const o of others) if (o.z > me.z && overlaps(o, me)) above.push(o);
  if (!above.length) return POP_MIN;
  const { gs, gt } = slopesOf(me.tiltX, me.tiltY);
  const bottom = me.z - CARD_T / 2;
  let lift = POP_MIN;
  for (const p of contacts(me, above)) lift = Math.max(lift, p.z - (bottom + gs * p.s + gt * p.t) + POP_CLEAR);
  return lift;
}

/** True while a card is still where an X spread laid it, so it lies flat (decision 160). */
export function laidFlat(card: { x: number; y: number; laidAt?: { x: number; y: number } }): boolean {
  const at = card.laidAt;
  return !!at && Math.abs(at.x - card.x) < 0.01 && Math.abs(at.y - card.y) < 0.01;
}

/** A point under the card, in its own frame: s across the short side, t along the long side. */
interface Point {
  s: number;
  t: number;
  z: number;
}

/** Slopes of a resting card's plane along its own short (s) and long (t) sides, from its pose tilt. */
export function slopesOf(tiltX: number, tiltY: number): { gs: number; gt: number } {
  return { gt: Math.tan(tiltX), gs: -Math.tan(tiltY) / Math.cos(tiltX) };
}

/** The pose tilt that lays a card on a plane with these slopes along its own sides. */
export function tiltFor(gs: number, gt: number): { tiltX: number; tiltY: number } {
  const tiltX = Math.atan(gt);
  return { tiltX, tiltY: -Math.atan(gs * Math.cos(tiltX)) };
}

/**
 * A support seen from the resting card's own frame: its own across (a) and
 * along (b) coordinates, and the height of its top face, are each linear in
 * the resting card's s and t. Worked out once per support, so the lines below
 * need no trigonometry.
 */
interface Frame {
  a0: number; as: number; at: number;
  b0: number; bs: number; bt: number;
  z0: number; zs: number; zt: number;
}

function frameOf(c: Resting, at: { x: number; y: number }, ux: number, uy: number, vx: number, vy: number): Frame {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  const ox = at.x - c.x, oy = at.y - c.y;
  // The support's across axis is (cos, sin), its along axis (-sin, cos).
  const a0 = ox * cos + oy * sin, as = ux * cos + uy * sin, at_ = vx * cos + vy * sin;
  const b0 = -ox * sin + oy * cos, bs = -ux * sin + uy * cos, bt = -vx * sin + vy * cos;
  const { gs, gt } = slopesOf(c.tiltX, c.tiltY);
  return {
    a0, as, at: at_, b0, bs, bt,
    z0: c.z + CARD_T / 2 + gs * a0 + gt * b0,
    zs: gs * as + gt * bs,
    zt: gs * at_ + gt * bt,
  };
}

/** The part [u0, u1] of a line, where a = a0 + a1 u and b = b0 + b1 u, that lies over the support, or null. */
function clip(a0: number, a1: number, b0: number, b1: number, u0: number, u1: number): [number, number] | null {
  for (let k = 0; k < 2; k++) {
    const v0 = k ? b0 : a0, v1 = k ? b1 : a1, h = k ? HH : HW;
    if (Math.abs(v1) < 1e-9) {
      if (Math.abs(v0) > h) return null;
      continue;
    }
    let lo = (-h - v0) / v1, hi = (h - v0) / v1;
    if (lo > hi) [lo, hi] = [hi, lo];
    u0 = Math.max(u0, lo);
    u1 = Math.min(u1, hi);
    if (u0 > u1) return null;
  }
  return [u0, u1];
}

// A support's top is a plane, so its highest point under the card is a corner
// of where the two overlap: on the card's own edges, or a corner of the support.
const S_LINES = [-HW, HW];
const T_LINES = [-HH, HH];
const CORNERS = [[-HW, -HH], [HW, -HH], [-HW, HH], [HW, HH]];

/**
 * Every point where the card could touch what is under it: where each
 * support crosses the card's edges, the support's corners that lie under the
 * card, and the table at the card's corners. These are the corners of each
 * overlap, which is where a plane is highest.
 */
function contacts(at: { x: number; y: number; yaw: number }, supports: Resting[]): Point[] {
  const ux = Math.cos(at.yaw), uy = Math.sin(at.yaw); // across (s)
  const vx = -uy, vy = ux; // along (t)
  const pts: Point[] = [];
  for (const s of [-HW, 0, HW]) for (const t of [-HH, HH]) pts.push({ s, t, z: 0 });
  pts.push({ s: -HW, t: 0, z: 0 }, { s: HW, t: 0, z: 0 });
  for (const c of supports) {
    const f = frameOf(c, at, ux, uy, vx, vy);
    // Lines along the card at fixed s, and across it at fixed t.
    for (const s of S_LINES) {
      const r = clip(f.a0 + f.as * s, f.at, f.b0 + f.bs * s, f.bt, -HH, HH);
      if (r) for (const t of r) pts.push({ s, t, z: f.z0 + f.zs * s + f.zt * t });
    }
    for (const t of T_LINES) {
      const r = clip(f.a0 + f.at * t, f.as, f.b0 + f.bt * t, f.bs, -HW, HW);
      if (r) for (const s of r) pts.push({ s, t, z: f.z0 + f.zs * s + f.zt * t });
    }
    // The support's own corners that lie under the card.
    const cc = Math.cos(c.yaw), cs = Math.sin(c.yaw);
    for (const [a, b] of CORNERS) {
      const px = c.x + a * cc - b * cs - at.x, py = c.y + a * cs + b * cc - at.y;
      const s = px * ux + py * uy;
      const t = px * vx + py * vy;
      if (Math.abs(s) <= HW && Math.abs(t) <= HH) pts.push({ s, t, z: f.z0 + f.zs * s + f.zt * t });
    }
  }
  return pts;
}

/** The upper convex hull of points (u, z), left to right. */
function upperHull(pts: { u: number; z: number }[]): { u: number; z: number }[] {
  // Highest first at each u, and only that one: a vertical step is not part of the top.
  const sorted = [...pts].sort((a, b) => a.u - b.u || b.z - a.z);
  const h: { u: number; z: number }[] = [];
  let lastU = NaN;
  for (const p of sorted) {
    if (Math.abs(p.u - lastU) < 1e-9) continue;
    lastU = p.u;
    while (h.length >= 2) {
      const a = h[h.length - 2], b = h[h.length - 1];
      if ((b.u - a.u) * (p.z - a.z) - (b.z - a.z) * (p.u - a.u) >= 0) h.pop();
      else break;
    }
    h.push(p);
  }
  return h;
}

/**
 * The slope a card settles at along one of its sides, from the highest points
 * under it: a rigid card rests on the edge of their hull under its center,
 * which is as low as its center can go (decision 100). It never droops toward
 * a lower side: that lifts its other end into the air, and cards landing on
 * those raised ends built towers.
 */
export function restSlope(pts: { u: number; z: number }[]): number {
  const h = upperHull(pts);
  if (h.length < 2) return 0;
  const slope = (i: number) => (h[i + 1].z - h[i].z) / (h[i + 1].u - h[i].u || 1e-9);
  let com = Infinity;
  for (let i = 0; i < h.length - 1; i++) {
    if (h[i].u <= 1e-9 && h[i + 1].u >= -1e-9) {
      const g = slope(i);
      if (Math.abs(g) < Math.abs(com)) com = g;
    }
  }
  if (!Number.isFinite(com)) com = 0;
  return Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, com));
}

/**
 * Where a card at this spot comes to rest on these supports (the cards under
 * it, with their own rests). With nothing under it, it lies flat on the table.
 */
export function restOn(at: { x: number; y: number; yaw: number }, supports: Resting[]): Rest {
  if (!supports.length) return { z: CARD_T / 2, tiltX: 0, tiltY: 0 };
  const pts = contacts(at, supports);
  const gt = restSlope(pts.map((p) => ({ u: p.t, z: p.z })));
  const gs = restSlope(pts.map((p) => ({ u: p.s, z: p.z })));
  // Lower the plane until it touches the highest point under it.
  let c = -Infinity;
  for (const p of pts) c = Math.max(c, p.z - gs * p.s - gt * p.t);
  return { z: c + CARD_T / 2, ...tiltFor(gs, gt) };
}

/**
 * A card's rest in a pile, kept from growing a tower (decisions 194, 355): its
 * rest on what is under it, unless that sits more than REST_SLACK above its
 * stacked height; then it lies flat on the highest point under it. Lying flat
 * passes no tilt on to the cards above, and it is tilt piling up card after
 * card that grows a tower; lying on the highest point means no card under it
 * ever shows through it (pushing it down to the cap did, decision 355).
 */
export function restCapped(at: { x: number; y: number; yaw: number }, supports: Resting[], stackedZ: number): Rest {
  const rest = restOn(at, supports);
  if (rest.z <= stackedZ + REST_SLACK) return rest;
  let top = 0;
  for (const p of contacts(at, supports)) top = Math.max(top, p.z);
  return { z: top + CARD_T / 2, tiltX: 0, tiltY: 0 };
}

/** Height of a resting card's bottom face at a point in its own frame (for tests and checks). */
export function bottomAt(rest: Rest, s: number, t: number): number {
  const { gs, gt } = slopesOf(rest.tiltX, rest.tiltY);
  return rest.z - CARD_T / 2 + gs * s + gt * t;
}
