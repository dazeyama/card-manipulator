// No card is ever under a card stand (decision 222): whenever cards settle or a
// stand moves, any card on the table that lies even partly under a stand goes
// up onto its slope, above where it lay, keeping its pile (a stack the stand
// was set down on comes out on top of the slope as a stack). A group too big
// for the slope goes on the table in front of the stand instead.

import type { App } from './app';
import { inSpace, land, placeSequential } from './commands';
import { isStand, liftOntoSlope, STAND_D, STAND_W, underStand } from './state/stand';
import { CARD_H, CARD_W, type Card, type Mat } from './state/types';

/** A card can be under a stand only if its centre is this close to the stand's, mm. */
const REACH = Math.hypot(STAND_W, STAND_D) / 2 + Math.hypot(CARD_W, CARD_H) / 2;

export function installStandSnap(app: App): void {
  let queued = false;
  const run = () => {
    queued = false;
    const store = app.store;
    const stands = [...store.mats.values()].filter(isStand);
    if (!stands.length) return;
    const under = new Map<Mat, Card[]>();
    for (const c of store.cards.values()) {
      // Cards in the hand or still falling are left until they come to rest.
      if (c.stand || app.motion.held.has(c.uid)) continue;
      const m = stands.find((s) => Math.hypot(c.x - s.x, c.y - s.y) < REACH && underStand(s, c));
      if (!m) continue;
      if (!under.has(m)) under.set(m, []);
      under.get(m)!.push(c);
    }
    for (const [m, cards] of under) {
      // Bottom first, so piles keep their order on the slope.
      cards.sort((a, b) => a.z - b.z);
      const spots = cards.map((c) => ({ ...liftOntoSlope(m, c.x, c.y), yaw: c.yaw }));
      land(app, inSpace(m.uid, () => placeSequential(app, cards.map((c) => c.uid), spots)), { arc: 8 });
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    // Next frame: a landing still in flight just heads for the slope instead.
    requestAnimationFrame(run);
  };
  app.store.events.on('settled', queue);
  app.store.events.on('added', queue);
  app.store.events.on('mats', queue);
}
