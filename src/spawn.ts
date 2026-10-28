// Creating cards on the table (spec 12): layout at the spawn point and the
// short "dealt onto the table" animation.

import type { App } from './app';
import { newUid } from './state/store';
import { messyLayout, stackLayout, surfaceTop } from './state/piles';
import type { Arrival, Card, CardRecord, Finish } from './state/types';
import { easeOut } from './physics/motion';
import { MAX_BODIES, MAX_DROP } from './physics/world';

export interface SpawnItem {
  record: CardRecord;
  finish: Finish;
  count: number;
}

export interface SpawnOptions {
  arrival: Arrival;
  faceUp: boolean;
  where: 'cursor' | 'center';
  /** Explicit spot, overriding `where`. */
  at?: { x: number; y: number };
}

const DROP_HEIGHT = 70;

/** Spawn every copy of every item as one pile. Returns the new card uids, bottom to top. */
export function spawnCards(app: App, items: SpawnItem[], opts: SpawnOptions): string[] {
  const records = items.map((i) => i.record);
  app.store.addRecords(records.filter((r) => !app.store.records.has(r.id)));
  const flat: { record: CardRecord; finish: Finish }[] = [];
  for (const item of items) for (let i = 0; i < item.count; i++) flat.push({ record: item.record, finish: item.finish });
  if (!flat.length) return [];

  const spot = opts.at ?? (opts.where === 'cursor' ? app.lastTablePoint : { x: app.rig.target.x, y: app.rig.target.y });
  const at = { x: spot.x, y: spot.y, yaw: 0 };
  const base = surfaceTop(app.store.cards.values(), at);
  const places = opts.arrival === 'stack' ? stackLayout(flat.length, at, base) : messyLayout(flat.length, at, base);

  const cards: Card[] = flat.map((f, i) => ({
    uid: newUid(),
    scryfallId: f.record.id,
    finish: f.finish,
    x: places[i].x,
    y: places[i].y,
    z: places[i].z,
    yaw: places[i].yaw,
    faceUp: opts.faceUp,
    pileId: null,
    spreadOf: null,
  }));
  app.store.addCards(cards);

  // A messy handful falls through the physics world when it is small enough (spec 15.1).
  const physics = app.physics;
  if (opts.arrival === 'messy' && physics && cards.length <= MAX_DROP && physics.bodyCount + cards.length <= MAX_BODIES) {
    cards.forEach((c, i) => {
      app.layer.setPose(c.uid, { x: c.x, y: c.y, z: base + 20 + i * 2.4, yaw: c.yaw, roll: c.faceUp ? 0 : Math.PI, tiltX: (Math.random() - 0.5) * 0.3, tiltY: (Math.random() - 0.5) * 0.3 });
    });
    const ok = physics.drop(cards.map((c) => ({
      uid: c.uid,
      vx: (Math.random() - 0.5) * 160,
      vy: (Math.random() - 0.5) * 160,
      vz: -200,
      wx: (Math.random() - 0.5) * 2,
      wy: (Math.random() - 0.5) * 2,
      wz: (Math.random() - 0.5) * 3,
    })));
    if (ok) return cards.map((c) => c.uid);
  }

  // Deal: each card starts above its spot and drops in, bottom card first.
  const step = Math.min(3, 600 / cards.length);
  cards.forEach((c, i) => {
    app.layer.setPose(c.uid, { z: c.z + DROP_HEIGHT, yaw: c.yaw + (i % 2 ? 0.08 : -0.08) });
    app.motion.animate(c.uid, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, roll: c.faceUp ? 0 : Math.PI }, { duration: 220, delay: i * step, ease: easeOut });
  });
  app.store.events.emit('settled', cards.map((c) => c.uid));
  return cards.map((c) => c.uid);
}
