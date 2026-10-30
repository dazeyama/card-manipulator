// Keeps every card's drawn pose resting on what is under it (decisions 99,
// 100). The model keeps flat heights for ordering and pile detection; after
// piles are detected, the cards that moved, and every card above them in the
// same pile, rest again from the bottom up, as low as they can go. Physics
// carries cards while they fly and tumble; this lays them to rest, and lets
// what lay on a lifted card fall at once. A landing in flight is retargeted;
// a card at rest drops into place briefly.

import type { App } from '../app';
import { overlaps } from '../state/piles';
import { capRest, laidFlat, restOn, type Rest, type Resting } from '../state/rest';
import { isStand, STAND_D, STAND_W, standSupports, standTopUnder } from '../state/stand';
import { CARD_H, CARD_T, CARD_W, type Card, type Mat, type Pile } from '../state/types';

/** A card stand can be under a card whose centre is this close to the stand's, mm. */
const STAND_REACH = Math.hypot(STAND_W, STAND_D) / 2 + Math.hypot(CARD_W, CARD_H) / 2;

/** A card rests on at most this many of the cards under it, nearest first. */
const MAX_SUPPORTS = 20;
/** How long a card at rest takes to tip into its new rest, ms. */
const SETTLE_MS = 140;

interface Seen {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pile: string | null;
}

export class RestSync {
  /** Cards that do not lie flat at their model height: their drawn rest. */
  private readonly rests = new Map<string, Rest>();
  /** Where each card was the last time rests were worked out. */
  private seen = new Map<string, Seen>();
  /** Cards that settled since then (a flip or turn may not move them). */
  private readonly dirty = new Set<string>();
  /** Time the last update took, ms. */
  lastMs = 0;

  constructor(private readonly app: App) {
    const events = app.store.events;
    events.on('settled', (uids) => {
      for (const u of uids) this.dirty.add(u);
    });
    events.on('piles', () => this.update());
    events.on('reset', () => {
      this.rests.clear();
      this.seen.clear();
    });
    // A card stand moved, turned, came or went (decision 220): the cards where it
    // was and where it is now rest again, onto it or down to the table.
    events.on('mats', () => {
      const now = [...app.store.mats.values()].filter(isStand).map((m) => ({ ...m }));
      const moved = [...now, ...this.stands].filter((m) => {
        const was = this.stands.find((o) => o.uid === m.uid);
        const is = now.find((o) => o.uid === m.uid);
        return !was || !is || was.x !== is.x || was.y !== is.y || was.yaw !== is.yaw;
      });
      this.stands = now;
      if (!moved.length) return;
      for (const c of app.store.cards.values()) {
        if (moved.some((m) => Math.hypot(c.x - m.x, c.y - m.y) < STAND_REACH)) this.dirty.add(c.uid);
      }
      this.update();
    });
  }

  /** The card stands as last seen, to tell which moved. */
  private stands: Mat[] = [];

  /** The card stands a card lies over (decision 220). */
  private standsUnder(c: Card): Mat[] {
    const out: Mat[] = [];
    for (const m of this.app.store.mats.values()) {
      if (!isStand(m) || Math.hypot(c.x - m.x, c.y - m.y) > STAND_REACH) continue;
      if (standTopUnder(m, c, CARD_W / 2, CARD_H / 2) > 0) out.push(m);
    }
    return out;
  }

  /** Cards were lifted off the table (a drag began): what rested on them falls now (decision 100). */
  lifted(uids: string[]): void {
    const store = this.app.store;
    const lowest = new Map<string, number>();
    for (const uid of uids) {
      const c = store.cards.get(uid);
      const pile = store.pileOf(uid);
      if (c && pile) lowest.set(pile.id, Math.min(lowest.get(pile.id) ?? Infinity, c.z));
    }
    for (const [id, z] of lowest) {
      const pile = store.piles.get(id);
      if (pile) this.restPile(pile, z);
    }
  }

  /** The drawn rest of a card, or null when it lies flat at its model height. */
  restOf(uid: string): Rest | null {
    return this.rests.get(uid) ?? null;
  }

  /** Work out rests again wherever cards changed since last time. */
  update(): void {
    const t0 = performance.now();
    const store = this.app.store;
    // Per pile, the lowest model height from which cards must rest again.
    const from = new Map<string, number>();
    const lower = (pile: string | null | undefined, z: number) => {
      if (!pile) return;
      from.set(pile, Math.min(from.get(pile) ?? Infinity, z));
    };
    const pileOf = new Map<string, string>();
    for (const p of store.piles.values()) for (const u of p.cardUids) pileOf.set(u, p.id);

    const loose: string[] = [];
    for (const [uid, old] of this.seen) {
      const c = store.cards.get(uid);
      const now = pileOf.get(uid) ?? null;
      if (!c) {
        // Gone: the cards that rested on it may fall.
        lower(old.pile, old.z);
        continue;
      }
      if (c.x !== old.x || c.y !== old.y || c.z !== old.z || c.yaw !== old.yaw || now !== old.pile) {
        lower(old.pile, old.z);
        lower(now, c.z);
        if (!now) loose.push(uid);
      }
    }
    for (const c of store.cards.values()) {
      const now = pileOf.get(c.uid) ?? null;
      if (!this.seen.has(c.uid) || this.dirty.has(c.uid)) {
        lower(now, c.z);
        if (!now) loose.push(c.uid);
      }
    }
    this.dirty.clear();

    for (const [id, z] of from) {
      const pile = store.piles.get(id);
      if (pile) this.restPile(pile, z);
    }
    // A card on its own lies flat on the table, or on the slope of a card stand under it.
    for (const uid of loose) {
      const c = store.cards.get(uid);
      const stands = c ? this.standsUnder(c) : [];
      this.apply(uid, c && stands.length ? restOn(c, stands.flatMap(standSupports)) : null);
    }

    const seen = new Map<string, Seen>();
    for (const c of store.cards.values()) seen.set(c.uid, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pile: pileOf.get(c.uid) ?? null });
    this.seen = seen;
    this.lastMs = performance.now() - t0;
  }

  /** Rest a pile's cards from model height `fromZ` up, on the ones below them. */
  private restPile(pile: Pile, fromZ: number): void {
    const store = this.app.store;
    const cards = pile.cardUids.map((u) => store.cards.get(u)!).filter(Boolean).sort((a, b) => a.z - b.z);
    const stands = new Map(cards.map((c) => [c.uid, this.standsUnder(c)]));
    const onStand = cards.some((c) => stands.get(c.uid)!.length);
    // A neat stack lies flat, one card on the next, unless it is on a card stand.
    if (pile.kind === 'stack' && !onStand) {
      for (const c of cards) if (c.z >= fromZ - 1e-6) this.apply(c.uid, null);
      return;
    }
    const held = this.app.motion.held;
    const resting: Resting[] = cards.map((c) => {
      const r = this.rests.get(c.uid);
      return { x: c.x, y: c.y, yaw: c.yaw, z: r?.z ?? c.z, tiltX: r?.tiltX ?? 0, tiltY: r?.tiltY ?? 0 };
    });
    for (let k = 0; k < cards.length; k++) {
      const c = cards[k];
      if (c.z < fromZ - 1e-6) continue;
      const under = stands.get(c.uid)!;
      // Laid out by an X spread and not moved since: flat at its model height (decision 160).
      if (laidFlat(c) && !under.length) {
        resting[k] = { x: c.x, y: c.y, yaw: c.yaw, z: c.z, tiltX: 0, tiltY: 0 };
        this.apply(c.uid, null);
        continue;
      }
      const supports: Resting[] = [];
      for (let j = k - 1; j >= 0 && supports.length < MAX_SUPPORTS; j--) {
        if (held.has(cards[j].uid)) continue;
        if (overlaps(resting[j], resting[k])) supports.push(resting[j]);
      }
      // A card stand under it is a support too (decision 220).
      for (const m of under) supports.push(...standSupports(m));
      // Never far above its stacked height, so a deep pile can't grow into a tower (decision 194);
      // on a card stand, its stacked height is above the stand's top under it.
      const raise = under.length ? Math.max(...under.map((m) => standTopUnder(m, c, CARD_W / 2, CARD_H / 2))) : 0;
      const rest = capRest(restOn(c, supports), c.z + raise);
      resting[k] = { x: c.x, y: c.y, yaw: c.yaw, ...rest };
      const flat = Math.abs(rest.z - c.z) < 0.01 && Math.abs(rest.tiltX) < 1e-4 && Math.abs(rest.tiltY) < 1e-4;
      this.apply(c.uid, flat ? null : rest);
    }
  }

  /** Record a card's rest and move its drawn pose there. */
  private apply(uid: string, rest: Rest | null): void {
    const app = this.app;
    const c = app.store.cards.get(uid);
    if (!c) return;
    if (rest) this.rests.set(uid, rest);
    else this.rests.delete(uid);
    if (app.motion.held.has(uid)) return;
    const to = { z: rest?.z ?? c.z, tiltX: rest?.tiltX ?? 0, tiltY: rest?.tiltY ?? 0 };
    if (app.motion.isAnimating(uid)) {
      // A landing in flight ends at the rest instead.
      app.motion.retarget(uid, to);
      return;
    }
    const pose = app.layer.pose(uid);
    if (!pose) return;
    if (Math.abs(pose.z - to.z) < 0.01 && Math.abs(pose.tiltX - to.tiltX) < 1e-4 && Math.abs(pose.tiltY - to.tiltY) < 1e-4) return;
    app.motion.animate(uid, { x: c.x, y: c.y, yaw: c.yaw, roll: c.faceUp ? 0 : Math.PI, ...to }, { duration: SETTLE_MS });
  }
}

/** The highest point of a resting card above the table (for colliders and lift). */
export function restingTop(z: number, tiltX: number, tiltY: number, halfDiag: number): number {
  return z + CARD_T / 2 + (Math.abs(Math.sin(tiltX)) + Math.abs(Math.sin(tiltY))) * halfDiag;
}
