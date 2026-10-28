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
