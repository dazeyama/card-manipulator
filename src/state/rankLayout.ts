// Rank view (decision 198): cards in columns by how they are valued, as
// CubeCobra's Elo view shows a cube. E sorts by EDHREC rank in widening bands
// (1-100, 101-250 ... 20,001+); E E by CubeCobra Elo in 50-point columns
// (1050-1099, 1100-1149 ...). Columns run from the least valued on the left to
// the best on the right, each cascading down the table like a curve column,
// its best card at the top; cards with no value come first, on the far left.
// Split creatures puts creatures and non-creatures in separate bands. Pure
// geometry, tested without a browser.

import { CASCADE_STEP } from './curve';
import type { Placed } from './piles';
import { CARD_H, CARD_T, CARD_W } from './types';

export type RankMode = 'edhrec' | 'elo';

export interface RankCard {
  uid: string;
  name: string;
  creature: boolean;
  /** EDHREC rank (lower is better) or Elo (higher is better); undefined when unknown. */
  value: number | undefined;
}

/** The upper end of each EDHREC band; past the last, 20,001 and up. */
export const EDHREC_BANDS = [100, 250, 500, 1000, 2000, 5000, 10000, 20000];
/** Elo columns are this wide. */
export const ELO_STEP = 50;

const COLUMN_GAP = 8;
const BAND_GAP = 16;

/**
 * A card's column key, larger for better cards so columns sort left to right:
 * EDHREC bands count down from the least played, Elo columns are the bucket's
 * floor. Unknown values get -Infinity, the far left.
 */
export function rankColumn(mode: RankMode, value: number | undefined): number {
  if (value === undefined) return -Infinity;
  if (mode === 'elo') return Math.floor(value / ELO_STEP) * ELO_STEP;
  const band = EDHREC_BANDS.findIndex((top) => value <= top);
  // Band 0 (1-100) is the best: give it the largest key.
  return EDHREC_BANDS.length - (band < 0 ? EDHREC_BANDS.length : band);
}

/** Better first: a lower EDHREC rank, a higher Elo; then by name. */
function better(mode: RankMode) {
  return (a: RankCard, b: RankCard) => {
    if (a.value !== undefined && b.value !== undefined && a.value !== b.value) return mode === 'elo' ? b.value - a.value : a.value - b.value;
    return a.name.localeCompare(b.name);
  };
}

/**
 * Lay cards out in rank columns centred on `centre`. Returns where each card
 * goes, in the order to place them (each column's top card first, so the next
 * lies over it and leaves its title bar showing).
 */
export function rankLayout(cards: RankCard[], centre: { x: number; y: number }, opts: { mode: RankMode; split: boolean }): { uid: string; at: Placed }[] {
  const column = (c: RankCard) => rankColumn(opts.mode, c.value);
  const cols = [...new Set(cards.map(column))].sort((a, b) => a - b);
  const order = better(opts.mode);
  const placed: { uid: string; x: number; y: number }[] = [];
  let top = 0;
  const bands = opts.split ? [cards.filter((c) => c.creature), cards.filter((c) => !c.creature)] : [cards];
  for (const band of bands) {
    if (!band.length) continue;
    let tallest = CARD_H;
    cols.forEach((col, k) => {
      const inCol = band.filter((c) => column(c) === col).sort(order);
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
