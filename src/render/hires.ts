// Close-up quality (spec 8.3): when a card is bigger than about 160 px on
// screen (100 px in High graphics, decision 152), the hovered card and the
// cards nearest the middle of the view get Scryfall's `normal` image (`large`
// in High) through a pool of individual textures,
// drawn as a plane just above the card's face. The plane is inset 2 mm so the
// instanced card's border, selection rim and rounded corners still show. Any
// card with at least 5% of its face showing qualifies, so every card of a fan
// sharpens, not just the top one (decision 101). A foil card's close-up
// image carries the same foil sheen as the card under it (decision 211).

import * as THREE from 'three';
import type { App } from '../app';
import { visibleShare } from '../state/piles';
import { CARD_H, CARD_T, CARD_W } from '../state/types';
import { FOIL_GLSL } from './cards';
import { ImageLoader } from './images';

/** How close-up images behave; the graphics mode sets these (decision 152). */
export interface HiResQuality {
  /** Shown once a card is this many CSS pixels tall. */
  abovePx: number;
  /** At most this many cards at once, keeping this many textures. */
  max: number;
  pool: number;
  image: 'normal' | 'large';
  anisotropy: number;
}
/** A card gets a close-up image once at least this share of its face shows (decision 101). */
const MIN_SHOWING = 0.05;
const INSET = 2;

interface Overlay {
  uid: string;
  url: string;
  foil: boolean;
  mesh: THREE.Mesh;
}

export class HiRes {
  private readonly loaders = { normal: new ImageLoader(488, 680), large: new ImageLoader(672, 936) };
  private quality: HiResQuality = { abovePx: 160, max: 32, pool: 64, image: 'normal', anisotropy: 8 };
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
    const close = this.cardPixels() > this.quality.abovePx;
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
      // Up with the card when hovering pops it above the cards on it (decision 173).
      this.p.set(pose.x, pose.y, pose.z + this.app.layer.lift(o.uid));
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
      // A card hidden from this browser in a room shows its back up close too (ONLINE.md 7.3).
      if (!card.faceUp || !app.store.canSee(card)) continue;
      const pose = app.layer.pose(card.uid);
      if (!pose) continue;
      const s = rig.worldToScreen(pose.x, pose.y, pose.z);
      if (s.x < -100 || s.y < -150 || s.x > width + 100 || s.y > height + 150) continue;
      scored.push({ uid: card.uid, d: Math.hypot(s.x - cx, s.y - cy) });
    }
    scored.sort((a, b) => a.d - b.d);
    const want = new Set<string>();
    const hovered = this.hovered ? app.store.cards.get(this.hovered) : undefined;
    if (hovered && app.store.canSee(hovered)) want.add(hovered.uid);
    // Nearest the middle first; a card whose face is almost all covered is skipped.
    for (const s of scored) {
      if (want.size >= this.quality.max) break;
      if (this.showing(s.uid) >= MIN_SHOWING) want.add(s.uid);
    }
    for (const [uid, o] of this.overlays) {
      // A card that turned foil or nonfoil gets a fresh overlay.
      if (!want.has(uid) || o.foil !== this.isFoil(uid)) {
        this.group.remove(o.mesh);
        (o.mesh.material as THREE.Material).dispose();
        this.overlays.delete(uid);
      }
    }
    for (const uid of want) if (!this.overlays.has(uid)) this.attach(uid);
  }

  /** How much of a card's face the cards above it in its pile leave showing (0 to 1). */
  private showing(uid: string): number {
    const pile = this.app.store.pileOf(uid);
    if (!pile) return 1;
    const i = pile.cardUids.indexOf(uid);
    if (i === pile.cardUids.length - 1) return 1;
    // In a neat stack every card under the top one is hidden.
    if (pile.kind === 'stack') return 0;
    const layer = this.app.layer;
    const me = layer.pose(uid);
    if (!me) return 0;
    const above = [];
    for (let k = i + 1; k < pile.cardUids.length; k++) {
      const p = layer.pose(pile.cardUids[k]);
      if (p) above.push(p);
    }
    return visibleShare(me, above);
  }

  private attach(uid: string): void {
    const card = this.app.store.cards.get(uid);
    const r = card && this.app.store.recordOf(card);
    // Scryfall's large image sits at the same path as the normal one.
    const url = this.quality.image === 'large' ? r?.image_normal?.replace('/normal/', '/large/') : r?.image_normal;
    if (!url) return;
    const tex = this.textures.get(url);
    if (!tex) {
      this.request(url);
      return;
    }
    const foil = this.isFoil(uid);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    if (foil) this.addFoil(mat);
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.overlays.set(uid, { uid, url, foil, mesh });
  }

  private isFoil(uid: string): boolean {
    const card = this.app.store.cards.get(uid);
    return !!card && card.finish !== 'nonfoil';
  }

  /** The card's own foil sheen, drawn over the close-up image (decision 211). */
  private addFoil(mat: THREE.MeshLambertMaterial): void {
    const time = this.app.layer.timeUniform;
    mat.customProgramCacheKey = () => 'hires-foil';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = 'varying vec3 vLocal;\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vLocal = position;
vWorldP = (modelMatrix * vec4(position, 1.0)).xyz;
vWorldN = normalize(mat3(modelMatrix) * normal);`);
      shader.fragmentShader = 'uniform float uTime;\nvarying vec3 vLocal;\nvarying vec3 vWorldN;\nvarying vec3 vWorldP;\n' + FOIL_GLSL + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += foilSheen(vLocal.xy, normalize(vWorldN), vWorldP);`);
    };
  }

  private request(url: string): void {
    if (this.loading.has(url)) return;
    this.loading.add(url);
    this.loaders[url.includes('/large/') ? 'large' : 'normal']
      .load(url, 1)
      .then((bmp) => {
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.quality.anisotropy;
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
    if (this.textures.size <= this.quality.pool) return;
    const inUse = new Set([...this.overlays.values()].map((o) => o.url));
    for (const [url, tex] of this.textures) {
      if (this.textures.size <= this.quality.pool) break;
      if (inUse.has(url)) continue;
      tex.dispose();
      this.textures.delete(url);
    }
  }

  /** Switch graphics mode: a new image size starts over with fresh textures. */
  setQuality(q: HiResQuality): void {
    const restart = q.image !== this.quality.image || q.anisotropy !== this.quality.anisotropy;
    this.quality = { ...q };
    if (restart) {
      this.clear();
      for (const tex of this.textures.values()) tex.dispose();
      this.textures.clear();
    }
    this.evict();
    this.lastPick = 0;
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
