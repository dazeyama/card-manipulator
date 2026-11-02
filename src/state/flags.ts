// Flags (decision 327): a named, colored zone on the table, a pole at the
// center of a circle 35 cm in radius, that sorts cards by where they lie. A card on the table whose center is inside a flag's circle is the
// flag's; zones never overlap, so a card is never two flags'. A flag lives
// without cards. Pure: geometry only, tested without a browser.

import { CARD_H, CARD_W } from './types';

export interface Flag {
  uid: string;
  name: string;
  /** Cards that don't match are turned away from the zone (spec 9.4's query language). */
  filter: string | null;
  /** The cloth and the zone's tint, `#rrggbb`. */
  colour: string;
  /** The pole: the zone's center. */
  x: number;
  y: number;
  /** Locked in place: not dragged or removed until unlocked. */
  locked?: boolean;
}

/** How far a flag's zone reaches from its pole, mm. */
export const FLAG_REACH = 350;

/** Shift-dragging a flag pulls in cards from this far from the pole (decision 329). */
export const FLAG_PULL = 440;

/** The colors a flag may be. */
export const FLAG_COLOURS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#4895ef', '#7b2cbf', '#ff6fb5', '#6b7280'];

/** Where a turned-away card's center lands past the edge: half a card's diagonal and a gap out. */
const OUTSIDE = Math.hypot(CARD_W, CARD_H) / 2 + 12;

/** The flag whose zone holds a table point, or null. */
export function flagAt(flags: Iterable<Flag>, x: number, y: number): Flag | null {
  let best: Flag | null = null;
  let bestD = FLAG_REACH;
  for (const f of flags) {
    const d = Math.hypot(x - f.x, y - f.y);
    if (d <= bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** The flag a card belongs to: one on the table (not a card stand) with its center in the zone. */
export function flagOfCard(flags: Iterable<Flag>, card: { x: number; y: number; stand?: string }): Flag | null {
  return card.stand ? null : flagAt(flags, card.x, card.y);
}

/**
 * Which flag each card belongs to (decision 354): a card whose center lies in
 * a zone is that flag's, and so is every card of the same pile (cards
 * touching cards, all the way along), so a curve or a spread reaching out of
 * the circle still counts. A pile reaching two zones: cards in a circle stay
 * that flag's, the rest go to the flag with more of the pile in its circle.
 * `fits` is the flag's filter: a card joined only through its pile counts only
 * if it matches (one in the circle counts either way; it is turned out).
 */
export function flagMembership<C extends { uid: string; x: number; y: number; stand?: string; pileId: string | null }>(
  flags: Iterable<Flag>,
  cards: Iterable<C>,
  fits: (flag: Flag, uid: string) => boolean = () => true,
): Map<string, Flag> {
  const all = [...flags];
  const out = new Map<string, Flag>();
  if (!all.length) return out;
  const groups = new Map<string, C[]>();
  for (const c of cards) {
    const key = c.pileId ?? `card:${c.uid}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(c);
  }
  for (const g of groups.values()) {
    const direct = new Map<string, Flag>();
    const votes = new Map<Flag, number>();
    for (const c of g) {
      const f = flagOfCard(all, c);
      if (!f) continue;
      direct.set(c.uid, f);
      votes.set(f, (votes.get(f) ?? 0) + 1);
    }
    if (!votes.size) continue;
    let lead: Flag | null = null;
    for (const [f, n] of votes) if (!lead || n > votes.get(lead)!) lead = f;
    for (const c of g) {
      const d = direct.get(c.uid);
      if (d) out.set(c.uid, d);
      else if (!c.stand && fits(lead!, c.uid)) out.set(c.uid, lead!);
    }
  }
  return out;
}

/** The cards of one flag. */
export function membersOf<C extends { uid: string; x: number; y: number; stand?: string }>(flag: Flag, flags: Iterable<Flag>, cards: Iterable<C>): C[] {
  const all = [...flags];
  return [...cards].filter((c) => flagOfCard(all, c)?.uid === flag.uid);
}

/**
 * Where a flag may stand near `at` without its zone overlapping another's:
 * pushed straight away from each one too close until the zones only touch.
 */
export function clearOf(at: { x: number; y: number }, others: Iterable<{ x: number; y: number }>): { x: number; y: number } {
  const list = [...others];
  const gap = FLAG_REACH * 2;
  let p = { ...at };
  for (let round = 0; round < 24; round++) {
    let moved = false;
    for (const o of list) {
      let dx = p.x - o.x;
      let dy = p.y - o.y;
      let d = Math.hypot(dx, dy);
      if (d >= gap - 0.01) continue;
      if (d < 1e-6) {
        // Right on top: away to the right.
        dx = 1;
        dy = 0;
        d = 1;
      }
      p = { x: o.x + (dx / d) * gap, y: o.y + (dy / d) * gap };
      moved = true;
    }
    if (!moved) return p;
  }
  return p;
}

/**
 * Where a card a flag turns away should land: straight out from the pole past
 * the zone's edge, turned round the zone a little at a time if that spot is in
 * another flag's zone.
 */
export function outsideSpot(flag: Flag, card: { x: number; y: number }, others: Iterable<Flag>): { x: number; y: number } {
  const list = [...others].filter((f) => f.uid !== flag.uid);
  const r = FLAG_REACH + OUTSIDE;
  let a = Math.atan2(card.y - flag.y, card.x - flag.x);
  if (card.x === flag.x && card.y === flag.y) a = 0;
  for (let k = 0; k < 24; k++) {
    // 0, +15°, -15°, +30°, -30°...
    const turn = (Math.ceil(k / 2) * (k % 2 ? 1 : -1) * Math.PI) / 12;
    const spot = { x: flag.x + Math.cos(a + turn) * r, y: flag.y + Math.sin(a + turn) * r };
    if (!list.some((f) => Math.hypot(spot.x - f.x, spot.y - f.y) <= FLAG_REACH + OUTSIDE)) return spot;
  }
  return { x: flag.x + Math.cos(a) * r, y: flag.y + Math.sin(a) * r };
}

/** The next color for a new flag: the first no flag has, or round again. */
export function nextColour(flags: Iterable<Flag>): string {
  const used = new Set([...flags].map((f) => f.colour));
  return FLAG_COLOURS.find((c) => !used.has(c)) ?? FLAG_COLOURS[used.size % FLAG_COLOURS.length];
}

/** A name for a new flag: Flag 1, Flag 2... the first not taken. */
export function nextName(flags: Iterable<Flag>): string {
  const names = new Set([...flags].map((f) => f.name.toLowerCase()));
  for (let n = 1; ; n++) if (!names.has(`flag ${n}`)) return `Flag ${n}`;
}
