// Dice on the table (decision 255): D drops a 20 mm die at the cursor; dice
// select (click, Ctrl + click, a marquee) and drag like cards, landing on
// whatever is under them; R rolls them, a real physics tumble; 1 to 6 set the
// number on top; Delete removes them. Keys act on the die under the cursor
// first, then the selected dice, as cards do (decision 254).

import * as THREE from 'three';
import type { App } from './app';
import type { CustomGesture, Mods } from './input/mouse';
import { FLICK_SPEED, flickDirection } from './physics/feel';
import type { DiceLayer } from './render/dice';
import { DIE_SIZE, dieTurn, gatherOffsets, valueUp, yawOf, type Die } from './state/dice';
import { newUid } from './state/store';
import { isStand, standHeightAt } from './state/stand';
import { CARD_H, CARD_T, CARD_W } from './state/types';

/** Held dice ride this far above what is under them, mm. */
const CARRY = 16;
/** How quickly held dice close in on their places under the cursor, 1/s (decision 256). */
const GLIDE_RATE = 18;

export class Dice {
  readonly selected = new Set<string>();
  /** The die under the mouse, if any. */
  hovered: string | null = null;
  /** Dice being dragged or rolled: hands off. */
  private readonly busy = new Set<string>();
  /** Dice being dragged, and where each is heading under the cursor. */
  private carrying: { uid: string; x: number; y: number; die: Die }[] | null = null;

  constructor(private readonly app: App, private readonly layer: DiceLayer) {
    window.addEventListener('pointermove', (e) => {
      const r = app.canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this.hovered = inside && app.store.dice.size ? layer.pick(e.clientX - r.left, e.clientY - r.top) : null;
    });
    // Choosing cards takes the selection away from the dice.
    app.store.events.on('selection', () => {
      if (app.store.selection.size) this.select([]);
    });
    app.onFrame((_now, dt) => this.glide(dt));
    app.store.events.on('dice', () => {
      for (const u of [...this.selected]) if (!app.store.dice.has(u)) this.selected.delete(u);
      layer.setSelected(this.selected);
    });
  }

  /** Held dice close in on their places under the cursor, a share each frame. */
  private glide(dt: number): void {
    if (!this.carrying) return;
    const k = 1 - Math.exp(-GLIDE_RATE * dt);
    const skip = new Set(this.carrying.map((c) => c.uid));
    for (const c of this.carrying) {
      const now = this.layer.drawnAt(c.uid)?.position;
      const x = now ? now.x + (c.x - now.x) * k : c.x, y = now ? now.y + (c.y - now.y) * k : c.y;
      this.layer.pose(c.uid, { x, y, z: this.surfaceAt(x, y, skip) + DIE_SIZE / 2 + CARRY }, dieTurn(c.die.value, c.die.yaw));
    }
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
    const die: Die = { uid: newUid('d'), x: at.x, y: at.y, z: this.surfaceAt(at.x, at.y) + DIE_SIZE / 2, yaw: (Math.random() - 0.5) * 0.6, value: 1 };
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
          return { uid: r.uid, x: r.x, y: r.y, z: this.surfaceAt(r.x, r.y, skip) + DIE_SIZE / 2, yaw: yawOf(r.q), value: valueUp(r.q) };
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
   * A press on a die: a click selects it (Ctrl + click adds or takes it away),
   * a drag carries it, or all the selected dice if it is one of them.
   */
  press(uid: string, sx: number, sy: number, mods: Mods): CustomGesture {
    const app = this.app;
    const store = app.store;
    const grab = app.rig.screenToPlane(sx, sy, 0) ?? new THREE.Vector3();
    let held: { uid: string; ox: number; oy: number; die: Die }[] | null = null;
    const begin = () => {
      if (!this.selected.has(uid)) {
        store.clearSelection();
        this.select([uid], mods.ctrl);
      }
      held = [...this.selected].map((u) => store.dice.get(u)).filter((d): d is Die => !!d && !this.busy.has(d.uid)).map((d) => ({ uid: d.uid, ox: d.x - grab.x, oy: d.y - grab.y, die: { ...d } }));
      // Several dice gather together under the cursor, as cards gather into a stack;
      // Alt keeps them as they lay, like a card formation (decision 256).
      if (held.length > 1 && !mods.alt) {
        const spots = gatherOffsets(held.length);
        // Square to the die picked up, so the block is neat and no corners clash.
        const yaw = store.dice.get(uid)?.yaw ?? 0;
        held.forEach((h, i) => {
          h.ox = spots[i].x;
          h.oy = spots[i].y;
          h.die.yaw = yaw;
        });
      }
      for (const h of held) {
        this.busy.add(h.uid);
        this.layer.carried.add(h.uid);
      }
    };
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
      const moved = held.map((h) => {
        this.busy.delete(h.uid);
        this.layer.carried.delete(h.uid);
        if (!p) return h.die;
        const nx = p.x + h.ox, ny = p.y + h.oy;
        return { ...h.die, x: nx, y: ny, z: this.surfaceAt(nx, ny, skip()) + DIE_SIZE / 2 };
      });
      held = null;
      this.carrying = null;
      store.setDice(moved);
    };
    return {
      kind: 'custom',
      move: (x, y) => {
        if (tossed) return;
        if (!held && Math.hypot(x - sx, y - sy) <= 4) return;
        if (!held) begin();
        if (shake(x, y)) return;
        const p = at(x, y);
        if (!p) return;
        // Each frame they glide in to their places (glide), so the gathering shows.
        this.carrying = held!.map((h) => ({ uid: h.uid, x: p.x + h.ox, y: p.y + h.oy, die: h.die }));
      },
      up: (x, y) => {
        if (tossed) return;
        if (held) return finish(true, x, y);
        // A click: select this die, or add it or take it away with Ctrl.
        store.clearSelection();
        if (mods.ctrl) {
          if (this.selected.has(uid)) this.selected.delete(uid);
          else this.selected.add(uid);
          this.layer.setSelected(this.selected);
        } else this.select([uid]);
      },
      cancel: () => finish(false, sx, sy),
    };
  }
}
