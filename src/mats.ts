// Playmats (decision 144): a card's art on a 61 x 35 cm mat lying on the
// table, always under the cards. A mat is dragged like a card (pressed where
// no card is), moving alone, or carrying the cards on it while Alt is held.
// R turns it, Delete removes it. Hovering one shows a 📺 button in its top
// right corner that opens a mirror window: the mat and its cards from straight
// above, live and clean, for screen sharing.

import * as THREE from 'three';
import type { App } from './app';
import type { CustomGesture, Mods } from './input/mouse';
import { ImageLoader } from './render/images';
import { MAT_H, MAT_W, type Mat } from './state/types';
import { newUid } from './state/store';

/**
 * A mat is 2.5 mm thick, a black rubber base under the art (decision 146).
 * The thickness is for looks only: cards on a mat still lie at table height
 * and are drawn over it.
 */
const MAT_T = 2.5;
/** Rounded corners, like a real playmat. */
const MAT_CORNER = 10;
/**
 * Mats are drawn by order, not by depth (decision 145): after the table
 * (render order -1), before the cards (0), each later mat over earlier ones.
 * They skip the depth test, which also leaves the depth buffer holding the
 * table, so nothing just above the table can flicker against a mat at any
 * zoom or angle.
 */
const MAT_ORDER = -0.9;
const MAT_ORDER_STEP = 0.0001;
/** The art crop is loaded at about Scryfall's size; it is the most detail there is. */
const ART_W = 626;
const ART_H = 457;
/** The mirror window redraws at most this often, ms. */
const MIRROR_EVERY_MS = 33;
/** The mirror's longest side, in device pixels, at most. */
const MIRROR_MAX = 1920;

interface Drawn {
  /** The art on top. */
  mesh: THREE.Mesh;
  /** The black base under it. */
  base: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  art: string;
}

interface Mirror {
  uid: string;
  win: Window;
  canvas: HTMLCanvasElement;
  target: THREE.WebGLRenderTarget | null;
  pixels: Uint8Array;
  last: number;
}

export class Mats {
  private readonly group = new THREE.Group();
  private readonly geometry = matTop();
  private readonly baseGeometry = new THREE.ExtrudeGeometry(matShape(), { depth: MAT_T, bevelEnabled: false, curveSegments: 8 });
  private readonly baseMaterial = new THREE.MeshLambertMaterial({ color: 0x141414, depthTest: false, depthWrite: false });
  private readonly drawn = new Map<string, Drawn>();
  private readonly loader = new ImageLoader(ART_W, ART_H);
  private readonly textures = new Map<string, THREE.Texture>();
  /** The mat under the mouse (whether or not a card is above it), or null. */
  hovered: string | null = null;
  /** A mat being dragged, and whether it carries its cards. */
  dragging: { uid: string; carrying: boolean } | null = null;
  private readonly button: HTMLButtonElement;
  private readonly counts = new Map<string, HTMLDivElement>();
  private alt = false;
  private readonly mirrors: Mirror[] = [];
  private readonly mirrorCam = new THREE.OrthographicCamera(-MAT_W / 2, MAT_W / 2, MAT_H / 2, -MAT_H / 2, 1, 5000);

  constructor(private readonly app: App) {
    app.view.scene.add(this.group);
    app.store.events.on('mats', () => this.sync());
    app.store.events.on('reset', () => this.sync());

    // The 📺 button, shown in the top right corner of the mat under the mouse.
    this.button = document.createElement('button');
    this.button.className = 'mat-mirror-btn';
    this.button.textContent = '📺';
    this.button.title = 'Open a top-down mirror of this playmat in its own window, for screen sharing';
    this.button.hidden = true;
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => {
      if (this.hovered) this.openMirror(this.hovered);
    });
    app.overlay.append(this.button);

    window.addEventListener('pointermove', (e) => {
      this.alt = e.altKey;
      const r = app.canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this.hovered = inside ? this.matAt(e.clientX - r.left, e.clientY - r.top) : null;
    });
    const keys = (e: KeyboardEvent) => (this.alt = e.altKey);
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('blur', () => (this.alt = false));
    app.onFrame((now) => this.frame(now));
    this.sync();
  }

  // ---- spawning, turning, removing ----

  /** Lay a new mat on the table at a spot. */
  spawn(scryfallId: string, name: string, art: string, at: { x: number; y: number }): void {
    this.app.store.addMat({ uid: newUid('m'), scryfallId, name, art, x: at.x, y: at.y, yaw: 0 });
  }

  /** R over a mat: a quarter turn clockwise, like a card. */
  rotate(uid: string): void {
    const m = this.app.store.mats.get(uid);
    if (m) this.app.store.moveMat(uid, m.x, m.y, Math.round((m.yaw - Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2));
  }

  remove(uid: string): void {
    this.app.store.removeMat(uid);
  }

  // ---- drawing ----

  /** Match the meshes to the store's mats. */
  private sync(): void {
    const mats = this.app.store.mats;
    for (const [uid, d] of this.drawn) {
      if (!mats.has(uid)) {
        this.group.remove(d.mesh, d.base);
        d.material.dispose();
        this.drawn.delete(uid);
        this.counts.get(uid)?.remove();
        this.counts.delete(uid);
      }
    }
    let order = 0;
    for (const m of mats.values()) {
      let d = this.drawn.get(m.uid);
      if (!d) {
        const material = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, depthTest: false, depthWrite: false });
        // Shadows fall on the art as if it lay on the table, where the cards really are.
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
#ifdef USE_SHADOWMAP
worldPosition.z -= ${MAT_T.toFixed(2)};
#endif`,
          );
        };
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.receiveShadow = true;
        const base = new THREE.Mesh(this.baseGeometry, this.baseMaterial);
        this.group.add(base, mesh);
        d = { mesh, base, material, art: '' };
        this.drawn.set(m.uid, d);
      }
      if (d.art !== m.art) {
        d.art = m.art;
        void this.texture(m.art).then((tex) => {
          if (!tex || this.drawn.get(m.uid) !== d) return;
          d.material.map = tex;
          d.material.color.set(0xffffff);
          d.material.needsUpdate = true;
        });
      }
      // Each mat's base, then its art; later mats are drawn over earlier ones where they overlap.
      d.base.renderOrder = MAT_ORDER + order * MAT_ORDER_STEP;
      d.mesh.renderOrder = MAT_ORDER + (order + 0.5) * MAT_ORDER_STEP;
      order++;
      d.base.position.set(m.x, m.y, 0);
      d.mesh.position.set(m.x, m.y, MAT_T);
      d.base.rotation.set(0, 0, m.yaw);
      d.mesh.rotation.set(0, 0, m.yaw);
    }
  }

  /** The art, cropped top and bottom to the mat's wide shape. */
  private async texture(url: string): Promise<THREE.Texture | null> {
    const have = this.textures.get(url);
    if (have) return have;
    try {
      const bmp = await this.loader.load(url, 2);
      const tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      // Image bitmaps arrive top row first, so v runs down the image.
      tex.flipY = false;
      const keep = (ART_W / ART_H) / (MAT_W / MAT_H);
      tex.repeat.set(1, -keep);
      tex.offset.set(0, (1 + keep) / 2);
      tex.needsUpdate = true;
      this.textures.set(url, tex);
      return tex;
    } catch {
      return null;
    }
  }

  // ---- picking ----

  /** The top mat under a screen point (cards ignored), or null. */
  matAt(sx: number, sy: number): string | null {
    const p = this.app.rig.screenToPlane(sx, sy, MAT_T);
    if (!p) return null;
    const mats = [...this.app.store.mats.values()];
    for (let i = mats.length - 1; i >= 0; i--) if (onMat(mats[i], p.x, p.y)) return mats[i].uid;
    return null;
  }

  /** Cards whose centre lies on a mat. */
  cardsOn(uid: string): string[] {
    const m = this.app.store.mats.get(uid);
    if (!m) return [];
    return ridersOf(m, this.app.store.cards.values());
  }

  // ---- dragging ----

  /**
   * A press on a mat where no card is. Moving it drags the mat (Alt held:
   * with the cards on it); letting go without moving acts as a click on
   * empty table, clearing the selection.
   */
  press(uid: string, sx: number, sy: number, mods: Mods): CustomGesture {
    const app = this.app;
    const mat = app.store.mats.get(uid)!;
    const grab = app.rig.screenToPlane(sx, sy, 0)!;
    const start = { x: mat.x, y: mat.y };
    let riders: { uid: string; x: number; y: number }[] | null = null;
    let moved = false;
    const finish = (dx: number, dy: number, keep: boolean) => {
      this.dragging = null;
      if (!keep) {
        dx = 0;
        dy = 0;
      }
      app.store.moveMat(uid, start.x + dx, start.y + dy, mat.yaw);
      if (riders?.length) {
        app.store.moveCards(riders.map((r) => ({ uid: r.uid, x: r.x + dx, y: r.y + dy })));
        for (const r of riders) {
          app.motion.held.delete(r.uid);
          const pose = app.layer.pose(r.uid);
          if (pose) {
            pose.x = r.x + dx;
            pose.y = r.y + dy;
            app.layer.touch(r.uid);
          }
        }
        app.store.events.emit('settled', riders.map((r) => r.uid));
      }
    };
    let last = { dx: 0, dy: 0 };
    return {
      kind: 'custom',
      move: (x, y) => {
        if (!moved && Math.hypot(x - sx, y - sy) <= 4) return;
        if (!moved) {
          moved = true;
          // Alt carries the cards lying on the mat (owner's choice).
          if (mods.alt) {
            riders = this.cardsOn(uid).map((u) => {
              const c = app.store.cards.get(u)!;
              app.motion.cancel(u);
              app.motion.held.add(u);
              return { uid: u, x: c.x, y: c.y };
            });
          }
          this.dragging = { uid, carrying: !!riders?.length };
        }
        const p = app.rig.screenToPlane(x, y, 0);
        if (!p) return;
        last = { dx: p.x - grab.x, dy: p.y - grab.y };
        const d = this.drawn.get(uid);
        d?.mesh.position.set(start.x + last.dx, start.y + last.dy, MAT_T);
        d?.base.position.set(start.x + last.dx, start.y + last.dy, 0);
        for (const r of riders ?? []) {
          const pose = app.layer.pose(r.uid);
          if (!pose) continue;
          pose.x = r.x + last.dx;
          pose.y = r.y + last.dy;
          app.layer.touch(r.uid);
        }
      },
      up: () => {
        if (moved) finish(last.dx, last.dy, true);
        else app.store.clearSelection();
      },
      cancel: () => {
        if (moved) finish(0, 0, false);
      },
    };
  }

  // ---- every frame: the 📺 button, Alt counts, mirrors ----

  private frame(now: number): void {
    const rig = this.app.rig;
    const store = this.app.store;
    // The 📺 button sits just inside the hovered mat's top right corner.
    const m = this.hovered && !this.dragging ? store.mats.get(this.hovered) : undefined;
    this.button.hidden = !m;
    if (m) {
      const c = corner(m, MAT_W / 2 - 22, MAT_H / 2 - 22);
      const s = rig.worldToScreen(c.x, c.y, MAT_T);
      this.button.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    // With Alt held, each mat shows how many cards lie on it, like a pile's badge (decision 109).
    for (const mat of store.mats.values()) {
      let el = this.counts.get(mat.uid);
      if (!this.alt) {
        if (el) el.hidden = true;
        continue;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = 'badge mat-count';
        this.app.overlay.append(el);
        this.counts.set(mat.uid, el);
      }
      el.hidden = false;
      el.textContent = `${mat.name.split(' // ')[0]} · ${this.cardsOn(mat.uid).length}`;
      const c = corner(mat, -MAT_W / 2 + 40, MAT_H / 2 - 16);
      const s = rig.worldToScreen(c.x, c.y, MAT_T);
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(0, -50%)`;
    }
    if (this.mirrors.length) this.drawMirrors(now);
  }

  // ---- the mirror window ----

  /** Open (or bring forward) a window showing this mat from straight above. */
  openMirror(uid: string): void {
    const mat = this.app.store.mats.get(uid);
    if (!mat) return;
    const open = this.mirrors.find((m) => m.uid === uid && !m.win.closed);
    if (open) {
      open.win.focus();
      return;
    }
    const w = 1220, h = Math.round((w * MAT_H) / MAT_W);
    const win = window.open('', `mat-mirror-${uid}`, `width=${w},height=${h}`);
    if (!win) return;
    win.document.title = `Playmat: ${mat.name}`;
    win.document.body.style.cssText = 'margin:0;background:#111;overflow:hidden;display:flex;align-items:center;justify-content:center;height:100vh';
    const canvas = win.document.createElement('canvas');
    // WebGL reads rows bottom up; the canvas is flipped back by CSS.
    canvas.style.cssText = 'max-width:100vw;max-height:100vh;aspect-ratio:' + MAT_W + '/' + MAT_H + ';width:100vw;transform:scaleY(-1)';
    win.document.body.append(canvas);
    this.mirrors.push({ uid, win, canvas, target: null, pixels: new Uint8Array(0), last: 0 });
  }

  private drawMirrors(now: number): void {
    const app = this.app;
    const renderer = app.view.renderer;
    for (let i = this.mirrors.length - 1; i >= 0; i--) {
      const mirror = this.mirrors[i];
      const mat = app.store.mats.get(mirror.uid);
      if (mirror.win.closed || !mat) {
        if (!mirror.win.closed) mirror.win.close();
        mirror.target?.dispose();
        this.mirrors.splice(i, 1);
        continue;
      }
      if (now - mirror.last < MIRROR_EVERY_MS) continue;
      mirror.last = now;
      // As big as the window shows it, in device pixels.
      const dpr = mirror.win.devicePixelRatio || 1;
      const shownW = Math.max(64, mirror.canvas.clientWidth * dpr);
      const width = Math.round(Math.min(MIRROR_MAX, shownW));
      const height = Math.round((width * MAT_H) / MAT_W);
      if (!mirror.target || mirror.target.width !== width || mirror.target.height !== height) {
        mirror.target?.dispose();
        mirror.target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
        mirror.target.texture.colorSpace = THREE.SRGBColorSpace;
        mirror.pixels = new Uint8Array(width * height * 4);
        mirror.canvas.width = width;
        mirror.canvas.height = height;
      }
      // Straight down over the mat, turned with it so it fills the frame.
      const cam = this.mirrorCam;
      cam.position.set(mat.x, mat.y, 1000);
      cam.up.set(-Math.sin(mat.yaw), Math.cos(mat.yaw), 0);
      cam.lookAt(mat.x, mat.y, 0);
      cam.updateMatrixWorld();
      // A clean view: no selection rims, hover glow or far-zoom dots.
      app.layer.setPlain(true);
      const hidden = app.view.scene.children.filter((o) => o instanceof THREE.Points && o.visible);
      for (const o of hidden) o.visible = false;
      renderer.setRenderTarget(mirror.target);
      renderer.render(app.view.scene, cam);
      renderer.readRenderTargetPixels(mirror.target, 0, 0, width, height, mirror.pixels);
      renderer.setRenderTarget(null);
      for (const o of hidden) o.visible = true;
      app.layer.setPlain(false);
      const ctx = mirror.canvas.getContext('2d');
      if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(mirror.pixels.buffer as ArrayBuffer), width, height), 0, 0);
    }
  }
}

/** The mat's outline, centred, with rounded corners. */
function matShape(): THREE.Shape {
  const w = MAT_W / 2, h = MAT_H / 2, r = MAT_CORNER;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/** The art's surface: the rounded outline, with the texture spread corner to corner. */
function matTop(): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(matShape(), 8);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / MAT_W + 0.5, pos.getY(i) / MAT_H + 0.5);
  return geo;
}

/**
 * The cards a mat carries (decision 147): those whose centre lies on it, and
 * every card in the same pile as one of them, even where it hangs off the
 * mat, since a pile moves as one.
 */
export function ridersOf(m: Mat, cards: Iterable<{ uid: string; x: number; y: number; pileId: string | null }>): string[] {
  const list = [...cards];
  const piles = new Set<string>();
  const out = new Set<string>();
  for (const c of list) {
    if (!onMat(m, c.x, c.y)) continue;
    out.add(c.uid);
    if (c.pileId) piles.add(c.pileId);
  }
  for (const c of list) if (c.pileId && piles.has(c.pileId)) out.add(c.uid);
  return [...out];
}

/** True if a table point lies on a mat. */
export function onMat(m: Mat, x: number, y: number): boolean {
  const dx = x - m.x, dy = y - m.y;
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return Math.abs(dx * c + dy * s) <= MAT_W / 2 && Math.abs(-dx * s + dy * c) <= MAT_H / 2;
}

/** A point on a mat given in its own frame (across, along). */
function corner(m: Mat, a: number, b: number): { x: number; y: number } {
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return { x: m.x + a * c - b * s, y: m.y + a * s + b * c };
}
