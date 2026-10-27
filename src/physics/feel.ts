// The feel of dragging (spec 10.1–10.4, 15.5): held cards lift about 10 mm,
// tilt a little toward their motion and follow the cursor through a short
// spring. Gather drags trail the selection in a clump behind the cursor;
// formation and whole-stack drags move the cards as a rigid group.

import type { App } from '../app';
import { land, leaveSpreads, placeSequential, stackAt, type Landing } from '../commands';
import type { CustomGesture } from '../input/mouse';
import { pickCard } from '../render/picking';
import { messyLayout, snapYaw } from '../state/piles';
import { CARD_T } from '../state/types';

export type DragMode = 'single' | 'gather' | 'formation' | 'rigid';

const LIFT = 10;
/** Spring rate of the lead card: about 80 ms of visible lag (spec 15.5). */
const OMEGA_LEAD = 28;
const OMEGA_TAIL = 13;
const MAX_TILT = 0.14;

interface Held {
  uid: string;
  /** Offset from the cursor's table point (formation, rigid) or clump offset (gather). */
  ox: number;
  oy: number;
  /** Height above the lift plane. */
  dz: number;
  omega: number;
  vx: number;
  vy: number;
  vz: number;
  /** Where it was before the drag, for Esc. */
  home: { x: number; y: number; z: number; yaw: number };
}

/** Flick thresholds in screen pixels per second (spec 10.5: Off / Normal / Sensitive). */
const FLICK_SPEED = { off: Infinity, normal: 2300, sensitive: 1400 };

export class DragController {
  private held: Held[] = [];
  private mode: DragMode = 'single';
  private cursor = { x: 0, y: 0 };
  private active = false;
  private readonly label: HTMLDivElement;
  /** Smoothed cursor velocity on screen, px/s, for flick detection. */
  private vel = { x: 0, y: 0 };
  private flicked = false;

  constructor(private readonly app: App) {
    this.label = document.createElement('div');
    this.label.className = 'drag-label';
    this.label.hidden = true;
    app.overlay.append(this.label);
    app.onFrame((_now, dt) => this.step(dt));
  }

  get dragging(): boolean {
    return this.active;
  }

  get heldUids(): string[] {
    return this.held.map((h) => h.uid);
  }

  /** True if the last drag ended in a flick. */
  get lastWasFlick(): boolean {
    return this.flicked;
  }

  /** Begin a drag of these cards. `sx, sy` is the press point on screen. */
  begin(uids: string[], mode: DragMode, sx: number, sy: number): CustomGesture | null {
    const store = this.app.store;
    const grab = this.app.rig.screenToPlane(sx, sy, 0);
    if (!grab || !uids.length) return null;
    // Bottom to top, so the stacking order survives the trip.
    const cards = uids.map((u) => store.cards.get(u)!).filter(Boolean).sort((a, b) => a.z - b.z);
    leaveSpreads(this.app, cards.map((c) => c.uid));
    const minZ = cards[0].z;
    const n = cards.length;
    this.mode = mode;
    this.cursor = { x: grab.x, y: grab.y };
    this.held = cards.map((c, i) => {
      const rank = i / Math.max(1, n - 1);
      let ox = c.x - grab.x;
      let oy = c.y - grab.y;
      let dz = c.z - minZ;
      let omega = OMEGA_LEAD;
      if (mode === 'gather') {
        // A loose clump: small offsets that grow toward the bottom of the pile,
        // and slower springs further back so the clump trails the cursor.
        const a = i * 2.399963;
        const r = Math.min(14, 1.5 * Math.sqrt(n - 1 - i));
        ox = Math.cos(a) * r;
        oy = Math.sin(a) * r;
        dz = i * CARD_T;
        omega = OMEGA_TAIL + (OMEGA_LEAD - OMEGA_TAIL) * rank;
      } else if (mode === 'single') {
        dz = 0;
      }
      return { uid: c.uid, ox, oy, dz, omega, vx: 0, vy: 0, vz: 0, home: { x: c.x, y: c.y, z: c.z, yaw: c.yaw } };
    });
    for (const h of this.held) {
      this.app.motion.cancel(h.uid);
      this.app.motion.held.add(h.uid);
    }
    this.active = true;
    this.flicked = false;
    this.vel = { x: 0, y: 0 };
    this.showLabel(sx, sy);
    let last = { x: sx, y: sy, t: performance.now() };

    return {
      kind: 'custom',
      move: (x, y) => {
        if (!this.active) return;
        const p = this.app.rig.screenToPlane(x, y, 0);
        if (p) this.cursor = { x: p.x, y: p.y };
        const now = performance.now();
        const dt = Math.max(4, now - last.t) / 1000;
        const v = { x: (x - last.x) / dt, y: (y - last.y) / dt };
        last = { x, y, t: now };
        if (this.detectFlick(v, x, y)) return;
        this.showLabel(x, y);
      },
      up: (x, y) => {
        if (this.active) this.release(x, y);
      },
      cancel: () => {
        if (this.active) this.cancel();
      },
    };
  }

  private showLabel(sx: number, sy: number): void {
    if (this.held.length < 2) {
      this.label.hidden = true;
      return;
    }
    this.label.hidden = false;
    this.label.textContent = `${this.held.length}`;
    this.label.style.transform = `translate(${sx + 16}px, ${sy + 14}px)`;
  }

  /**
   * A flick: the cursor was moving fast and then reverses sharply. The held
   * cards are tossed the way it was going and flip in the air (spec 10.5).
   */
  private detectFlick(v: { x: number; y: number }, sx: number, sy: number): boolean {
    const prev = this.vel;
    this.vel = { x: prev.x * 0.4 + v.x * 0.6, y: prev.y * 0.4 + v.y * 0.6 };
    const dir = flickDirection(prev, v, FLICK_SPEED[this.app.store.settings.flick]);
    return dir ? this.flick(dir.x, dir.y, sx, sy) : false;
  }

  private flick(dirX: number, dirY: number, sx: number, sy: number): boolean {
    const physics = this.app.physics;
    if (!physics) return false;
    // The screen direction as a direction on the table.
    const a = this.app.rig.screenToPlane(sx, sy, 0);
    const b = this.app.rig.screenToPlane(sx + dirX * 60, sy + dirY * 60, 0);
    if (!a || !b) return false;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    const held = this.held;
    const loose = held.map((c, i) => {
      const pose = this.app.layer.pose(c.uid)!;
      // Spin about the card's own long axis so it turns over in the air.
      const ax = Math.cos(pose.yaw + Math.PI / 2);
      const ay = Math.sin(pose.yaw + Math.PI / 2);
      // Which way round depends on the toss direction, so the card rolls forward.
      const sign = Math.sign(tx * Math.cos(pose.yaw) + ty * Math.sin(pose.yaw)) || 1;
      const spin = 21 * sign;
      const spread = 1 + (i % 5) * 0.04;
      return { uid: c.uid, vx: tx * 650 * spread, vy: ty * 650 * spread, vz: 950, wx: ax * spin, wy: ay * spin, wz: 0 };
    });
    if (!physics.drop(loose)) return false;
    this.flicked = true;
    this.finish();
    return true;
  }

  /** Spring every held card toward its target. */
  private step(dt: number): void {
    if (!this.active) return;
    const layer = this.app.layer;
    const steps = 2;
    const h = Math.min(dt, 1 / 30) / steps;
    for (const c of this.held) {
      const pose = layer.pose(c.uid);
      if (!pose) continue;
      const tx = this.cursor.x + c.ox;
      const ty = this.cursor.y + c.oy;
      const tz = LIFT + CARD_T / 2 + c.dz;
      for (let s = 0; s < steps; s++) {
        const w = c.omega;
        c.vx += (w * w * (tx - pose.x) - 2 * w * c.vx) * h;
        c.vy += (w * w * (ty - pose.y) - 2 * w * c.vy) * h;
        c.vz += (w * w * (tz - pose.z) - 2 * w * c.vz) * h;
        pose.x += c.vx * h;
        pose.y += c.vy * h;
        pose.z += c.vz * h;
      }
      // Lean into the motion: the leading edge dips a little.
      pose.tiltX = clamp(c.vy * 0.0009, -MAX_TILT, MAX_TILT);
      pose.tiltY = clamp(-c.vx * 0.0009, -MAX_TILT, MAX_TILT);
      layer.touch(c.uid);
    }
  }

  private finish(): void {
    this.active = false;
    this.label.hidden = true;
    this.held = [];
  }

  cancel(): void {
    const held = this.held;
    this.finish();
    for (const c of held) {
      this.app.motion.held.delete(c.uid);
      const card = this.app.store.cards.get(c.uid);
      this.app.motion.animate(c.uid, { ...c.home, roll: card?.faceUp === false ? Math.PI : 0 }, { duration: 200 });
    }
  }

  private release(sx: number, sy: number): void {
    const held = this.held;
    const mode = this.mode;
    this.finish();
    if (this.dropLoose(held, mode, sx, sy)) return;
    land(this.app, this.landings(held, mode, sx, sy));
  }

  /**
   * Messy landings fall through the physics world: a single card dropped on
   * open table, or any group dropped on a messy pile, when Tidy drops is off
   * (spec 10.4, 15.4). Returns false when the landing is a tidy one.
   */
  private dropLoose(held: Held[], mode: DragMode, sx: number, sy: number): boolean {
    const app = this.app;
    const physics = app.physics;
    if (!physics || app.store.settings.tidyDrops || mode === 'formation') return false;
    const moving = new Set(held.map((c) => c.uid));
    const hit = pickCard(app.rig, app.layer, sx, sy, moving);
    const pile = hit ? app.store.pileOf(hit) : undefined;
    const ontoMessy = !!pile && pile.kind === 'messy';
    const singleOnTable = !hit && mode === 'single';
    if (!ontoMessy && !singleOnTable) return false;
    return physics.drop(held.map((c) => ({ uid: c.uid, vx: c.vx * 0.6, vy: c.vy * 0.6, vz: 0, wz: (Math.random() - 0.5) * 2 })));
  }

  /** Where released cards come to rest (spec 10.4). */
  private landings(held: Held[], mode: DragMode, sx: number, sy: number): Landing[] {
    const app = this.app;
    const store = app.store;
    const uids = held.map((c) => c.uid);
    const moving = new Set(uids);
    const tidy = store.settings.tidyDrops;

    if (mode === 'formation') {
      // Each card drops where it is, on whatever is beneath it.
      const spots = held.map((c) => ({ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw: c.home.yaw }));
      return placeSequential(app, uids, spots, moving);
    }

    const hit = pickCard(app.rig, app.layer, sx, sy, moving);
    if (hit) {
      const pile = store.pileOf(hit);
      const target = pile ? pile.cardUids.filter((u) => !moving.has(u)) : [hit];
      const top = store.cards.get(target[target.length - 1])!;
      const bottom = store.cards.get(target[0])!;
      const squared = !pile || pile.kind === 'stack' || tidy;
      if (squared) {
        // Join the top, squared up on the pile (spec 10.4).
        const base = pile && pile.kind === 'stack' ? bottom : top;
        return stackAt(app, uids, { x: base.x, y: base.y, yaw: base.yaw }, moving);
      }
      // A messy pile takes the cards messily (Tidy drops off).
      const spots = messyLayout(uids.length, { x: this.cursor.x, y: this.cursor.y, yaw: top.yaw }).map((p) => ({ x: p.x, y: p.y, yaw: p.yaw }));
      return placeSequential(app, uids, spots, moving);
    }

    // Empty table.
    if (mode === 'single') {
      const c = held[0];
      const yaw = tidy ? snapYaw(c.home.yaw) : c.home.yaw;
      return placeSequential(app, uids, [{ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw }], moving);
    }
    if (mode === 'rigid') {
      // A lifted stack lands as the stack it was, where it is drawn.
      const b = held[0];
      return stackAt(app, uids, { x: this.cursor.x + b.ox, y: this.cursor.y + b.oy, yaw: b.home.yaw }, moving);
    }
    // A gathered group becomes a neat stack at the drop point (decision 5).
    return stackAt(app, uids, { x: this.cursor.x, y: this.cursor.y, yaw: 0 }, moving);
  }
}

/**
 * A flick is a fast cursor movement followed by a sharp reversal. Given the
 * smoothed velocity before this move and the new one (px/s), returns the
 * unit direction to toss in, or null.
 */
export function flickDirection(prev: { x: number; y: number }, v: { x: number; y: number }, threshold: number): { x: number; y: number } | null {
  const prevSpeed = Math.hypot(prev.x, prev.y);
  const speed = Math.hypot(v.x, v.y);
  if (prevSpeed < threshold || speed < 150) return null;
  const cos = (prev.x * v.x + prev.y * v.y) / (prevSpeed * speed);
  if (cos > -0.25) return null;
  return { x: prev.x / prevSpeed, y: prev.y / prevSpeed };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
