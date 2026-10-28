// The feel of dragging (spec 10.1–10.4, 15.5): held cards lift about 10 mm,
// tilt a little toward their motion and follow the cursor through a short
// spring. Gather drags trail the selection in a clump behind the cursor;
// formation drags move the cards as a rigid group. A whole stack keeps its
// shape at rest but its lower cards trail when moved fast, so letting go
// mid-swing fans it out. A Shift
// drag sweeps: cards the cursor passes over are pulled into the clump.

import type { App } from '../app';
import { land, leaveSpreads, pileAt, placeSequential, stackAt, type Landing } from '../commands';
import type { CustomGesture } from '../input/mouse';
import { pickCard } from '../render/picking';
import { messyLayout, snapYaw } from '../state/piles';
import { CARD_T, CARD_W } from '../state/types';

export type DragMode = 'single' | 'gather' | 'formation' | 'rigid';

const LIFT = 10;
/** Spring rate of the lead card: about 80 ms of visible lag (spec 15.5). */
const OMEGA_LEAD = 28;
const OMEGA_TAIL = 13;
const MAX_TILT = 0.2;
const TILT_PER_SPEED = 0.0012;
/** A single card turns about the point it was grabbed by (decision 94): gain, damping, limit. */
const TURN_GAIN = 0.02;
const TURN_DAMP = 10;
const TURN_MAX = 0.35;
/** Released while any held card moves faster than this (mm/s), the cards stop where they are (decision 95). */
export const MOVING_SPEED = 150;
/** ...sliding on for this long at their speed, as if friction caught them. */
export const CARRY_S = 0.03;
/** Gravity in the physics world, mm/s^2, for aiming tosses. */
const GRAVITY = 9810;

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
  /** Offset from the grab point at the start, before any turn (single drags). */
  bx: number;
  by: number;
}

/** Sweep (decision 89): a pile gives up its top card at once, more after this long... */
export const SWEEP_MORE_MS = 350;
/** ...and all of it after this long under the cursor. */
export const SWEEP_ALL_MS = 1600;
/** Moving off a pile for less than this keeps its dwell time. */
const SWEEP_GRACE_MS = 150;

/** How many cards a sweep has pulled from a pile of `size` after `ms` over it. */
export function sweepCount(ms: number, size: number): number {
  if (size <= 1 || ms < SWEEP_MORE_MS) return Math.min(1, size);
  if (ms >= SWEEP_ALL_MS) return size;
  // Slow at first, then faster: a heavy pile resists, then gives way.
  const k = ((ms - SWEEP_MORE_MS) / (SWEEP_ALL_MS - SWEEP_MORE_MS)) ** 2.2;
  return Math.min(size, Math.max(2, 1 + Math.floor(k * (size - 1))));
}

/** The pile (or loose card) the sweep is over, and how long it has been there. */
interface Dwell {
  key: string;
  since: number;
  /** Cards pulled from it so far. */
  taken: number;
  /** Its size when the sweep reached it. */
  size: number;
  /** When the cursor slipped off it, or 0. */
  lost: number;
}

/** Flick thresholds in screen pixels per second (spec 10.5: Off / Normal / Sensitive). */
const FLICK_SPEED = { off: Infinity, normal: 1600, sensitive: 1000 };

export class DragController {
  private held: Held[] = [];
  private mode: DragMode = 'single';
  private cursor = { x: 0, y: 0 };
  private active = false;
  private readonly label: HTMLDivElement;
  /** Smoothed cursor velocity on screen, px/s, for flick detection. */
  private vel = { x: 0, y: 0 };
  private flicked = false;
  private sweeping = false;
  private dwell: Dwell | null = null;
  /** Latest cursor position on screen, for the sweep's pick. */
  private screen = { x: 0, y: 0 };
  /** Single drags: how far the card has turned about the grab point, and how fast. */
  private turn = 0;
  private turnVel = 0;
  /** Cursor on the table last frame and its smoothed velocity, mm/s. */
  private lastCursor = { x: 0, y: 0 };
  private cursorVel = { x: 0, y: 0 };

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

  /**
   * Begin a drag of these cards. `sx, sy` is the press point on screen.
   * `sweepFrom` (the pressed card) turns on the Shift sweep for a gather.
   */
  begin(uids: string[], mode: DragMode, sx: number, sy: number, sweepFrom?: string): CustomGesture | null {
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
      const rank = n === 1 ? 1 : i / (n - 1);
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
      } else if (mode === 'rigid') {
        // Top card leads, lower cards trail a little: a quick swing strings the stack out (decision 95).
        omega = OMEGA_TAIL + (OMEGA_LEAD - OMEGA_TAIL) * rank;
      }
      return { uid: c.uid, ox, oy, dz, omega, vx: 0, vy: 0, vz: 0, home: { x: c.x, y: c.y, z: c.z, yaw: c.yaw }, bx: ox, by: oy };
    });
    for (const h of this.held) {
      this.app.motion.cancel(h.uid);
      this.app.motion.held.add(h.uid);
    }
    this.active = true;
    this.flicked = false;
    this.vel = { x: 0, y: 0 };
    this.screen = { x: sx, y: sy };
    this.turn = 0;
    this.turnVel = 0;
    this.lastCursor = { ...this.cursor };
    this.cursorVel = { x: 0, y: 0 };
    this.sweeping = !!sweepFrom && mode === 'gather';
    this.dwell = null;
    if (sweepFrom && this.sweeping) {
      // The pile the drag started on counts as already reached, its top card taken.
      const pile = store.pileOf(sweepFrom);
      this.dwell = { key: pile?.id ?? sweepFrom, since: performance.now(), taken: 1, size: pile ? pile.cardUids.length : 1, lost: 0 };
    }
    this.showLabel(sx, sy);
    let last = { x: sx, y: sy, t: performance.now() };

    return {
      kind: 'custom',
      move: (x, y) => {
        if (!this.active) return;
        const p = this.app.rig.screenToPlane(x, y, 0);
        if (p) this.cursor = { x: p.x, y: p.y };
        this.screen = { x, y };
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
    // Tossed cards move fast enough to need continuous collision detection.
    if (!physics.drop(loose, undefined, { ccd: true })) return false;
    this.flicked = true;
    this.finish();
    return true;
  }

  /** Shift sweep: pull in what the cursor is over, more the longer it stays (decision 89). */
  private sweep(now: number): void {
    const app = this.app;
    const store = app.store;
    const held = new Set(this.held.map((c) => c.uid));
    const hit = pickCard(app.rig, app.layer, this.screen.x, this.screen.y, held);
    let d = this.dwell;
    if (!hit) {
      if (d && !d.lost) d.lost = now;
      if (d && now - d.lost > SWEEP_GRACE_MS) this.dwell = null;
      return;
    }
    const pile = store.pileOf(hit);
    const key = pile?.id ?? hit;
    if (d && d.key === key) d.lost = 0;
    else {
      d = { key, since: now, taken: 0, size: pile ? pile.cardUids.filter((u) => !held.has(u)).length : 1, lost: 0 };
      this.dwell = d;
    }
    const want = sweepCount(now - d.since, d.size);
    while (d.taken < want) {
      // The card under the cursor first, then the pile from the top down.
      let next: string | null = d.taken === 0 ? hit : null;
      if (!next && pile) {
        let topZ = -Infinity;
        for (const u of pile.cardUids) {
          const c = store.cards.get(u);
          if (c && !held.has(u) && c.z > topZ) {
            topZ = c.z;
            next = u;
          }
        }
      }
      if (!next) break;
      this.collect(next);
      held.add(next);
      d.taken++;
    }
  }

  /** Add a card to the clump; it springs up from where it lies. */
  private collect(uid: string): void {
    const app = this.app;
    const card = app.store.cards.get(uid);
    if (!card) return;
    leaveSpreads(app, [uid]);
    const i = this.held.length;
    const a = i * 2.399963;
    const r = Math.min(6, 1.5 * Math.sqrt(i % 9));
    const top = this.held.reduce((m, c) => Math.max(m, c.dz), -CARD_T);
    this.held.push({
      uid, ox: Math.cos(a) * r, oy: Math.sin(a) * r, dz: top + CARD_T, omega: OMEGA_TAIL,
      vx: 0, vy: 0, vz: 0, home: { x: card.x, y: card.y, z: card.z, yaw: card.yaw }, bx: 0, by: 0,
    });
    app.motion.cancel(uid);
    app.motion.held.add(uid);
    app.store.setSelection([...app.store.selection, uid]);
    this.showLabel(this.screen.x, this.screen.y);
  }

  /**
   * A card pulled by a point off its centre swings so the centre trails behind
   * the motion, like dragging a real card by its corner. Only a little.
   */
  private turnSingle(dt: number): void {
    const c = this.held[0];
    const k = Math.min(1, dt * 12);
    const vx = (this.cursor.x - this.lastCursor.x) / Math.max(dt, 1e-3);
    const vy = (this.cursor.y - this.lastCursor.y) / Math.max(dt, 1e-3);
    this.cursorVel = { x: this.cursorVel.x + (vx - this.cursorVel.x) * k, y: this.cursorVel.y + (vy - this.cursorVel.y) * k };
    this.lastCursor = { ...this.cursor };
    const lever = Math.hypot(c.ox, c.oy);
    if (lever > 8) {
      // Torque of the drag on the centre: turns it to point away from the motion.
      const torque = (c.ox * -this.cursorVel.y - c.oy * -this.cursorVel.x) / lever;
      this.turnVel += (torque * TURN_GAIN * Math.min(1, lever / 40) - this.turnVel * TURN_DAMP) * dt;
    } else {
      this.turnVel -= this.turnVel * TURN_DAMP * dt;
    }
    this.turn = clamp(this.turn + this.turnVel * dt, -TURN_MAX, TURN_MAX);
    const cos = Math.cos(this.turn), sin = Math.sin(this.turn);
    c.ox = c.bx * cos - c.by * sin;
    c.oy = c.bx * sin + c.by * cos;
    const pose = this.app.layer.pose(c.uid);
    if (pose) pose.yaw = c.home.yaw + this.turn;
  }

  /** Spring every held card toward its target. */
  private step(dt: number): void {
    if (!this.active) return;
    if (this.sweeping) this.sweep(performance.now());
    if (this.mode === 'single' && this.held.length === 1 && dt > 0) this.turnSingle(dt);
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
      pose.tiltX = clamp(c.vy * TILT_PER_SPEED, -MAX_TILT, MAX_TILT);
      pose.tiltY = clamp(-c.vx * TILT_PER_SPEED, -MAX_TILT, MAX_TILT);
      layer.touch(c.uid);
    }
  }

  private finish(): void {
    this.active = false;
    this.sweeping = false;
    this.dwell = null;
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
    let held = this.held;
    const mode = this.mode;
    this.finish();
    // Let go mid-motion: the cards drop where they are drawn, strung out along
    // the drag, instead of finishing the planned landing (decision 95). A quick
    // drag of a gathered stack fans it out this way.
    if (!this.app.store.settings.tidyDrops && inMotion(held)) {
      const ordered = held
        .map((c) => ({ c, pose: this.app.layer.pose(c.uid) }))
        .filter((e) => e.pose)
        .sort((a, b) => a.pose!.z - b.pose!.z);
      const spots = stopWhereTheyAre(ordered.map(({ c, pose }) => ({ x: pose!.x, y: pose!.y, yaw: pose!.yaw, vx: c.vx, vy: c.vy })));
      land(this.app, placeSequential(this.app, ordered.map((e) => e.c.uid), spots), { duration: 150, stagger: 0 });
      return;
    }
    if (mode !== 'formation') {
      const target = this.target(held, sx, sy);
      if (target) {
        // A named pile with a filter turns away cards that don't match (spec 11.3).
        const { accepted, rejected } = this.app.named.sort(target.id, held.map((c) => c.uid));
        if (rejected.length) {
          const out = new Set(rejected);
          this.reject(held.filter((c) => out.has(c.uid)), target.id);
          held = held.filter((c) => !out.has(c.uid));
          if (!held.length) return;
        }
        this.join(target.id, accepted);
      }
    }
    if (this.dropLoose(held, mode, sx, sy)) return;
    land(this.app, this.landings(held, mode, sx, sy));
  }

  /**
   * Landed cards join the target pile, so it keeps its identity. A whole
   * named pile dropped on another pile merges into it: the receiving pile's
   * name wins if both are named, otherwise the dropped pile's name carries
   * over (spec 11.4).
   */
  private join(targetId: string, accepted: string[]): void {
    const store = this.app.store;
    const moving = new Set(accepted);
    const sources = new Set<string>();
    for (const u of accepted) {
      const id = store.cards.get(u)?.pileId;
      if (id && id !== targetId && store.named.has(id)) sources.add(id);
    }
    // Only a whole named pile merges; a few cards peeled off it just join.
    for (const id of [...sources]) {
      for (const c of store.cards.values()) {
        if (c.pileId === id && !moving.has(c.uid)) {
          sources.delete(id);
          break;
        }
      }
    }
    let keepId = targetId;
    if (!store.named.has(targetId) && sources.size) {
      keepId = [...sources][0];
      sources.delete(keepId);
      for (const u of store.piles.get(targetId)?.cardUids ?? []) {
        const c = store.cards.get(u);
        if (c) c.pileId = keepId;
      }
    }
    const keeper = store.named.get(keepId);
    for (const id of sources) {
      const lost = store.named.get(id);
      if (lost && keeper) store.events.emit('notice', `${lost.name} merged into ${keeper.name}; ${keeper.name} keeps its name`);
      store.named.delete(id);
    }
    for (const u of accepted) {
      const c = store.cards.get(u);
      if (c) c.pileId = keepId;
    }
  }

  /** The pile (or empty named outline) a release lands on, if any. */
  private target(held: Held[], sx: number, sy: number): { id: string } | null {
    const app = this.app;
    const moving = new Set(held.map((c) => c.uid));
    const hit = pickCard(app.rig, app.layer, sx, sy, moving);
    if (hit) {
      const pile = app.store.pileOf(hit);
      // A single loose card is a target too: dropping onto it makes a new pile.
      return pile ? { id: pile.id } : null;
    }
    const n = app.named.outlineAt(this.cursor.x, this.cursor.y);
    return n ? { id: n.id } : null;
  }

  /** Rejected cards slide off beside the pile with a short shake and a toast. */
  private reject(held: Held[], pileId: string): void {
    const app = this.app;
    const store = app.store;
    const n = store.named.get(pileId);
    const anchor = store.piles.get(pileId)?.anchor ?? n?.anchor ?? this.cursor;
    const yaw = n?.yaw ?? 0;
    const off = CARD_W + 28;
    const at = { x: anchor.x + Math.cos(yaw) * off, y: anchor.y + Math.sin(yaw) * off, yaw };
    const uids = held.map((c) => c.uid);
    for (const u of uids) {
      const c = store.cards.get(u);
      if (c && c.pileId === pileId) c.pileId = null;
    }
    const spots = messyLayout(uids.length, at).map((p) => ({ x: p.x, y: p.y, yaw: p.yaw }));
    land(app, placeSequential(app, uids, spots), { duration: 260, arc: 8 });
    // The shake: a quick wobble once they have slid off.
    setTimeout(() => {
      for (const u of uids) {
        const pose = app.layer.pose(u);
        const c = store.cards.get(u);
        if (!pose || !c) continue;
        const base = c.yaw;
        app.motion.animate(u, { yaw: base + 0.12 }, {
          duration: 60,
          done: () => app.motion.animate(u, { yaw: base - 0.1 }, {
            duration: 70,
            done: () => app.motion.animate(u, { yaw: base }, { duration: 60 }),
          }),
        });
      }
    }, 270);
    const label = uids.length === 1 ? '1 card doesn’t' : `${uids.length} cards don’t`;
    store.events.emit('notice', `${label} match ${n?.name ?? 'the pile'}: \`${n?.filter ?? ''}\``);
  }

  /**
   * Messy landings fall through the physics world: a single card dropped on
   * open table, or any group dropped on a messy pile, when Tidy drops is off
   * (spec 10.4, 15.4). Returns false when the landing is a tidy one.
   */
  /**
   * Every drop falls through physics when Tidy drops is off (decision 94):
   * each card is tossed in a low arc toward where the layout would put it, with
   * a little tumble and twist, and comes to rest wherever it really lands.
   * Formation and whole-pile drags keep their shape and land by layout.
   */
  private dropLoose(held: Held[], mode: DragMode, sx: number, sy: number): boolean {
    const app = this.app;
    const physics = app.physics;
    if (!physics || app.store.settings.tidyDrops || mode === 'formation' || mode === 'rigid') return false;
    const spots = this.landings(held, mode, sx, sy);
    const byUid = new Map(held.map((c) => [c.uid, c]));
    const tosses = spots.map((l, i) => {
      const c = byUid.get(l.uid)!;
      const pose = app.layer.pose(l.uid)!;
      if (mode === 'single') {
        // A single card just lets go, carrying a little of the drag's speed.
        return { uid: l.uid, vx: c.vx * 0.6, vy: c.vy * 0.6, vz: 0, wx: jitter(1), wy: jitter(1), wz: jitter(1.5) };
      }
      // Space the bodies (2 mm thick) so they don't start inside each other.
      pose.z = Math.max(pose.z, l.z + 4) + i * 2.4;
      const vz = 250;
      const h = pose.z - l.z;
      const t = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * h)) / GRAVITY;
      // A little extra to make up for the bodies' air damping.
      return { uid: l.uid, vx: ((l.x - pose.x) / t) * 1.15, vy: ((l.y - pose.y) / t) * 1.15, vz, wx: jitter(1.2), wy: jitter(1.2), wz: jitter(1.5) };
    });
    return physics.drop(tosses);
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
      // By membership, not pileId: a merge may already have re-tagged the target's cards.
      const pile = [...store.piles.values()].find((p) => p.cardUids.includes(hit));
      const rest = pile ? pile.cardUids.filter((u) => !moving.has(u)) : [];
      const target = rest.length ? rest : [hit];
      const top = store.cards.get(target[target.length - 1])!;
      const bottom = store.cards.get(target[0])!;
      if (tidy) {
        // Join the top, squared up on the pile (spec 10.4).
        const base = pile && pile.kind === 'stack' ? bottom : top;
        return stackAt(app, uids, { x: base.x, y: base.y, yaw: base.yaw }, moving);
      }
      if (!pile || pile.kind === 'stack' || uids.length === 1 || mode !== 'gather') {
        // Join the top as a loose stack (decision 94).
        return pileAt(app, uids, { x: top.x, y: top.y, yaw: top.yaw }, moving);
      }
      // A messy pile takes the cards messily (Tidy drops off).
      const spots = messyLayout(uids.length, { x: this.cursor.x, y: this.cursor.y, yaw: top.yaw }).map((p) => ({ x: p.x, y: p.y, yaw: p.yaw }));
      return placeSequential(app, uids, spots, moving);
    }

    // An empty named pile's outline takes the cards as a neat stack (a prepared bin, decision 27).
    const bin = app.named.outlineAt(this.cursor.x, this.cursor.y);
    if (bin) return pileAt(app, uids, { x: bin.anchor.x, y: bin.anchor.y, yaw: bin.yaw }, moving);

    // Empty table.
    if (mode === 'single') {
      const c = held[0];
      // Keeps the turn it picked up while dragged.
      const turned = app.layer.pose(c.uid)?.yaw ?? c.home.yaw;
      const yaw = tidy ? snapYaw(turned) : turned;
      return placeSequential(app, uids, [{ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw }], moving);
    }
    if (mode === 'rigid') {
      // A lifted stack lands as the stack it was, where it is drawn.
      const b = held[0];
      return stackAt(app, uids, { x: this.cursor.x + b.ox, y: this.cursor.y + b.oy, yaw: b.home.yaw }, moving);
    }
    // A gathered group becomes a stack at the drop point (decision 5), loose unless Tidy drops is on (decision 94).
    return pileAt(app, uids, { x: this.cursor.x, y: this.cursor.y, yaw: 0 }, moving);
  }
}

/**
 * A flick is a fast cursor movement followed by a sharp reversal. Given the
 * smoothed velocity before this move and the new one (px/s), returns the
 * unit direction to toss in, or null.
 */
/** True when any held card is still moving fast enough that letting go should stop it in place. */
export function inMotion(cards: { vx: number; vy: number }[]): boolean {
  return cards.some((c) => Math.hypot(c.vx, c.vy) > MOVING_SPEED);
}

/** Where cards let go mid-motion come to rest: where they are, slid on a little. */
export function stopWhereTheyAre(cards: { x: number; y: number; yaw: number; vx: number; vy: number }[]): { x: number; y: number; yaw: number }[] {
  return cards.map((c) => ({ x: c.x + c.vx * CARRY_S, y: c.y + c.vy * CARRY_S, yaw: c.yaw }));
}

/** A random value between -a and a. */
function jitter(a: number): number {
  return (Math.random() * 2 - 1) * a;
}

export function flickDirection(prev: { x: number; y: number }, v: { x: number; y: number }, threshold: number): { x: number; y: number } | null {
  const prevSpeed = Math.hypot(prev.x, prev.y);
  const speed = Math.hypot(v.x, v.y);
  if (prevSpeed < threshold || speed < 150) return null;
  const cos = (prev.x * v.x + prev.y * v.y) / (prevSpeed * speed);
  // The move must turn back by more than about 95°.
  if (cos > -0.1) return null;
  return { x: prev.x / prevSpeed, y: prev.y / prevSpeed };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
