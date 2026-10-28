// Curve view (decision 107): cards laid out by mana value, the way deckbuilders
// and cube lists show them. Each mana value is a column of cards cascading
// down the table with every card's title bar showing; lands sit in a neat
// stack at the start. Optionally creatures and non-creatures cascade in two
// bands. Sorted by colour, each colour group is its own row of columns, top to
// bottom, as a cube list is read. Pure geometry, tested without a browser.

import { CARD_H, CARD_T, CARD_W } from './types';
import type { Placed } from './piles';

/** How far each card in a cascade sits below the one before: enough to show its title bar and cost. */
export const CASCADE_STEP = 22;
/** Gap between columns, between the creature and non-creature bands, and between colour rows, mm. */
const COLUMN_GAP = 8;
const BAND_GAP = 16;
const ROW_GAP = 30;
/** Mana values 7 and up share the last column. */
export const MAX_MV = 7;

/** What the layout needs to know about a card. */
export interface CurveCard {
  uid: string;
  name: string;
  /** Mana value. */
  mv: number;
  land: boolean;
  creature: boolean;
  /** Colour group, for sorting by colour: see COLOUR_GROUPS. */
  group: ColourGroup;
}

export type ColourGroup = 'W' | 'U' | 'B' | 'R' | 'G' | 'multi' | 'colourless' | 'land';
/** The order colour rows run, top to bottom, as on a cube list. */
export const COLOUR_GROUPS: ColourGroup[] = ['W', 'U', 'B', 'R', 'G', 'multi', 'colourless', 'land'];

/** A card's colour group from its colours and type: lands first, then by colour count. */
export function colourGroup(colours: string[], land: boolean): ColourGroup {
  if (land) return 'land';
  if (colours.length > 1) return 'multi';
  if (colours.length === 0) return 'colourless';
  const c = colours[0];
  return c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G' ? c : 'colourless';
}

/** The column a card goes in: 0 for lands, 1 + mana value (7+ together) for the rest. */
function columnOf(card: CurveCard): number {
  return card.land ? 0 : 1 + Math.min(MAX_MV, Math.max(0, Math.floor(card.mv)));
}

/**
 * Lay cards out as a curve. Returns where each card goes, in the order to
 * place them (each cascade top card first, so later cards lie over the one
 * above and leave its title bar showing). The whole layout is centred on
 * `centre`. `byColour` makes one row per colour group; `split` puts creatures
 * and non-creatures in separate bands.
 */
export function curveLayout(cards: CurveCard[], centre: { x: number; y: number }, opts: { byColour: boolean; split: boolean }): { uid: string; at: Placed }[] {
  const byName = (a: CurveCard, b: CurveCard) => a.name.localeCompare(b.name);
  const groups: CurveCard[][] = opts.byColour
    ? COLOUR_GROUPS.map((g) => cards.filter((c) => c.group === g)).filter((g) => g.length)
    : [cards];

  // Which columns are used anywhere, so every row lines up.
  const used = [...new Set(cards.map(columnOf))].sort((a, b) => a - b);
  const xOf = new Map(used.map((col, i) => [col, i * (CARD_W + COLUMN_GAP)]));
  const width = used.length * CARD_W + (used.length - 1) * COLUMN_GAP;

  // Rows top to bottom; within a row, bands (creatures over non-creatures when split).
  const placed: { uid: string; x: number; y: number }[] = [];
  let top = 0; // y of the current row's top edge, going down (negative y is down the table)
  for (const group of groups) {
    const bands = opts.split ? [group.filter((c) => c.creature || c.land), group.filter((c) => !c.creature && !c.land)] : [group];
    for (const band of bands) {
      if (!band.length) continue;
      let tallest = CARD_H;
      for (const col of used) {
        const inCol = band.filter((c) => columnOf(c) === col).sort(byName);
        if (!inCol.length) continue;
        const x = xOf.get(col)! + CARD_W / 2;
        if (col === 0) {
          // Lands: one neat stack at the start of the row.
          for (const c of inCol) placed.push({ uid: c.uid, x, y: top - CARD_H / 2 });
          continue;
        }
        inCol.forEach((c, i) => placed.push({ uid: c.uid, x, y: top - CARD_H / 2 - i * CASCADE_STEP }));
        tallest = Math.max(tallest, CARD_H + (inCol.length - 1) * CASCADE_STEP);
      }
      top -= tallest + BAND_GAP;
    }
    top += BAND_GAP - ROW_GAP;
  }
  const height = -(top + ROW_GAP);

  // Centre the whole layout on the spot.
  const ox = centre.x - width / 2, oy = centre.y + height / 2;
  return placed.map((p) => ({ uid: p.uid, at: { x: ox + p.x, y: oy + p.y, yaw: 0, z: CARD_T / 2 } }));
}
