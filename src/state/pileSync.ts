// Keeps the store's piles in step with card positions: detection runs once
// after cards settle, never every frame (spec 11.1). Named piles (11.3) are
// authoritative: a card's pileId says which named pile it belongs to, and
// that pile keeps its identity as cards come and go, while it is spread, and
// as an empty outline when every card has left.

import { detectPiles } from './piles';
import type { Store } from './store';
import type { Pile } from './types';

export function redetect(store: Store, moved: Set<string> = new Set()): void {
  const named = new Set(store.named.keys());
  // Cards of a spread named pile stay members while spread (spec 11.3).
  const spreadMember = new Map<string, string>();
  for (const sp of store.spreads.values()) {
    if (sp.pileId && named.has(sp.pileId)) for (const u of sp.uids) spreadMember.set(u, sp.pileId);
  }
  const prev = new Map<string, string[]>();
  const cards = [];
  for (const c of store.cards.values()) {
    if (spreadMember.has(c.uid)) continue;
    cards.push({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw });
    if (c.pileId) {
      let list = prev.get(c.pileId);
      if (!list) prev.set(c.pileId, (list = []));
      list.push(c.uid);
    }
  }
  const found = detectPiles(cards, prev, undefined, { named, moved });
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
}

/** Run detection on the next frame after any settle, coalescing bursts. */
export function installPileSync(store: Store): { flush: () => void; lastMs: () => number } {
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
