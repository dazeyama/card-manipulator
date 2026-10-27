// The feel of dragging (spec 10.1–10.4, 15.5): held cards lift about 10 mm,
// tilt a little toward their motion and follow the cursor through a short
// spring. Gather drags trail the selection in a clump behind the cursor;
// formation and whole-stack drags move the cards as a rigid group.

import type { App } from '../app';
import { land, leaveSpreads, placeSequential, stackAt, type Landing } from '../commands';
import type { CustomGesture } from '../input/mouse';
import { pickCard } from '../render/picking';
import { messyLayout, snapYaw } from '../state/piles';
import { CARD_T, CARD_W } from '../state/types';

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
    // Tossed cards move fast enough to need continuous collision detection.
    if (!physics.drop(loose, undefined, { ccd: true })) return false;
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
    let held = this.held;
    const mode = this.mode;
    this.finish();
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
  private dropLoose(held: Held[], mode: DragMode, sx: number, sy: number): boolean {
    const app = this.app;
    const physics = app.physics;
    if (!physics || app.store.settings.tidyDrops || mode === 'formation') return false;
    const moving = new Set(held.map((c) => c.uid));
    const hit = pickCard(app.rig, app.layer, sx, sy, moving);
    const pile = hit ? [...app.store.piles.values()].find((p) => p.cardUids.includes(hit)) : undefined;
    const ontoMessy = !!pile && pile.kind === 'messy';
    const singleOnTable = !hit && mode === 'single' && !app.named.outlineAt(this.cursor.x, this.cursor.y);
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
      // By membership, not pileId: a merge may already have re-tagged the target's cards.
      const pile = [...store.piles.values()].find((p) => p.cardUids.includes(hit));
      const rest = pile ? pile.cardUids.filter((u) => !moving.has(u)) : [];
      const target = rest.length ? rest : [hit];
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

    // An empty named pile's outline takes the cards as a neat stack (a prepared bin, decision 27).
    const bin = app.named.outlineAt(this.cursor.x, this.cursor.y);
    if (bin) return stackAt(app, uids, { x: bin.anchor.x, y: bin.anchor.y, yaw: bin.yaw }, moving);

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
