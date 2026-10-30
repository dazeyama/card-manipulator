// Colour view (decision 217): C C lays cards out in a cascading column per
// colour, in WUBRG order, then colourless, multicolour and lands (W U B R G C
// M L), like the curve and rank views. A card's column comes from its own
// colours (its mana cost), and lands always go in L. Each column runs cheapest
// first, then by name; Split creatures puts creatures and non-creatures in
// separate bands. Pure geometry, tested without a browser.

import { CASCADE_STEP, colourGroup, MAX_MV, type ColourGroup } from './curve';
import type { Placed } from './piles';
import { CARD_H, CARD_T, CARD_W } from './types';

export interface ColourCard {
  uid: string;
  name: string;
  mv: number;
  land: boolean;
  creature: boolean;
  /** The card's own colours, from its mana cost (the front face of a double-faced card). */
  colours: string[];
}

/** The columns, left to right: W U B R G, colourless, multicolour, lands. */
export const COLOUR_COLUMNS: ColourGroup[] = ['W', 'U', 'B', 'R', 'G', 'colourless', 'multi', 'land'];

const COLUMN_GAP = 8;
const BAND_GAP = 16;

/** A card's column, 0 (W) to 7 (lands). */
export function colourColumn(c: ColourCard): number {
  return COLOUR_COLUMNS.indexOf(colourGroup(c.colours, c.land));
}

/** Cheapest first (7 and up together, as on the curve), then by name. */
function cheaper(a: ColourCard, b: ColourCard): number {
  const mv = (c: ColourCard) => Math.min(MAX_MV, Math.max(0, Math.floor(c.mv)));
  return mv(a) - mv(b) || a.name.localeCompare(b.name);
}

/**
 * Lay cards out in colour columns centred on `centre`, only the columns some
 * card uses. Returns where each card goes, in the order to place them (each
 * column's top card first, so the next lies over it and leaves its title bar
 * showing).
 */
export function colourLayout(cards: ColourCard[], centre: { x: number; y: number }, opts: { split: boolean }): { uid: string; at: Placed }[] {
  const cols = [...new Set(cards.map(colourColumn))].sort((a, b) => a - b);
  const placed: { uid: string; x: number; y: number }[] = [];
  let top = 0;
  const bands = opts.split ? [cards.filter((c) => c.creature), cards.filter((c) => !c.creature)] : [cards];
  for (const band of bands) {
    if (!band.length) continue;
    let tallest = CARD_H;
    cols.forEach((col, k) => {
      const inCol = band.filter((c) => colourColumn(c) === col).sort(cheaper);
      const x = k * (CARD_W + COLUMN_GAP) + CARD_W / 2;
      inCol.forEach((c, i) => placed.push({ uid: c.uid, x, y: top - CARD_H / 2 - i * CASCADE_STEP }));
      if (inCol.length) tallest = Math.max(tallest, CARD_H + (inCol.length - 1) * CASCADE_STEP);
    });
    top -= tallest + BAND_GAP;
  }
  const width = cols.length * CARD_W + (cols.length - 1) * COLUMN_GAP;
  const height = -top - BAND_GAP;
  const ox = centre.x - width / 2, oy = centre.y + height / 2;
  return placed.map((p) => ({ uid: p.uid, at: { x: ox + p.x, y: oy + p.y, yaw: 0, z: CARD_T / 2 } }));
}
