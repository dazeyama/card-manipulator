// Flags on the table (decision 327): a pole with a cloth naming the flag and
// counting its cards, standing in a tinted circle, its zone. A card whose
// centre lies in the zone is the flag's, wherever in it the card lies; zones
// never overlap. A flag with a filter turns away cards that don't match it,
// out past the edge with a shake and a notice: cards this browser's user
// puts down there, and the cards a flag lands on when placed or moved.
//
// B arms placing (the next click sets a flag down, and its box opens). Drag
// the pole or the cloth to move the flag alone; its hover buttons are ✏️
// (name, filter, colour), ⤓ (export its cards) and 🔒; Delete over a flag
// takes it away, leaving its cards. Rooms hear of every change through the
// store's `flag` op (ONLINE.md O114).

import * as THREE from 'three';
import type { App } from './app';
import { land, placeSequential } from './commands';
import type { CustomGesture, Mods } from './input/mouse';
import { allowedNow } from './online/guard';
import { compileQuery } from './query/evaluate';
import { clearOf, FLAG_PULL, FLAG_REACH, flagOfCard, membersOf, nextColour, nextName, outsideSpot, type Flag } from './state/flags';
import { remoteHeld } from './state/remoteHeld';
import { newUid } from './state/store';
import { queryCard } from './state/selection';
import { FlagEditor } from './ui/flagEditor';

/** The pole: how tall, and how thick (mm). */
const POLE_H = 170;
const POLE_R = 2.5;
/** The cloth's height on the table, mm; its width follows the text. */
const CLOTH_H = 46;
/** The cloth's texture: this many pixels tall, so the text stays sharp up close. */
const CLOTH_PX = 128;
/** Pulled cards end this far in from the pole at most, so a whole card lies inside the zone. */
const FLAG_INSIDE = FLAG_REACH - 55;
/** Drawn over the playmats, under the cards (the mats are at -0.9). */
const ZONE_ORDER = -0.85;

interface Drawn {
  root: THREE.Group;
  zone: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Hinged at the pole's top: turns about the pole and tilts back to face the camera, so the cloth reads from any angle, top-down too. */
  turner: THREE.Group;
  cloth: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /**
   * The cloth's shadow (decision 331): an unseen cloth the same size, hanging
   * straight down from the pole as a real flag would, turned like the one you
   * see but never tilted, so the shadow stays joined to the pole's.
   */
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shadowTurner: THREE.Group;
  /** A thicker, unseen pole, so the thin one is easy to grab. */
  grip: THREE.Mesh;
  text: string;
  colour: string;
  /** The cloth's width, mm. */
  width: number;
}

export interface FlagDeps {
  /** Whether a card is under the cursor: then the zone under it isn't hovered. */
  cardHovered: () => boolean;
  /** Export cards as a decklist from near a screen point (the Export panel). */
  exportCards: (uids: string[], label: string, near: { x: number; y: number }) => void;
}

export class Flags {
  private readonly group = new THREE.Group();
  private readonly drawn = new Map<string, Drawn>();
  private readonly poleGeometry = new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 12).rotateX(Math.PI / 2).translate(0, 0, POLE_H / 2);
  private readonly gripGeometry = new THREE.CylinderGeometry(10, 10, POLE_H, 8).rotateX(Math.PI / 2).translate(0, 0, POLE_H / 2);
  private readonly baseGeometry = new THREE.CylinderGeometry(9, 12, 4, 24).rotateX(Math.PI / 2).translate(0, 0, 2);
  private readonly poleMaterial = new THREE.MeshStandardMaterial({ color: 0x3b3b3f, metalness: 0.5, roughness: 0.45 });
  private readonly gripMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private readonly raycaster = new THREE.Raycaster();
  private readonly buttons: HTMLDivElement;
  private readonly lockButton: HTMLButtonElement;
  private readonly filterTag: HTMLDivElement;
  readonly editor: FlagEditor;
  /** The flag under the mouse (its pole, cloth, or bare zone), or null. */
  hovered: string | null = null;
  /** A flag being dragged, drawn at its new spot until let go. */
  private dragging: { uid: string; x: number; y: number } | null = null;
  /** A dragged flag carries cards (Alt, or Shift's pull): the cursor shows the link (decision 330). */
  private carrying = false;
  /** The unlocked flag whose pole or cloth is under the mouse: a press there picks it up (the open glove). */
  grabbable: string | null = null;

  /** A flag is in hand: the cursor shows the fist (decision 330). */
  get holding(): { carrying: boolean } | null {
    return this.dragging ? { carrying: this.carrying } : null;
  }
  /** Card counts on the cloths are worked out again when something changed. */
  private countsDirty = true;
  private readonly counts = new Map<string, number>();
  /** Cards this browser's user added or moved since the filters were last kept. */
  private touched = new Set<string>();
  private loading = false;

  constructor(private readonly app: App, private readonly deps: FlagDeps) {
    app.view.scene.add(this.group);
    this.editor = new FlagEditor(app, {
      saved: (f) => this.keepOut(f.uid),
      remove: (uid) => this.remove(uid),
    });
    const store = app.store;
    store.events.on('flags', () => {
      this.sync();
      this.countsDirty = true;
    });
    store.events.on('reset', () => {
      this.sync();
      this.countsDirty = true;
      this.loading = true;
      queueMicrotask(() => (this.loading = false));
    });
    const note = (uids: string[]) => {
      this.countsDirty = true;
      // Another player's change is theirs to keep in line (their browser does it).
      if (store.origin === 'remote' || this.loading) return;
      for (const u of uids) this.touched.add(u);
    };
    store.events.on('moved', note);
    store.events.on('added', note);
    store.events.on('removed', () => (this.countsDirty = true));
    store.events.on('records', () => (this.countsDirty = true));

    // Hover buttons over the cloth: ✏️ name, filter and colour; ⤓ export; 🔒 lock.
    const button = (text: string, title: string, run: (uid: string, el: HTMLElement) => void) => {
      const b = document.createElement('button');
      b.className = 'mat-mirror-btn';
      b.textContent = text;
      b.title = title;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => {
        if (this.hovered) run(this.hovered, b);
      });
      return b;
    };
    const edit = button('✏️', 'Name, filter and colour', (uid, el) => {
      if (allowedNow('flag')) this.edit(uid, el);
    });
    const out = button('⤓', 'Export this flag’s cards as a decklist', (uid, el) => {
      const f = store.flags.get(uid);
      const r = el.getBoundingClientRect();
      if (f) deps.exportCards(this.members(f).map((c) => c.uid), f.name, { x: r.left + r.width / 2, y: r.bottom });
    });
    this.lockButton = button('🔓', '', (uid) => {
      const f = store.flags.get(uid);
      if (f && allowedNow('flag')) store.setFlags([{ ...f, locked: !f.locked || undefined }]);
    });
    this.buttons = document.createElement('div');
    this.buttons.className = 'flag-buttons';
    this.buttons.hidden = true;
    // Under the buttons, the flag's filter while it is hovered (decision 332).
    this.filterTag = document.createElement('div');
    this.filterTag.className = 'flag-filter';
    this.buttons.append(edit, out, this.lockButton, this.filterTag);
    app.overlay.append(this.buttons);

    app.onFrame(() => this.frame());
    this.sync();
  }

  /** B: arm placing a flag, or put it down again. */
  arm(): void {
    if (this.app.flagging) {
      this.app.flagging = false;
      return;
    }
    if (!allowedNow('flag')) return;
    this.app.drawing = null;
    this.app.spreading = null;
    this.app.placing = null;
    this.app.flagging = true;
  }

  /** The click after B: a new flag there, clear of the others, and its box open to name it. */
  placeAt(at: { x: number; y: number }, near: { x: number; y: number }): void {
    this.app.flagging = false;
    const store = this.app.store;
    const spot = clearOf(at, store.flags.values());
    const f: Flag = { uid: newUid('g'), name: nextName(store.flags.values()), filter: null, colour: nextColour(store.flags.values()), x: spot.x, y: spot.y };
    store.setFlags([f]);
    this.editor.show(f.uid, near, true);
  }

  /** Open a flag's box under a button or the cloth. */
  edit(uid: string, el?: HTMLElement): void {
    const r = el?.getBoundingClientRect();
    const near = r ? { x: r.left + r.width / 2, y: r.bottom } : this.screenOf(uid);
    this.editor.show(uid, near);
  }

  /** Take a flag away; its cards stay where they lie. */
  remove(uid: string): void {
    if (!this.app.store.flags.has(uid)) return;
    this.app.store.setFlags([], [uid]);
    if (this.hovered === uid) this.hovered = null;
  }

  /** The flag whose pole or cloth is under a screen point (canvas pixels), or null. */
  pick(sx: number, sy: number): string | null {
    this.raycaster.ray.copy(this.app.rig.rayFrom(sx, sy));
    let best: string | null = null;
    let near = Infinity;
    for (const [uid, d] of this.drawn) {
      const hit = this.raycaster.intersectObjects([d.grip, d.cloth], false)[0];
      if (hit && hit.distance < near) {
        near = hit.distance;
        best = uid;
      }
    }
    return best;
  }

  /**
   * A press on a flag's pole or cloth: drag it, or (a click) open its box.
   * Null if it is locked. Dragged plainly, the flag moves alone; with **Alt**
   * its cards ride along, keeping their layout, as a playmat's do; while
   * **Shift** is held it is a black hole (decision 329): every card within
   * 44 cm of the pole that the flag's filter takes is pulled into the zone and
   * carried, along with the cards already there.
   */
  press(uid: string, sx: number, sy: number, mods: Mods): CustomGesture | null {
    const app = this.app;
    const store = app.store;
    const f = store.flags.get(uid);
    if (!f || f.locked) return null;
    const grab = app.rig.screenToPlane(sx, sy, 0);
    if (!grab) return null;
    let moved = false;
    /** Cards carried: their offset from the pole now (o), where it is heading (t), and whether Shift pulled them in. */
    let riders: Map<string, { ox: number; oy: number; tx: number; ty: number; pulled: boolean }> | null = null;
    const fits = this.fitter(f);
    const carry = () => {
      if (riders) return;
      this.carrying = true;
      riders = new Map();
      for (const c of this.members(f)) {
        if (app.motion.held.has(c.uid) || remoteHeld.has(c.uid)) continue;
        app.motion.cancel(c.uid);
        app.motion.held.add(c.uid);
        const o = { ox: c.x - f.x, oy: c.y - f.y };
        riders.set(c.uid, { ...o, tx: o.ox, ty: o.oy, pulled: false });
      }
    };
    /** Shift: pull in what lies within reach of the pole, into the zone, where the filter allows. */
    const pull = (at: { x: number; y: number }) => {
      const flags = [...store.flags.values()].filter((o) => o.uid !== uid);
      for (const c of store.cards.values()) {
        if (riders!.has(c.uid) || c.stand || app.motion.held.has(c.uid) || remoteHeld.has(c.uid)) continue;
        const dx = c.x - at.x;
        const dy = c.y - at.y;
        const d = Math.hypot(dx, dy);
        if (d > FLAG_PULL) continue;
        // Another flag's card stays that flag's; a card the filter won't take stays put.
        if (flagOfCard(flags, c) || (fits && !fits(c.uid))) continue;
        const k = d > FLAG_INSIDE ? FLAG_INSIDE / d : 1;
        app.motion.cancel(c.uid);
        app.motion.held.add(c.uid);
        riders!.set(c.uid, { ox: dx, oy: dy, tx: dx * k, ty: dy * k, pulled: true });
      }
    };
    const release = () => {
      for (const u of riders?.keys() ?? []) app.motion.held.delete(u);
    };
    return {
      kind: 'custom',
      move: (x, y, e) => {
        if (!moved && Math.hypot(x - sx, y - sy) <= 4) return;
        if (!moved) {
          // In a room, moving a flag needs Move, as a playmat does (ONLINE.md 6.2).
          if (!allowedNow('flag')) return;
          moved = true;
          if (mods.alt) carry();
        }
        const p = app.rig.screenToPlane(x, y, 0);
        if (!p) return;
        const at = { x: f.x + p.x - grab.x, y: f.y + p.y - grab.y };
        this.dragging = { uid, ...at };
        if (e.shiftKey) {
          carry();
          pull(at);
        }
        // The carried cards follow the pole; the pulled ones slide in towards it.
        for (const [u, r] of riders ?? []) {
          r.ox += (r.tx - r.ox) * 0.3;
          r.oy += (r.ty - r.oy) * 0.3;
          const pose = app.layer.pose(u);
          if (!pose) continue;
          pose.x = at.x + r.ox;
          pose.y = at.y + r.oy;
          app.layer.touch(u);
        }
      },
      up: () => {
        const to = this.dragging;
        this.dragging = null;
        this.carrying = false;
        if (!moved) {
          store.clearSelection();
          this.edit(uid);
          return;
        }
        if (!to) return release();
        const others = [...store.flags.values()].filter((o) => o.uid !== uid);
        const spot = clearOf(to, others);
        if (riders?.size) {
          // The cards that were there keep their layout and height; the pulled ones land on what is under them.
          const kept = [...riders].filter(([, r]) => !r.pulled);
          // Bottom first, so cards pulled from one stack land in the same order.
          const pulled = [...riders].filter(([, r]) => r.pulled).sort(([a], [b]) => store.cards.get(a)!.z - store.cards.get(b)!.z);
          if (kept.length) {
            store.moveCards(kept.map(([u, r]) => ({ uid: u, x: spot.x + r.tx, y: spot.y + r.ty })));
            for (const [u] of kept) {
              app.motion.held.delete(u);
              const c = store.cards.get(u);
              const pose = app.layer.pose(u);
              if (c && pose) {
                pose.x = c.x;
                pose.y = c.y;
                app.layer.touch(u);
              }
            }
            store.events.emit('settled', kept.map(([u]) => u));
          }
          if (pulled.length) {
            for (const [u] of pulled) app.motion.held.delete(u);
            const uids = pulled.map(([u]) => u);
            const spots = pulled.map(([u, r]) => ({ x: spot.x + r.tx, y: spot.y + r.ty, yaw: store.cards.get(u)!.yaw }));
            land(app, placeSequential(app, uids, spots), { duration: 160, stagger: 0 });
          }
        }
        store.setFlags([{ ...f, x: spot.x, y: spot.y }]);
        // Set down on cards: the ones that don't match go out past the edge.
        this.keepOut(uid);
      },
      cancel: () => {
        this.dragging = null;
        this.carrying = false;
        release();
        // Back where they lie.
        for (const u of riders?.keys() ?? []) {
          const c = store.cards.get(u);
          if (c) app.motion.animate(u, { x: c.x, y: c.y }, { duration: 150 });
        }
      },
    };
  }

  /** A flag's cards. */
  members(f: Flag) {
    return membersOf(f, this.app.store.flags.values(), this.app.store.cards.values());
  }

  /** Whether a card may be in a flag: it matches the filter, or this browser can't see it to tell (rooms). */
  private fitter(f: Flag): ((uid: string) => boolean) | null {
    if (!f.filter) return null;
    const compiled = compileQuery(f.filter);
    if (!compiled.ok) return null;
    const store = this.app.store;
    return (uid) => {
      const c = store.cards.get(uid);
      return !c || !store.canSee(c) || compiled.test(queryCard(store, c));
    };
  }

  /** Every card in a flag's zone that its filter won't take goes out past the edge. */
  keepOut(uid: string): void {
    const f = this.app.store.flags.get(uid);
    const fits = f && this.fitter(f);
    if (!f || !fits) return;
    const out = this.members(f).map((c) => c.uid).filter((u) => !fits(u) && !this.app.motion.held.has(u));
    if (out.length) this.turnAway(f, out);
  }

  /**
   * After piles are detected (pileSync): the cards this browser's user just
   * put down in a filtered flag's zone that don't match it go out past the edge.
   */
  keepFilters(): void {
    if (!this.touched.size) return;
    const touched = this.touched;
    this.touched = new Set();
    const store = this.app.store;
    if (!store.flags.size) return;
    const flags = [...store.flags.values()];
    const out = new Map<Flag, string[]>();
    const fitters = new Map<Flag, ((uid: string) => boolean) | null>();
    for (const u of touched) {
      const c = store.cards.get(u);
      if (!c || this.app.motion.held.has(u)) continue;
      const f = flagOfCard(flags, c);
      if (!f) continue;
      if (!fitters.has(f)) fitters.set(f, this.fitter(f));
      const fits = fitters.get(f);
      if (fits && !fits(u)) out.set(f, [...(out.get(f) ?? []), u]);
    }
    for (const [f, uids] of out) this.turnAway(f, uids);
  }

  /** Slide cards straight out past a flag's edge, clear of other zones, with a shake and a notice. */
  private turnAway(f: Flag, uids: string[]): void {
    const app = this.app;
    const store = app.store;
    const flags = [...store.flags.values()];
    const spots = uids.map((u) => {
      const c = store.cards.get(u)!;
      return { ...outsideSpot(f, c, flags), yaw: c.yaw };
    });
    land(app, placeSequential(app, uids, spots), { duration: 300, arc: 10 });
    setTimeout(() => {
      for (const u of uids) {
        const c = store.cards.get(u);
        if (!c || !app.layer.pose(u)) continue;
        const base = c.yaw;
        app.motion.animate(u, { yaw: base + 0.12 }, {
          duration: 60,
          done: () => app.motion.animate(u, { yaw: base - 0.1 }, {
            duration: 70,
            done: () => app.motion.animate(u, { yaw: base }, { duration: 60 }),
          }),
        });
      }
    }, 310);
    const label = uids.length === 1 ? '1 card doesn’t' : `${uids.length} cards don’t`;
    store.events.emit('notice', `${label} match ${f.name}: \`${f.filter ?? ''}\``);
  }

  /** The cloth's top on screen, in page pixels: where a flag's box opens. */
  private screenOf(uid: string): { x: number; y: number } {
    const f = this.app.store.flags.get(uid);
    const r = this.app.canvas.getBoundingClientRect();
    if (!f) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const s = this.app.rig.worldToScreen(f.x, f.y, POLE_H);
    return { x: r.left + s.x, y: r.top + s.y };
  }

  // ---- drawing ----

  /** Meshes for every flag, made, changed or taken away to match the store. */
  private sync(): void {
    const store = this.app.store;
    for (const [uid, d] of this.drawn) {
      if (store.flags.has(uid)) continue;
      this.group.remove(d.root);
      d.zone.geometry.dispose();
      d.zone.material.dispose();
      d.ring.geometry.dispose();
      d.ring.material.dispose();
      d.cloth.geometry.dispose();
      d.cloth.material.map?.dispose();
      d.cloth.material.dispose();
      d.shadow.geometry.dispose();
      d.shadow.material.dispose();
      this.drawn.delete(uid);
    }
    for (const f of store.flags.values()) {
      let d = this.drawn.get(f.uid);
      if (!d) {
        d = this.make();
        this.drawn.set(f.uid, d);
        this.group.add(d.root);
      }
      if (d.colour !== f.colour) {
        d.colour = f.colour;
        d.zone.material.color.set(f.colour);
        d.ring.material.color.set(f.colour);
        d.text = '';
      }
      d.root.position.set(f.x, f.y, 0);
    }
  }

  private make(): Drawn {
    const root = new THREE.Group();
    // Blended, but drawn with the opaque things, so the render order puts the tint
    // after the table and mats and before the cards (a transparent material would
    // be drawn after every card, over them).
    const tint = (opacity: number) => new THREE.MeshBasicMaterial({
      opacity, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const zone = new THREE.Mesh(new THREE.CircleGeometry(FLAG_REACH, 96), tint(0.1));
    const ring = new THREE.Mesh(new THREE.RingGeometry(FLAG_REACH - 4, FLAG_REACH, 128), tint(0.55));
    zone.renderOrder = ZONE_ORDER;
    ring.renderOrder = ZONE_ORDER + 0.01;
    zone.position.z = ring.position.z = 0.2;
    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    pole.castShadow = true;
    const base = new THREE.Mesh(this.baseGeometry, this.poleMaterial);
    base.castShadow = true;
    const grip = new THREE.Mesh(this.gripGeometry, this.gripMaterial);
    const turner = new THREE.Group();
    turner.position.z = POLE_H - 4;
    // Turn about the pole first, then tilt back about the hinge.
    turner.rotation.order = 'ZXY';
    // Upright, facing -y (towards the default camera); the turner swings it round to face the camera.
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }));
    // The tilted cloth casts no shadow: its shadow would hang in the air, cut off from the pole's.
    turner.add(cloth);
    // Seen by the sun only: it draws nothing, but fills the shadow map.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    shadow.castShadow = true;
    const shadowTurner = new THREE.Group();
    shadowTurner.position.z = turner.position.z;
    shadowTurner.add(shadow);
    root.add(zone, ring, pole, base, grip, turner, shadowTurner);
    return { root, zone, ring, turner, cloth, grip, shadow, shadowTurner, text: '', colour: '', width: 0 };
  }

  /** Paint a cloth's text: the name and the count, on the flag's colour. */
  private paint(d: Drawn, text: string, colour: string): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = `700 ${Math.round(CLOTH_PX * 0.5)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.font = font;
    const pad = CLOTH_PX * 0.3;
    canvas.width = Math.ceil(ctx.measureText(text).width + pad * 2);
    canvas.height = CLOTH_PX;
    ctx.font = font;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Dark text on the light colours, white on the rest.
    const rgb = new THREE.Color(colour);
    ctx.fillStyle = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b > 0.62 ? '#1d1d1f' : '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, CLOTH_PX / 2 + CLOTH_PX * 0.03);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    d.cloth.material.map?.dispose();
    d.cloth.material.map = tex;
    d.cloth.material.needsUpdate = true;
    d.width = (CLOTH_H * canvas.width) / canvas.height;
    // Hung from the pole's top, out to one side.
    d.cloth.scale.set(d.width, 1, CLOTH_H);
    d.cloth.position.set(d.width / 2 + POLE_R, 0, -CLOTH_H / 2);
    d.shadow.scale.copy(d.cloth.scale);
    d.shadow.position.copy(d.cloth.position);
    d.text = text;
  }

  private frame(): void {
    const app = this.app;
    const store = app.store;
    if (this.countsDirty) {
      this.countsDirty = false;
      this.counts.clear();
      const flags = [...store.flags.values()];
      for (const c of store.cards.values()) {
        const f = flagOfCard(flags, c);
        if (f) this.counts.set(f.uid, (this.counts.get(f.uid) ?? 0) + 1);
      }
    }
    const cam = app.rig.camera.position;
    for (const f of store.flags.values()) {
      const d = this.drawn.get(f.uid);
      if (!d) continue;
      const text = `${f.name} · ${this.counts.get(f.uid) ?? 0}`;
      if (text !== d.text) this.paint(d, text, f.colour);
      const at = this.dragging?.uid === f.uid ? this.dragging : f;
      d.root.position.set(at.x, at.y, 0);
      // The cloth faces the camera: turned about the pole, and tilted back as far as the camera looks down.
      const dx = cam.x - at.x;
      const dy = cam.y - at.y;
      d.turner.rotation.z = Math.atan2(dx, -dy);
      d.shadowTurner.rotation.z = d.turner.rotation.z;
      d.turner.rotation.x = -Math.atan2(cam.z - d.turner.position.z, Math.hypot(dx, dy));
    }
    // The flag under the mouse: its pole or cloth, or its bare zone (no card under the cursor).
    const p = app.pointer;
    let hovered: string | null = null;
    this.grabbable = null;
    if (!p.inside) {
      if (!this.buttons.matches(':hover')) this.hovered = null;
    } else if (!this.buttons.matches(':hover')) {
      hovered = this.pick(p.x, p.y);
      if (hovered && !store.flags.get(hovered)?.locked) this.grabbable = hovered;
      if (!hovered && !this.deps.cardHovered()) {
        const t = app.rig.screenToPlane(p.x, p.y, 0);
        hovered = t ? flagOfCard(store.flags.values(), t)?.uid ?? null : null;
      }
      this.hovered = hovered;
    }
    const f = this.hovered ? store.flags.get(this.hovered) : undefined;
    const show = !!f && !this.dragging && !app.flagging;
    this.buttons.hidden = !show;
    if (show) {
      const s = app.rig.worldToScreen(f.x, f.y, POLE_H);
      this.buttons.style.transform = `translate(${Math.round(s.x + 8)}px, ${Math.round(s.y - 44)}px)`;
      this.lockButton.textContent = f.locked ? '🔒' : '🔓';
      this.lockButton.classList.toggle('on', !!f.locked);
      this.lockButton.title = f.locked ? 'Unlock: let the flag be moved and taken away' : 'Lock the flag in place';
      this.filterTag.hidden = !f.filter;
      if (f.filter && this.filterTag.textContent !== f.filter) {
        const pill = document.createElement('span');
        pill.textContent = f.filter;
        this.filterTag.replaceChildren(pill);
      }
    }
  }
}
