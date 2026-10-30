// Dice on the table (decision 255): D drops a 20 mm die at the cursor; dice
// select (click, Ctrl + click, a marquee) and drag like cards, landing on
// whatever is under them; R rolls them, a real physics tumble; 1 to 6 set the
// number on top; Delete removes them. Keys act on the die under the cursor
// first, then the selected dice, as cards do (decision 254).

import * as THREE from 'three';
import type { App } from './app';
import type { CustomGesture, Mods } from './input/mouse';
import { FLICK_SPEED, flickDirection } from './physics/feel';
import { shortAngle } from './physics/motion';
import type { DiceLayer } from './render/dice';
import { DIE_SIZE, dieTurn, gatherOffsets, valueUp, yawOf, type Die } from './state/dice';
import { newUid } from './state/store';
import { snapYaw } from './state/piles';
import { isStand, standHeightAt } from './state/stand';
import { CARD_H, CARD_T, CARD_W } from './state/types';

/** Held dice ride this far above what is under them, mm. */
const CARRY = 16;
/** How quickly held dice close in on their places under the cursor, 1/s (decision 256). */
const GLIDE_RATE = 18;
/** Held dice lean into their motion (decision 261): radians per mm/s, at most this much, eased at this rate (1/s). */
const SWAY_PER_SPEED = 0.0012;
const SWAY_MAX = 0.5;
const SWAY_RATE = 10;
/** A held die swings round to its new turn at this rate, 1/s, as cards do (decision 275). */
const FACE_RATE = 14;
/** Dice carried with cards ride this far clear of the cards' clump, mm (decision 274). */
const ASIDE_GAP = 10;
/** Dice let go with cards wait at most this long for them to come to rest, ms. */
const SETTLE_MAX_MS = 3000;

type HeldDie = { uid: string; ox: number; oy: number; die: Die };

export class Dice {
  readonly selected = new Set<string>();
  /** The die under the mouse, if any. */
  hovered: string | null = null;
  /** Dice being dragged or rolled: hands off. */
  private readonly busy = new Set<string>();
  /** Each carried die's smoothed speed on the table, mm/s, and its own wobble's phase (decision 261). */
  private readonly sway = new Map<string, { vx: number; vy: number; phase: number }>();
  /** Turn each held die still has to swing through on screen: turned to face you, or squared to a gathered block (decision 275). */
  private readonly face = new Map<string, number>();
  /** Dice being dragged, and where each is heading under the cursor. */
  private carrying: { uid: string; x: number; y: number; die: Die }[] | null = null;
  /** Dice let go with cards, hanging where they were let go until those cards come to rest (decision 274). */
  private landing: { dice: { uid: string; x: number; y: number; die: Die }[]; cards: string[]; since: number }[] = [];
  /**
   * Dragging selected dice brings the selected cards along (decision 274): main.ts
   * starts their drag from the press, gathered `aside` from the cursor, or
   * in formation with Alt.
   */
  cardsAlong: ((sx: number, sy: number, alt: boolean, aside: { x: number; y: number }) => CustomGesture | null) | null = null;

  /** True while dice are being carried (for the cursor, decision 260). */
  get dragging(): boolean {
    return !!this.carrying;
  }

  constructor(private readonly app: App, private readonly layer: DiceLayer) {
    window.addEventListener('pointermove', (e) => {
      const r = app.canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this.hovered = inside && app.store.dice.size ? layer.pick(e.clientX - r.left, e.clientY - r.top) : null;
    });
    // Choosing cards takes the selection away from the dice, but not cards swept up while carrying dice with them (decision 274).
    app.store.events.on('selection', () => {
      if (app.store.selection.size && !this.carrying) this.select([]);
    });
    app.onFrame((_now, dt) => this.glide(dt));
    app.store.events.on('dice', () => {
      for (const u of [...this.selected]) if (!app.store.dice.has(u)) this.selected.delete(u);
      layer.setSelected(this.selected);
    });
  }

  /** Held dice close in on their places under the cursor, a share each frame. */
  private glide(dt: number): void {
    this.settle();
    const moving = [...(this.carrying ?? []), ...this.landing.flatMap((l) => l.dice)];
    if (!moving.length) {
      this.sway.clear();
      this.face.clear();
      return;
    }
    const k = 1 - Math.exp(-GLIDE_RATE * dt);
    const ease = 1 - Math.exp(-SWAY_RATE * dt);
    const skip = new Set(moving.map((c) => c.uid));
    const t = performance.now() / 1000;
    for (const c of moving) {
      const now = this.layer.drawnAt(c.uid)?.position;
      const x = now ? now.x + (c.x - now.x) * k : c.x, y = now ? now.y + (c.y - now.y) * k : c.y;
      // Loose in the hand (decision 261): it leans and tips the way it is moving,
      // rises a little with speed, and wobbles a touch, as held cards do.
      const sw = this.sway.get(c.uid) ?? { vx: 0, vy: 0, phase: Math.random() * 6 };
      if (now && dt > 0) {
        sw.vx += ((x - now.x) / dt - sw.vx) * ease;
        sw.vy += ((y - now.y) / dt - sw.vy) * ease;
      }
      this.sway.set(c.uid, sw);
      // Tidy mode (decision 262): held perfectly level, square to the table, no lean or wobble.
      const tidy = this.app.tidy;
      const speed = Math.hypot(sw.vx, sw.vy);
      const lean = tidy ? 0 : Math.min(SWAY_MAX, speed * SWAY_PER_SPEED);
      let face = this.face.get(c.uid) ?? 0;
      if (face) {
        face = Math.abs(face) < 1e-3 ? 0 : face - face * Math.min(1, dt * FACE_RATE);
        this.face.set(c.uid, face);
      }
      const q = dieTurn(c.die.value, tidy ? this.square(c.die.yaw) + face : c.die.yaw + face + Math.sin(t * 3.1 + sw.phase) * 0.06);
      if (lean > 1e-4) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-sw.vy / speed, sw.vx / speed, 0), lean));
      const bob = tidy ? 0 : Math.min(6, speed * 0.012) + Math.sin(t * 4.3 + sw.phase) * 0.8;
      this.layer.pose(c.uid, { x, y, z: this.surfaceAt(x, y, skip) + DIE_SIZE / 2 + CARRY + bob }, q);
    }
  }

  /**
   * Dice let go with cards land once those cards have come to rest, on top of
   * them if they are under (decision 274), or after a few seconds whatever happens.
   */
  private settle(): void {
    if (!this.landing.length) return;
    const app = this.app;
    const now = performance.now();
    const still = (u: string) => !app.motion.isAnimating(u) && !app.motion.held.has(u) && !app.physics?.falling(u);
    const done = this.landing.filter((l) => now - l.since > SETTLE_MAX_MS || l.cards.every(still));
    if (!done.length) return;
    this.landing = this.landing.filter((l) => !done.includes(l));
    const skip = new Set(done.flatMap((l) => l.dice.map((d) => d.uid)));
    const moved = done.flatMap((l) => l.dice).filter((d) => app.store.dice.has(d.uid))
      .map((d) => ({ ...d.die, x: d.x, y: d.y, z: this.surfaceAt(d.x, d.y, skip) + DIE_SIZE / 2, yaw: this.square(d.die.yaw) }));
    for (const u of skip) {
      this.busy.delete(u);
      this.layer.carried.delete(u);
    }
    app.store.setDice(moved);
  }

  /**
   * Where dice carried with cards ride (decision 274): a block this far to the
   * right of the cursor as you see it, clear of the cards' clump; on the table.
   */
  asideFor(count: number, sx: number, sy: number): { x: number; y: number } {
    const a = this.app.rig.screenToPlane(sx, sy, 0), b = this.app.rig.screenToPlane(sx + 60, sy, 0);
    if (!a || !b) return { x: 0, y: 0 };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const spots = gatherOffsets(count);
    const half = Math.max(...spots.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) + DIE_SIZE / 2;
    const far = CARD_H / 2 + ASIDE_GAP + half;
    return { x: ((b.x - a.x) / len) * far, y: ((b.y - a.y) / len) * far };
  }

  /** In Tidy mode (Ctrl held, or Shift + T), a turn snapped to the nearest quarter (decision 262). */
  private square(yaw: number): number {
    return this.app.tidy ? snapYaw(yaw) : yaw;
  }

  /** What keys act on: the die under the cursor unless it is one of the selected, else the selected dice. */
  targets(): string[] {
    const dice = this.app.store.dice;
    if (this.hovered && dice.has(this.hovered) && !this.selected.has(this.hovered)) return [this.hovered];
    return [...this.selected].filter((u) => dice.has(u) && !this.busy.has(u));
  }

  select(uids: Iterable<string>, add = false): void {
    if (!add) this.selected.clear();
    for (const u of uids) this.selected.add(u);
    this.layer.setSelected(this.selected);
  }

  /** The top of what is under a die's spot: cards, a card stand, or the table. */
  private surfaceAt(x: number, y: number, skip: Set<string> = new Set()): number {
    let top = 0;
    const reach = DIE_SIZE / 2;
    this.app.layer.forEach((_uid, p) => {
      const dx = x - p.x, dy = y - p.y;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      if (Math.abs(dx * c + dy * s) < CARD_W / 2 + reach * 0.5 && Math.abs(-dx * s + dy * c) < CARD_H / 2 + reach * 0.5) top = Math.max(top, p.z + CARD_T / 2);
    });
    for (const m of this.app.store.mats.values()) if (isStand(m)) top = Math.max(top, standHeightAt(m, x, y));
    for (const d of this.app.store.dice.values()) {
      if (skip.has(d.uid) || Math.abs(d.x - x) > DIE_SIZE || Math.abs(d.y - y) > DIE_SIZE) continue;
      top = Math.max(top, d.z + DIE_SIZE / 2);
    }
    return top;
  }

  /** D: a new die at the cursor, showing 1, on whatever is there. */
  spawn(at: { x: number; y: number }): void {
    // Facing the side that spawns it (decision 267).
    const die: Die = { uid: newUid('d'), x: at.x, y: at.y, z: this.surfaceAt(at.x, at.y) + DIE_SIZE / 2, yaw: this.square(this.app.facing + (Math.random() - 0.5) * 0.6), value: 1, side: this.app.side || undefined };
    this.app.store.setDice([die]);
  }

  /** 1-6: set the number on top. */
  set(uids: string[], value: number): void {
    const dice = this.app.store.dice;
    this.app.store.setDice(uids.map((u) => dice.get(u)).filter((d): d is Die => !!d).map((d) => ({ ...d, value })));
  }

  remove(uids: string[]): void {
    this.app.store.removeDice(uids);
  }

  /**
   * R: roll them, a real tumble; without physics yet, they just come up at
   * random. A shake while carrying them throws them its way (`toss`, a unit
   * direction on the table), from where they are drawn (decision 257).
   */
  roll(uids: string[], toss?: { x: number; y: number }): void {
    const store = this.app.store;
    const dice = uids.map((u) => store.dice.get(u)).filter((d): d is Die => !!d && (!this.busy.has(d.uid) || !!toss));
    if (!dice.length) return;
    const physics = this.app.physics;
    const start = dice.map((d) => {
      const drawn = toss ? this.layer.drawnAt(d.uid) : null;
      return drawn
        ? { uid: d.uid, x: drawn.position.x, y: drawn.position.y, z: drawn.position.z, q: drawn.quaternion.clone() }
        : { uid: d.uid, x: d.x, y: d.y, z: d.z, q: dieTurn(d.value, d.yaw) };
    });
    const ok = physics?.rollDice(
      start,
      (uid, at, q) => this.layer.pose(uid, at, q),
      (rest) => {
        for (const r of rest) {
          this.busy.delete(r.uid);
          this.layer.carried.delete(r.uid);
        }
        // Where each came to rest, flat on whatever it landed on, showing the face that came up.
        store.setDice(rest.filter((r) => store.dice.has(r.uid)).map((r) => {
          const skip = new Set([r.uid]);
          return { uid: r.uid, x: r.x, y: r.y, z: this.surfaceAt(r.x, r.y, skip) + DIE_SIZE / 2, yaw: this.square(yawOf(r.q)), value: valueUp(r.q) };
        }));
      },
      toss,
    );
    if (ok) {
      for (const d of dice) {
        this.busy.add(d.uid);
        this.layer.carried.add(d.uid);
      }
      return;
    }
    for (const d of dice) {
      this.busy.delete(d.uid);
      this.layer.carried.delete(d.uid);
    }
    store.setDice(dice.map((d) => ({ ...d, value: 1 + Math.floor(Math.random() * 6), yaw: d.yaw + (Math.random() - 0.5) * 2 })));
  }

  /** The dice in a screen rectangle, for the marquee. */
  inRect(rect: { x0: number; y0: number; x1: number; y1: number }): string[] {
    const minX = Math.min(rect.x0, rect.x1), maxX = Math.max(rect.x0, rect.x1);
    const minY = Math.min(rect.y0, rect.y1), maxY = Math.max(rect.y0, rect.y1);
    const out: string[] = [];
    for (const d of this.app.store.dice.values()) {
      const s = this.app.rig.worldToScreen(d.x, d.y, d.z);
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) out.push(d.uid);
    }
    return out;
  }

  /**
   * Pick up the selected dice from a grab point on the table. Several gather
   * into a block under the cursor, as cards gather into a stack, or `aside` of
   * it when cards come too; Alt keeps them as they lay, like a card formation
   * (decisions 256, 274).
   */
  private pickUp(grab: { x: number; y: number }, lead: string | null, alt: boolean, aside: { x: number; y: number }): HeldDie[] {
    const store = this.app.store;
    const held = [...this.selected].map((u) => store.dice.get(u)).filter((d): d is Die => !!d && !this.busy.has(d.uid)).map((d) => ({ uid: d.uid, ox: d.x - grab.x, oy: d.y - grab.y, die: { ...d } }));
    // Picked up from the other side of the table: it turns round to face you (decision 267),
    // but not with Alt, which moves them exactly as they lay (decision 275).
    const side = this.app.side;
    for (const h of held) {
      if (alt || (h.die.side ?? 0) === side) continue;
      h.die.yaw += Math.PI;
      h.die.side = side || undefined;
    }
    if (!alt && (held.length > 1 || aside.x || aside.y)) {
      const spots = gatherOffsets(held.length);
      // Square to the die picked up, so the block is neat and no corners clash.
      const yaw = (held.find((h) => h.uid === lead) ?? held[0])?.die.yaw ?? 0;
      held.forEach((h, i) => {
        h.ox = spots[i].x + aside.x;
        h.oy = spots[i].y + aside.y;
        h.die.yaw = yaw;
      });
    }
    // Each swings round to its new turn rather than snapping (decision 275); half a turn goes clockwise, as R does.
    for (const h of held) {
      const was = store.dice.get(h.uid)!.yaw;
      const d = shortAngle(was - h.die.yaw);
      this.face.set(h.uid, Math.abs(Math.abs(d) - Math.PI) < 1e-3 ? Math.PI : d);
      this.busy.add(h.uid);
      this.layer.carried.add(h.uid);
    }
    return held;
  }

  /**
   * A card drag that takes the selected dice along (decision 274): beside the
   * gathered cards, or in formation with them (`alt`). Landing waits for the cards.
   */
  along(cards: CustomGesture | null, sx: number, sy: number, alt: boolean): CustomGesture | null {
    const grab = this.app.rig.screenToPlane(sx, sy, 0);
    if (!grab) return cards;
    const held = this.pickUp(grab, null, alt, alt ? { x: 0, y: 0 } : this.asideFor(this.selected.size, sx, sy));
    if (!held.length) return cards;
    return this.carry(held, sx, sy, cards);
  }

  /**
   * A press on a die: a click selects it (Ctrl + click adds or takes it away),
   * a drag carries it, or all the selected dice if it is one of them, and any
   * selected cards with them (decision 274).
   */
  press(uid: string, sx: number, sy: number, mods: Mods): CustomGesture {
    const app = this.app;
    const store = app.store;
    const grab = app.rig.screenToPlane(sx, sy, 0) ?? new THREE.Vector3();
    let inner: CustomGesture | null = null;
    const begin = () => {
      if (!this.selected.has(uid)) {
        store.clearSelection();
        this.select([uid], mods.ctrl);
      }
      // The selected cards come too: gathered beside the dice, which keep the cursor, or in formation with Alt.
      let cards: CustomGesture | null = null;
      if (store.selection.size && this.cardsAlong) {
        const right = this.asideFor(this.selected.size, sx, sy);
        cards = this.cardsAlong(sx, sy, mods.alt, mods.alt ? { x: 0, y: 0 } : { x: -right.x, y: -right.y });
      }
      inner = this.carry(this.pickUp(grab, uid, mods.alt, { x: 0, y: 0 }), sx, sy, cards);
    };
    return {
      kind: 'custom',
      move: (x, y, e) => {
        if (!inner && Math.hypot(x - sx, y - sy) <= 4) return;
        if (!inner) begin();
        inner!.move(x, y, e);
      },
      up: (x, y, e) => {
        if (inner) return inner.up(x, y, e);
        // A click: select this die, or add it or take it away with Ctrl.
        store.clearSelection();
        if (mods.ctrl) {
          if (this.selected.has(uid)) this.selected.delete(uid);
          else this.selected.add(uid);
          this.layer.setSelected(this.selected);
        } else this.select([uid]);
      },
      cancel: () => inner?.cancel(),
    };
  }

  /**
   * Carry picked-up dice under the cursor, with a card drag running alongside if
   * `cards` (decision 274). The shake that flips held cards rolls held dice
   * (decision 257); let go, they land on what is under them.
   */
  private carry(picked: HeldDie[], sx: number, sy: number, cards: CustomGesture | null): CustomGesture {
    const app = this.app;
    const store = app.store;
    let held: HeldDie[] | null = picked;
    const at = (x: number, y: number) => app.rig.screenToPlane(x, y, 0);
    // The shake that flips held cards rolls held dice (decision 257).
    let last = { x: sx, y: sy, t: performance.now() };
    let vel = { x: 0, y: 0 };
    let tossed = false;
    const shake = (x: number, y: number): boolean => {
      const now = performance.now();
      const dt = Math.max(4, now - last.t) / 1000;
      const v = { x: (x - last.x) / dt, y: (y - last.y) / dt };
      last = { x, y, t: now };
      const prev = vel;
      vel = { x: prev.x * 0.4 + v.x * 0.6, y: prev.y * 0.4 + v.y * 0.6 };
      const dir = held ? flickDirection(prev, v, FLICK_SPEED[store.settings.flick]) : null;
      if (!dir) return false;
      // The screen direction as one on the table.
      const a = at(x, y), b = at(x + dir.x * 60, y + dir.y * 60);
      if (!a || !b) return false;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const uids = held!.map((h) => h.uid);
      held = null;
      this.carrying = null;
      tossed = true;
      this.roll(uids, { x: (b.x - a.x) / len, y: (b.y - a.y) / len });
      return true;
    };
    const skip = () => new Set(held?.map((h) => h.uid) ?? []);
    const finish = (keep: boolean, x: number, y: number) => {
      if (!held) return;
      const p = keep ? at(x, y) : null;
      // Let go with cards: they hang where they were let go until the cards come to rest,
      // then land on them, or on what else is there (decision 274).
      if (p && cards) {
        const uids = [...store.selection];
        this.landing.push({ dice: held.map((h) => ({ uid: h.uid, x: p.x + h.ox, y: p.y + h.oy, die: h.die })), cards: uids, since: performance.now() });
        held = null;
        this.carrying = null;
        return;
      }
      const moved = held.map((h) => {
        this.busy.delete(h.uid);
        this.layer.carried.delete(h.uid);
        if (!p) return h.die;
        const nx = p.x + h.ox, ny = p.y + h.oy;
        return { ...h.die, x: nx, y: ny, z: this.surfaceAt(nx, ny, skip()) + DIE_SIZE / 2, yaw: this.square(h.die.yaw) };
      });
      held = null;
      this.carrying = null;
      store.setDice(moved);
    };
    return {
      kind: 'custom',
      move: (x, y, e) => {
        cards?.move(x, y, e);
        if (tossed || shake(x, y)) return;
        const p = at(x, y);
        if (!p || !held) return;
        // Each frame they glide in to their places (glide), so the gathering shows.
        this.carrying = held.map((h) => ({ uid: h.uid, x: p.x + h.ox, y: p.y + h.oy, die: h.die }));
      },
      up: (x, y, e) => {
        // The cards first, so the dice can wait for where they land.
        cards?.up(x, y, e);
        if (!tossed) finish(true, x, y);
      },
      cancel: () => {
        cards?.cancel();
        finish(false, sx, sy);
      },
    };
  }
}
