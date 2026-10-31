// No card is ever under a card stand (decision 222): whenever cards settle or a
// stand moves, any card on the table that lies even partly under a stand goes
// up onto its slope, above where it lay, keeping its pile (a stack the stand
// was set down on comes out on top of the slope as a stack). A group too big
// for the slope goes on the table in front of the stand instead.

import type { App } from './app';
import { inSpace, land, placeSequential } from './commands';
import { standWhyNot } from './online/guard';
import { inFrontOf, isStand, liftOntoSlope, STAND_D, STAND_W, underStand } from './state/stand';
import { CARD_H, CARD_W, type Card, type Mat } from './state/types';

/** A card can be under a stand only if its centre is this close to the stand's, mm. */
const REACH = Math.hypot(STAND_W, STAND_D) / 2 + Math.hypot(CARD_W, CARD_H) / 2;

export function installStandSnap(app: App): void {
  let queued = false;
  // In a room, the browser whose change put a card under a stand lifts it, and
  // its lift goes to the room like any move; changes from the room are left alone,
  // or every browser would send the same lift (ONLINE.md 11.1).
  let local = false;
  const run = () => {
    queued = false;
    if (!local) return;
    local = false;
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
      // In a room, a stand you may not touch takes no cards: they go on the table in front of it instead (6.3).
      if (standWhyNot(m)) {
        const front = inFrontOf(m, cards.map((c) => ({ x: c.x, y: c.y, yaw: c.yaw })));
        land(app, inSpace(null, () => placeSequential(app, cards.map((c) => c.uid), front)), { arc: 8, keepSide: true });
        continue;
      }
      const spots = cards.map((c) => ({ ...liftOntoSlope(m, c.x, c.y), yaw: c.yaw }));
      land(app, inSpace(m.uid, () => placeSequential(app, cards.map((c) => c.uid), spots)), { arc: 8, keepSide: true });
    }
  };
  const queue = () => {
    if (app.store.origin === 'local') local = true;
    if (queued) return;
    queued = true;
    // Next frame: a landing still in flight just heads for the slope instead.
    requestAnimationFrame(run);
  };
  app.store.events.on('settled', queue);
  app.store.events.on('added', queue);
  app.store.events.on('mats', queue);
}
