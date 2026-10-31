// Raycast to a card and marquee to cards (spec 4.3 picking.ts). Both work on
// the drawn poses with plain maths, not three.js raycasting, so they stay fast
// with 2,000 cards.

import { slopesOf } from '../state/rest';
import { remoteHeld } from '../state/remoteHeld';
import { CARD_H, CARD_T, CARD_W } from '../state/types';
import type { CameraRig } from './camera';
import type { CardLayer } from './cards';

const HALF_W = CARD_W / 2;
const HALF_H = CARD_H / 2;

/** The card under a screen point: the nearest card whose face contains the ray hit. */
export function pickCard(rig: CameraRig, layer: CardLayer, sx: number, sy: number, skip?: Set<string>): string | null {
  const r = rig.rayFrom(sx, sy);
  const ox = r.origin.x, oy = r.origin.y, oz = r.origin.z;
  const dx = r.direction.x, dy = r.direction.y, dz = r.direction.z;
  if (Math.abs(dz) < 1e-6) return null;
  let best: string | null = null;
  let bestT = Infinity;
  layer.forEach((uid, p) => {
    // Another player's held cards are theirs until they land (ONLINE.md 8.4).
    if (skip?.has(uid) || remoteHeld.has(uid)) return;
    const c = Math.cos(-p.yaw), s = Math.sin(-p.yaw);
    // Met at its resting height, not where the hover pop draws it: a card is hovered only
    // over the part of it that shows before it pops (decision 175).
    const z = p.z;
    let t: number;
    if (p.tiltX === 0 && p.tiltY === 0) {
      t = (z + CARD_T / 2 - oz) / dz;
    } else {
      // A resting card is tilted (decision 99): meet the plane of its top face.
      const { gs, gt } = slopesOf(p.tiltX, p.tiltY);
      const ax0 = (ox - p.x) * c - (oy - p.y) * s, ay0 = (ox - p.x) * s + (oy - p.y) * c;
      const adx = dx * c - dy * s, ady = dx * s + dy * c;
      const den = dz - gs * adx - gt * ady;
      if (Math.abs(den) < 1e-9) return;
      t = (z + CARD_T / 2 + gs * ax0 + gt * ay0 - oz) / den;
    }
    if (t <= 0 || t >= bestT) return;
    const hx = ox + dx * t - p.x;
    const hy = oy + dy * t - p.y;
    const lx = hx * c - hy * s;
    const ly = hx * s + hy * c;
    if (Math.abs(lx) <= HALF_W && Math.abs(ly) <= HALF_H) {
      bestT = t;
      best = uid;
    }
  });
  return best;
}

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Every card whose centre projects inside the screen rectangle (spec 9.1). */
export function marqueeCards(rig: CameraRig, layer: CardLayer, rect: ScreenRect): string[] {
  const minX = Math.min(rect.x0, rect.x1), maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1), maxY = Math.max(rect.y0, rect.y1);
  const out: string[] = [];
  const e = rig.camera.matrixWorldInverse.elements;
  const pr = rig.camera.projectionMatrix.elements;
  const { width, height } = rig.viewport;
  layer.forEach((uid, p) => {
    if (remoteHeld.has(uid)) return;
    // Inline projection: view space, then clip space.
    const vx = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12];
    const vy = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13];
    const vz = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
    if (vz >= 0) return;
    const cx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12];
    const cy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13];
    const cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
    const sx = (cx / cw + 1) * 0.5 * width;
    const sy = (1 - cy / cw) * 0.5 * height;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(uid);
  });
  return out;
}
