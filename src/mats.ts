// Playmats (decision 144): a card's art on a 61 x 35 cm mat lying on the
// table, always under the cards. A mat is dragged like a card (pressed where
// no card is), moving alone, or carrying the cards on it while Alt is held.
// R turns it, Delete removes it. A 🔓 button locks it in place (decision
// 154). Hovering one shows a 📺 button in its top
// right corner that opens a mirror window: the mat and its cards from straight
// above, live and clean, for screen sharing.

import * as THREE from 'three';
import { ACCENT, type App } from './app';
import type { CustomGesture, Mods } from './input/mouse';
import { ImageLoader } from './render/images';
import { inSpace, land, placeSequential } from './commands';
import { drawPlate, setOutlineResolution, standGroup } from './render/standMesh';
import { isStand, LIP_H, onStand, STAND_D, STAND_H, STAND_W, standHeightAt } from './state/stand';
import { textDialog } from './ui/confirm';
import { MAT_H, MAT_W, type Mat } from './state/types';
import { newUid } from './state/store';

/**
 * A mat is 5 mm thick, a black rubber base under the art (decisions 146, 172).
 * The thickness is for looks only: cards on a mat still lie at table height
 * and are drawn over it.
 */
const MAT_T = 5;
/** Rounded corners, like a real playmat. */
const MAT_CORNER = 10;
/** How far the selected mat's blue rim shows past its edge, mm (decision 214). */
const RIM = 6;
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
/** Mirror window and art quality, set by the graphics mode (decision 152). */
export interface MatQuality {
  /** The mirror redraws at most this often, ms... */
  mirrorEveryMs: number;
  /** ...at most this many device pixels wide, with this many smoothing samples. */
  mirrorMax: number;
  mirrorSamples: number;
  anisotropy: number;
}

interface Drawn {
  /** The art on top; a card stand's wedge and plate (decision 220). */
  mesh: THREE.Object3D;
  /** The black base under it; a card stand's spot on the table. */
  base: THREE.Object3D;
  /** The art's material; a stand's name plate. */
  material: THREE.MeshLambertMaterial;
  /** The art loaded; a stand's plate text. */
  art: string;
  stand: boolean;
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
  /**
   * The mat last moved or turned (decision 214): it shows a blue rim, and Z
   * frames it, until cards are selected, the table is clicked, or it is locked.
   */
  selected: string | null = null;
  private readonly rim = new THREE.Mesh(new THREE.ShapeGeometry(matShape(RIM), 8), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, depthWrite: false }));
  /** A selected card stand's rim, on the table round its foot (decision 220). */
  private readonly standRim = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(STAND_W / 2 + RIM, STAND_D / 2 + RIM, 6 + RIM), 4), new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, depthWrite: false }));
  private readonly editButton: HTMLButtonElement;
  private readonly button: HTMLButtonElement;
  private readonly lockButton: HTMLButtonElement;
  private readonly buttons: HTMLDivElement;
  private readonly counts = new Map<string, HTMLDivElement>();
  private alt = false;
  private readonly mirrors: Mirror[] = [];
  private quality: MatQuality = { mirrorEveryMs: 33, mirrorMax: 1920, mirrorSamples: 4, anisotropy: 8 };
  private readonly mirrorCam = new THREE.OrthographicCamera(-MAT_W / 2, MAT_W / 2, MAT_H / 2, -MAT_H / 2, 1, 5000);

  constructor(private readonly app: App) {
    app.view.scene.add(this.group);
    this.rim.visible = false;
    this.standRim.visible = false;
    // Over the mats, under everything else.
    this.standRim.renderOrder = MAT_ORDER + 0.05;
    this.group.add(this.rim, this.standRim);
    app.store.events.on('mats', () => this.sync());
    app.store.events.on('reset', () => this.sync());
    // Choosing cards takes the selection away from the mat.
    app.store.events.on('selection', () => this.select(null));

    // The 📺 button, shown in the top right corner of the mat under the mouse.
    this.button = document.createElement('button');
    this.button.className = 'mat-mirror-btn';
    this.button.textContent = '📺';
    this.button.title = 'Open a top-down mirror of this playmat in its own window, for screen sharing';
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.button.addEventListener('click', () => {
      if (this.hovered) this.openMirror(this.hovered);
    });
    // Beside it, the lock (decision 154): a locked mat stays put until unlocked here.
    this.lockButton = document.createElement('button');
    this.lockButton.className = 'mat-mirror-btn mat-lock-btn';
    this.lockButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.lockButton.addEventListener('click', () => {
      const m = this.hovered ? app.store.mats.get(this.hovered) : undefined;
      if (m) app.store.setMatLocked(m.uid, !m.locked);
    });
    this.buttons = document.createElement('div');
    this.buttons.className = 'mat-buttons';
    this.buttons.hidden = true;
    // A card stand's ✏️ changes its name plate (decision 220).
    this.editButton = document.createElement('button');
    this.editButton.className = 'mat-mirror-btn';
    this.editButton.textContent = '✏️';
    this.editButton.title = 'Change the name on the plate';
    this.editButton.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.editButton.addEventListener('click', () => {
      const m = this.hovered ? app.store.mats.get(this.hovered) : undefined;
      if (!m) return;
      void textDialog('The name on the plate, read from across the table:', { value: m.name, ok: 'Save' }).then((text) => {
        if (text !== null) app.store.setMatName(m.uid, text.trim());
      });
    });
    this.buttons.append(this.lockButton, this.button, this.editButton);
    app.overlay.append(this.buttons);

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

  /** Set up a new card stand at a spot, with this name on its plate (decision 220). */
  spawnStand(name: string, at: { x: number; y: number }): void {
    this.app.store.addMat({ uid: newUid('m'), kind: 'stand', scryfallId: '', name, art: '', x: at.x, y: at.y, yaw: 0 });
  }

  /** Lay a new mat on the table at a spot. */
  spawn(scryfallId: string, name: string, art: string, at: { x: number; y: number }): void {
    this.app.store.addMat({ uid: newUid('m'), scryfallId, name, art, x: at.x, y: at.y, yaw: 0 });
  }

  /** R over a mat: a quarter turn clockwise, like a card. */
  rotate(uid: string): void {
    const store = this.app.store;
    const m = store.mats.get(uid);
    if (!m) return;
    const yaw = Math.round((m.yaw - Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
    // A card stand turns its cards with it, about its centre (decision 221).
    const members = isStand(m) ? this.cardsOn(uid) : [];
    if (members.length) {
      const d = yaw - m.yaw, c = Math.cos(d), s = Math.sin(d);
      store.moveCards(members.map((u) => {
        const card = store.cards.get(u)!;
        const dx = card.x - m.x, dy = card.y - m.y;
        return { uid: u, x: m.x + dx * c - dy * s, y: m.y + dx * s + dy * c, yaw: card.yaw + d };
      }));
    }
    store.moveMat(uid, m.x, m.y, yaw);
    if (members.length) store.events.emit('settled', members);
    this.select(uid);
  }

  /** Make a mat the selected one, or none (decision 214). A locked mat can't be. */
  select(uid: string | null): void {
    if (uid && this.app.store.mats.get(uid)?.locked) uid = null;
    if (this.selected === uid) return;
    this.selected = uid;
    // Puts the rim in the right place among the mats.
    this.sync();
  }

  /** The table-space box around a mat, for Z (decision 214), and how tall it is. */
  box(uid: string): { minX: number; minY: number; maxX: number; maxY: number; top: number } | null {
    const m = this.app.store.mats.get(uid);
    if (!m) return null;
    const stand = isStand(m);
    const w = stand ? STAND_W : MAT_W, h = stand ? STAND_D : MAT_H;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => corner(m, (a * w) / 2, (b * h) / 2));
    return {
      top: stand ? STAND_H : 0,
      minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)),
      maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)),
    };
  }

  remove(uid: string): void {
    const store = this.app.store;
    const m = store.mats.get(uid);
    // A card stand's cards drop to the table where it stood (decision 221).
    const members = m && isStand(m) ? this.cardsOn(uid).map((u) => store.cards.get(u)!).sort((a, b) => a.z - b.z) : [];
    store.removeMat(uid);
    if (members.length) {
      land(this.app, inSpace(null, () => placeSequential(this.app, members.map((c) => c.uid), members.map((c) => ({ x: c.x, y: c.y, yaw: c.yaw })))));
    }
  }

  // ---- drawing ----

  /** Match the meshes to the store's mats. */
  private sync(): void {
    const mats = this.app.store.mats;
    // A mat that went away or was locked is no longer selected.
    if (this.selected && (!mats.has(this.selected) || mats.get(this.selected)!.locked)) this.selected = null;
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
      if (isStand(m)) {
        this.syncStand(m);
        continue;
      }
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
        d = { mesh, base, material, art: '', stand: false };
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
      // The selected mat's rim goes just under its base, over the mats before it.
      if (m.uid === this.selected) this.rim.renderOrder = MAT_ORDER + (order - 0.25) * MAT_ORDER_STEP;
      d.mesh.renderOrder = MAT_ORDER + (order + 0.5) * MAT_ORDER_STEP;
      order++;
      this.place(d, m.x, m.y, m.yaw);
    }
  }

  /** A card stand's wedge and its name plate (decision 220), drawn by depth like any solid. */
  private syncStand(m: Mat): void {
    let d = this.drawn.get(m.uid);
    if (!d) {
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const mesh = standGroup(material);
      const base = new THREE.Object3D();
      this.group.add(mesh, base);
      d = { mesh, base, material, art: '', stand: true };
      this.drawn.set(m.uid, d);
    }
    if (d.art !== m.name || !d.material.map) {
      d.art = m.name;
      d.material.map?.dispose();
      d.material.map = drawPlate(m.name);
      d.material.needsUpdate = true;
    }
    this.place(d, m.x, m.y, m.yaw);
  }

  /** Put a drawn mat or stand at a spot. */
  private place(d: Drawn, x: number, y: number, yaw: number): void {
    d.base.position.set(x, y, 0);
    d.mesh.position.set(x, y, d.stand ? 0 : MAT_T);
    d.base.rotation.set(0, 0, yaw);
    d.mesh.rotation.set(0, 0, yaw);
  }

  /** Switch graphics mode: the art's filtering changes at once, the mirror on its next frame. */
  setQuality(q: MatQuality): void {
    const refilter = q.anisotropy !== this.quality.anisotropy;
    this.quality = { ...q };
    if (!refilter) return;
    for (const tex of this.textures.values()) {
      tex.anisotropy = q.anisotropy;
      tex.needsUpdate = true;
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
      tex.anisotropy = this.quality.anisotropy;
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
  /** The hovered mat if it can be moved, turned or removed: not locked. */
  get movable(): string | null {
    return this.hovered && !this.app.store.mats.get(this.hovered)?.locked ? this.hovered : null;
  }

  /** The topmost mat under a screen point that isn't locked, or null. */
  movableAt(sx: number, sy: number): string | null {
    const uid = this.matAt(sx, sy);
    return uid && !this.app.store.mats.get(uid)?.locked ? uid : null;
  }

  matAt(sx: number, sy: number): string | null {
    const mats = [...this.app.store.mats.values()];
    // Card stands stand up over the mats: the first one the ray meets (decision 220).
    for (let i = mats.length - 1; i >= 0; i--) if (isStand(mats[i]) && this.rayMeetsStand(mats[i], sx, sy)) return mats[i].uid;
    const p = this.app.rig.screenToPlane(sx, sy, MAT_T);
    if (!p) return null;
    for (let i = mats.length - 1; i >= 0; i--) if (!isStand(mats[i]) && onMat(mats[i], p.x, p.y)) return mats[i].uid;
    return null;
  }

  /** True if the ray through a screen point meets a card stand: from above its ridge down, the first height inside it. */
  private rayMeetsStand(m: Mat, sx: number, sy: number): boolean {
    for (let z = STAND_H + 1; z >= 0; z -= 1.5) {
      const p = this.app.rig.screenToPlane(sx, sy, z);
      if (p && standHeightAt(m, p.x, p.y) >= z) return true;
    }
    return false;
  }

  /** Cards whose centre lies on a mat. */
  cardsOn(uid: string): string[] {
    const m = this.app.store.mats.get(uid);
    if (!m) return [];
    // A card stand's are its own cards (decision 221); a mat carries none of those.
    if (isStand(m)) return [...this.app.store.cards.values()].filter((c) => c.stand === uid).map((c) => c.uid);
    return ridersOf(m, [...this.app.store.cards.values()].filter((c) => !c.stand));
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
    /** The cards carried: where they are in the model, and where they are drawn (px, py). */
    let riders: { uid: string; x: number; y: number; px: number; py: number }[] | null = null;
    let moved = false;
    const finish = (dx: number, dy: number, keep: boolean) => {
      this.dragging = null;
      if (!keep) {
        dx = 0;
        dy = 0;
      }
      if (riders?.length) {
        app.store.moveCards(riders.map((r) => ({ uid: r.uid, x: r.x + dx, y: r.y + dy })));
        for (const r of riders) {
          app.motion.held.delete(r.uid);
          const pose = app.layer.pose(r.uid);
          if (pose) {
            pose.x = r.px + dx;
            pose.y = r.py + dy;
            app.layer.touch(r.uid);
          }
        }
        app.store.events.emit('settled', riders.map((r) => r.uid));
      }
      // After its riders, so a card stand's cards rest on it where it is now (decision 220).
      app.store.moveMat(uid, start.x + dx, start.y + dy, mat.yaw);
    };
    let last = { dx: 0, dy: 0 };
    return {
      kind: 'custom',
      move: (x, y) => {
        if (!moved && Math.hypot(x - sx, y - sy) <= 4) return;
        if (!moved) {
          moved = true;
          // Alt carries the cards lying on the mat (owner's choice); a card stand always carries its own (decision 221).
          if (mods.alt || isStand(mat)) {
            riders = this.cardsOn(uid).map((u) => {
              const c = app.store.cards.get(u)!;
              app.motion.cancel(u);
              app.motion.held.add(u);
              const pose = app.layer.pose(u);
              return { uid: u, x: c.x, y: c.y, px: pose?.x ?? c.x, py: pose?.y ?? c.y };
            });
          }
          this.dragging = { uid, carrying: !!riders?.length };
        }
        const p = app.rig.screenToPlane(x, y, 0);
        if (!p) return;
        last = { dx: p.x - grab.x, dy: p.y - grab.y };
        const d = this.drawn.get(uid);
        if (d) this.place(d, start.x + last.dx, start.y + last.dy, mat.yaw);
        for (const r of riders ?? []) {
          const pose = app.layer.pose(r.uid);
          if (!pose) continue;
          pose.x = r.px + last.dx;
          pose.y = r.py + last.dy;
          app.layer.touch(r.uid);
        }
      },
      up: () => {
        if (moved) {
          finish(last.dx, last.dy, true);
          // The mat just moved is the selected object (decision 214).
          app.store.clearSelection();
          this.select(uid);
        } else {
          app.store.clearSelection();
          this.select(null);
        }
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
    // The stands' outlines keep their width in screen pixels (decision 231).
    setOutlineResolution(rig.viewport.width, rig.viewport.height);
    // The selected mat's blue rim follows it, even mid-drag.
    const sel = this.selected ? this.drawn.get(this.selected) : undefined;
    const rim = sel?.stand ? this.standRim : this.rim;
    this.rim.visible = !!sel && !sel.stand;
    this.standRim.visible = !!sel?.stand;
    if (sel) {
      rim.position.set(sel.base.position.x, sel.base.position.y, 0);
      rim.rotation.copy(sel.base.rotation);
    }
    // The 🔒 and 📺 buttons sit just inside the hovered mat's top right corner,
    // or its bottom left corner while it is locked (decision 155).
    const m = this.hovered && !this.dragging ? store.mats.get(this.hovered) : undefined;
    this.buttons.hidden = !m;
    if (m) {
      const locked = !!m.locked;
      // A card stand's buttons sit on its front lip, at the right, or the left while locked (decision 220).
      const stand = isStand(m);
      const c = stand
        ? corner(m, locked ? -STAND_W / 2 + 22 : STAND_W / 2 - 22, -STAND_D / 2 + 4)
        : locked ? corner(m, -MAT_W / 2 + 22, -MAT_H / 2 + 22) : corner(m, MAT_W / 2 - 22, MAT_H / 2 - 22);
      const s = rig.worldToScreen(c.x, c.y, stand ? LIP_H : MAT_T);
      this.button.hidden = stand;
      this.editButton.hidden = !stand;
      // The corner point is the middle of the button nearest the corner: the 📺 at top right, the lock at bottom left.
      const shift = locked ? 'translate(-16px, -50%)' : 'translate(calc(-100% + 16px), -50%)';
      this.buttons.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) ${shift}`;
      if (this.lockButton.classList.contains('on') !== locked || !this.lockButton.textContent) {
        this.lockButton.textContent = locked ? '🔒' : '🔓';
        this.lockButton.classList.toggle('on', locked);
        this.lockButton.setAttribute('aria-pressed', String(locked));
        this.lockButton.title = locked ? 'Locked: it can’t be dragged, turned or removed. Click to unlock.' : 'Lock it in place';
      }
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
      const c = isStand(mat) ? corner(mat, -STAND_W / 2 + 40, -STAND_D / 2 + 4) : corner(mat, -MAT_W / 2 + 40, MAT_H / 2 - 16);
      const s = rig.worldToScreen(c.x, c.y, isStand(mat) ? LIP_H : MAT_T);
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
      if (now - mirror.last < this.quality.mirrorEveryMs) continue;
      mirror.last = now;
      // As big as the window shows it, in device pixels.
      const dpr = mirror.win.devicePixelRatio || 1;
      const shownW = Math.max(64, mirror.canvas.clientWidth * dpr);
      const width = Math.round(Math.min(this.quality.mirrorMax, shownW));
      const height = Math.round((width * MAT_H) / MAT_W);
      const samples = Math.min(this.quality.mirrorSamples, renderer.capabilities.maxSamples);
      if (!mirror.target || mirror.target.width !== width || mirror.target.height !== height || mirror.target.samples !== samples) {
        mirror.target?.dispose();
        mirror.target = new THREE.WebGLRenderTarget(width, height, { samples });
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

/** A rounded rectangle, centred, half w by half h with corner radius r. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
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

/** The mat's outline, centred, with rounded corners; `pad` grows it all round (the selection rim). */
function matShape(pad = 0): THREE.Shape {
  const w = MAT_W / 2 + pad, h = MAT_H / 2 + pad, r = MAT_CORNER + pad;
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
  if (isStand(m)) return onStand(m, x, y);
  const dx = x - m.x, dy = y - m.y;
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return Math.abs(dx * c + dy * s) <= MAT_W / 2 && Math.abs(-dx * s + dy * c) <= MAT_H / 2;
}

/** A point on a mat given in its own frame (across, along). */
function corner(m: Mat, a: number, b: number): { x: number; y: number } {
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
  return { x: m.x + a * c - b * s, y: m.y + a * s + b * c };
}
