// Curve view (decision 107): cards laid out by mana value, the way deckbuilders
// and cube lists show them. Each mana value is a column of cards cascading
// down the table with every card's title bar showing. Optionally creatures and
// non-creatures cascade in two bands. Sorted by colour, each colour group is
// its own block of columns, two blocks to a row: white and blue, black and
// red, green and colourless. Multicolour cards then get a full row of their
// own, a cascading column per colour identity (decision 150). Lands get their
// own row underneath in the same columns: the ten guilds, then three or more
// colours, then one colour and colourless together (decision 149). Pure
// geometry, tested without a browser.

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
  /** Colour identity (Scryfall's ci), which picks a land's column. */
  identity: string[];
}

export type ColourGroup = 'W' | 'U' | 'B' | 'R' | 'G' | 'multi' | 'colourless' | 'land';
/**
 * Where each colour block goes when sorted by colour: two to a row, top to
 * bottom (decision 113). Multicolour and lands have rows of their own below,
 * by colour identity (decisions 149, 150).
 */
export const COLOUR_GRID: ColourGroup[][] = [['W', 'U'], ['B', 'R'], ['G', 'colourless']];

/** The guilds in their usual order: Azorius, Orzhov, Dimir, Izzet, Rakdos, Golgari, Gruul, Boros, Selesnya, Simic. */
export const GUILDS = ['WU', 'WB', 'UB', 'UR', 'BR', 'BG', 'RG', 'RW', 'GW', 'GU'];

/**
 * A card's column in a colour identity row (decisions 149, 150): 0 to 9 for
 * the guilds, 10 for three or more colours, 11 for one colour or none.
 */
export function landColumn(identity: string[]): number {
  if (identity.length >= 3) return GUILDS.length;
  if (identity.length < 2) return GUILDS.length + 1;
  const i = GUILDS.findIndex((g) => identity.includes(g[0]) && identity.includes(g[1]));
  return i < 0 ? GUILDS.length + 1 : i;
}

/** A card's colour group from its colours and type: lands first, then by colour count. */
export function colourGroup(colours: string[], land: boolean): ColourGroup {
  if (land) return 'land';
  if (colours.length > 1) return 'multi';
  if (colours.length === 0) return 'colourless';
  const c = colours[0];
  return c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G' ? c : 'colourless';
}

/** The column a spell goes in: its mana value, 7 and up together. */
function columnOf(card: CurveCard): number {
  return Math.min(MAX_MV, Math.max(0, Math.floor(card.mv)));
}

interface Block {
  placed: { uid: string; x: number; y: number }[];
  height: number;
}

const byName = (a: CurveCard, b: CurveCard) => a.name.localeCompare(b.name);

/**
 * One curve: a column per value of `column` in `cols`, cascading down from
 * y = 0 (negative y is down the table). Returns the placements, x from the
 * block's left edge, and the block's height.
 */
function block(
  cards: CurveCard[],
  cols: number[],
  split: boolean,
  column: (c: CurveCard) => number = columnOf,
  order: (a: CurveCard, b: CurveCard) => number = byName,
): Block {
  const placed: { uid: string; x: number; y: number }[] = [];
  let top = 0;
  const bands = split ? [cards.filter((c) => c.creature), cards.filter((c) => !c.creature)] : [cards];
  for (const band of bands) {
    if (!band.length) continue;
    let tallest = CARD_H;
    cols.forEach((col, k) => {
      const inCol = band.filter((c) => column(c) === col).sort(order);
      if (!inCol.length) return;
      const x = k * (CARD_W + COLUMN_GAP) + CARD_W / 2;
      inCol.forEach((c, i) => placed.push({ uid: c.uid, x, y: top - CARD_H / 2 - i * CASCADE_STEP }));
      tallest = Math.max(tallest, CARD_H + (inCol.length - 1) * CASCADE_STEP);
    });
    top -= tallest + BAND_GAP;
  }
  return { placed, height: -top - BAND_GAP };
}

const widthOf = (cols: number) => cols * CARD_W + (cols - 1) * COLUMN_GAP;

/** Multicolour cards in a column: cheapest first, then by name. */
const byCost = (a: CurveCard, b: CurveCard) => columnOf(a) - columnOf(b) || byName(a, b);

/** The identity columns these cards use, in landColumn order. */
const identityCols = (cards: CurveCard[]) => [...new Set(cards.map((c) => landColumn(c.identity)))].sort((a, b) => a - b);

/**
 * A row by colour identity (decisions 149, 150): a cascading column per
 * identity in `cols`, by default those these cards use.
 */
function identityRow(cards: CurveCard[], split: boolean, order: (a: CurveCard, b: CurveCard) => number, cols = identityCols(cards)): Block & { width: number } {
  const column = (c: CurveCard) => landColumn(c.identity);
  return { ...block(cards, cols, split, column, order), width: widthOf(cols.length) };
}

/**
 * Lay cards out as a curve. Returns where each card goes, in the order to
 * place them (each cascade top card first, so later cards lie over the one
 * above and leave its title bar showing). The whole layout is centred on
 * `centre`. `byColour` gives each colour group its own block, two to a row
 * (COLOUR_GRID), with the mana value columns lined up across blocks; `split`
 * puts creatures and non-creatures in separate bands. Lands always go in
 * their own row underneath, a column per colour identity.
 */
export function curveLayout(cards: CurveCard[], centre: { x: number; y: number }, opts: { byColour: boolean; split: boolean }): { uid: string; at: Placed }[] {
  const placed: { uid: string; x: number; y: number }[] = [];
  const spells = cards.filter((c) => !c.land);
  const lands = cards.filter((c) => c.land);
  const cols = [...new Set(spells.map(columnOf))].sort((a, b) => a - b);
  let width = 0, height = 0;
  /** With Shift + C, the identity columns the multicolour and land rows share. */
  let shared: number[] | null = null;
  // A full-width row under everything so far. With Shift + C it starts one
  // column in, under mana value 1, leaving the 0 column empty (decision 151).
  const indent = opts.byColour && cols[0] === 0 ? CARD_W + COLUMN_GAP : 0;
  const addRow = (row: Block & { width: number }) => {
    const top = placed.length ? -(height + ROW_GAP) : 0;
    for (const p of row.placed) placed.push({ uid: p.uid, x: indent + p.x, y: top + p.y });
    width = Math.max(width, indent + row.width);
    height = -top + row.height;
  };
  if (spells.length && !opts.byColour) {
    const b = block(spells, cols, opts.split);
    placed.push(...b.placed);
    width = widthOf(cols.length);
    height = b.height;
  } else if (spells.length) {
    // Every colour block uses the same mana value columns, so they line up.
    const blockWidth = Math.max(CARD_W, widthOf(cols.length));
    let top = 0;
    let used = 0;
    for (const row of COLOUR_GRID) {
      let tallest = 0;
      row.forEach((g, k) => {
        const group = spells.filter((c) => c.group === g);
        if (!group.length) return;
        used = Math.max(used, k + 1);
        const b = block(group, cols, opts.split);
        const left = k * (blockWidth + BLOCK_GAP);
        for (const p of b.placed) placed.push({ uid: p.uid, x: left + p.x, y: top + p.y });
        tallest = Math.max(tallest, b.height);
      });
      if (tallest) top -= tallest + ROW_GAP;
    }
    if (used) {
      width = used * blockWidth + (used - 1) * BLOCK_GAP;
      height = -top - ROW_GAP;
    }
    // Multicolour: a row by colour identity, guilds first (decision 150). It shares its
    // columns with the land row below, so each guild lines up; a guild with neither
    // multicolour cards nor lands has no column (decision 161).
    const multi = spells.filter((c) => c.group === 'multi');
    shared = identityCols([...multi, ...lands]);
    if (multi.length) addRow(identityRow(multi, opts.split, byCost, shared));
  }

  // Lands: their own row underneath, by colour identity (decision 149).
  if (lands.length) addRow(identityRow(lands, false, byName, shared ?? identityCols(lands)));

  // Centre the whole layout on the spot.
  const ox = centre.x - width / 2, oy = centre.y + height / 2;
  return placed.map((p) => ({ uid: p.uid, at: { x: ox + p.x, y: oy + p.y, yaw: 0, z: CARD_T / 2 } }));
}
