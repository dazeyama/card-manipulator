// Curve view (decision 107): cards laid out by mana value, the way deckbuilders
// and cube lists show them. Each mana value is a column of cards cascading
// down the table with every card's title bar showing; lands sit in a neat
// stack at the start. Optionally creatures and non-creatures cascade in two
// bands. Sorted by colour, each colour group is its own block of columns, two
// blocks to a row: white and blue, black and red, green and colourless, then
// multicolour and lands (decision 113). Pure geometry, tested without a browser.

import { CARD_H, CARD_T, CARD_W } from './types';
import type { Placed } from './piles';

/** How far each card in a cascade sits below the one before: enough to show its title bar and cost. */
export const CASCADE_STEP = 22;
/** Gap between columns, between the creature and non-creature bands, and between colour rows, mm. */
const COLUMN_GAP = 8;
const BAND_GAP = 16;
const ROW_GAP = 30;
/** Gap between the two colour blocks side by side, mm. */
const BLOCK_GAP = 60;
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
  /** Colour group, for sorting by colour: see COLOUR_GRID. */
  group: ColourGroup;
}

export type ColourGroup = 'W' | 'U' | 'B' | 'R' | 'G' | 'multi' | 'colourless' | 'land';
/** Where each colour block goes when sorted by colour: two to a row, top to bottom (decision 113). */
export const COLOUR_GRID: ColourGroup[][] = [['W', 'U'], ['B', 'R'], ['G', 'colourless'], ['multi', 'land']];

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
 * One curve: a column per mana value in `cols`, cascading down from y = 0
 * (negative y is down the table), lands stacked in column 0. Returns the
 * placements, x from the block's left edge, and the block's height.
 */
function block(cards: CurveCard[], cols: number[], split: boolean): { placed: { uid: string; x: number; y: number }[]; height: number } {
  const byName = (a: CurveCard, b: CurveCard) => a.name.localeCompare(b.name);
  const placed: { uid: string; x: number; y: number }[] = [];
  let top = 0;
  const bands = split ? [cards.filter((c) => c.creature || c.land), cards.filter((c) => !c.creature && !c.land)] : [cards];
  for (const band of bands) {
    if (!band.length) continue;
    let tallest = CARD_H;
    cols.forEach((col, k) => {
      const inCol = band.filter((c) => columnOf(c) === col).sort(byName);
      if (!inCol.length) return;
      const x = k * (CARD_W + COLUMN_GAP) + CARD_W / 2;
      if (col === 0) {
        // Lands: one neat stack at the start.
        for (const c of inCol) placed.push({ uid: c.uid, x, y: top - CARD_H / 2 });
        return;
      }
      inCol.forEach((c, i) => placed.push({ uid: c.uid, x, y: top - CARD_H / 2 - i * CASCADE_STEP }));
      tallest = Math.max(tallest, CARD_H + (inCol.length - 1) * CASCADE_STEP);
    });
    top -= tallest + BAND_GAP;
  }
  return { placed, height: -top - BAND_GAP };
}

const widthOf = (cols: number) => cols * CARD_W + (cols - 1) * COLUMN_GAP;

/**
 * Lay cards out as a curve. Returns where each card goes, in the order to
 * place them (each cascade top card first, so later cards lie over the one
 * above and leave its title bar showing). The whole layout is centred on
 * `centre`. `byColour` gives each colour group its own block, two to a row
 * (COLOUR_GRID), with the mana value columns lined up across blocks; `split`
 * puts creatures and non-creatures in separate bands.
 */
export function curveLayout(cards: CurveCard[], centre: { x: number; y: number }, opts: { byColour: boolean; split: boolean }): { uid: string; at: Placed }[] {
  const placed: { uid: string; x: number; y: number }[] = [];
  let width: number, height: number;
  if (!opts.byColour) {
    const cols = [...new Set(cards.map(columnOf))].sort((a, b) => a - b);
    const b = block(cards, cols, opts.split);
    placed.push(...b.placed);
    width = widthOf(cols.length);
    height = b.height;
  } else {
    // Every colour block uses the same mana value columns, so they line up; lands are their own block.
    const cols = [...new Set(cards.filter((c) => !c.land).map(columnOf))].sort((a, b) => a - b);
    const blockWidth = Math.max(CARD_W, widthOf(cols.length));
    let top = 0;
    for (const row of COLOUR_GRID) {
      let tallest = 0;
      row.forEach((g, k) => {
        const group = cards.filter((c) => c.group === g);
        if (!group.length) return;
        const b = block(group, g === 'land' ? [0] : cols, opts.split);
        const left = k * (blockWidth + BLOCK_GAP);
        for (const p of b.placed) placed.push({ uid: p.uid, x: left + p.x, y: top + p.y });
        tallest = Math.max(tallest, b.height);
      });
      if (tallest) top -= tallest + ROW_GAP;
    }
    width = 2 * blockWidth + BLOCK_GAP;
    height = -top - ROW_GAP;
  }

  // Centre the whole layout on the spot.
  const ox = centre.x - width / 2, oy = centre.y + height / 2;
  return placed.map((p) => ({ uid: p.uid, at: { x: ox + p.x, y: oy + p.y, yaw: 0, z: CARD_T / 2 } }));
}
