// Keeps the store's piles in step with card positions: detection runs once
// after cards settle, never every frame (spec 11.1).

import { detectPiles } from './piles';
import type { Store } from './store';
import type { Pile } from './types';

export function redetect(store: Store): void {
  const cards = [...store.cards.values()].map((c) => ({ uid: c.uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw }));
  const prev = new Map<string, string[]>();
  for (const p of store.piles.values()) prev.set(p.id, p.cardUids);
  const found = detectPiles(cards, prev);
  const piles = new Map<string, Pile>();
  for (const d of found) {
    const old = store.piles.get(d.id);
    piles.set(d.id, { id: d.id, name: old?.name ?? null, kind: d.kind, anchor: d.anchor, cardUids: d.cardUids, filter: old?.filter ?? null });
  }
  store.setPiles(piles);
}

/** Run detection on the next frame after any settle, coalescing bursts. */
export function installPileSync(store: Store): { flush: () => void; lastMs: () => number } {
  let queued = false;
  let last = 0;
  const run = () => {
    queued = false;
    const t0 = performance.now();
    redetect(store);
    last = performance.now() - t0;
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  store.events.on('settled', queue);
  store.events.on('removed', queue);
  store.events.on('added', queue);
  store.events.on('reset', queue);
  return { flush: run, lastMs: () => last };
}
