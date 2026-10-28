// The feel of dragging (spec 10.1–10.4, 15.5): held cards lift about 10 mm,
// tilt a little toward their motion and follow the cursor through a short
// spring. Gather drags trail the selection in a clump behind the cursor;
// formation drags and tidy stacks move the cards as a rigid group. A messy
// stack keeps its shape at rest but its lower cards trail, heavier, when moved
// fast, so letting go mid-swing fans it out. A Shift
// drag sweeps: cards the cursor passes over are pulled into the clump.

import * as THREE from 'three';
import { restPose, type App } from '../app';
import { land, leaveSpreads, pileAt, placeSequential, stackAt, type Landing } from '../commands';
import type { CustomGesture } from '../input/mouse';
import { pickCard } from '../render/picking';
import { gridLayout, messyLayout, nextQuarterClockwise, overlaps, snapYaw, uprightYaw, type Footprint } from '../state/piles';
import { shortAngle } from './motion';
import { restingTop } from './restSync';
import { CARD_H, CARD_T, CARD_W } from '../state/types';

export type DragMode = 'single' | 'gather' | 'formation' | 'rigid';

const LIFT = 10;
/** Spring rate of the lead card: about 80 ms of visible lag (spec 15.5). */
const OMEGA_LEAD = 28;
/**
 * Messy stacks and gathered clumps are a little heavier (decision 96): their
 * top card follows at this rate and the bottom of the pile at the tail rate.
 * A tidy stack moves as one at the lead rate.
 */
const OMEGA_MESSY_LEAD = 22;
const OMEGA_TAIL = 10;
const MAX_TILT = 0.2;
const TILT_PER_SPEED = 0.0012;
/** Tidy mode (decision 98) keeps the lean from before the messy changes. */
const TIDY_MAX_TILT = 0.14;
const TIDY_TILT_PER_SPEED = 0.0009;
/** Tidy mode's clump tail rate, from before decision 96. */
const OMEGA_TIDY_TAIL = 13;
/** Rate (1/s) at which a held card turns to the nearest quarter turn in Tidy mode. */
const SQUARE_RATE = 14;
/** Rate (1/s) at which a held card turns over when F flips it in the hand. */
const FLIP_RATE = 12;
/** A single card turns about the point it was grabbed by (decision 94): gain, damping, limit. */
const TURN_GAIN = 0.02;
const TURN_DAMP = 10;
const TURN_MAX = 0.35;
/** Released while any held card moves faster than this (mm/s), the cards stop where they are (decision 95). */
export const MOVING_SPEED = 150;
/** ...sliding on for this long at their speed, as if friction caught them. */
export const CARRY_S = 0.03;
/** No clipping (decision 97): a tilted card's corner can dip this far below its centre per unit of slope. */
const HALF_DIAG = Math.hypot(CARD_W, CARD_H) / 2;
/** The least gap kept between a held card's lowest corner and the cards under it, mm. */
const MIN_CLEAR = 1.5;
/** How far ahead (seconds of motion) held cards look for stacks to rise over. */
const LOOK_AHEAD_S = 0.12;
/** Rates (1/s) at which the held group rises over a stack, settles back down, and picked-up cards reach the group. */
const RISE_RATE = 30;
const FALL_RATE = 8;
const JOIN_RATE = 18;
/** A held group wider than this (mm) leans less, so a wide formation doesn't seesaw. */
const LEAN_SPAN = 300;
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
  /** Its own turn on the table while held; the group's lean is added on top. */
  yaw: number;
  /** The turn it is heading for: its own, or the nearest quarter turn in Tidy mode. */
  yawTo: number;
  /** Its turn before any swing about the grab point; R while held turns this (decision 103). */
  base: number;
  /** The roll it is turning over to, when F flips it in the hand (NaN when not flipping). */
  rollTo: number;
  /** Height still to close to the group's plane after pick-up (NaN until the first frame). */
  ez: number;
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
  /** How far R has turned a held group, so a gathered group lands turned too. */
  private groupTurn = 0;
  /** Cursor on the table last frame and its smoothed velocity, mm/s. */
  private lastCursor = { x: 0, y: 0 };
  private cursorVel = { x: 0, y: 0 };
  /** Height of the held group's shared plane at the cursor (NaN until the first frame). */
  private base = NaN;
  private readonly qTilt = new THREE.Quaternion();
  private readonly qCard = new THREE.Quaternion();
  private readonly qPart = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'ZXY');
  private static readonly UP = new THREE.Vector3(0, 0, 1);
  private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();

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
    // A tidy stack dragged whole stays snappy and rigid (decision 96).
    const pile = mode === 'rigid' ? store.pileOf(cards[0].uid) : undefined;
    const tidyStack = !!pile && pile.kind === 'stack' && pile.cardUids.length === cards.length;
    const tidy = this.tidy;
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
        omega = tidy ? OMEGA_TIDY_TAIL + (OMEGA_LEAD - OMEGA_TIDY_TAIL) * rank : OMEGA_TAIL + (OMEGA_MESSY_LEAD - OMEGA_TAIL) * rank;
      } else if (mode === 'single') {
        dz = 0;
      } else if (mode === 'rigid' && !tidyStack && !tidy) {
        // A messy stack: top card leads, lower cards trail, heavier (decisions 95, 96).
        omega = OMEGA_TAIL + (OMEGA_MESSY_LEAD - OMEGA_TAIL) * rank;
      }
      return { uid: c.uid, ox, oy, dz, omega, vx: 0, vy: 0, vz: 0, home: { x: c.x, y: c.y, z: c.z, yaw: c.yaw }, bx: ox, by: oy, yaw: c.yaw, yawTo: tidy ? snapYaw(c.yaw) : c.yaw, base: c.yaw, rollTo: NaN, ez: NaN };
    });
    for (const h of this.held) {
      this.app.motion.cancel(h.uid);
      this.app.motion.held.add(h.uid);
    }
    // What rested on the lifted cards falls now (decision 100).
    this.app.rest?.lifted(this.held.map((h) => h.uid));
    this.active = true;
    this.flicked = false;
    this.vel = { x: 0, y: 0 };
    this.screen = { x: sx, y: sy };
    this.turn = 0;
    this.turnVel = 0;
    this.groupTurn = 0;
    this.base = NaN;
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
      uid, ox: Math.cos(a) * r, oy: Math.sin(a) * r, dz: top + CARD_T, omega: this.tidy ? OMEGA_TIDY_TAIL : OMEGA_TAIL,
      vx: 0, vy: 0, vz: 0, home: { x: card.x, y: card.y, z: card.z, yaw: card.yaw }, bx: 0, by: 0,
      yaw: card.yaw, yawTo: this.tidy ? snapYaw(card.yaw) : card.yaw, base: card.yaw, rollTo: NaN, ez: NaN,
    });
    app.motion.cancel(uid);
    app.motion.held.add(uid);
    app.rest?.lifted([uid]);
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
    c.yawTo = c.base + this.turn;
    c.yaw = c.yawTo;
  }

  /**
   * R while dragging (decision 103): every held card turns to its next quarter
   * turn clockwise, or upright on a double tap, and the group turns with the
   * top card about the cursor, so a held stack turns as one.
   */
  rotate(upright: boolean): void {
    if (!this.active || !this.held.length) return;
    const lead = this.held[this.held.length - 1];
    const turnTo = (yaw: number) => (upright ? uprightYaw(yaw) : nextQuarterClockwise(yaw));
    const delta = turnTo(lead.base) - lead.base;
    const cos = Math.cos(delta), sin = Math.sin(delta);
    for (const c of this.held) {
      c.base = turnTo(c.base);
      c.yawTo = c.base + (this.mode === 'single' ? this.turn : 0);
      [c.ox, c.oy] = [c.ox * cos - c.oy * sin, c.ox * sin + c.oy * cos];
      [c.bx, c.by] = [c.bx * cos - c.by * sin, c.bx * sin + c.by * cos];
    }
    this.groupTurn += delta;
  }

  /**
   * F while dragging (decision 104): the held cards turn over in the hand. A
   * held stack turns over as a whole, so its order reverses: the bottom card
   * comes out on top, as with a real stack.
   */
  flipHeld(): void {
    if (!this.active || !this.held.length) return;
    const store = this.app.store;
    this.reverseHeld();
    store.moveCards(this.held.map((c) => ({ uid: c.uid, faceUp: !store.cards.get(c.uid)!.faceUp })));
    for (const c of this.held) {
      const pose = this.app.layer.pose(c.uid);
      const card = store.cards.get(c.uid);
      if (!pose || !card) continue;
      // Always the same way round, to the matching side's roll nearest half a turn on.
      const side = card.faceUp ? 0 : Math.PI;
      c.rollTo = side + 2 * Math.PI * Math.round((pose.roll + Math.PI - side) / (2 * Math.PI));
    }
  }

  /**
   * F twice quickly while dragging (decision 105): every held card faces up,
   * in the order it had before the first F, so a mixed stack is fronted.
   */
  frontHeld(): void {
    if (!this.active || !this.held.length) return;
    const store = this.app.store;
    // The first F turned the whole stack over; put its order back.
    this.reverseHeld();
    store.moveCards(this.held.map((c) => ({ uid: c.uid, faceUp: true })));
    for (const c of this.held) {
      const pose = this.app.layer.pose(c.uid);
      if (!pose) continue;
      // Face up by the short way from wherever it is in its turn.
      c.rollTo = 2 * Math.PI * Math.round(pose.roll / (2 * Math.PI));
    }
  }

  /** Reverse the held cards' order, keeping the heights they ride at. */
  private reverseHeld(): void {
    const heights = this.held.map((c) => c.dz);
    this.held.reverse();
    this.held.forEach((c, i) => (c.dz = heights[i]));
  }

  /**
   * T while dragging (decision 104): the held cards square up into a neat
   * stack in the hand, under the top card, at a quarter turn; they land neat.
   */
  tidyHeld(): void {
    if (!this.active || this.held.length < 2) return;
    const top = this.held[this.held.length - 1];
    const yaw = snapYaw(top.base);
    this.held.forEach((c, i) => {
      c.ox = c.bx = top.ox;
      c.oy = c.by = top.oy;
      c.dz = i * CARD_T;
      c.base = c.yawTo = yaw;
      c.omega = OMEGA_LEAD;
    });
    this.mode = 'rigid';
  }

  /**
   * S while dragging (decision 104): the held cards gather into a clump under
   * the cursor and land as one stack (loose, or neat in Tidy mode).
   */
  stackHeld(): void {
    if (!this.active || this.held.length < 2) return;
    const n = this.held.length;
    const tidy = this.tidy;
    this.held.forEach((c, i) => {
      const a = i * 2.399963;
      const r = Math.min(14, 1.5 * Math.sqrt(n - 1 - i));
      c.ox = c.bx = Math.cos(a) * r;
      c.oy = c.by = Math.sin(a) * r;
      c.dz = i * CARD_T;
      const rank = i / (n - 1);
      c.omega = tidy ? OMEGA_TIDY_TAIL + (OMEGA_LEAD - OMEGA_TIDY_TAIL) * rank : OMEGA_TAIL + (OMEGA_MESSY_LEAD - OMEGA_TAIL) * rank;
    });
    this.mode = 'gather';
  }

  /**
   * X while dragging (decision 104): the held cards spread out in a grid
   * around the cursor, top card first, and each lands where it is held.
   */
  spreadHeld(): void {
    if (!this.active || this.held.length < 2) return;
    const topFirst = [...this.held].reverse();
    const grid = gridLayout(topFirst.length, { x: 0, y: 0 });
    topFirst.forEach((c, i) => {
      c.ox = c.bx = grid[i].x;
      c.oy = c.by = grid[i].y;
      c.dz = 0;
      c.base = c.yawTo = grid[i].yaw;
      c.omega = OMEGA_LEAD;
    });
    this.mode = 'formation';
  }

  /** Tidy mode (decision 98): everything squared up at quarter turns, with the drag feel from before the messy changes. */
  private get tidy(): boolean {
    return this.app.store.settings.tidyDrops;
  }

  /**
   * Spring every held card toward its spot under the cursor. So that held
   * cards never pass through each other or through the table's piles
   * (decision 97), the whole group leans as one: every card lies parallel to
   * one tilted plane, stacked along it in its own order, and the plane rises
   * over whatever is beneath any of the cards.
   */
  private step(dt: number): void {
    if (!this.active) return;
    if (this.sweeping) this.sweep(performance.now());
    const tidy = this.tidy;
    if (this.mode === 'single' && this.held.length === 1 && dt > 0 && !tidy) this.turnSingle(dt);
    const layer = this.app.layer;
    const steps = 2;
    const h = Math.min(dt, 1 / 30) / steps;
    let avx = 0, avy = 0, n = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of this.held) {
      const pose = layer.pose(c.uid);
      if (!pose) continue;
      const tx = this.cursor.x + c.ox;
      const ty = this.cursor.y + c.oy;
      for (let s = 0; s < steps; s++) {
        const w = c.omega;
        c.vx += (w * w * (tx - pose.x) - 2 * w * c.vx) * h;
        c.vy += (w * w * (ty - pose.y) - 2 * w * c.vy) * h;
        pose.x += c.vx * h;
        pose.y += c.vy * h;
      }
      avx += c.vx;
      avy += c.vy;
      n++;
      minX = Math.min(minX, pose.x);
      maxX = Math.max(maxX, pose.x);
      minY = Math.min(minY, pose.y);
      maxY = Math.max(maxY, pose.y);
    }
    if (!n) return;
    // One lean for the group: the leading edge rises a little, as before.
    const span = Math.max(LEAN_SPAN, maxX - minX, maxY - minY);
    const lean = LEAN_SPAN / span;
    const perSpeed = tidy ? TIDY_TILT_PER_SPEED : TILT_PER_SPEED;
    const maxTilt = tidy ? TIDY_MAX_TILT : MAX_TILT;
    const sx = Math.tan(clamp((avx / n) * perSpeed, -maxTilt, maxTilt) * lean);
    const sy = Math.tan(clamp((avy / n) * perSpeed, -maxTilt, maxTilt) * lean);
    const cx = this.cursor.x, cy = this.cursor.y;

    // Rise over what lies under (or just ahead of) any held card.
    const spots = this.surfaces();
    const want = planeBase(spots, cx, cy, sx, sy, LIFT);
    const floor = planeBase(spots, cx, cy, sx, sy, 0);
    if (Number.isNaN(this.base)) this.base = want;
    else this.base += (want - this.base) * Math.min(1, dt * (want > this.base ? RISE_RATE : FALL_RATE));
    this.base = Math.max(this.base, floor);

    this.normal.set(-sx, -sy, 1).normalize();
    this.qTilt.setFromUnitVectors(DragController.UP, this.normal);
    const join = Math.exp(-JOIN_RATE * dt);
    const square = Math.min(1, dt * SQUARE_RATE);
    for (const c of this.held) {
      const pose = layer.pose(c.uid);
      if (!pose) continue;
      // Tidy mode: a card held at an angle turns to the nearest quarter turn as it goes.
      // A card heading for another turn (R while held, or a quarter turn in Tidy mode) swings there.
      if (tidy && c.yawTo !== snapYaw(c.yawTo)) c.yawTo = snapYaw(c.yawTo);
      if (c.yaw !== c.yawTo) {
        const d = shortAngle(c.yawTo - c.yaw);
        c.yaw = Math.abs(d) < 1e-4 ? c.yawTo : c.yaw + d * square;
      }
      // F in the hand: turning over.
      if (!Number.isNaN(c.rollTo)) {
        const d = c.rollTo - pose.roll;
        if (Math.abs(d) < 1e-3) {
          const card = this.app.store.cards.get(c.uid);
          pose.roll = card?.faceUp === false ? Math.PI : 0;
          c.rollTo = NaN;
        } else {
          pose.roll += d * Math.min(1, dt * FLIP_RATE);
        }
      }
      const planeZ = this.base + c.dz + sx * (pose.x - cx) + sy * (pose.y - cy);
      // Picked-up cards close the gap to the plane quickly, then ride on it.
      c.ez = Number.isNaN(c.ez) ? pose.z - planeZ : c.ez * join;
      pose.z = planeZ + c.ez;
      // The card's own turn and side, then the group's lean.
      this.euler.set(0, 0, c.yaw, 'ZXY');
      this.qCard.setFromEuler(this.euler);
      this.qPart.setFromAxisAngle(DragController.AXIS_Y, pose.roll);
      this.qCard.premultiply(this.qTilt).multiply(this.qPart);
      this.euler.setFromQuaternion(this.qCard, 'ZXY');
      pose.tiltX = this.euler.x;
      pose.tiltY = wrapAngle(this.euler.y - pose.roll);
      pose.yaw = c.yaw + wrapAngle(this.euler.z - c.yaw);
      layer.touch(c.uid);
    }
  }

  /** For every held card, where it is and the top of the table's cards under it now or just ahead of it. */
  private surfaces(): HeldSpot[] {
    const layer = this.app.layer;
    const held = new Set(this.held.map((c) => c.uid));
    const out: HeldSpot[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const ahead: Footprint[] = [];
    for (const c of this.held) {
      const pose = layer.pose(c.uid);
      if (!pose) continue;
      const fx = pose.x + c.vx * LOOK_AHEAD_S, fy = pose.y + c.vy * LOOK_AHEAD_S;
      ahead.push({ x: fx, y: fy, yaw: pose.yaw });
      out.push({ x: pose.x, y: pose.y, dz: c.dz, surface: 0 });
      minX = Math.min(minX, pose.x, fx);
      maxX = Math.max(maxX, pose.x, fx);
      minY = Math.min(minY, pose.y, fy);
      maxY = Math.max(maxY, pose.y, fy);
    }
    // Only the table's cards near the group can be under it.
    const pad = HALF_DIAG * 2;
    const near: { x: number; y: number; yaw: number; top: number }[] = [];
    layer.forEach((uid, p) => {
      if (held.has(uid) || p.x < minX - pad || p.x > maxX + pad || p.y < minY - pad || p.y > maxY + pad) return;
      near.push({ x: p.x, y: p.y, yaw: p.yaw, top: restingTop(p.z, p.tiltX, p.tiltY, HALF_DIAG) });
    });
    if (!near.length) return out;
    out.forEach((spot, i) => {
      const now = { x: spot.x, y: spot.y, yaw: ahead[i].yaw };
      for (const t of near) {
        if (t.top <= spot.surface) continue;
        if (overlaps(t, now) || overlaps(t, ahead[i])) spot.surface = t.top;
      }
    });
    return out;
  }

  private finish(): void {
    // A card let go mid-flip finishes the turn by the short way, not a whole extra spin.
    for (const c of this.held) {
      const pose = this.app.layer.pose(c.uid);
      const card = this.app.store.cards.get(c.uid);
      if (Number.isNaN(c.rollTo) || !pose || !card) continue;
      const side = card.faceUp ? 0 : Math.PI;
      pose.roll -= 2 * Math.PI * Math.round((pose.roll - side) / (2 * Math.PI));
      c.rollTo = NaN;
    }
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
      const rest = card ? restPose(this.app, card) : { z: c.home.z, tiltX: 0, tiltY: 0 };
      this.app.motion.animate(c.uid, { ...c.home, ...rest, roll: card?.faceUp === false ? Math.PI : 0 }, { duration: 200 });
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
   * open table, or any group dropped on a messy pile, when Tidy mode is off
   * (spec 10.4, 15.4). Returns false when the landing is a tidy one.
   */
  /**
   * Every drop falls through physics when Tidy mode is off (decision 94):
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
      const spots = held.map((c) => ({ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw: tidy ? snapYaw(c.base) : c.base }));
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
        return stackAt(app, uids, { x: base.x, y: base.y, yaw: snapYaw(base.yaw) }, moving);
      }
      if (!pile || pile.kind === 'stack' || uids.length === 1 || mode !== 'gather') {
        // Join the top as a loose stack (decision 94).
        return pileAt(app, uids, { x: top.x, y: top.y, yaw: top.yaw }, moving);
      }
      // A messy pile takes the cards messily (Tidy mode off).
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
      const turned = c.yaw;
      const yaw = tidy ? snapYaw(turned) : turned;
      return placeSequential(app, uids, [{ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw }], moving);
    }
    if (mode === 'rigid') {
      const b = held[0];
      // Tidy mode squares the lifted pile up at a quarter turn where it is drawn.
      if (tidy) return stackAt(app, uids, { x: this.cursor.x + b.ox, y: this.cursor.y + b.oy, yaw: snapYaw(b.base) }, moving);
      // Otherwise it lands as the pile it was, a loose one staying loose (decision 98).
      return placeSequential(app, uids, held.map((c) => ({ x: this.cursor.x + c.ox, y: this.cursor.y + c.oy, yaw: c.base })), moving);
    }
    // A gathered group becomes a stack at the drop point (decision 5), loose unless Tidy mode is on (decisions 94, 98).
    return pileAt(app, uids, { x: this.cursor.x, y: this.cursor.y, yaw: this.groupTurn }, moving);
  }
}

/**
 * A flick is a fast cursor movement followed by a sharp reversal. Given the
 * smoothed velocity before this move and the new one (px/s), returns the
 * unit direction to toss in, or null.
 */
/** A held card's position on the table, its height in the group, and the top of what is under it. */
export interface HeldSpot {
  x: number;
  y: number;
  dz: number;
  surface: number;
}

/**
 * Height at the cursor (cx, cy) of the held group's shared plane, which has
 * slope (sx, sy): just high enough that every card's lowest corner keeps
 * `lift` above what is under it, and never less than `lift` over bare table
 * (decision 97). Cards lie on the plane at their own `dz` above it.
 */
export function planeBase(cards: HeldSpot[], cx: number, cy: number, sx: number, sy: number, lift: number): number {
  const corner = HALF_DIAG * Math.hypot(sx, sy);
  let base = lift + CARD_T / 2;
  for (const c of cards) {
    const need = c.surface + CARD_T / 2 + Math.max(lift, MIN_CLEAR + corner) - c.dz - (sx * (c.x - cx) + sy * (c.y - cy));
    if (need > base) base = need;
  }
  return base;
}

/** An angle brought into -pi..pi. */
function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

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
