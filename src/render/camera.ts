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

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  distance = DEFAULT_DISTANCE;
  /** Degrees. */
  pitch = DEFAULT_PITCH;
  yaw = 0;
  /** Set whenever the view changes, cleared by the owner. */
  changed = true;
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
    const y = this.yaw * DEG;
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
    const now = this.screenToPlane(sx, sy, grab.z);
    if (!now) return;
    this.target.x += grab.x - now.x;
    this.target.y += grab.y - now.y;
    this.update();
  }

  /** Zoom by a factor toward the table point under the cursor. */
  zoomAt(sx: number, sy: number, factor: number): void {
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
    this.yaw -= dxPixels * 0.25;
    this.pitch += dyPixels * 0.25;
    this.update();
  }

  reset(): void {
    this.target.set(0, 0, 0);
    this.distance = DEFAULT_DISTANCE;
    this.pitch = DEFAULT_PITCH;
    this.yaw = 0;
    this.update();
  }

  /** Move the camera to fit a table-space box (spec 7.2, Z). */
  frame(minX: number, minY: number, maxX: number, maxY: number, top = 0): void {
    this.target.set((minX + maxX) / 2, (minY + maxY) / 2, 0);
    const w = Math.max(maxX - minX, 90) * 1.35;
    const h = Math.max(maxY - minY, 120) * 1.35;
    const aspect = this.camera.aspect || 1;
    const fitWidth = Math.max(w, h * aspect * 1.25);
    this.distance = this.distanceFor(fitWidth) + top;
    this.update();
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
    this.target.set(s.target[0], s.target[1], s.target[2]);
    this.distance = s.distance;
    this.pitch = s.pitch;
    this.yaw = s.yaw;
    this.update();
  }
}
