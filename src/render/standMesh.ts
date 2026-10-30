// How a card stand looks (decision 220): a polished cherry wedge, and on its
// back, facing the player across the table, a black name plate with a gold
// border and gold lettering, like an executive desk nameplate.

import * as THREE from 'three';
import { BACK, RIDGE, STAND_D, STAND_H, STAND_W, standProfile } from '../state/stand';

/** The name plate: inset from the back face's edges, mm. */
const PLATE_INSET_W = 22;
const PLATE_INSET_H = 9;
const BACK_LEN = STAND_H / Math.sin(BACK);
const PLATE_W = STAND_W - 2 * PLATE_INSET_W;
const PLATE_H = BACK_LEN - 2 * PLATE_INSET_H;
/** Texture pixels per mm on the plate. */
const PLATE_PX = 3;

let wood: THREE.CanvasTexture | null = null;

/** A polished cherry grain: warm red-brown with long darker streaks. */
function woodTexture(): THREE.CanvasTexture {
  if (wood) return wood;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  const base = g.createLinearGradient(0, 0, 0, c.height);
  base.addColorStop(0, '#7a2a17');
  base.addColorStop(0.5, '#8c3520');
  base.addColorStop(1, '#6b2312');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  // Grain: thin wavy streaks along the length.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * c.height, amp = 2 + rnd() * 6, freq = 0.002 + rnd() * 0.006;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '40, 10, 4' : '150, 70, 40'}, ${0.08 + rnd() * 0.18})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) {
      const yy = y + Math.sin(x * freq + i) * amp;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  wood = new THREE.CanvasTexture(c);
  wood.colorSpace = THREE.SRGBColorSpace;
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.anisotropy = 8;
  return wood;
}

/** The wedge's body: its side profile run across its width, the grain running across. */
function wedgeGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  standProfile().forEach(([b, h], i) => (i ? shape.lineTo(b, h) : shape.moveTo(b, h)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: STAND_W, bevelEnabled: false });
  // Shape x is front to back (b), shape y is height, the extrusion is across (a).
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -STAND_W / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  // Grain along the width on every face: u across, v from the side profile.
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / STAND_W + 0.5, (pos.getY(i) + pos.getZ(i)) / STAND_D);
  geo.computeVertexNormals();
  return geo;
}

let sharedWedge: THREE.BufferGeometry | null = null;
let sharedWood: THREE.MeshLambertMaterial | null = null;

/** Draw the name plate's face: black, a gold border, the text in gold serif capitals' style. */
export function drawPlate(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(PLATE_W * PLATE_PX);
  c.height = Math.round(PLATE_H * PLATE_PX);
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0c0c';
  g.fillRect(0, 0, c.width, c.height);
  const gold = g.createLinearGradient(0, 0, 0, c.height);
  gold.addColorStop(0, '#f3dc8a');
  gold.addColorStop(0.5, '#c9a13b');
  gold.addColorStop(1, '#e8c869');
  // The gold frame, inset a little, like the brass plate's border.
  g.strokeStyle = gold;
  g.lineWidth = 2.2 * PLATE_PX;
  const inset = 3 * PLATE_PX;
  g.strokeRect(inset, inset, c.width - 2 * inset, c.height - 2 * inset);
  if (text.trim()) {
    let size = c.height * 0.5;
    const font = (n: number) => `600 ${n}px Georgia, "Times New Roman", serif`;
    g.font = font(size);
    const room = c.width - 16 * PLATE_PX;
    const w = g.measureText(text).width;
    if (w > room) {
      size *= room / w;
      g.font = font(size);
    }
    g.fillStyle = gold;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0, 0, 0, 0.6)';
    g.shadowBlur = 2;
    g.fillText(text, c.width / 2, c.height / 2 + size * 0.04);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A stand to put on the table: the wedge and its plate, centred on its footprint, on the table. */
export function standGroup(plate: THREE.MeshLambertMaterial): THREE.Group {
  sharedWedge ??= wedgeGeometry();
  sharedWood ??= new THREE.MeshLambertMaterial({ map: woodTexture() });
  const group = new THREE.Group();
  const wedge = new THREE.Mesh(sharedWedge, sharedWood);
  wedge.castShadow = true;
  wedge.receiveShadow = true;
  const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_H);
  // Turned to face the back: readable from across the table, right way up (decision 220).
  geo.rotateZ(Math.PI);
  geo.rotateX(-BACK);
  const face = new THREE.Mesh(geo, plate);
  const mid = (RIDGE + STAND_D / 2) / 2;
  const n = new THREE.Vector3(0, Math.sin(BACK), Math.cos(BACK));
  face.position.set(0, mid, STAND_H / 2).addScaledVector(n, 0.4);
  face.receiveShadow = true;
  group.add(wedge, face);
  return group;
}
