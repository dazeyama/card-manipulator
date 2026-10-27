// Instanced card meshes (spec 8.1, 8.2, 8.4).
//
// Every card is one instance of a thin box. The shader reads the front and
// back images from the atlas array texture using per-instance slot
// attributes, rounds the corners by discarding fragments, draws the
// selection rim glow, the hover brightening and the foil sheen.

import * as THREE from 'three';
import { CARD_H, CARD_T, CARD_W } from '../state/types';
import { SLOT_UV, type Atlas, type Slot } from './atlas';

/** The displayed transform of one card. The model position is the target; this is what is drawn. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Rotation about the card's long axis: 0 face up, PI face down. */
  roll: number;
  /** Small tilts while held (radians). */
  tiltX: number;
  tiltY: number;
}

export const CORNER_R = 3;
const HOVER_LIFT = 2;

interface Entry {
  uid: string;
  index: number;
  pose: Pose;
  selected: boolean;
  hovered: boolean;
  foil: boolean;
  hidden: boolean;
}

const vertexHead = /* glsl */ `
attribute vec3 aFront;
attribute vec3 aBack;
attribute vec4 aFlags;
varying vec3 vFront;
varying vec3 vBack;
varying vec4 vFlags;
varying vec3 vLocal;
varying float vFace;
varying vec3 vWorldN;
varying vec3 vWorldP;
`;

const vertexBody = /* glsl */ `
vFront = aFront;
vBack = aBack;
vFlags = aFlags;
vLocal = position;
vFace = normal.z > 0.5 ? 1.0 : (normal.z < -0.5 ? -1.0 : 0.0);
vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
vWorldP = wp.xyz;
vWorldN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
if (aFlags.w > 0.5) transformed = vec3(0.0);
`;

const fragmentHead = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec2 uSlotUV;
uniform vec3 uAccent;
uniform float uTime;
varying vec3 vFront;
varying vec3 vBack;
varying vec4 vFlags;
varying vec3 vLocal;
varying float vFace;
varying vec3 vWorldN;
varying vec3 vWorldP;
const vec2 CARD_HALF = vec2(${(CARD_W / 2).toFixed(3)}, ${(CARD_H / 2).toFixed(3)});
const float CORNER = ${CORNER_R.toFixed(3)};

float cardDist(vec2 p) {
  vec2 q = abs(p) - (CARD_HALF - CORNER);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - CORNER;
}

vec4 sampleSlot(vec3 slot, vec2 uv) {
  vec2 t = slot.xy + vec2(uv.x, 1.0 - uv.y) * uSlotUV;
  return texture(uAtlas, vec3(t, slot.z));
}

vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
`;

const mapFragment = /* glsl */ `
float cd = cardDist(vLocal.xy);
if (cd > 0.0) discard;
vec2 cuv = vLocal.xy / (CARD_HALF * 2.0) + 0.5;
vec4 texel;
if (vFace > 0.5) texel = sampleSlot(vFront, cuv);
else if (vFace < -0.5) texel = sampleSlot(vBack, vec2(1.0 - cuv.x, cuv.y));
else texel = vec4(0.16, 0.15, 0.14, 1.0);
diffuseColor.rgb *= texel.rgb;
diffuseColor.rgb *= 1.0 + 0.14 * vFlags.y;
`;

const emissiveFragment = /* glsl */ `
#include <emissivemap_fragment>
float px = max(fwidth(vLocal.x), fwidth(vLocal.y));
float rimW = max(1.6, px * 2.6);
float rim = vFlags.x * step(0.5, abs(vFace)) * smoothstep(-rimW, -rimW * 0.35, cd);
diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, rim * 0.85 + vFlags.x * 0.06);
totalEmissiveRadiance += uAccent * rim * 0.55;
if (vFlags.z > 0.5 && vFace > 0.5) {
  vec3 V = normalize(cameraPosition - vWorldP);
  float facing = dot(normalize(vWorldN), V);
  float band = sin((vLocal.x * 0.035 + vLocal.y * 0.05) + facing * 9.0 + V.x * 4.0 + V.y * 3.0 + uTime * 0.25);
  float s = smoothstep(0.55, 1.0, band);
  totalEmissiveRadiance += hue(fract(vLocal.y * 0.006 + facing * 1.4 + V.x * 0.6)) * s * 0.16;
}
`;

// A soft contact shadow under cards that rest on the table, so single cards
// separate from the pale table even though a flat card casts almost no real
// shadow (spec 7.1a). It shares the card instance buffers.
const contactVertex = /* glsl */ `
attribute vec4 aFlags;
varying vec2 vLocal;
varying float vAlpha;
void main() {
  vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 ax = normalize((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xy);
  vec2 ay = vec2(-ax.y, ax.x);
  vLocal = position.xy;
  vec2 w = c.xy + ax * position.x + ay * position.y + vec2(1.2, 2.0);
  vAlpha = (1.0 - smoothstep(0.6, 2.5, c.z)) * (1.0 - aFlags.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.03, 1.0);
}
`;

const contactFragment = /* glsl */ `
varying vec2 vLocal;
varying float vAlpha;
const vec2 CARD_HALF = vec2(${(CARD_W / 2).toFixed(3)}, ${(CARD_H / 2).toFixed(3)});
void main() {
  vec2 q = abs(vLocal) - (CARD_HALF - 3.0);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 3.0;
  float a = (1.0 - smoothstep(-2.5, 4.5, d)) * 0.30 * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.18, 0.15, 0.12, a);
}
`;

const CONTACT_PAD = 6;

export class CardLayer {
  private readonly material: THREE.MeshLambertMaterial;
  private readonly geometry: THREE.BoxGeometry;
  private capacity: number;
  private aFront: THREE.InstancedBufferAttribute;
  private aBack: THREE.InstancedBufferAttribute;
  private aFlags: THREE.InstancedBufferAttribute;
  private readonly entries = new Map<string, Entry>();
  private byIndex: Entry[] = [];
  private readonly dirtyMatrix = new Set<Entry>();
  private flagsDirty = false;
  private slotsDirty = false;
  private readonly uniforms: {
    uAtlas: { value: THREE.DataArrayTexture };
    uSlotUV: { value: THREE.Vector2 };
    uAccent: { value: THREE.Color };
    uTime: { value: number };
  };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(private readonly scene: THREE.Scene, atlas: Atlas, accent: THREE.Color, capacity = 256) {
    this.capacity = capacity;
    this.geometry = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T);
    this.uniforms = {
      uAtlas: { value: atlas.texture },
      uSlotUV: { value: SLOT_UV },
      uAccent: { value: accent },
      uTime: { value: 0 },
    };
    atlas.onTextureChanged = (tex) => {
      this.uniforms.uAtlas.value = tex;
    };
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`);
      shader.fragmentShader = fragmentHead + shader.fragmentShader
        .replace('#include <map_fragment>', mapFragment)
        .replace('#include <emissivemap_fragment>', emissiveFragment);
    };
    const mesh = this.makeMesh(capacity);
    this.aFront = mesh.geometry.getAttribute('aFront') as THREE.InstancedBufferAttribute;
    this.aBack = mesh.geometry.getAttribute('aBack') as THREE.InstancedBufferAttribute;
    this.aFlags = mesh.geometry.getAttribute('aFlags') as THREE.InstancedBufferAttribute;
    scene.add(mesh);
  }

  private currentMesh: THREE.InstancedMesh | null = null;
  private contact: THREE.InstancedMesh | null = null;
  private readonly contactMaterial = new THREE.ShaderMaterial({
    vertexShader: contactVertex,
    fragmentShader: contactFragment,
    transparent: true,
    depthWrite: false,
  });

  private makeMesh(capacity: number): THREE.InstancedMesh {
    const geo = this.geometry.clone();
    geo.setAttribute('aFront', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geo.setAttribute('aBack', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    geo.setAttribute('aFlags', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.currentMesh = mesh;
    // The contact shadow mesh shares the same instance buffers.
    const cgeo = new THREE.PlaneGeometry(CARD_W + CONTACT_PAD * 2, CARD_H + CONTACT_PAD * 2);
    cgeo.setAttribute('aFlags', geo.getAttribute('aFlags'));
    const contact = new THREE.InstancedMesh(cgeo, this.contactMaterial, capacity);
    contact.instanceMatrix = mesh.instanceMatrix;
    contact.count = 0;
    contact.frustumCulled = false;
    contact.renderOrder = 1;
    if (this.contact) {
      this.scene.remove(this.contact);
      this.contact.geometry.dispose();
    }
    this.contact = contact;
    this.scene.add(contact);
    return mesh;
  }

  /** The live mesh (it is replaced when capacity grows). */
  get object(): THREE.InstancedMesh {
    return this.currentMesh!;
  }

  get count(): number {
    return this.byIndex.length;
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t;
  }

  has(uid: string): boolean {
    return this.entries.has(uid);
  }

  add(uid: string, pose: Pose, front: Slot, back: Slot, foil: boolean): void {
    if (this.entries.has(uid)) return;
    if (this.byIndex.length >= this.capacity) this.grow(this.capacity * 2);
    const entry: Entry = { uid, index: this.byIndex.length, pose: { ...pose }, selected: false, hovered: false, foil, hidden: false };
    this.byIndex.push(entry);
    this.entries.set(uid, entry);
    this.writeSlots(entry, front, back);
    this.writeFlags(entry);
    this.dirtyMatrix.add(entry);
    this.setCount(this.byIndex.length);
  }

  remove(uid: string): void {
    const entry = this.entries.get(uid);
    if (!entry) return;
    this.entries.delete(uid);
    this.dirtyMatrix.delete(entry);
    const last = this.byIndex.pop()!;
    if (last !== entry) {
      // Move the last instance into the freed index.
      this.byIndex[entry.index] = last;
      const from = last.index;
      last.index = entry.index;
      copyAttr(this.aFront, from, last.index);
      copyAttr(this.aBack, from, last.index);
      copyAttr(this.aFlags, from, last.index);
      this.slotsDirty = true;
      this.flagsDirty = true;
      this.dirtyMatrix.add(last);
    }
    this.setCount(this.byIndex.length);
  }

  clear(): void {
    this.entries.clear();
    this.byIndex = [];
    this.dirtyMatrix.clear();
    this.setCount(0);
  }

  private setCount(n: number): void {
    this.object.count = n;
    this.contact!.count = n;
  }

  pose(uid: string): Pose | undefined {
    return this.entries.get(uid)?.pose;
  }

  /** Mark a card's pose as changed after editing the object returned by pose(). */
  touch(uid: string): void {
    const e = this.entries.get(uid);
    if (e) this.dirtyMatrix.add(e);
  }

  setPose(uid: string, pose: Partial<Pose>): void {
    const e = this.entries.get(uid);
    if (!e) return;
    Object.assign(e.pose, pose);
    this.dirtyMatrix.add(e);
  }

  setSlots(uid: string, front: Slot, back: Slot): void {
    const e = this.entries.get(uid);
    if (e) this.writeSlots(e, front, back);
  }

  setSelected(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e || e.selected === on) return;
    e.selected = on;
    this.writeFlags(e);
  }

  setHovered(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e || e.hovered === on) return;
    e.hovered = on;
    this.writeFlags(e);
    this.dirtyMatrix.add(e);
  }

  setFoil(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e || e.foil === on) return;
    e.foil = on;
    this.writeFlags(e);
  }

  setHidden(uid: string, on: boolean): void {
    const e = this.entries.get(uid);
    if (!e || e.hidden === on) return;
    e.hidden = on;
    this.writeFlags(e);
  }

  forEach(fn: (uid: string, pose: Pose) => void): void {
    for (const e of this.byIndex) fn(e.uid, e.pose);
  }

  /** Push changed instance data to the GPU. Call once per frame. */
  update(): void {
    if (this.dirtyMatrix.size) {
      const arr = this.object.instanceMatrix;
      let lo = Infinity;
      let hi = -1;
      for (const e of this.dirtyMatrix) {
        this.compose(e);
        this.m.toArray(arr.array as Float32Array, e.index * 16);
        if (e.index < lo) lo = e.index;
        if (e.index > hi) hi = e.index;
      }
      arr.clearUpdateRanges();
      arr.addUpdateRange(lo * 16, (hi - lo + 1) * 16);
      arr.needsUpdate = true;
      this.dirtyMatrix.clear();
    }
    if (this.slotsDirty) {
      this.aFront.needsUpdate = true;
      this.aBack.needsUpdate = true;
      this.slotsDirty = false;
    }
    if (this.flagsDirty) {
      this.aFlags.needsUpdate = true;
      this.flagsDirty = false;
    }
  }

  private compose(e: Entry): void {
    const p = e.pose;
    this.p.set(p.x, p.y, p.z + (e.hovered ? HOVER_LIFT : 0));
    // Yaw about world z, then tilt, then the flip roll about the card's long (y) axis.
    this.e.set(p.tiltX, p.roll + p.tiltY, p.yaw, 'ZXY');
    this.q.setFromEuler(this.e);
    this.m.compose(this.p, this.q, this.s);
  }

  private writeSlots(e: Entry, front: Slot, back: Slot): void {
    const i = e.index;
    this.aFront.setXYZ(i, front.u, front.v, front.layer);
    this.aBack.setXYZ(i, back.u, back.v, back.layer);
    this.slotsDirty = true;
  }

  private writeFlags(e: Entry): void {
    this.aFlags.setXYZW(e.index, e.selected ? 1 : 0, e.hovered ? 1 : 0, e.foil ? 1 : 0, e.hidden ? 1 : 0);
    this.flagsDirty = true;
  }

  private grow(capacity: number): void {
    const old = this.object;
    const mesh = this.makeMesh(capacity);
    const nf = mesh.geometry.getAttribute('aFront') as THREE.InstancedBufferAttribute;
    const nb = mesh.geometry.getAttribute('aBack') as THREE.InstancedBufferAttribute;
    const nl = mesh.geometry.getAttribute('aFlags') as THREE.InstancedBufferAttribute;
    (nf.array as Float32Array).set(this.aFront.array as Float32Array);
    (nb.array as Float32Array).set(this.aBack.array as Float32Array);
    (nl.array as Float32Array).set(this.aFlags.array as Float32Array);
    (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    this.setCount(old.count);
    this.scene.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.scene.add(mesh);
    this.aFront = nf;
    this.aBack = nb;
    this.aFlags = nl;
    this.capacity = capacity;
    this.slotsDirty = true;
    this.flagsDirty = true;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

function copyAttr(attr: THREE.InstancedBufferAttribute, from: number, to: number): void {
  const n = attr.itemSize;
  const a = attr.array as Float32Array;
  for (let k = 0; k < n; k++) a[to * n + k] = a[from * n + k];
}
