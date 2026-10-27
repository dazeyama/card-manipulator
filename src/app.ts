// The app context: owns the store, renderer, camera and the per-frame loop,
// and keeps the instanced cards in step with the model.

import * as THREE from 'three';
import { Store } from './state/store';
import { CARD_T, type Card } from './state/types';
import { SceneView } from './render/scene';
import { CameraRig } from './render/camera';
import { Atlas, BACK_KEY, drawPlaceholder, type Slot } from './render/atlas';
import { CardLayer, type Pose } from './render/cards';
import { Motion } from './physics/motion';

export const ACCENT = new THREE.Color('#2563eb');

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
  /** Last cursor position over the canvas, in canvas pixels. */
  readonly pointer = { x: 0, y: 0, inside: false };
  /** Per-frame hooks run before rendering. */
  private readonly frameHooks: ((now: number, dt: number) => void)[] = [];
  private lastFrame = performance.now();
  /** Frame time samples for the performance readout. */
  readonly frameTimes: number[] = [];

  constructor(readonly root: HTMLElement) {
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

  onFrame(fn: (now: number, dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  /** Atlas slots for a card's front and back. Overridden once images exist (Phase 2). */
  slotsFor: (card: Card) => { front: Slot; back: Slot } = (card) => {
    const key = `ph:${card.scryfallId}`;
    let front = this.atlas.get(key);
    if (!front) {
      front = this.atlas.allocate(key);
      this.atlas.draw(front, drawPlaceholder(card.scryfallId.replace(/^placeholder:/, '')));
    }
    return { front, back: this.atlas.get(BACK_KEY)! };
  };

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
export function levelZ(level: number): number {
  return CARD_T / 2 + level * CARD_T;
}
