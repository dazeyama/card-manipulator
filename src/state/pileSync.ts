// Keeps the store's piles in step with card positions: detection runs once
// after cards settle, never every frame (spec 11.1). Named piles (11.3) are
// authoritative: a card's pileId says which named pile it belongs to, and
// that pile keeps its identity as cards come and go, while it is spread, and
// as an empty outline when every card has left.

import { detectPiles } from './piles';
import type { Store } from './store';
import type { Pile } from './types';
import { remoteHeld } from './remoteHeld';

export function redetect(store: Store, moved: Set<string> = new Set()): void {
  const named = new Set(store.named.keys());
  // Cards of a spread named pile stay members while spread (spec 11.3).
  const spreadMember = new Map<string, string>();
  for (const sp of store.spreads.values()) {
    if (sp.pileId && named.has(sp.pileId)) for (const u of sp.uids) spreadMember.set(u, sp.pileId);
  }
  const prev = new Map<string, string[]>();
  // Cards on each card stand, and on the table, form piles apart (decision 221):
  // a stand's cards are laid out in its slope's own frame.
  const spaces = new Map<string, { uid: string; x: number; y: number; z: number; yaw: number }[]>();
  // Cards in another player's hand are off the table until they land (ONLINE.md 8.4); they keep their named pile.
  const away = new Map<string, string | null>();
  for (const c of store.cards.values()) {
    if (remoteHeld.has(c.uid)) {
      away.set(c.uid, c.pileId);
      continue;
    }
    if (spreadMember.has(c.uid)) continue;
    const key = c.stand ?? '';
    let cards = spaces.get(key);
    if (!cards) spaces.set(key, (cards = []));
    cards.push({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw });
    if (c.pileId) {
      let list = prev.get(c.pileId);
      if (!list) prev.set(c.pileId, (list = []));
      list.push(c.uid);
    }
  }
  const found = [...spaces.values()].flatMap((cards) => detectPiles(cards, prev, undefined, { named, moved }));
  const piles = new Map<string, Pile>();
  for (const d of found) {
    const n = store.named.get(d.id);
    piles.set(d.id, { id: d.id, name: n?.name ?? null, kind: d.kind, anchor: d.anchor, cardUids: d.cardUids, filter: n?.filter ?? null });
    if (n) {
      n.anchor = { ...d.anchor };
      n.yaw = d.yaw;
    }
    for (const lost of d.merged) {
      const loser = store.named.get(lost);
      if (loser && n) store.events.emit('notice', `${loser.name} merged into ${n.name}; ${n.name} keeps its name`);
      store.named.delete(lost);
    }
  }
  store.setPiles(piles);
  for (const [uid, id] of spreadMember) {
    const c = store.cards.get(uid);
    if (c) c.pileId = id;
  }
  for (const [uid, id] of away) {
    const c = store.cards.get(uid);
    if (c && id && named.has(id)) c.pileId = id;
  }
}

/**
 * Run detection on the next frame after any settle, coalescing bursts. `after`
 * runs once each detection is done: filtered named piles turn away cards then
 * (decision 322).
 */
export function installPileSync(store: Store, after: () => void = () => {}): { flush: () => void; lastMs: () => number } {
  let queued = false;
  let last = 0;
  let moved = new Set<string>();
  const run = () => {
    queued = false;
    const t0 = performance.now();
    const m = moved;
    moved = new Set();
    redetect(store, m);
    last = performance.now() - t0;
    after();
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  store.events.on('settled', (uids) => {
    for (const u of uids) moved.add(u);
    queue();
  });
  store.events.on('removed', queue);
  store.events.on('added', queue);
  store.events.on('reset', queue);
  return { flush: run, lastMs: () => last };
}
