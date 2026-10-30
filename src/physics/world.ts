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
import { inSpace, land, placeSequential, type Landing } from '../commands';
import { snapYaw } from '../state/piles';
import { restingTop } from './restSync';
import { CARD_H, CARD_T, CARD_W, type Mat } from '../state/types';
import { isStand, LIP_D, LIP_H, STAND_D, STAND_W, standProfile, standW, standWorld, unrollPoint } from '../state/stand';
import { D20_RADIUS, d20Geometry, DIE_SIZE, dieSize, type DieKind } from '../state/dice';
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
const HALF_DIAG = Math.hypot(CARD_W, CARD_H) / 2;

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

/** A roll of dice in progress (decision 255). */
interface Roll {
  bodies: { uid: string; body: RAPIER_NS.RigidBody }[];
  statics: RAPIER_NS.Collider[];
  started: number;
  pose: (uid: string, at: THREE.Vector3, q: THREE.Quaternion) => void;
  done: (rest: { uid: string; x: number; y: number; z: number; q: THREE.Quaternion }[]) => void;
}
/** A roll is cut off after this long, ms. */
const ROLL_MAX_MS = 5000;

interface Session {
  bodies: { uid: string; body: RAPIER_NS.RigidBody }[];
  statics: RAPIER_NS.Collider[];
  started: number;
  done: (uids: string[]) => void;
}

/** A d20's solid (decision 278): its twelve corners, a little in, rounded back out to its size. */
function d20Collider(): RAPIER_NS.ColliderDesc {
  const round = 1.5;
  const pos = d20Geometry(D20_RADIUS - round).getAttribute('position');
  const pts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count * 3; i++) pts[i] = (pos.array[i] as number) * MM;
  return RAPIER.ColliderDesc.roundConvexHull(pts, round * MM)!;
}

export class Physics {
  private world: RAPIER_NS.World | null = null;
  private readonly sessions: Session[] = [];
  private readonly rolls: Roll[] = [];
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
    return this.sessions.reduce((n, s) => n + s.bodies.length, 0) + this.rolls.reduce((n, r) => n + r.bodies.length, 0);
  }

  /**
   * Let cards fall from where they are drawn. When they come to rest they are
   * snapped flat, stacked by the model and `done` is called with their uids.
   * Returns false (and does nothing) if physics isn't ready or the drop is too big.
   */
  drop(cards: LooseCard[], done: (uids: string[]) => void = () => {}, opts: { ccd?: boolean; ignore?: Set<string> } = {}): boolean {
    const world = this.world;
    if (!world || !cards.length || cards.length > MAX_DROP || this.bodyCount + cards.length > MAX_BODIES) return false;
    const app = this.app;
    const loose = new Set(cards.map((c) => c.uid));
    // Cards still in the hand are no surface to land on (decision 180).
    const ignore = opts.ignore ?? new Set<string>();
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
    session.statics.push(...this.staticsAround(minX, minY, maxX, maxY, new Set([...loose, ...ignore])));

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

  /**
   * Static colliders for what falling things can land on near a region: stacks
   * and big piles as boxes, other cards as slabs where they are drawn, card
   * stands, and dice at rest (decision 255); `skip` are the ones in the air.
   */
  private staticsAround(minX: number, minY: number, maxX: number, maxY: number, skip: Set<string>): RAPIER_NS.Collider[] {
    const app = this.app;
    const out: RAPIER_NS.Collider[] = [];
    const doneCards = new Set<string>();
    for (const pile of app.store.piles.values()) {
      // A stack is one box; so is a big loose pile (decision 94), shaped like
      // its top card, so a loose cube doesn't become a thousand colliders.
      if (pile.kind !== 'stack' && pile.cardUids.length < BOX_PILE) continue;
      const bottom = app.store.cards.get(pile.cardUids[0]);
      if (!bottom || pile.cardUids.some((u) => skip.has(u))) continue;
      const topCard = app.store.cards.get(pile.cardUids[pile.cardUids.length - 1])!;
      const base = pile.kind === 'stack' ? bottom : topCard;
      if (base.x < minX || base.x > maxX || base.y < minY || base.y > maxY) continue;
      // A loose pile's cards rest tilted (decision 99): the box reaches its highest drawn point.
      let top = topCard.z + CARD_T / 2;
      if (pile.kind !== 'stack') {
        top = 0;
        for (const u of pile.cardUids) {
          const p = app.layer.pose(u);
          if (p) top = Math.max(top, restingTop(p.z, p.tiltX, p.tiltY, HALF_DIAG));
        }
      }
      out.push(this.staticBox(base.x, base.y, top / 2, base.yaw, top / 2));
      pile.cardUids.forEach((u) => doneCards.add(u));
    }
    for (const c of app.store.cards.values()) {
      if (skip.has(c.uid) || doneCards.has(c.uid)) continue;
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      // A slab where the card is drawn, tilted as it rests (decision 99).
      const p = app.layer.pose(c.uid);
      const top = (p?.z ?? c.z) + CARD_T / 2;
      out.push(this.staticBox(p?.x ?? c.x, p?.y ?? c.y, top - BODY_HALF_T, p?.yaw ?? c.yaw, BODY_HALF_T, p?.tiltX ?? 0, p?.tiltY ?? 0));
    }

    // Card stands (decision 220): the lip and the wedge, so cards land on the slope.
    for (const m of app.store.mats.values()) {
      if (!isStand(m) || m.x < minX - STAND_W || m.x > maxX + STAND_W || m.y < minY - STAND_W || m.y > maxY + STAND_W) continue;
      out.push(...this.standColliders(m));
    }
    for (const d of app.store.dice.values()) {
      if (skip.has(d.uid) || d.x < minX || d.x > maxX || d.y < minY || d.y > maxY) continue;
      out.push(this.world!.createCollider(
        RAPIER.ColliderDesc.cuboid((dieSize(d.kind) / 2) * MM, (dieSize(d.kind) / 2) * MM, (dieSize(d.kind) / 2) * MM)
          .setTranslation(d.x * MM, d.y * MM, d.z * MM)
          .setRotation({ x: 0, y: 0, z: Math.sin(d.yaw / 2), w: Math.cos(d.yaw / 2) })
          .setFriction(0.5),
      ));
    }
    return out;
  }

  /**
   * Roll dice (decision 255): each is flicked up with a random spin and sideways
   * push and tumbles for real, off cards, piles, stands and each other. `pose`
   * draws them each step; `done` gets where each came to rest.
   */
  rollDice(dice: { uid: string; x: number; y: number; z: number; q: THREE.Quaternion; kind?: DieKind }[], pose: (uid: string, at: THREE.Vector3, q: THREE.Quaternion) => void, done: (rest: { uid: string; x: number; y: number; z: number; q: THREE.Quaternion }[]) => void, toss?: { x: number; y: number }): boolean {
    const world = this.world;
    if (!world || !dice.length || this.bodyCount + dice.length > MAX_BODIES) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of dice) {
      minX = Math.min(minX, d.x - 300);
      maxX = Math.max(maxX, d.x + 300);
      minY = Math.min(minY, d.y - 300);
      maxY = Math.max(maxY, d.y + 300);
    }
    const roll: Roll = { bodies: [], statics: this.staticsAround(minX, minY, maxX, maxY, new Set(dice.map((d) => d.uid))), started: performance.now(), pose, done };
    const r = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    for (const d of dice) {
      // A flick: up, a little to one side, spinning hard; thrown by a shake, mostly the way it went (decision 257).
      // Livelier since decision 259: higher, further, spinning longer.
      const dir = Math.random() * Math.PI * 2, push = r(0.2, 0.42);
      const vx = Math.cos(dir) * push + (toss ? toss.x * r(0.45, 0.65) : 0);
      const vy = Math.sin(dir) * push + (toss ? toss.y * r(0.45, 0.65) : 0);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(d.x * MM, d.y * MM, (d.z + 4) * MM)
          .setRotation({ x: d.q.x, y: d.q.y, z: d.q.z, w: d.q.w })
          .setLinvel(vx, vy, r(0.95, 1.3))
          .setAngvel({ x: r(-34, 34), y: r(-34, 34), z: r(-18, 18) })
          .setLinearDamping(0.08)
          .setAngularDamping(0.15)
          .setCcdEnabled(true)
          .setCanSleep(true),
      );
      world.createCollider(
        (d.kind === 'd20' ? d20Collider() : RAPIER.ColliderDesc.roundCuboid((DIE_SIZE / 2 - 2) * MM, (DIE_SIZE / 2 - 2) * MM, (DIE_SIZE / 2 - 2) * MM, 2 * MM))
          .setFriction(0.35).setRestitution(0.45).setDensity(1200),
        body,
      );
      roll.bodies.push({ uid: d.uid, body });
    }
    this.rolls.push(roll);
    return true;
  }

  private stepRolls(now: number): void {
    const world = this.world!;
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const roll of [...this.rolls]) {
      let asleep = true;
      for (const { uid, body } of roll.bodies) {
        const t = body.translation(), r = body.rotation();
        roll.pose(uid, at.set(t.x / MM, t.y / MM, t.z / MM), q.set(r.x, r.y, r.z, r.w));
        if (!body.isSleeping()) {
          const lv = body.linvel(), av = body.angvel();
          if (Math.hypot(lv.x, lv.y, lv.z) > 0.01 || Math.hypot(av.x, av.y, av.z) > 0.3) asleep = false;
        }
      }
      if (!asleep && now - roll.started < ROLL_MAX_MS) continue;
      this.rolls.splice(this.rolls.indexOf(roll), 1);
      const rest = roll.bodies.map(({ uid, body }) => {
        const t = body.translation(), r = body.rotation();
        return { uid, x: t.x / MM, y: t.y / MM, z: t.z / MM, q: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
      });
      for (const { body } of roll.bodies) world.removeRigidBody(body);
      for (const c of roll.statics) world.removeCollider(c, false);
      roll.done(rest);
    }
  }

  /** A card stand as two solids: its lip, and the wedge behind it. */
  private standColliders(m: Mat): RAPIER_NS.Collider[] {
    const world = this.world!;
    const rot = { x: 0, y: 0, z: Math.sin(m.yaw / 2), w: Math.cos(m.yaw / 2) };
    const out: RAPIER_NS.Collider[] = [];
    const lip = standWorld(m, 0, -STAND_D / 2 + LIP_D / 2);
    out.push(world.createCollider(
      RAPIER.ColliderDesc.cuboid((standW(m) / 2) * MM, (LIP_D / 2) * MM, (LIP_H / 2) * MM)
        .setTranslation(lip.x * MM, lip.y * MM, (LIP_H / 2) * MM)
        .setRotation(rot)
        .setFriction(0.6),
    ));
    // The wedge: its three profile corners behind the lip, at both ends.
    const pts: number[] = [];
    for (const a of [-standW(m) / 2, standW(m) / 2]) for (const [b, h] of standProfile().slice(3)) pts.push(a * MM, b * MM, h * MM);
    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (hull) out.push(world.createCollider(hull.setTranslation(m.x * MM, m.y * MM, 0).setRotation(rot).setFriction(0.6)));
    return out;
  }

  private staticBox(x: number, y: number, z: number, yaw: number, halfZ: number, tiltX = 0, tiltY = 0): RAPIER_NS.Collider {
    this.e.set(tiltX, tiltY, yaw, 'ZXY');
    this.q.setFromEuler(this.e);
    return this.world!.createCollider(
      RAPIER.ColliderDesc.cuboid((CARD_W / 2) * MM, (CARD_H / 2) * MM, Math.max(0.05, halfZ) * MM)
        .setTranslation(x * MM, y * MM, z * MM)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w })
        .setFriction(0.6),
    );
  }

  private step(now: number, dt: number): void {
    const world = this.world;
    if (!world || (!this.sessions.length && !this.rolls.length)) return;
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
    if (this.rolls.length) this.stepRolls(now);
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

  /** True while a card is falling under physics. */
  falling(uid: string): boolean {
    return this.sessions.some((s) => s.bodies.some((b) => b.uid === uid));
  }

  /**
   * Take cards out of any fall in progress (decision 219): a command or a drag
   * that moves a card still falling owns it now, so the fall must neither keep
   * steering its drawn pose nor put it back where it lands. The rest of the
   * fall carries on.
   */
  release(uids: Iterable<string>): void {
    const world = this.world;
    if (!world || !this.sessions.length) return;
    const out = new Set(uids);
    for (const s of [...this.sessions]) {
      const keep = s.bodies.filter((b) => !out.has(b.uid));
      if (keep.length === s.bodies.length) continue;
      for (const b of s.bodies) if (out.has(b.uid)) world.removeRigidBody(b.body);
      s.bodies = keep;
      if (!keep.length) {
        for (const c of s.statics) world.removeCollider(c, false);
        this.sessions.splice(this.sessions.indexOf(s), 1);
      }
    }
  }

  /** Undo (decision 204): drop every fall in progress without landing it; the model's positions stand. */
  abandonAll(): void {
    const world = this.world;
    if (!world) return;
    for (const s of this.sessions.splice(0)) {
      for (const { body } of s.bodies) world.removeRigidBody(body);
      for (const c of s.statics) world.removeCollider(c, false);
    }
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
      const yaw = this.app.tidy ? snapYaw(turned) : turned;
      const t = body.translation();
      return { uid, x: t.x / MM, y: t.y / MM, z: t.z / MM, yaw, faceUp };
    });
    for (const { body } of s.bodies) world.removeRigidBody(body);
    for (const c of s.statics) world.removeCollider(c, false);

    const app = this.app;
    const live = results.filter((r) => app.store.cards.has(r.uid));
    // Lowest first, so the model stacks them the way they came to rest.
    live.sort((a, b) => a.z - b.z);
    // A card that came to rest on a card stand's slope joins it there (decision 221).
    const groups = new Map<string | null, { uid: string; x: number; y: number; yaw: number }[]>();
    for (const r of live) {
      let at: { x: number; y: number } | null = null;
      let stand: string | null = null;
      for (const m of app.store.mats.values()) {
        if (!isStand(m) || r.z < 2) continue;
        at = unrollPoint(m, r.x, r.y);
        if (at) {
          stand = m.uid;
          break;
        }
      }
      const spot = { uid: r.uid, x: at?.x ?? r.x, y: at?.y ?? r.y, yaw: r.yaw };
      if (!groups.has(stand)) groups.set(stand, []);
      groups.get(stand)!.push(spot);
    }
    const byUid = new Map<string, Landing>();
    for (const [stand, spots] of groups) {
      for (const l of inSpace(stand, () => placeSequential(app, spots.map((s) => s.uid), spots))) byUid.set(l.uid, l);
    }
    const landings = live.map((r) => byUid.get(r.uid)!);
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
