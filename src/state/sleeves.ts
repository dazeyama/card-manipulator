// Sleeves (decision 360, SLEEVES.md): a sleeve is a style, a color `#rrggbb`
// or the URL of a card's art crop, kept on each sleeved card. A sleeve pack is
// a die of kind 'pack' (src/dice.ts carries it): dropped on a pile it sleeves
// every card there and is used up. Every sleeving saves the pile to Your
// decks (src/io/savedDecks.ts). Pure, tested without a browser.

import type { Die } from './dice';

/** A sleeve pack's size, mm: a little bigger than a card, as thick as a small box. */
export const PACK_W = 72;
export const PACK_H = 98;
export const PACK_T = 16;

/** A pack's sleeves when nothing else was chosen: dark blue. */
export const DEFAULT_SLEEVE = '#1f3a6e';

/** The rim an art sleeve shows round a face-up card: near black. */
export const ART_RIM = '#1d1d1f';

/** Is this sleeve a card's art (rather than a color)? */
export function isArtSleeve(sleeve: string): boolean {
  return !sleeve.startsWith('#');
}

/** The rim a sleeved card shows face up: the sleeve's color, or near black for art. */
export function sleeveRim(sleeve: string): string {
  return isArtSleeve(sleeve) ? ART_RIM : sleeve;
}

/** The sleeves a pack holds: its art, else its color. */
export function packSleeve(d: Pick<Die, 'art' | 'color'>): string {
  return d.art ?? d.color ?? DEFAULT_SLEEVE;
}

/** Is this die a sleeve pack? */
export function isPack(d: Pick<Die, 'kind'> | undefined): boolean {
  return d?.kind === 'pack';
}

/** The names of the colors to choose from (the dice's palette, decision 278). */
export const COLOUR_NAMES: Record<string, string> = {
  '#fbfbf8': 'White', '#e0443e': 'Red', '#f08c2e': 'Orange', '#f2cf3a': 'Yellow', '#4cae4f': 'Green', '#3d7fd9': 'Blue', '#8a5cc7': 'Purple', '#e86aa6': 'Pink', '#1d1d1f': 'Black',
  '#7a1f24': 'Dark red', '#1f3a6e': 'Dark blue', '#1f5a34': 'Dark green', '#4a2a6e': 'Dark purple', '#1d5a5e': 'Dark teal', '#5a3a1e': 'Brown', '#2c2c30': 'Charcoal',
};

/** A sleeve said in words: its color's name, or "art" with the card's name when known. */
export function sleeveName(sleeve: string, artName?: string): string {
  if (isArtSleeve(sleeve)) return artName ? `${artName} art` : 'Card art';
  return COLOUR_NAMES[sleeve.toLowerCase()] ?? sleeve;
}

/**
 * The name a sleeving saves its deck under (decision 360): the pile's name if
 * it has one, else the cube's, else the next free "Deck N". `replaces` says a
 * saved deck already has that name, so the snapshot takes its place.
 */
export function deckNameFor(pileName: string | null, cubeName: string | null, existing: string[]): { name: string; replaces: boolean } {
  const given = (pileName ?? cubeName ?? '').trim();
  if (given) return { name: given, replaces: existing.some((n) => n.toLowerCase() === given.toLowerCase()) };
  return { name: nextDeckName(existing), replaces: false };
}

/** The first "Deck N" no saved deck is called. */
export function nextDeckName(existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`deck ${n}`)) return `Deck ${n}`;
}

/**
 * What Shift + F does to a card (decision 360): a sleeved double-faced card
 * goes face up and raised, or back down into its sleeve if it is raised and face
 * up; an unsleeved one flips, as F does; anything else stays (null).
 */
export function raiseOf(card: { faceUp: boolean; sleeve?: string; raised?: true }, doubleFaced: boolean): { faceUp: boolean; raised: true | null } | null {
  if (!doubleFaced) return null;
  if (!card.sleeve) return { faceUp: !card.faceUp, raised: null };
  if (card.faceUp && card.raised) return { faceUp: true, raised: null };
  return { faceUp: true, raised: true };
}
