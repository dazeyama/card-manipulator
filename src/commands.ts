// Table commands (spec 10.6, 10.7, 10.8): landing cards, Stack, Spread, Tidy,
// Rotate, Remove, Frame, and toggling a stack's spread.

import type { App } from './app';
import { CARD_H, CARD_T, CARD_W, type Card } from './state/types';
import { gridLayout, layOrder, looseStackLayout, nextQuarterClockwise, overlaps, shuffled, snapYaw, spreadLayout, uprightYaw, type Footprint, type Placed } from './state/piles';
import type { Spread } from './state/store';
import { colourGroup, curveLayout, type CurveCard } from './state/curve';
import { arcHand, fanLayout, HAND_ROW, handLayout } from './state/fan';

/** The gap between the face-down piles 0 deals (decision 236), mm. */
const PILE_GAP = 10;
import { rankLayout, type RankCard, type RankMode } from './state/rankLayout';
import { colourLayout, type ColourCard } from './state/colourLayout';
import { alignTo, fitOnStand, fromSlope, inFrontOf, isStand, SLOPE_LEN, slopePose, standW } from './state/stand';
import type { Mat } from './state/types';
import { hiddenRow, splitHidden } from './online/hidden';
import { mayTouchStand, touchable } from './online/guard';

export interface Landing {
  uid: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  faceUp?: boolean;
  /** The card stand it lands on, or null for the table (decision 221); left out, it stays where it is. */
  stand?: string | null;
  /** Where an X spread laid it, so it stays flat there (decision 160); left out, unchanged. */
  laidAt?: { x: number; y: number } | null;
}

/**
 * Where landings worked out now go (decision 221): the table (null) or a card
 * stand's slope. Cards there stack only on each other, and a group laid out
 * there is kept on the slope. Set around a placement with `inSpace`.
 */
let space: string | null = null;

/** Work out landings on a card stand's slope (or the table, null). */
export function inSpace<T>(stand: string | null, fn: () => T): T {
  const was = space;
  space = stand;
  try {
    return fn();
  } finally {
    space = was;
  }
}

/** The stand landings go to now, if any. */
function spaceStand(app: App): Mat | null {
  const m = space ? app.store.mats.get(space) : undefined;
  return m && isStand(m) ? m : null;
}

/** The card stand every one of these cards is on, or null (decision 221). */
export function standOf(app: App, uids: string[]): Mat | null {
  const first = uids.length ? app.store.cards.get(uids[0])?.stand : undefined;
  if (!first || !uids.every((u) => app.store.cards.get(u)?.stand === first)) return null;
  const m = app.store.mats.get(first);
  return m && isStand(m) ? m : null;
}

/** Two presses of R within this long stand the cards upright (decision 102), ms. */
export const DOUBLE_TAP_MS = 350;

/** Settle timing (spec 15.5: under 300 ms, snappy and light). */
const SETTLE_MS = 190;

/**
 * Move cards to their landing spots in the model and animate the drawn cards
 * there with a short settle. Emits `settled` so piles and autosave update.
 */
export function land(app: App, landings: Landing[], opts: { stagger?: number; duration?: number; arc?: number; keepSide?: boolean } = {}): void {
  if (!landings.length) return;
  // A card still falling is the landing's now, not the fall's (decision 219).
  app.physics?.release(landings.map((l) => l.uid));
  // Onto a card stand, or off one onto the table (decision 221). Moved, a card
  // is now the side's that moved it (decision 267), unless this only turns or squares it.
  // One move through the store, so a room hears of it (ONLINE.md 11.1).
  const side = app.side || null;
  app.store.moveCards(opts.keepSide ? landings : landings.map((l) => ({ ...l, side })));
  const stagger = opts.stagger ?? Math.min(1.5, 200 / landings.length);
  landings.forEach((l, i) => {
    app.motion.held.delete(l.uid);
    const card = app.store.cards.get(l.uid);
    // On a stand, straight to where it lies on the slope.
    const m = card?.stand ? app.store.mats.get(card.stand) : undefined;
    const to = m ? slopePose(m, l) : { x: l.x, y: l.y, z: l.z, yaw: l.yaw };
    app.motion.animate(
      l.uid,
      { ...to, roll: (l.faceUp ?? card?.faceUp ?? true) ? 0 : Math.PI },
      { duration: opts.duration ?? SETTLE_MS, delay: i * stagger, arc: opts.arc ?? 0, bounce: 0.8 },
    );
  });
  app.store.events.emit('settled', landings.map((l) => l.uid));
}

/**
 * The flip (spec 10.5): each card rises in an arc and turns over to the face
 * its model now has, in a quick cascade top card first. Used for your own
 * flips and, in a room, for others' (decision 294), so a card turning over
 * never cuts through its neighbours. `cards` are already turned in the model.
 */
export function animateFlips(app: App, cards: Card[], shortest = false): void {
  const sorted = [...cards].sort((a, b) => b.z - a.z);
  const step = Math.min(10, 600 / Math.max(1, sorted.length));
  sorted.forEach((c, i) => {
    const pose = app.layer.pose(c.uid);
    if (!pose) return;
    // Turn to the new side: always the same way round, or the short way when
    // facing cards up mid-turn (decision 105). The roll is tidied to 0 or PI afterwards.
    const side = c.faceUp ? 0 : Math.PI;
    const turns = (pose.roll - side) / (2 * Math.PI);
    const target = side + 2 * Math.PI * (shortest ? Math.round(turns) : Math.ceil(turns + 1e-4));
    const m = c.stand ? app.store.mats.get(c.stand) : undefined;
    const to = m ? slopePose(m, c) : { x: c.x, y: c.y, z: c.z, yaw: c.yaw };
    app.motion.animate(c.uid, { ...to, roll: target }, {
      duration: 350,
      delay: i * step,
      arc: 24,
      ease: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
      done: () => {
        const p = app.layer.pose(c.uid);
        if (p && !app.motion.isAnimating(c.uid)) {
          p.roll = c.faceUp ? 0 : Math.PI;
          app.layer.touch(c.uid);
        }
      },
    });
  });
}

/** Cards on the table near a region, minus some, for surface-height checks. */
function nearby(app: App, exclude: Set<string>, around: Footprint[]): Card[] {
  if (!around.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of around) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = Math.hypot(CARD_W, CARD_H) + 2;
  const out: Card[] = [];
  for (const c of app.store.cards.values()) {
    if (exclude.has(c.uid)) continue;
    // Cards on a stand and on the table never lie on each other (decision 221).
    if ((c.stand ?? null) !== space) continue;
    if (c.x < minX - pad || c.x > maxX + pad || c.y < minY - pad || c.y > maxY + pad) continue;
    out.push(c);
  }
  return out;
}

/** Height of the surface under a footprint among some cards. */
function topOf(cards: Placed[], at: Footprint): number {
  let top = 0;
  for (const c of cards) if (overlaps(c, at, 1)) top = Math.max(top, c.z + CARD_T / 2);
  return top;
}

/**
 * Drop cards one after another at their footprints: each lands on whatever is
 * beneath it, including the cards placed before it (messy drops, formation).
 */
export function placeSequential(app: App, uids: string[], spots: Footprint[], exclude = new Set(uids)): Landing[] {
  // On a stand the whole group is kept on its slope (decision 221); one too big
  // for it goes on the table just in front of the stand instead (decision 222).
  const m = spaceStand(app);
  if (m) {
    const fitted = fitOnStand(m, spots.slice(0, uids.length));
    if (!fitted) return inSpace(null, () => placeSequential(app, uids, inFrontOf(m, spots.slice(0, uids.length)), exclude));
    spots = fitted;
  }
  const surface: Placed[] = nearby(app, exclude, spots);
  return uids.map((uid, i) => {
    const s = spots[i];
    const z = topOf(surface, s) + CARD_T / 2;
    const placed = { x: s.x, y: s.y, yaw: s.yaw, z };
    surface.push(placed);
    return { uid, ...placed, stand: space };
  });
}

/** A neat stack at a spot, bottom card first, on top of whatever is there. */
export function stackAt(app: App, uids: string[], at: Footprint, exclude = new Set(uids)): Landing[] {
  const m = spaceStand(app);
  if (m) at = fitOnStand(m, [at])?.[0] ?? at;
  const base = topOf(nearby(app, exclude, [at]), at);
  return uids.map((uid, i) => ({ uid, x: at.x, y: at.y, yaw: at.yaw, z: base + CARD_T / 2 + i * CARD_T, stand: space }));
}

/**
 * Cards gathered onto one spot: a loose, hand-made stack, or a neat one at a
 * quarter turn in Tidy mode (decisions 94, 98). Only Tidy squares a loose stack up.
 */
export function pileAt(app: App, uids: string[], at: Footprint, exclude = new Set(uids)): Landing[] {
  if (app.tidy) return stackAt(app, uids, { ...at, yaw: snapYaw(at.yaw) }, exclude);
  return placeSequential(app, uids, looseStackLayout(uids.length, at), exclude);
}

/** Selected cards ordered bottom to top. */
export function byHeight(app: App, uids: Iterable<string>): string[] {
  return [...uids].map((u) => app.store.cards.get(u)!).filter(Boolean).sort((a, b) => a.z - b.z).map((c) => c.uid);
}

/** A hand on a stand's slope (decision 222): one arc exactly as wide as the slope, in its middle. */
function slopeHand(m: Mat, count: number): Placed[] {
  return fromSlope(m, arcHand(count, standW(m), { x: 0, y: SLOPE_LEN / 2 }));
}

/**
 * H H on a stand (decision 272): a hand of the usual size in the middle of the
 * slope, its arch flattened just enough to stay on the slope when it is too tall.
 */
function smallSlopeHand(m: Mat, count: number): Placed[] {
  const fan = fanLayout(count, { x: 0, y: 0 });
  const reach = (p: Placed) => Math.abs(Math.sin(p.yaw)) * (CARD_W / 2) + Math.abs(Math.cos(p.yaw)) * (CARD_H / 2);
  let k = 1;
  let spots = fan;
  for (let i = 0; i < 20; i++) {
    spots = fan.map((p) => ({ ...p, y: p.y * k }));
    const low = Math.min(...spots.map((p) => p.y - reach(p))), high = Math.max(...spots.map((p) => p.y + reach(p)));
    if (high - low <= SLOPE_LEN - 1 || i === 19) {
      const shift = SLOPE_LEN / 2 - (low + high) / 2;
      return fromSlope(m, spots.map((p) => ({ ...p, y: p.y + shift })));
    }
    k *= 0.85;
  }
  return fromSlope(m, spots);
}

/**
 * A big table layout (curve, rank, colour) of cards that were on a card stand
 * goes on the table directly in front of that stand, centred, like any shape
 * too big for its slope (decision 225); other layouts stay where they are.
 */
function offStand(app: App, uids: string[], spots: Placed[]): Placed[] {
  const id = uids.map((u) => app.store.cards.get(u)?.stand).find(Boolean);
  const m = id ? app.store.mats.get(id) : undefined;
  return m && isStand(m) ? inFrontOf(m, spots) : spots;
}

/** The hidden cards of a layout land face down (rooms, ONLINE.md 7.3). */
function facingDown(landings: Landing[], hidden: string[]): Landing[] {
  if (!hidden.length) return landings;
  const set = new Set(hidden);
  for (const l of landings) if (set.has(l.uid)) l.faceUp = false;
  return landings;
}

function centroid(app: App, uids: string[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const u of uids) {
    const c = app.store.cards.get(u)!;
    x += c.x;
    y += c.y;
  }
  return { x: x / uids.length, y: y / uids.length };
}

/** Take cards out of any spread they are part of (spec 10.6: a card dragged out leaves it). */
export function leaveSpreads(app: App, uids: Iterable<string>): void {
  const store = app.store;
  const set = new Set(uids);
  const keep: Spread[] = [];
  const gone: string[] = [];
  const freed: { uid: string; spreadOf: null }[] = [];
  for (const sp of store.spreads.values()) {
    const left = sp.uids.filter((u) => !set.has(u));
    if (left.length === sp.uids.length) continue;
    for (const u of set) {
      if (store.cards.get(u)?.spreadOf === sp.id) freed.push({ uid: u, spreadOf: null });
    }
    if (left.length) keep.push({ ...sp, uids: left });
    else gone.push(sp.id);
  }
  // Through the store, so a room hears of it (ONLINE.md 11.1).
  if (freed.length) store.moveCards(freed);
  if (keep.length || gone.length) store.setSpreads(keep, gone);
  else store.events.emit('piles', undefined);
}

export class Commands {
  constructor(private readonly app: App) {}

  /** Which curve each curved-out card belongs to, and where the curve put that curve's cards (decision 108). */
  private readonly curveOf = new Map<string, Map<string, { x: number; y: number }>>();
  /** Which rank view (E, decision 198) each card was laid out in, and where. */
  private readonly rankOf = new Map<string, Map<string, { x: number; y: number }>>();
  /** The same for fans (decision 141). */
  private readonly fanOf = new Map<string, Map<string, { x: number; y: number }>>();

  private get sel(): string[] {
    return [...this.app.store.selection];
  }

  /** S: gather the selection into one stack at its centroid, loose unless Tidy mode is on. */
  stack(cards: string[] = this.sel): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const uids = byHeight(this.app, cards);
    if (uids.length < 1) return;
    leaveSpreads(this.app, uids);
    const c = centroid(this.app, uids);
    // Cards all on one stand stack there, square to it (decision 221).
    const m = standOf(this.app, uids);
    land(this.app, inSpace(m?.uid ?? null, () => pileAt(this.app, uids, { x: c.x, y: c.y, yaw: m?.yaw ?? this.app.facing })));
  }

  /**
   * C: curve the cards out by mana value, a column each, lands in a row
   * underneath by colour identity (decision 149); Shift + C also sorts them
   * into a row per colour (decision 107).
   */
  curve(cards: string[], byColour: boolean, centre?: { x: number; y: number }): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const store = this.app.store;
    if (!cards.length) return;
    // Cards hidden from this browser in a room aren't sorted: they go after, face down (ONLINE.md 7.3).
    const { seen, hidden } = splitHidden(this.app, cards);
    const info: CurveCard[] = seen.map((uid) => {
      const r = store.recordOf(store.cards.get(uid)!);
      // Double-faced cards sort by their front face.
      const front = r?.faces[0];
      const type = (r?.type_line ?? '').split('//')[0];
      const isLand = /\bLand\b/.test(type);
      const colours = r ? (r.colors.length ? r.colors : front?.colors ?? []) : [];
      return { uid, name: r?.name ?? '', mv: r?.cmc ?? 0, land: isLand, creature: /\bCreature\b/.test(type), group: colourGroup(colours, isLand), identity: r?.color_identity ?? [] };
    });
    leaveSpreads(this.app, cards);
    // Centred where the cards are, or at `centre` (Shift + C: the middle of the view, decision 191).
    const middle = centre ?? centroid(this.app, cards);
    const layout = curveLayout(info, middle, { byColour, split: store.settings.curveSplit });
    const uids = [...layout.map((p) => p.uid), ...hidden];
    // Off a card stand: in front of it, unless placed in the middle of the view (Shift + C).
    // The right way up from your side (decision 267).
    const laid: Placed[] = layout.map((p) => p.at);
    const spots = alignTo([...laid, ...hiddenRow(laid, hidden.length, middle)], middle, this.app.facing);
    const landings = facingDown(placeSequential(this.app, uids, centre ? spots : offStand(this.app, uids, spots)), hidden);
    land(this.app, landings, { stagger: Math.min(2, 400 / uids.length), arc: 10 });
    // Remember the curve (one per colour row), so C on it stacks it back up.
    const groupOf = new Map(info.map((c) => [c.uid, byColour ? c.group : 'all']));
    const groups = new Map<string, Map<string, { x: number; y: number }>>();
    for (const l of landings) {
      const key = groupOf.get(l.uid)!;
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key)!.set(l.uid, { x: l.x, y: l.y });
    }
    for (const spots of groups.values()) {
      for (const uid of spots.keys()) this.curveOf.set(uid, spots);
    }
  }

  /**
   * C on cards that are already curved out (decision 108): the curve they belong
   * to, those of its cards still where the curve put them; or null.
   */
  curvedGroup(cards: string[]): string[] | null {
    return this.laidOutGroup(this.curveOf, cards);
  }

  /** The group (a curve or a fan) these cards were laid out in, those of its cards still in place; or null. */
  private laidOutGroup(groups: Map<string, Map<string, { x: number; y: number }>>, cards: string[]): string[] | null {
    const store = this.app.store;
    for (const uid of cards) {
      const spots = groups.get(uid);
      if (!spots) continue;
      const still = [...spots].filter(([u, at]) => {
        const c = store.cards.get(u);
        return c && Math.abs(c.x - at.x) < 0.5 && Math.abs(c.y - at.y) < 0.5;
      });
      if (still.length >= 2 && still.some(([u]) => u === uid)) return still.map(([u]) => u);
    }
    return null;
  }

  /**
   * E: lay the cards out in columns by EDHREC rank; E E by CubeCobra Elo
   * (decision 198), cascading like a curve, centred where they are.
   */
  rankSort(cards: string[], mode: RankMode): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const store = this.app.store;
    cards = [...new Set(cards)].filter((u) => store.cards.has(u));
    if (!cards.length) return;
    // Cards hidden from this browser in a room aren't ranked: they go after, face down (ONLINE.md 7.3).
    const { seen, hidden } = splitHidden(this.app, cards);
    const info: RankCard[] = seen.map((uid) => {
      const card = store.cards.get(uid)!;
      const r = store.recordOf(card);
      const rank = typeof r?.edhrec_rank === 'number' ? r.edhrec_rank : undefined;
      return { uid, name: r?.name ?? '', creature: /\bCreature\b/.test((r?.type_line ?? '').split('//')[0]), value: mode === 'elo' ? store.eloOf(card) : rank };
    });
    leaveSpreads(this.app, cards);
    const middle = centroid(this.app, cards);
    const layout = rankLayout(info, middle, { mode, split: store.settings.curveSplit });
    const uids = [...layout.map((p) => p.uid), ...hidden];
    const laid: Placed[] = layout.map((p) => p.at);
    const landings = facingDown(placeSequential(this.app, uids, offStand(this.app, uids, alignTo([...laid, ...hiddenRow(laid, hidden.length, middle)], middle, this.app.facing))), hidden);
    land(this.app, landings, { stagger: Math.min(2, 400 / uids.length), arc: 10 });
    // Remember the view, so E on it stacks it back up.
    const spots = new Map(landings.map((l) => [l.uid, { x: l.x, y: l.y }]));
    for (const uid of spots.keys()) this.rankOf.set(uid, spots);
  }

  /**
   * C C (decision 217): a cascading column per colour, W U B R G, colourless,
   * multicolour, lands, centred where the cards are. Remembered as a curve, so
   * C on it stacks it back up.
   */
  colourSort(cards: string[]): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const store = this.app.store;
    cards = [...new Set(cards)].filter((u) => store.cards.has(u));
    if (!cards.length) return;
    // Cards hidden from this browser in a room aren't sorted: they go after, face down (ONLINE.md 7.3).
    const { seen, hidden } = splitHidden(this.app, cards);
    const info: ColourCard[] = seen.map((uid) => {
      const r = store.recordOf(store.cards.get(uid)!);
      // Double-faced cards sort by their front face, as on the curve.
      const type = (r?.type_line ?? '').split('//')[0];
      const colours = r ? (r.colors.length ? r.colors : r.faces[0]?.colors ?? []) : [];
      return { uid, name: r?.name ?? '', mv: r?.cmc ?? 0, land: /\bLand\b/.test(type), creature: /\bCreature\b/.test(type), colours };
    });
    leaveSpreads(this.app, cards);
    const middle = centroid(this.app, cards);
    const layout = colourLayout(info, middle, { split: store.settings.curveSplit });
    const uids = [...layout.map((p) => p.uid), ...hidden];
    const laid: Placed[] = layout.map((p) => p.at);
    const landings = facingDown(placeSequential(this.app, uids, offStand(this.app, uids, alignTo([...laid, ...hiddenRow(laid, hidden.length, middle)], middle, this.app.facing))), hidden);
    land(this.app, landings, { stagger: Math.min(2, 400 / uids.length), arc: 10 });
    for (const u of uids) this.rankOf.delete(u);
    const spots = new Map(landings.map((l) => [l.uid, { x: l.x, y: l.y }]));
    for (const uid of spots.keys()) this.curveOf.set(uid, spots);
  }

  /** E: the rank view by EDHREC, or stack the cards back up if they are already laid out in one (decision 198). */
  toggleRank(cards: string[]): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const sorted = this.laidOutGroup(this.rankOf, [...new Set(cards)]);
    if (sorted) {
      for (const u of sorted) this.rankOf.delete(u);
      this.stack(sorted);
    } else this.rankSort(cards, 'edhrec');
  }

  /** C: curve the cards out, or stack them back up if they already are (decision 108). */
  /**
   * H: fan the cards out like a hand of cards (decision 141), bottom card on
   * the left, top card on the right and on top. On a fan that is still in
   * place, stack it back up instead, as S would.
   */
  toggleFan(cards: string[]): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    cards = [...new Set(cards)];
    const fanned = this.laidOutGroup(this.fanOf, cards);
    if (fanned) {
      for (const u of fanned) this.fanOf.delete(u);
      this.stack(fanned);
      return;
    }
    this.fan(cards);
  }

  /**
   * Fan cards like a hand. On a stand, one arc the slope's width (decision 222),
   * or with `small` (H H, decision 272) a hand of the usual size in the slope's middle.
   */
  fan(cards: string[], small = false): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    cards = [...new Set(cards)].filter((u) => this.app.store.cards.has(u));
    if (cards.length < 2) return;
    const uids = byHeight(this.app, cards);
    leaveSpreads(this.app, uids);
    const m = standOf(this.app, uids);
    const centre = centroid(this.app, uids);
    const layout = m
      ? small ? smallSlopeHand(m, uids.length) : slopeHand(m, uids.length)
      : alignTo(fanLayout(uids.length, centre), centre, this.app.facing);
    const landings = inSpace(m?.uid ?? null, () => placeSequential(this.app, uids, layout));
    land(this.app, landings, { stagger: Math.min(3, 300 / uids.length), arc: 6 });
    const spots = new Map(landings.map((l) => [l.uid, { x: l.x, y: l.y }]));
    for (const uid of uids) this.fanOf.set(uid, spots);
  }

  /**
   * 1-9 then a click (decision 143): take the top `count` cards of `source`
   * and lay them out at `at` as a fanned hand, like H, always face up. H on
   * the hand stacks it back up.
   */
  dealHand(source: string[], count: number, at: { x: number; y: number }, stand: Mat | null = null): void {
    // In a room, neither from nor onto a stand this player may not touch (ONLINE.md 6.3).
    source = touchable(source);
    if (stand && !mayTouchStand(stand)) return;
    const store = this.app.store;
    const top = byHeight(this.app, source.filter((u) => store.cards.has(u))).slice(-count);
    if (!top.length) return;
    leaveSpreads(this.app, top);
    // Dealt onto a slope: one new hand of everything there, the dealt cards on the right (decisions 224, 249).
    const dealt = new Set(top);
    const joined = stand ? this.onStand(stand).filter((u) => !dealt.has(u)) : [];
    const uids = [...joined, ...top];
    // More than 15 cards are dealt as packs of 15, one under the next (decision 205).
    // Clicked on a card stand's slope: dealt onto it as one arc the slope's width (decisions 221, 222).
    const landings = inSpace(stand?.uid ?? null, () => placeSequential(this.app, uids, stand ? slopeHand(stand, uids.length) : alignTo(handLayout(uids.length, at), at, this.app.facing)));
    // A hand is for reading: face down cards come up.
    for (const l of landings) if (dealt.has(l.uid)) l.faceUp = true;
    land(this.app, landings, { stagger: Math.min(30, 300 / uids.length), arc: 14 });
    const spots = new Map(landings.map((l) => [l.uid, { x: l.x, y: l.y }]));
    for (const uid of uids) this.fanOf.set(uid, spots);
  }

  /**
   * 0 with Face down? ticked (decision 236): the top `count` cards of `source`
   * dealt face down at `at` as messy piles of up to 15, close together in a
   * grid, like packs (squared stacks in Tidy mode). On a stand's slope if
   * clicked there, or in front of it if they don't fit.
   */
  dealPiles(source: string[], count: number, at: { x: number; y: number }, stand: Mat | null = null): void {
    // In a room, neither from nor onto a stand this player may not touch (ONLINE.md 6.3).
    source = touchable(source);
    if (stand && !mayTouchStand(stand)) return;
    const store = this.app.store;
    const top = byHeight(this.app, source.filter((u) => store.cards.has(u))).slice(-count);
    if (!top.length) return;
    leaveSpreads(this.app, top);
    const packs: string[][] = [];
    for (let i = 0; i < top.length; i += HAND_ROW) packs.push(top.slice(i, i + HAND_ROW));
    // One spot per pile, close together, upright to a stand if on one.
    const spots = alignTo(gridLayout(packs.length, at, PILE_GAP), at, stand?.yaw ?? this.app.facing);
    const exclude = new Set(top);
    const landings = inSpace(stand?.uid ?? null, () => packs.flatMap((pack, i) => pileAt(this.app, pack, spots[i], exclude)));
    for (const l of landings) l.faceUp = false;
    land(this.app, landings, { stagger: Math.min(6, 300 / top.length), arc: 10 });
  }

  /** A card stand's cards, bottom to top: a hand's left to right. */
  private onStand(m: Mat): string[] {
    return [...this.app.store.cards.values()].filter((c) => c.stand === m.uid).sort((a, b) => a.z - b.z).map((c) => c.uid);
  }

  /**
   * Cards dealt onto a slope by right-click or Space (decision 249): everything
   * on the stand is laid again as one hand the slope's width, the dealt cards
   * last, on the right and on top, their faces as they were.
   */
  joinSlopeHand(m: Mat, dealt: string[]): void {
    // Never re-lays a hand on a stand this player may not touch (ONLINE.md 6.3).
    if (!mayTouchStand(m, true)) return;
    const set = new Set(dealt);
    const uids = [...this.onStand(m).filter((u) => !set.has(u)), ...dealt.filter((u) => this.app.store.cards.has(u))];
    if (!uids.length) return;
    const landings = inSpace(m.uid, () => placeSequential(this.app, uids, slopeHand(m, uids.length)));
    land(this.app, landings, { stagger: Math.min(10, 200 / uids.length), arc: 8 });
    const spots = new Map(landings.map((l) => [l.uid, { x: l.x, y: l.y }]));
    for (const uid of uids) this.fanOf.set(uid, spots);
  }

  toggleCurve(cards: string[], byColour: boolean): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    cards = [...new Set(cards)];
    const curved = byColour ? null : this.curvedGroup(cards);
    if (curved) {
      for (const u of curved) this.curveOf.delete(u);
      this.stack(curved);
    } else this.curve(cards, byColour);
  }

  /** S twice quickly (decision 106): stack the cards in a random order, a shuffle. */
  shuffle(cards: string[] = this.sel): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    if (cards.length < 2) return;
    const uids = shuffled(cards);
    leaveSpreads(this.app, uids);
    const c = centroid(this.app, uids);
    const m = standOf(this.app, uids);
    // In a room the crown then re-keys any hidden cards among them (ONLINE.md 7.2).
    this.app.store.markShuffle();
    land(this.app, inSpace(m?.uid ?? null, () => pileAt(this.app, uids, { x: c.x, y: c.y, yaw: m?.yaw ?? this.app.facing })), { stagger: Math.min(3, 300 / uids.length), arc: 8 });
  }

  /** X: spread the selection in a grid at its centroid. A selection that is exactly one stack spreads beside it instead. */
  spread(cards: string[] = this.sel): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const uids = cards;
    if (!uids.length) return;
    const pile = this.app.store.pileOf(uids[0]);
    if (pile && pile.cardUids.length === uids.length && uids.every((u) => this.app.store.pileOf(u) === pile)) {
      this.toggleSpread(uids[0]);
      return;
    }
    const ordered = byHeight(this.app, uids).reverse();
    leaveSpreads(this.app, ordered);
    const centre = centroid(this.app, ordered);
    const m = standOf(this.app, ordered);
    const grid = alignTo(gridLayout(ordered.length, centre), centre, m?.yaw ?? this.app.facing);
    land(this.app, inSpace(m?.uid ?? null, () => placeSequential(this.app, ordered, grid)));
  }

  /**
   * X, then a click or a dragged box (decision 159): spread the cards in a
   * grid there, top card first. A whole pile remembers where it came from,
   * so a double-click or X on it stacks it back there.
   */
  spreadTo(cards: string[], layout: (count: number) => Placed[], reverse = false, stand: string | null = null): void {
    // In a room, neither from nor onto a stand this player may not touch (ONLINE.md 6.3).
    cards = touchable(cards);
    if (stand && !mayTouchStand(this.app.store.mats.get(stand))) return;
    const store = this.app.store;
    if (!cards.length) return;
    const pile = store.pileOf(cards[0]);
    const whole = !!pile && pile.cardUids.length === cards.length && cards.every((u) => store.pileOf(u) === pile);
    const ordered = whole ? [...pile!.cardUids].reverse() : byHeight(this.app, cards).reverse();
    leaveSpreads(this.app, ordered);
    if (whole) {
      const bottom = store.cards.get(pile!.cardUids[0])!;
      const spread: Spread = { id: pile!.id, anchor: { ...pile!.anchor }, yaw: snapYaw(bottom.yaw), uids: ordered, pileId: pile!.name ? pile!.id : null };
      store.setSpreads([spread]);
      store.moveCards(ordered.map((u) => ({ uid: u, spreadOf: spread.id })));
    }
    // X X lays each row right to left, so the mana costs show instead of the names (decision 215).
    const spots = layout(ordered.length);
    const order = layOrder(spots, reverse);
    // Onto a stand's slope when clicked there (decision 221).
    const landings = inSpace(stand, () => placeSequential(this.app, order.map((i) => ordered[i]), order.map((i) => spots[i])));
    // Spread onto a slope, every card comes face up, for showing (decision 227).
    if (stand) for (const l of landings) l.faceUp = true;
    // Overlapping cards would tip to rest on each other; these stay flat where they are laid (decision 160).
    for (const l of landings) l.laidAt = { x: l.x, y: l.y };
    land(this.app, landings, { stagger: Math.min(4, 300 / ordered.length), arc: 6 });
  }

  /**
   * Pointer mode (decision 189): move cards to a spot as one stack, on top of
   * whatever is there, loose or (in Tidy mode) squared, keeping their order.
   */
  stackAt(cards: string[], at: { x: number; y: number }, stand: Mat | null = null, faceDown = false): void {
    // In a room, neither from nor onto a stand this player may not touch (ONLINE.md 6.3).
    cards = touchable(cards);
    if (stand && !mayTouchStand(stand)) return;
    if (!cards.length) return;
    const ordered = byHeight(this.app, cards);
    leaveSpreads(this.app, ordered);
    const landings = inSpace(stand?.uid ?? null, () => pileAt(this.app, ordered, { x: at.x, y: at.y, yaw: stand?.yaw ?? this.app.facing }));
    // P P: every card face down, like a sealed draft pack (decision 226).
    if (faceDown) for (const l of landings) l.faceUp = false;
    land(this.app, landings, { stagger: Math.min(3, 300 / ordered.length), arc: 10 });
  }

  /** T: square up each pile the selection touches, without merging piles. Loose cards snap to a quarter turn. */
  tidy(cards: string[] = this.sel): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    cards = touchable(cards);
    const store = this.app.store;
    const landings: Landing[] = [];
    const done = new Set<string>();
    for (const u of cards) {
      if (done.has(u)) continue;
      const pile = store.pileOf(u);
      if (pile) {
        pile.cardUids.forEach((id) => done.add(id));
        const bottom = store.cards.get(pile.cardUids[0])!;
        const at = { x: bottom.x, y: bottom.y, yaw: snapYaw(bottom.yaw) };
        landings.push(...inSpace(bottom.stand ?? null, () => stackAt(this.app, pile.cardUids, at, new Set(pile.cardUids))));
      } else {
        done.add(u);
        const c = store.cards.get(u)!;
        landings.push({ uid: u, x: c.x, y: c.y, z: c.z, yaw: snapYaw(c.yaw) });
      }
    }
    land(this.app, landings, { keepSide: true });
  }

  /**
   * R: turn each card to the next quarter turn clockwise, so it also squares
   * up a card at an odd angle; `upright` (R twice quickly) stands them upright (decision 102).
   */
  rotate(uids: string[] = this.sel, upright = false): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    uids = touchable(uids);
    if (!uids.length) return;
    const landings = uids.map((u) => {
      const c = this.app.store.cards.get(u)!;
      return { uid: u, x: c.x, y: c.y, z: c.z, yaw: upright ? uprightYaw(c.yaw, this.app.facing) : nextQuarterClockwise(c.yaw) };
    });
    land(this.app, landings, { stagger: 0, keepSide: true });
  }

  /**
   * F, middle-click: flip cards over with a physical turn, rising and turning
   * about the long axis; a selection flips in a quick cascade (spec 10.5, 15.5).
   */
  flip(uids: string[] = this.sel, shortest = false): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    uids = touchable(uids);
    const store = this.app.store;
    const cards = uids.map((u) => store.cards.get(u)!).filter(Boolean).sort((a, b) => b.z - a.z);
    if (!cards.length) return;
    store.moveCards(cards.map((c) => ({ uid: c.uid, faceUp: !c.faceUp })));
    animateFlips(this.app, cards, shortest);
    store.events.emit('settled', cards.map((c) => c.uid));
  }

  /** F twice quickly (decision 105): every card faces up; only the face-down ones turn. */
  faceUp(uids: string[] = this.sel): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    uids = touchable(uids);
    this.flip(uids.filter((u) => this.app.store.cards.get(u)?.faceUp === false), true);
  }

  /**
   * Z: move the camera to fit the selection (or the whole table). Selected
   * `dice` count too, each framed as if it were a card (decision 277).
   */
  frame(dice: { x: number; y: number; z: number }[] = []): void {
    const store = this.app.store;
    const uids = store.selection.size || dice.length ? this.sel : [...store.cards.keys()];
    if (!uids.length && !dice.length) {
      this.app.rig.reset();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, top = 0;
    for (const c of [...uids.map((u) => store.cards.get(u)!), ...dice]) {
      minX = Math.min(minX, c.x - CARD_W / 2);
      maxX = Math.max(maxX, c.x + CARD_W / 2);
      minY = Math.min(minY, c.y - CARD_H / 2);
      maxY = Math.max(maxY, c.y + CARD_H / 2);
      top = Math.max(top, c.z);
    }
    this.app.rig.frame(minX, minY, maxX, maxY, top);
  }

  /** Double-click: spread a pile beside its spot, or restack the spread a card belongs to (spec 10.6). */
  toggleSpread(uid: string): void {
    // In a room, cards on a stand this player may not touch are left out (ONLINE.md 6.3).
    if (!touchable([uid]).length) return;
    const store = this.app.store;
    const card = store.cards.get(uid);
    if (!card) return;
    if (card.spreadOf && store.spreads.has(card.spreadOf)) {
      this.restack(card.spreadOf);
      return;
    }
    const pile = store.pileOf(uid);
    if (!pile) return;
    const topFirst = [...pile.cardUids].reverse();
    const bottom = store.cards.get(pile.cardUids[0])!;
    const spread: Spread = { id: pile.id, anchor: { ...pile.anchor }, yaw: snapYaw(bottom.yaw), uids: topFirst, pileId: pile.name ? pile.id : null };
    store.setSpreads([spread]);
    store.moveCards(topFirst.map((u) => ({ uid: u, spreadOf: spread.id })));
    const spots = alignTo(spreadLayout(topFirst.length, spread.anchor), spread.anchor, this.app.facing);
    land(this.app, inSpace(bottom.stand ?? null, () => placeSequential(this.app, topFirst, spots)), { stagger: Math.min(4, 300 / topFirst.length), arc: 6 });
  }

  /** Put a spread back into a (loose) stack at its anchor, in the same order. */
  restack(spreadId: string): void {
    const store = this.app.store;
    const sp = store.spreads.get(spreadId);
    if (!sp) return;
    const uids = sp.uids.filter((u) => store.cards.get(u)?.spreadOf === spreadId);
    // In a room, never a spread on a stand this player may not touch, the crown's too (ONLINE.md 6.3).
    if (touchable(uids).length < uids.length) return;
    store.setSpreads([], [spreadId]);
    store.moveCards(uids.map((u) => ({ uid: u, spreadOf: null })));
    const bottomFirst = [...uids].reverse();
    const m = standOf(this.app, bottomFirst);
    land(this.app, inSpace(m?.uid ?? null, () => pileAt(this.app, bottomFirst, { x: sp.anchor.x, y: sp.anchor.y, yaw: sp.yaw })), { stagger: Math.min(4, 300 / Math.max(1, uids.length)), arc: 6 });
  }
}
