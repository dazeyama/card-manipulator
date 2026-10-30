// Tilted camera with limited orbit, pan and zoom toward the cursor (spec 7.2).

import * as THREE from 'three';
import type { CameraState } from '../state/types';

const DEG = Math.PI / 180;
export const DEFAULT_PITCH = 55;
const PITCH_MIN = 25;
const PITCH_MAX = 89;
const YAW_LIMIT = 60;
const FOV = 35;
/** Visible table width limits at the target, millimetres (spec 7.2). */
const MIN_WIDTH = 150;
const MAX_WIDTH = 3600;
export const DEFAULT_DISTANCE = 1400;
const SWING_MS = 450;
/** Z leaves this share of the view clear on each side (decision 212)... */
const FRAME_MARGIN = 0.04;
/** ...and this many pixels more along the bottom, where the hints sit. */
const FRAME_BOTTOM = 40;
/** One notch of the mouse wheel out (mouse.ts zooms by exp(100 * 0.0015) a notch). */
const FRAME_BACK = Math.exp(0.15);

/** The view angles the View button cycles through; Home and double right-click return to the current one. */
export interface ViewPreset {
  name: string;
  pitch: number;
  yaw: number;
}
export const VIEW_PRESETS: ViewPreset[] = [
  { name: 'Tilted', pitch: DEFAULT_PITCH, yaw: 0 },
  { name: 'Top-down', pitch: 89, yaw: 0 },
  { name: 'Low', pitch: 30, yaw: 0 },
  { name: 'Corner', pitch: 45, yaw: -35 },
];

interface View {
  x: number;
  y: number;
  distance: number;
  pitch: number;
  yaw: number;
}

/** Two views the same, give or take rounding: the camera hasn't been moved between them. */
function sameView(a: View, b: View): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.distance / b.distance - 1) < 1e-4 && Math.abs(a.pitch - b.pitch) < 1e-3 && Math.abs(a.yaw - b.yaw) < 1e-3;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  distance = DEFAULT_DISTANCE;
  /** Degrees. */
  pitch = DEFAULT_PITCH;
  yaw = 0;
  /** Set whenever the view changes, cleared by the owner. */
  changed = true;
  /** Index into VIEW_PRESETS of the current default view. */
  preset = 0;
  /**
   * Mirror mode (decision 267): a half turn added to the camera's own turn, so
   * it looks from the far side of the table; the limited orbit (YAW_LIMIT)
   * swings about that. Degrees, eased from `turnFrom` toward `turnTo`.
   */
  private turn = 0;
  private turnFrom = 0;
  private turnTo = 0;
  private turnStart = 0;
  /** A smooth move to another view in progress (cycling and resetting). */
  private swing: { from: View; to: View; start: number } | null = null;
  /** The last Z (decision 276): the view before it, the view it made, and the box it framed. */
  private framed: { from: View; at: View; box: number[] } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private width = 1;
  private height = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 50000);
    this.camera.up.set(0, 0, 1);
    this.update();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.clampDistance();
    this.update();
  }

  get viewport(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Distance range that keeps the visible width between about 150 mm and 3,600 mm. */
  private distanceFor(width: number): number {
    const aspect = this.camera.aspect || 1;
    return width / (2 * Math.tan((FOV * DEG) / 2) * aspect);
  }

  private clampDistance(): void {
    this.distance = THREE.MathUtils.clamp(this.distance, this.distanceFor(MIN_WIDTH), this.distanceFor(MAX_WIDTH));
  }

  update(): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);
    this.yaw = THREE.MathUtils.clamp(this.yaw, -YAW_LIMIT, YAW_LIMIT);
    this.clampDistance();
    const p = this.pitch * DEG;
    const y = (this.yaw + this.turn) * DEG;
    const d = this.distance;
    this.camera.position.set(
      this.target.x + d * Math.cos(p) * Math.sin(y),
      this.target.y - d * Math.cos(p) * Math.cos(y),
      this.target.z + d * Math.sin(p),
    );
    this.camera.lookAt(this.target);
    // A near plane proportional to distance keeps depth precise enough for 0.3 mm cards.
    this.camera.near = Math.max(1, d * 0.05);
    this.camera.far = d * 40;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.changed = true;
  }

  /** Screen pixel (relative to the canvas) to normalised device coordinates. */
  toNdc(sx: number, sy: number, out = this.ndc): THREE.Vector2 {
    return out.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
  }

  rayFrom(sx: number, sy: number): THREE.Ray {
    this.ray.setFromCamera(this.toNdc(sx, sy), this.camera);
    return this.ray.ray;
  }

  /** Where a screen point hits the horizontal plane at height z. */
  screenToPlane(sx: number, sy: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 | null {
    const r = this.rayFrom(sx, sy);
    if (Math.abs(r.direction.z) < 1e-6) return null;
    const t = (z - r.origin.z) / r.direction.z;
    if (t <= 0) return null;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }

  /** World point to screen pixels. */
  worldToScreen(x: number, y: number, z: number, out = new THREE.Vector2()): THREE.Vector2 {
    this.tmp.set(x, y, z).project(this.camera);
    return out.set((this.tmp.x + 1) * 0.5 * this.width, (1 - this.tmp.y) * 0.5 * this.height);
  }

  /** True when the world point is in front of the camera. */
  inFront(x: number, y: number, z: number): boolean {
    this.tmp.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    return this.tmp.z < 0;
  }

  /** Shift the target so that the table point `grab` sits under the screen point again. */
  panTo(grab: THREE.Vector3, sx: number, sy: number): void {
    this.swing = null;
    const now = this.screenToPlane(sx, sy, grab.z);
    if (!now) return;
    this.target.x += grab.x - now.x;
    this.target.y += grab.y - now.y;
    this.update();
  }

  /** Zoom by a factor toward the table point under the cursor. */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.swing = null;
    const before = this.screenToPlane(sx, sy, 0);
    this.distance *= factor;
    this.update();
    if (!before) return;
    const after = this.screenToPlane(sx, sy, 0);
    if (!after) return;
    this.target.x += before.x - after.x;
    this.target.y += before.y - after.y;
    this.update();
  }

  orbit(dxPixels: number, dyPixels: number): void {
    this.swing = null;
    this.yaw -= dxPixels * 0.25;
    this.pitch += dyPixels * 0.25;
    this.update();
  }

  /** Back to the table's centre at the default zoom, looking from the current preset's angle. */
  reset(smooth = true): void {
    const p = VIEW_PRESETS[this.preset];
    const to = { x: 0, y: 0, distance: DEFAULT_DISTANCE, pitch: p.pitch, yaw: p.yaw };
    if (smooth) this.swingTo(to, performance.now());
    else this.jump(to);
  }

  /** Switch to the next preset angle, keeping where the camera looks and how far out it is. */
  cycle(): ViewPreset {
    this.preset = (this.preset + 1) % VIEW_PRESETS.length;
    this.straighten();
    return VIEW_PRESETS[this.preset];
  }

  /** Swing back to the current preset's angle, keeping where the camera looks and how far out it is. */
  straighten(): void {
    const p = VIEW_PRESETS[this.preset];
    this.swingTo({ x: this.target.x, y: this.target.y, distance: this.distance, pitch: p.pitch, yaw: p.yaw }, performance.now());
  }

  private view(): View {
    return { x: this.target.x, y: this.target.y, distance: this.distance, pitch: this.pitch, yaw: this.yaw };
  }

  private jump(v: View): void {
    this.swing = null;
    this.target.set(v.x, v.y, 0);
    this.distance = v.distance;
    this.pitch = v.pitch;
    this.yaw = v.yaw;
    this.update();
  }

  private swingTo(to: View, now: number): void {
    this.swing = { from: this.view(), to, start: now };
  }

  /** On the far side of the table (decision 267), or turning there. */
  get mirrored(): boolean {
    return this.turnTo === 180;
  }

  /** Swing round to the far side of the table, or back (decision 267). */
  setMirrored(on: boolean): void {
    const to = on ? 180 : 0;
    if (to === this.turnTo) return;
    this.turnFrom = this.turn;
    this.turnTo = to;
    this.turnStart = performance.now();
  }

  /** Advance a swing in progress; called once a frame. */
  step(now: number): void {
    if (this.turn !== this.turnTo) {
      const t = Math.min(1, (now - this.turnStart) / (SWING_MS * 1.6));
      const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.turn = t >= 1 ? this.turnTo : this.turnFrom + (this.turnTo - this.turnFrom) * k;
      this.update();
    }
    const s = this.swing;
    if (!s) return;
    const t = Math.min(1, (now - s.start) / SWING_MS);
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const a = s.from, b = s.to;
    // Zoom in log space so a long zoom feels even.
    const distance = a.distance * (b.distance / a.distance) ** k;
    this.jump({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, distance, pitch: a.pitch + (b.pitch - a.pitch) * k, yaw: a.yaw + (b.yaw - a.yaw) * k });
    if (t < 1) this.swing = s;
  }

  get swinging(): boolean {
    return this.swing !== null;
  }

  /**
   * Move the camera to fit a table-space box (spec 7.2, Z). The box is fitted
   * as the tilted camera actually sees it (decision 212): as close as keeps all
   * its corners on screen with a small margin, and centred in the view, so a
   * big group fills the screen, then backed off one wheel notch (decision 213).
   * Never closer than one card's framing, which stays as it was.
   */
  frame(minX: number, minY: number, maxX: number, maxY: number, top = 0): void {
    // Z again on the same thing, the camera untouched since: back to the view from before (decision 276).
    const box = [minX, minY, maxX, maxY, top];
    const before = this.view();
    const f = this.framed;
    const still = !!f && !this.swing && sameView(before, f.at);
    this.framed = null;
    if (still && f.box.every((v, i) => Math.abs(v - box[i]) < 0.5)) {
      this.swingTo(f.from, performance.now());
      return;
    }
    this.swing = null;
    const aspect = this.camera.aspect || 1;
    const nearest = this.distanceFor(Math.max(90 * 1.35, 120 * 1.35 * aspect * 1.25)) + top;
    const corners: [number, number, number][] = [];
    for (const z of [0, top]) for (const x of [minX, maxX]) for (const y of [minY, maxY]) corners.push([x, y, z]);
    // The part of the canvas to fit into: a small margin, and room for the hints along the bottom.
    const left = this.width * FRAME_MARGIN, right = this.width * (1 - FRAME_MARGIN);
    const upper = this.height * FRAME_MARGIN, lower = this.height * (1 - FRAME_MARGIN) - FRAME_BOTTOM;
    const s = new THREE.Vector2();
    const bounds = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y, z] of corners) {
        this.worldToScreen(x, y, z, s);
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
        y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      return { x0, y0, x1, y1 };
    };
    const fits = (d: number) => {
      this.distance = d;
      this.update();
      const b = bounds();
      return b.x0 >= left && b.x1 <= right && b.y0 >= upper && b.y1 <= lower;
    };
    const fit = () => {
      let lo = nearest, hi = this.distanceFor(MAX_WIDTH);
      if (!fits(lo)) {
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) hi = mid;
          else lo = mid;
        }
        lo = hi;
      }
      this.distance = lo;
      this.update();
    };
    this.target.set((minX + maxX) / 2, (minY + maxY) / 2, 0);
    // The near side of a tilted box looks bigger, so its centre is not the view's: nudge and fit again.
    for (let pass = 0; pass < 3; pass++) {
      fit();
      if (pass === 2) break;
      const b = bounds();
      const cx = (left + right) / 2, cy = (upper + lower) / 2;
      const from = this.screenToPlane(cx, cy, 0);
      const to = this.screenToPlane(cx + (b.x0 + b.x1) / 2 - cx, cy + (b.y0 + b.y1) / 2 - cy, 0);
      if (!from || !to) break;
      this.target.x += to.x - from.x;
      this.target.y += to.y - from.y;
    }
    // A group then sits one mouse-wheel step further out than the tightest fit (decision 213).
    if (this.distance > nearest + 1e-6) {
      this.distance *= FRAME_BACK;
      this.update();
    }
    // Framing one thing after another keeps the view from before the first.
    this.framed = { from: still ? f.from : before, at: this.view(), box };
  }

  /** Visible table width in millimetres at the target. */
  visibleWidth(): number {
    return 2 * this.distance * Math.tan((FOV * DEG) / 2) * this.camera.aspect;
  }

  toState(): CameraState {
    return {
      target: [this.target.x, this.target.y, this.target.z],
      distance: this.distance,
      pitch: this.pitch,
      yaw: this.yaw,
    };
  }

  fromState(s: CameraState): void {
    this.swing = null;
    this.target.set(s.target[0], s.target[1], s.target[2]);
    this.distance = s.distance;
    this.pitch = s.pitch;
    this.yaw = s.yaw;
    this.update();
  }
}
