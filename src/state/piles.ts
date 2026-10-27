// Pile geometry and layouts (spec 10.6, 10.7, 11.1). Pure functions over
// plain positions, so they are tested without a browser.

import { CARD_H, CARD_T, CARD_W } from './types';

export interface Footprint {
  x: number;
  y: number;
  yaw: number;
}

export interface Placed extends Footprint {
  z: number;
}

const HALF_W = CARD_W / 2;
const HALF_H = CARD_H / 2;

/** True if two card rectangles overlap (separating axis test). `margin` shrinks both. */
export function overlaps(a: Footprint, b: Footprint, margin = 0): boolean {
  const hw = HALF_W - margin;
  const hh = HALF_H - margin;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Quick reject on the bounding circle.
  const r = 2 * Math.hypot(hw, hh);
  if (dx * dx + dy * dy > r * r) return false;
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const projA = extent(a.yaw, ax, ay, hw, hh);
    const projB = extent(b.yaw, ax, ay, hw, hh);
    const dist = Math.abs(dx * ax + dy * ay);
    if (dist >= projA + projB) return false;
  }
  return true;
}

function extent(yaw: number, ax: number, ay: number, hw: number, hh: number): number {
  const ux = Math.cos(yaw), uy = Math.sin(yaw);
  const vx = -uy, vy = ux;
  return hw * Math.abs(ux * ax + uy * ay) + hh * Math.abs(vx * ax + vy * ay);
}

/** Height of the highest card top under a footprint, or 0 for bare table. */
export function surfaceTop(cards: Iterable<Placed>, at: Footprint): number {
  let top = 0;
  for (const c of cards) {
    if (overlaps(c, at, 1)) top = Math.max(top, c.z + CARD_T / 2);
  }
  return top;
}

/** A neat stack: every card squared up at one spot, one card thickness apart. */
export function stackLayout(count: number, at: Footprint, baseTop = 0): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) out.push({ x: at.x, y: at.y, yaw: at.yaw, z: baseTop + CARD_T / 2 + i * CARD_T });
  return out;
}

/** A small deterministic random generator so layouts are testable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** A messy pile: small random offsets and angles, each card above the last (spec 2). */
export function messyLayout(count: number, at: Footprint, baseTop = 0, random: () => number = Math.random): Placed[] {
  const out: Placed[] = [];
  // Bigger piles spread a little wider, as a dropped handful does.
  const spread = Math.min(28, 8 + Math.sqrt(count) * 1.6);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = spread * Math.sqrt(random());
    out.push({
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r,
      yaw: at.yaw + (random() - 0.5) * 0.5,
      z: baseTop + CARD_T / 2 + i * CARD_T,
    });
  }
  return out;
}

/** Grid for a spread: rows of up to ten, top card first, to the right of the anchor (spec 10.6). */
export function spreadLayout(count: number, anchor: { x: number; y: number }, gap = 6): Placed[] {
  const cols = Math.min(10, count);
  const out: Placed[] = [];
  const startX = anchor.x + CARD_W + gap * 3;
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ x: startX + col * (CARD_W + gap), y: anchor.y - row * (CARD_H + gap), yaw: 0, z: CARD_T / 2 });
  }
  return out;
}

/** A grid centred on a point (the Spread command on a selection, spec 10.7). */
export function gridLayout(count: number, centre: { x: number; y: number }, gap = 6): Placed[] {
  const cols = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(count * 1.4))));
  const rows = Math.ceil(count / cols);
  const w = cols * CARD_W + (cols - 1) * gap;
  const h = rows * CARD_H + (rows - 1) * gap;
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      x: centre.x - w / 2 + CARD_W / 2 + col * (CARD_W + gap),
      y: centre.y + h / 2 - CARD_H / 2 - row * (CARD_H + gap),
      yaw: 0,
      z: CARD_T / 2,
    });
  }
  return out;
}
