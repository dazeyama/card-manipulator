// The app context: owns the store, renderer, camera and the per-frame loop,
// and keeps the instanced cards in step with the model.

import * as THREE from 'three';
import { Store } from './state/store';
import { CARD_T, type Card } from './state/types';
import { SceneView } from './render/scene';
import { CameraRig } from './render/camera';
import { Atlas, type Slot } from './render/atlas';
import { CardImages } from './render/cardImages';
import { CardLayer, type Pose } from './render/cards';
import { Motion } from './physics/motion';
import type { Physics } from './physics/world';
import type { NamedPiles } from './named';
import type { RestSync } from './physics/restSync';
import type { Mats } from './mats';
import type { Dice } from './dice';
import type { Rest } from './state/rest';

export const ACCENT = new THREE.Color('#2563eb');

/** Actions with their own glove gesture (decision 164). */
export type Gesture = 'shuffle' | 'tidy' | 'flip' | 'rotate' | 'draw' | 'remove' | 'fan';

export function poseOf(card: Card): Pose {
  return { x: card.x, y: card.y, z: card.z, yaw: card.yaw, roll: card.faceUp ? 0 : Math.PI, tiltX: 0, tiltY: 0 };
}

export class App {
  readonly store = new Store();
  readonly canvas: HTMLCanvasElement;
  /** DOM layer over the canvas for badges, marquee and labels. */
  readonly overlay: HTMLDivElement;
  readonly view: SceneView;
  readonly rig = new CameraRig();
  readonly atlas: Atlas;
  readonly layer: CardLayer;
  readonly motion: Motion;
  readonly images: CardImages;
  /** Set once Rapier has loaded (Phase 5); null until then. */
  physics: Physics | null = null;
  /** Named piles (Phase 6), set at boot. */
  named!: NamedPiles;
  /** Resting tilt of cards on the cards under them (decision 99), set at boot. */
  rest: RestSync | null = null;
  /** Playmats (decision 144), set at boot. */
  mats: Mats | null = null;
  /** Dice (decision 255), set at boot. */
  dice: Dice | null = null;
  /** The table point under the cursor the last time it was over the table (spawn "at the cursor"). */
  readonly lastTablePoint = { x: 0, y: 0 };
  /** Last cursor position over the canvas, in canvas pixels. */
  readonly pointer = { x: 0, y: 0, inside: false };
  /** Ctrl is held: Tidy mode is on while it is (decision 129). */
  ctrlHeld = false;
  /** A number was pressed over a pile: the next click deals that many of its top cards as a hand (decision 143). */
  drawing: { count: number; source: string[]; faceDown?: boolean } | null = null;
  /** The action gesture the cursor shows for a moment after a key (decision 164), and when it began. */
  gesture: { name: Gesture; at: number; settle?: string[] } | null = null;
  /** X was pressed: the next click or dragged box on the table spreads these cards there (decision 159); X X, reversed (decision 215). */
  spreading: { source: string[]; reverse?: boolean } | null = null;
  /** Pointer mode: the next click on the table stacks these cards there (decision 189). */
  placing: { source: string[]; faceDown?: boolean } | null = null;
  /** Per-frame hooks run before rendering. */
  private readonly frameHooks: ((now: number, dt: number) => void)[] = [];
  private lastFrame = performance.now();
  /** Frame time samples for the performance readout. */
  readonly frameTimes: number[] = [];

  /** Mirror mode (decision 267): 1 on the far side of the table, 0 on the near side. */
  get side(): 0 | 1 {
    return this.rig.mirrored ? 1 : 0;
  }

  /** The turn that reads the right way up from your side: none, or a half turn in mirror mode. */
  get facing(): number {
    return this.side ? Math.PI : 0;
  }

  /** Tidy mode right now: switched on, or held on with Ctrl (decisions 98, 129). */
  get tidy(): boolean {
    return this.store.settings.tidyDrops || this.ctrlHeld;
  }

  constructor(readonly root: HTMLElement) {
    const keys = (e: KeyboardEvent | PointerEvent) => (this.ctrlHeld = e.ctrlKey || e.metaKey);
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('pointermove', keys);
    window.addEventListener('pointerdown', keys);
    window.addEventListener('blur', () => (this.ctrlHeld = false));
    const stage = document.createElement('div');
    stage.className = 'stage';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'table-canvas';
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    stage.append(this.canvas, this.overlay);
    root.append(stage);

    this.view = new SceneView(this.canvas);
    this.atlas = new Atlas(this.view.renderer, 1);
    this.layer = new CardLayer(this.view.scene, this.atlas, ACCENT);
    this.motion = new Motion(this.layer);
    this.images = new CardImages(this.atlas, this.layer, this.store);
    void this.images.loadBack();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(stage);
    this.resize();

    this.store.events.on('added', (uids) => this.onAdded(uids));
    this.store.events.on('removed', (uids) => uids.forEach((u) => this.layer.remove(u)));
    this.store.events.on('reset', () => this.layer.clear());
    this.store.events.on('selection', () => this.syncSelection());
  }

  resize(): void {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    this.view.resize(w, h);
    this.rig.resize(w, h);
  }

  /**
   * Show an action's glove gesture on the cursor for a moment (decision 164),
   * or until the `settle` cards stop moving (decision 165).
   */
  showGesture(name: Gesture, settle?: string[]): void {
    this.gesture = { name, at: performance.now(), settle };
  }

  onFrame(fn: (now: number, dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  /** Atlas slots for a card's front and back. */
  slotsFor(card: Card): { front: Slot; back: Slot } {
    return this.images.slotsFor(card);
  }

  private onAdded(uids: string[]): void {
    for (const uid of uids) {
      const card = this.store.cards.get(uid);
      if (!card) continue;
      const { front, back } = this.slotsFor(card);
      this.layer.add(uid, poseOf(card), front, back, card.finish !== 'nonfoil');
      if (this.store.selection.has(uid)) this.layer.setSelected(uid, true);
    }
  }

  private selectedDrawn = new Set<string>();

  private syncSelection(): void {
    for (const uid of this.selectedDrawn) if (!this.store.selection.has(uid)) this.layer.setSelected(uid, false);
    for (const uid of this.store.selection) this.layer.setSelected(uid, true);
    this.selectedDrawn = new Set(this.store.selection);
  }

  start(): void {
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      const t0 = performance.now();
      this.motion.update(now);
      this.rig.step(now);
      for (const fn of this.frameHooks) fn(now, dt);
      this.layer.setTime(now / 1000);
      this.layer.update();
      this.atlas.flush(now);
      if (this.rig.changed) {
        this.view.fitToView(this.rig);
        this.rig.changed = false;
      }
      this.view.render(this.rig.camera);
      this.frameTimes.push(performance.now() - t0);
      if (this.frameTimes.length > 240) this.frameTimes.shift();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Table point under the last cursor position (or the view centre). */
  tablePointUnderCursor(): THREE.Vector3 {
    if (this.pointer.inside) {
      const p = this.rig.screenToPlane(this.pointer.x, this.pointer.y, 0);
      if (p) return p;
    }
    return this.rig.target.clone().setZ(0);
  }
}

/** Height of a card's centre when it is `level` cards up from the table. */
/** Where a card's drawn pose rests: tilted on what is under it, or flat at its model height. */
export function restPose(app: App, card: Card): Rest {
  return app.rest?.restOf(card.uid) ?? { z: card.z, tiltX: 0, tiltY: 0 };
}

export function levelZ(level: number): number {
  return CARD_T / 2 + level * CARD_T;
}
