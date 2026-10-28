// Table commands (spec 10.6, 10.7, 10.8): landing cards, Stack, Spread, Tidy,
// Rotate, Remove, Frame, and toggling a stack's spread.

import type { App } from './app';
import { CARD_H, CARD_T, CARD_W, type Card } from './state/types';
import { gridLayout, looseStackLayout, nextQuarterClockwise, overlaps, snapYaw, spreadLayout, uprightYaw, type Footprint, type Placed } from './state/piles';
import type { Spread } from './state/store';

export interface Landing {
  uid: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  faceUp?: boolean;
}

/** Two presses of R within this long stand the cards upright (decision 102), ms. */
export const DOUBLE_TAP_MS = 350;

/** Settle timing (spec 15.5: under 300 ms, snappy and light). */
const SETTLE_MS = 190;

/**
 * Move cards to their landing spots in the model and animate the drawn cards
 * there with a short settle. Emits `settled` so piles and autosave update.
 */
export function land(app: App, landings: Landing[], opts: { stagger?: number; duration?: number; arc?: number } = {}): void {
  if (!landings.length) return;
  app.store.moveCards(landings);
  const stagger = opts.stagger ?? Math.min(1.5, 200 / landings.length);
  landings.forEach((l, i) => {
    app.motion.held.delete(l.uid);
    const card = app.store.cards.get(l.uid);
    app.motion.animate(
      l.uid,
      { x: l.x, y: l.y, z: l.z, yaw: l.yaw, roll: (l.faceUp ?? card?.faceUp ?? true) ? 0 : Math.PI },
      { duration: opts.duration ?? SETTLE_MS, delay: i * stagger, arc: opts.arc ?? 0, bounce: 0.8 },
    );
  });
  app.store.events.emit('settled', landings.map((l) => l.uid));
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
  const surface: Placed[] = nearby(app, exclude, spots);
  return uids.map((uid, i) => {
    const s = spots[i];
    const z = topOf(surface, s) + CARD_T / 2;
    const placed = { x: s.x, y: s.y, yaw: s.yaw, z };
    surface.push(placed);
    return { uid, ...placed };
  });
}

/** A neat stack at a spot, bottom card first, on top of whatever is there. */
export function stackAt(app: App, uids: string[], at: Footprint, exclude = new Set(uids)): Landing[] {
  const base = topOf(nearby(app, exclude, [at]), at);
  return uids.map((uid, i) => ({ uid, x: at.x, y: at.y, yaw: at.yaw, z: base + CARD_T / 2 + i * CARD_T }));
}

/**
 * Cards gathered onto one spot: a loose, hand-made stack, or a neat one at a
 * quarter turn in Tidy mode (decisions 94, 98). Only Tidy squares a loose stack up.
 */
export function pileAt(app: App, uids: string[], at: Footprint, exclude = new Set(uids)): Landing[] {
  if (app.store.settings.tidyDrops) return stackAt(app, uids, { ...at, yaw: snapYaw(at.yaw) }, exclude);
  return placeSequential(app, uids, looseStackLayout(uids.length, at), exclude);
}

/** Selected cards ordered bottom to top. */
export function byHeight(app: App, uids: Iterable<string>): string[] {
  return [...uids].map((u) => app.store.cards.get(u)!).filter(Boolean).sort((a, b) => a.z - b.z).map((c) => c.uid);
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
  const set = new Set(uids);
  for (const sp of [...app.store.spreads.values()]) {
    const before = sp.uids.length;
    sp.uids = sp.uids.filter((u) => !set.has(u));
    if (sp.uids.length !== before) {
      for (const u of set) {
        const c = app.store.cards.get(u);
        if (c?.spreadOf === sp.id) c.spreadOf = null;
      }
      if (!sp.uids.length) app.store.spreads.delete(sp.id);
    }
  }
  app.store.events.emit('piles', undefined);
}

export class Commands {
  constructor(private readonly app: App) {}

  private get sel(): string[] {
    return [...this.app.store.selection];
  }

  /** S: gather the selection into one stack at its centroid, loose unless Tidy mode is on. */
  stack(cards: string[] = this.sel): void {
    const uids = byHeight(this.app, cards);
    if (uids.length < 1) return;
    leaveSpreads(this.app, uids);
    const c = centroid(this.app, uids);
    land(this.app, pileAt(this.app, uids, { x: c.x, y: c.y, yaw: 0 }));
  }

  /** X: spread the selection in a grid at its centroid. A selection that is exactly one stack spreads beside it instead. */
  spread(cards: string[] = this.sel): void {
    const uids = cards;
    if (!uids.length) return;
    const pile = this.app.store.pileOf(uids[0]);
    if (pile && pile.cardUids.length === uids.length && uids.every((u) => this.app.store.pileOf(u) === pile)) {
      this.toggleSpread(uids[0]);
      return;
    }
    const ordered = byHeight(this.app, uids).reverse();
    leaveSpreads(this.app, ordered);
    const grid = gridLayout(ordered.length, centroid(this.app, ordered));
    land(this.app, placeSequential(this.app, ordered, grid));
  }

  /** T: square up each pile the selection touches, without merging piles. Loose cards snap to a quarter turn. */
  tidy(cards: string[] = this.sel): void {
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
        landings.push(...stackAt(this.app, pile.cardUids, at, new Set(pile.cardUids)));
      } else {
        done.add(u);
        const c = store.cards.get(u)!;
        landings.push({ uid: u, x: c.x, y: c.y, z: c.z, yaw: snapYaw(c.yaw) });
      }
    }
    land(this.app, landings);
  }

  /**
   * R: turn each card to the next quarter turn clockwise, so it also squares
   * up a card at an odd angle; `upright` (R twice quickly) stands them upright (decision 102).
   */
  rotate(uids: string[] = this.sel, upright = false): void {
    if (!uids.length) return;
    const landings = uids.map((u) => {
      const c = this.app.store.cards.get(u)!;
      return { uid: u, x: c.x, y: c.y, z: c.z, yaw: upright ? uprightYaw(c.yaw) : nextQuarterClockwise(c.yaw) };
    });
    land(this.app, landings, { stagger: 0 });
  }

  /**
   * F, middle-click: flip cards over with a physical turn, rising and turning
   * about the long axis; a selection flips in a quick cascade (spec 10.5, 15.5).
   */
  flip(uids: string[] = this.sel, shortest = false): void {
    const store = this.app.store;
    const cards = uids.map((u) => store.cards.get(u)!).filter(Boolean).sort((a, b) => b.z - a.z);
    if (!cards.length) return;
    const step = Math.min(10, 600 / cards.length);
    store.moveCards(cards.map((c) => ({ uid: c.uid, faceUp: !c.faceUp })));
    cards.forEach((c, i) => {
      const pose = this.app.layer.pose(c.uid);
      if (!pose) return;
      // Turn to the new side: always the same way round, or the short way when
      // facing cards up mid-turn (decision 105). The roll is tidied to 0 or PI afterwards.
      const side = c.faceUp ? 0 : Math.PI;
      const turns = (pose.roll - side) / (2 * Math.PI);
      const target = side + 2 * Math.PI * (shortest ? Math.round(turns) : Math.ceil(turns + 1e-4));
      this.app.motion.animate(c.uid, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, roll: target }, {
        duration: 350,
        delay: i * step,
        arc: 24,
        ease: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
        done: () => {
          const p = this.app.layer.pose(c.uid);
          if (p && !this.app.motion.isAnimating(c.uid)) {
            p.roll = c.faceUp ? 0 : Math.PI;
            this.app.layer.touch(c.uid);
          }
        },
      });
    });
    store.events.emit('settled', cards.map((c) => c.uid));
  }

  /** F twice quickly (decision 105): every card faces up; only the face-down ones turn. */
  faceUp(uids: string[] = this.sel): void {
    this.flip(uids.filter((u) => this.app.store.cards.get(u)?.faceUp === false), true);
  }

  /** Z: move the camera to fit the selection (or the whole table). */
  frame(): void {
    const store = this.app.store;
    const uids = store.selection.size ? this.sel : [...store.cards.keys()];
    if (!uids.length) {
      this.app.rig.reset();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, top = 0;
    for (const u of uids) {
      const c = store.cards.get(u)!;
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
    store.spreads.set(spread.id, spread);
    for (const u of topFirst) store.cards.get(u)!.spreadOf = spread.id;
    const spots = spreadLayout(topFirst.length, spread.anchor);
    land(this.app, placeSequential(this.app, topFirst, spots), { stagger: Math.min(4, 300 / topFirst.length), arc: 6 });
  }

  /** Put a spread back into a (loose) stack at its anchor, in the same order. */
  restack(spreadId: string): void {
    const store = this.app.store;
    const sp = store.spreads.get(spreadId);
    if (!sp) return;
    const uids = sp.uids.filter((u) => store.cards.get(u)?.spreadOf === spreadId);
    store.spreads.delete(spreadId);
    for (const u of uids) store.cards.get(u)!.spreadOf = null;
    const bottomFirst = [...uids].reverse();
    land(this.app, pileAt(this.app, bottomFirst, { x: sp.anchor.x, y: sp.anchor.y, yaw: sp.yaw }), { stagger: Math.min(4, 300 / Math.max(1, uids.length)), arc: 6 });
  }
}
