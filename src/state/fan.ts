// Fan a pile like a hand of cards (decision 141). The cards turn about a
// pivot below the pile: the bottom card on the left, the top card on the
// right and on top, each a few degrees further round, overlapping so every
// card's left edge and top corner show. Pure geometry, tested without a browser.

import { CARD_H, CARD_T } from './types';
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

/** A hand holds at most this many cards in one fan; more are dealt in several fans (decision 162). */
export const HAND_ROW = 20;
/** Distance between the middles of two fans of a big hand, top to bottom, mm. */
export const HAND_ROW_STEP = CARD_H * 1.9;

/**
 * A drawn hand (decisions 143, 162): one fan of up to HAND_ROW cards, or for
 * more, several fans of nearly equal size, one under the next, all centred
 * on `centre`. Bottom card first, the first fan at the top of the table.
 */
export function handLayout(count: number, centre: { x: number; y: number }): Placed[] {
  if (count <= HAND_ROW) return fanLayout(count, centre);
  const rows = Math.ceil(count / HAND_ROW);
  const per = Math.ceil(count / rows);
  const out: Placed[] = [];
  for (let r = 0, left = count; r < rows; r++) {
    const n = Math.min(per, left);
    left -= n;
    const y = centre.y + ((rows - 1) / 2 - r) * HAND_ROW_STEP;
    out.push(...fanLayout(n, { x: centre.x, y }));
  }
  return out;
}
