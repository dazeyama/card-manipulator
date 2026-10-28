// Close-up quality (spec 8.3): when a card is bigger than about 160 px on
// screen, the hovered card and the cards nearest the middle of the view get
// Scryfall's `normal` image through a small pool of individual textures,
// drawn as a plane just above the card's face. The plane is inset 2 mm so the
// instanced card's border, selection rim and rounded corners still show.

import * as THREE from 'three';
import type { App } from '../app';
import { CARD_H, CARD_T, CARD_W } from '../state/types';
import { ImageLoader } from './images';

const SHOW_ABOVE_PX = 160;
const MAX_OVERLAYS = 24;
const TEXTURE_POOL = 48;
const INSET = 2;

interface Overlay {
  uid: string;
  url: string;
  mesh: THREE.Mesh;
}

export class HiRes {
  private readonly loader = new ImageLoader(488, 680);
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly loading = new Set<string>();
  private readonly overlays = new Map<string, Overlay>();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly group = new THREE.Group();
  private lastPick = 0;
  hovered: string | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly lift = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(private readonly app: App) {
    this.geometry = new THREE.PlaneGeometry(CARD_W - INSET * 2, CARD_H - INSET * 2);
    // The plane shows only the inner part of the image, so it lines up with the card below.
    const uv = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = INSET / CARD_W, v0 = INSET / CARD_H;
    // ImageBitmaps upload top row first, so v runs down the image.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (1 - 2 * u0), 1 - (v0 + uv.getY(i) * (1 - 2 * v0)));
    this.lift.makeTranslation(0, 0, CARD_T / 2 + 0.03);
    this.group.matrixAutoUpdate = false;
    app.view.scene.add(this.group);
    app.onFrame((now) => this.update(now));
  }

  /** On-screen height of a card at the view's centre, in pixels. */
  private cardPixels(): number {
    const rig = this.app.rig;
    const fov = (rig.camera.fov * Math.PI) / 180;
    const pxPerMm = rig.viewport.height / (2 * rig.distance * Math.tan(fov / 2));
    return CARD_H * pxPerMm;
  }

  private update(now: number): void {
    const close = this.cardPixels() > SHOW_ABOVE_PX;
    if (!close) {
      if (this.overlays.size) this.clear();
      return;
    }
    if (now - this.lastPick > 150) {
      this.lastPick = now;
      this.pick();
    }
    // Follow the drawn cards every frame (drags, flips, tweens).
    for (const o of this.overlays.values()) {
      const pose = this.app.layer.pose(o.uid);
      const card = this.app.store.cards.get(o.uid);
      if (!pose || !card) continue;
      this.p.set(pose.x, pose.y, pose.z);
      this.e.set(pose.tiltX, pose.roll + pose.tiltY, pose.yaw, 'ZXY');
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.one).multiply(this.lift);
      o.mesh.matrix.copy(this.m);
      // Only while the front faces up; the small back image is fine for backs.
      o.mesh.visible = Math.cos(pose.roll) > 0.2;
    }
  }

  /** Choose which cards get a big image: the hovered one, then those nearest the centre of the view. */
  private pick(): void {
    const app = this.app;
    const rig = app.rig;
    const { width, height } = rig.viewport;
    const cx = width / 2, cy = height / 2;
    const scored: { uid: string; d: number }[] = [];
    for (const card of app.store.cards.values()) {
      if (!card.faceUp) continue;
      const pose = app.layer.pose(card.uid);
      if (!pose) continue;
      const s = rig.worldToScreen(pose.x, pose.y, pose.z);
      if (s.x < -100 || s.y < -150 || s.x > width + 100 || s.y > height + 150) continue;
      // Prefer cards that are on top: a card buried in a stack shows no face.
      if (this.covered(card.uid)) continue;
      scored.push({ uid: card.uid, d: Math.hypot(s.x - cx, s.y - cy) });
    }
    scored.sort((a, b) => a.d - b.d);
    const want = new Set<string>();
    if (this.hovered && app.store.cards.has(this.hovered)) want.add(this.hovered);
    for (const s of scored) {
      if (want.size >= MAX_OVERLAYS) break;
      want.add(s.uid);
    }
    for (const [uid, o] of this.overlays) {
      if (!want.has(uid)) {
        this.group.remove(o.mesh);
        (o.mesh.material as THREE.Material).dispose();
        this.overlays.delete(uid);
      }
    }
    for (const uid of want) if (!this.overlays.has(uid)) this.attach(uid);
  }

  /** True if another card lies on top of this one (it is in a stack or under a messy pile). */
  private covered(uid: string): boolean {
    const pile = this.app.store.pileOf(uid);
    return !!pile && pile.cardUids[pile.cardUids.length - 1] !== uid;
  }

  private attach(uid: string): void {
    const card = this.app.store.cards.get(uid);
    const r = card && this.app.store.records.get(card.scryfallId);
    const url = r?.image_normal;
    if (!url) return;
    const tex = this.textures.get(url);
    if (!tex) {
      this.request(url);
      return;
    }
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.overlays.set(uid, { uid, url, mesh });
  }

  private request(url: string): void {
    if (this.loading.has(url)) return;
    this.loading.add(url);
    this.loader
      .load(url, 1)
      .then((bmp) => {
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.flipY = false;
        tex.needsUpdate = true;
        this.textures.set(url, tex);
        this.evict();
        this.lastPick = 0;
      })
      .catch(() => {})
      .finally(() => this.loading.delete(url));
  }

  /** Keep the texture pool small: drop the oldest textures no overlay uses. */
  private evict(): void {
    if (this.textures.size <= TEXTURE_POOL) return;
    const inUse = new Set([...this.overlays.values()].map((o) => o.url));
    for (const [url, tex] of this.textures) {
      if (this.textures.size <= TEXTURE_POOL) break;
      if (inUse.has(url)) continue;
      tex.dispose();
      this.textures.delete(url);
    }
  }

  private clear(): void {
    for (const o of this.overlays.values()) {
      this.group.remove(o.mesh);
      (o.mesh.material as THREE.Material).dispose();
    }
    this.overlays.clear();
  }

  get count(): number {
    return this.overlays.size;
  }
}
