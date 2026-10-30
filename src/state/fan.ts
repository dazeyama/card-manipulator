// Fan a pile like a hand of cards (decision 141). The cards turn about a
// pivot below the pile: the bottom card on the left, the top card on the
// right and on top, each a few degrees further round, overlapping so every
// card's left edge and top corner show. Pure geometry, tested without a browser.

import { CARD_H, CARD_T, CARD_W } from './types';
import type { Placed } from './piles';

/** How far each card turns past the one before, radians (about 8.6 degrees)... */
export const FAN_STEP = 0.15;
/** ...unless the whole fan would turn further than this (about 126 degrees), when the step shrinks. */
export const FAN_MAX_SPREAD = 2.2;
/** Distance from the pivot to each card's centre, mm. */
export const FAN_RADIUS = CARD_H * 1.8;

/**
 * Where each of `count` cards goes, bottom card first, in a fan whose middle
 * card sits at `centre`, upright on the table.
 */
export function fanLayout(count: number, centre: { x: number; y: number }): Placed[] {
  if (count < 1) return [];
  const step = count > 1 ? Math.min(FAN_STEP, FAN_MAX_SPREAD / (count - 1)) : 0;
  const spread = step * (count - 1);
  // The pivot sits below the middle card, so the fan arches upward.
  const px = centre.x, py = centre.y - FAN_RADIUS;
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    // Angle from straight up: negative leans left, positive leans right.
    const a = -spread / 2 + i * step;
    out.push({
      x: px + FAN_RADIUS * Math.sin(a),
      y: py + FAN_RADIUS * Math.cos(a),
      // Turning right is clockwise seen from above, a negative yaw.
      yaw: -a,
      z: CARD_T / 2 + i * CARD_T,
    });
  }
  return out;
}

/** A hand on a card stand curves through at most this much, radians (about 69 degrees, decision 222). */
export const ARC_MAX = 1.2;

/**
 * A hand fanned in one arc exactly `width` wide, edge to edge, for any number
 * of cards (decision 222): as a fan (bottom card left, each a step further
 * round), the radius chosen so the outer cards' outer corners just reach the
 * width. Few cards make a wide, gentle arc; many, a rounder one. Centred on
 * `centre`, by its bounds.
 */
export function arcHand(count: number, width: number, centre: { x: number; y: number }): Placed[] {
  if (count < 1) return [];
  if (count === 1) return [{ x: centre.x, y: centre.y, yaw: 0, z: CARD_T / 2 }];
  const half = Math.min(ARC_MAX, FAN_STEP * (count - 1)) / 2;
  const radius = (width / 2 - (CARD_W / 2) * Math.cos(half) - (CARD_H / 2) * Math.sin(half)) / Math.sin(half);
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const a = -half + (2 * half * i) / (count - 1);
    out.push({ x: radius * Math.sin(a), y: radius * Math.cos(a), yaw: -a, z: CARD_T / 2 + i * CARD_T });
  }
  // Centre it by its cards' extent.
  const ext = (p: Placed) => Math.abs(Math.sin(p.yaw)) * (CARD_W / 2) + Math.abs(Math.cos(p.yaw)) * (CARD_H / 2);
  const lo = Math.min(...out.map((p) => p.y - ext(p))), hi = Math.max(...out.map((p) => p.y + ext(p)));
  const dy = centre.y - (lo + hi) / 2;
  return out.map((p) => ({ ...p, x: centre.x + p.x, y: p.y + dy }));
}

/** A hand holds at most this many cards in one fan, like a booster pack; more are dealt as several (decisions 162, 205). */
export const HAND_ROW = 15;
/** Distance between the middles of two fans of a big hand, top to bottom, mm. */
export const HAND_ROW_STEP = CARD_H * 1.9;

/**
 * A drawn hand (decisions 143, 162, 205): one fan of up to HAND_ROW cards, or
 * for more, packs of HAND_ROW with whatever is left over in a last, smaller
 * fan (27 cards: 15 then 12), one under the next, all centred on `centre`.
 * Bottom card first, the first fan at the top of the table.
 */
export function handLayout(count: number, centre: { x: number; y: number }): Placed[] {
  if (count <= HAND_ROW) return fanLayout(count, centre);
  const rows = Math.ceil(count / HAND_ROW);
  const out: Placed[] = [];
  for (let r = 0, left = count; r < rows; r++) {
    const n = Math.min(HAND_ROW, left);
    left -= n;
    const y = centre.y + ((rows - 1) / 2 - r) * HAND_ROW_STEP;
    out.push(...fanLayout(n, { x: centre.x, y }));
  }
  return out;
}
