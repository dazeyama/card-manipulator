// The Rapier world (spec 15.1–15.3). Only loose cards have bodies: cards that
// were just dropped, tossed or spawned in a handful. Settled cards are
// authored by the model; when a drop starts, the piles it can land on become
// static colliders (a whole stack is one box, decision in spec 15.3), and the
// table is a static ground. When every loose card sleeps, or after a short
// time limit, the cards are snapped flat and handed back to the model.
//
// The simulation runs in metres (Rapier's tuning assumes them); the model is
// in millimetres.

import type RAPIER_NS from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { App } from '../app';
import { land, placeSequential } from '../commands';
import { snapYaw } from '../state/piles';
import { CARD_H, CARD_T, CARD_W } from '../state/types';
import type { Pose } from '../render/cards';

// Rapier (with its WASM inlined) is loaded on demand so the table shows first.
let RAPIER: typeof RAPIER_NS;

const MM = 0.001;
/** The physics card is 2 mm thick while the drawn card stays 0.3 mm (spec 15.3). */
const BODY_HALF_T = 1;
/** Offset from the body centre to the drawn card's centre, along the card's own z. */
const VISUAL_OFFSET = BODY_HALF_T - CARD_T / 2;
const STEP = 1 / 120;
/** Settle must finish fast (spec 15.5); a drop is cut off after this. */
const MAX_MS = 420;
/** Spec 17: under 200 dynamic bodies at any moment. */
export const MAX_BODIES = 180;
/**
 * The most cards one drop simulates. Measured on the target machine, a
 * 60-card drop steps in about 5 ms and a 150-card tower in about 9 ms with
 * 40 ms spikes, so bigger drops land by layout instead to keep frames smooth.
 */
export const MAX_DROP = 80;
/** A loose pile of at least this many cards collides as one box. */
const BOX_PILE = 12;

export interface LooseCard {
  uid: string;
  /** Linear velocity, mm/s. */
  vx?: number;
  vy?: number;
  vz?: number;
  /** Angular velocity, rad/s, world axes. */
  wx?: number;
  wy?: number;
  wz?: number;
}

interface Session {
  bodies: { uid: string; body: RAPIER_NS.RigidBody }[];
  statics: RAPIER_NS.Collider[];
  started: number;
  done: (uids: string[]) => void;
}

export class Physics {
  private world: RAPIER_NS.World | null = null;
  private readonly sessions: Session[] = [];
  private accumulator = 0;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly v = new THREE.Vector3();

  constructor(private readonly app: App) {
    app.onFrame((now, dt) => this.step(now, dt));
  }

  async init(): Promise<void> {
    RAPIER = (await import('@dimforge/rapier3d-compat')).default;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = STEP;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(500, 500, 0.5).setTranslation(0, 0, -0.5).setFriction(0.7));
  }

  get ready(): boolean {
    return this.world !== null;
  }

  /** Dynamic bodies right now (spec 17). */
  get bodyCount(): number {
    return this.sessions.reduce((n, s) => n + s.bodies.length, 0);
  }

  /**
   * Let cards fall from where they are drawn. When they come to rest they are
   * snapped flat, stacked by the model and `done` is called with their uids.
   * Returns false (and does nothing) if physics isn't ready or the drop is too big.
   */
  drop(cards: LooseCard[], done: (uids: string[]) => void = () => {}, opts: { ccd?: boolean } = {}): boolean {
    const world = this.world;
    if (!world || !cards.length || cards.length > MAX_DROP || this.bodyCount + cards.length > MAX_BODIES) return false;
    const app = this.app;
    const loose = new Set(cards.map((c) => c.uid));
    const session: Session = { bodies: [], statics: [], started: performance.now(), done };

    // Static colliders for what the cards can land on.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      const p = app.layer.pose(c.uid)!;
      const reach = 160 + Math.hypot(c.vx ?? 0, c.vy ?? 0) * 0.4;
      minX = Math.min(minX, p.x - reach);
      maxX = Math.max(maxX, p.x + reach);
      minY = Math.min(minY, p.y - reach);
      maxY = Math.max(maxY, p.y + reach);
    }
    const doneCards = new Set<string>();
    for (const pile of app.store.piles.values()) {
      // A stack is one box; so is a big loose pile (decision 94), shaped like
      // its top card, so a loose cube doesn't become a thousand colliders.
      if (pile.kind !== 'stack' && pile.cardUids.length < BOX_PILE) continue;
      const bottom = app.store.cards.get(pile.cardUids[0]);
      if (!bottom || pile.cardUids.some((u) => loose.has(u))) continue;
      const topCard = app.store.cards.get(pile.cardUids[pile.cardUids.length - 1])!;
      const base = pile.kind === 'stack' ? bottom : topCard;
      if (base.x < minX || base.x > maxX || base.y < minY || base.y > maxY) continue;
      const top = topCard.z + CARD_T / 2;
      session.statics.push(this.staticBox(base.x, base.y, top / 2, base.yaw, top / 2));
      pile.cardUids.forEach((u) => doneCards.add(u));
    }
    for (const c of app.store.cards.values()) {
      if (loose.has(c.uid) || doneCards.has(c.uid)) continue;
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      const top = c.z + CARD_T / 2;
      session.statics.push(this.staticBox(c.x, c.y, top - BODY_HALF_T, c.yaw, BODY_HALF_T));
    }

    // A dynamic body for every loose card, at its drawn pose.
    for (const c of cards) {
      const pose = app.layer.pose(c.uid)!;
      this.e.set(pose.tiltX, pose.roll + pose.tiltY, pose.yaw, 'ZXY');
      this.q.setFromEuler(this.e);
      this.v.set(0, 0, VISUAL_OFFSET).applyQuaternion(this.q);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation((pose.x + this.v.x) * MM, (pose.y + this.v.y) * MM, (pose.z + this.v.z) * MM)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
        .setLinvel((c.vx ?? 0) * MM, (c.vy ?? 0) * MM, (c.vz ?? 0) * MM)
        .setAngvel({ x: c.wx ?? 0, y: c.wy ?? 0, z: c.wz ?? 0 })
        .setLinearDamping(1.2)
        .setAngularDamping(2.5)
        .setCcdEnabled(opts.ccd ?? false)
        .setCanSleep(true);
      const body = world.createRigidBody(desc);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid((CARD_W / 2) * MM, (CARD_H / 2) * MM, BODY_HALF_T * MM).setFriction(0.55).setRestitution(0.04).setDensity(700),
        body,
      );
      session.bodies.push({ uid: c.uid, body });
      app.motion.cancel(c.uid);
      app.motion.held.add(c.uid);
    }
    this.sessions.push(session);
    return true;
  }

  private staticBox(x: number, y: number, z: number, yaw: number, halfZ: number): RAPIER_NS.Collider {
    this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
    return this.world!.createCollider(
      RAPIER.ColliderDesc.cuboid((CARD_W / 2) * MM, (CARD_H / 2) * MM, Math.max(0.05, halfZ) * MM)
        .setTranslation(x * MM, y * MM, z * MM)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
        .setFriction(0.6),
    );
  }

  private step(now: number, dt: number): void {
    const world = this.world;
    if (!world || !this.sessions.length) return;
    // At most two steps a frame: a slow frame slows the drop rather than snowballing.
    this.accumulator = Math.min(this.accumulator + dt, 2 * STEP);
    while (this.accumulator >= STEP) {
      world.step();
      this.accumulator -= STEP;
    }
    const layer = this.app.layer;
    for (const s of [...this.sessions]) {
      let allAsleep = true;
      for (const { uid, body } of s.bodies) {
        const pose = layer.pose(uid);
        if (!pose) continue;
        this.writePose(body, pose);
        layer.touch(uid);
        if (!body.isSleeping()) {
          const lv = body.linvel();
          const av = body.angvel();
          if (Math.hypot(lv.x, lv.y, lv.z) > 0.02 || Math.hypot(av.x, av.y, av.z) > 0.6) allAsleep = false;
        }
      }
      // Never let a card fall forever: anything below the table is caught.
      if (allAsleep || now - s.started > MAX_MS) this.settle(s);
    }
  }

  /** Copy a body's transform to the drawn pose. */
  private writePose(body: RAPIER_NS.RigidBody, pose: Pose): void {
    const t = body.translation();
    const r = body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(0, 0, -VISUAL_OFFSET).applyQuaternion(this.q);
    pose.x = t.x / MM + this.v.x;
    pose.y = t.y / MM + this.v.y;
    pose.z = Math.max(CARD_T / 2, t.z / MM + this.v.z);
    this.e.setFromQuaternion(this.q, 'ZXY');
    pose.tiltX = this.e.x;
    pose.roll = this.e.y;
    pose.tiltY = 0;
    pose.yaw = this.e.z;
  }

  /** Snap a finished drop flat and give it back to the model. */
  private settle(s: Session): void {
    const world = this.world!;
    this.sessions.splice(this.sessions.indexOf(s), 1);
    const results = s.bodies.map(({ uid, body }) => {
      const r = body.rotation();
      this.q.set(r.x, r.y, r.z, r.w);
      const up = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
      const faceUp = up.z >= 0;
      // Face down is a half turn about the long axis, which flips the card's x axis.
      const turned = Math.atan2(ax.y, ax.x) + (faceUp ? 0 : Math.PI);
      // Tidy mode (decision 98): even a tossed card comes to rest at a quarter turn.
      const yaw = this.app.store.settings.tidyDrops ? snapYaw(turned) : turned;
      const t = body.translation();
      return { uid, x: t.x / MM, y: t.y / MM, z: t.z / MM, yaw, faceUp };
    });
    for (const { body } of s.bodies) world.removeRigidBody(body);
    for (const c of s.statics) world.removeCollider(c, false);

    const app = this.app;
    const live = results.filter((r) => app.store.cards.has(r.uid));
    // Lowest first, so the model stacks them the way they came to rest.
    live.sort((a, b) => a.z - b.z);
    const landings = placeSequential(app, live.map((r) => r.uid), live.map((r) => ({ x: r.x, y: r.y, yaw: r.yaw })));
    landings.forEach((l, i) => {
      l.faceUp = live[i].faceUp;
      // Keep the drawn roll on the same side of the turn so the snap doesn't spin.
      const pose = app.layer.pose(l.uid);
      if (pose && !l.faceUp && pose.roll < 0) pose.roll += 2 * Math.PI;
    });
    land(app, landings, { duration: 90, stagger: 0 });
    s.done(live.map((r) => r.uid));
  }
}
