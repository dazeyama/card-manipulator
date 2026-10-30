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

/**
 * The wood (decision 229): a generated, seamless dark-stained cherry, loaded
 * at 1024 px in High graphics and 512 in Low (public/wood, made by
 * devtools/makeWood.py). The GPU builds the smaller mip levels, so far and
 * glancing views read the small ones. Until it loads, plain cherry.
 */
const WOOD_COLOUR = 0x4a1a10;
let woodPx: 1024 | 512 = 512;
let woodAniso = 8;
let wood: THREE.Texture | null = null;
const woodLoader = new THREE.TextureLoader();

function loadWood(): void {
  const px = woodPx;
  woodLoader.load(`${import.meta.env.BASE_URL}wood/cherry-${px}.webp`, (tex) => {
    if (px !== woodPx) {
      tex.dispose();
      return;
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = woodAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    wood?.dispose();
    wood = tex;
    if (sharedWood) {
      sharedWood.map = tex;
      sharedWood.color.set(0xffffff);
      sharedWood.needsUpdate = true;
    }
  });
}

/** The graphics mode's wood size and filtering (decision 229). */
export function setWoodQuality(px: 1024 | 512, anisotropy: number): void {
  woodAniso = anisotropy;
  if (wood) {
    wood.anisotropy = anisotropy;
    wood.needsUpdate = true;
  }
  if (px === woodPx && (wood || !sharedWood)) return;
  woodPx = px;
  if (sharedWood) loadWood();
}

/** The wedge's body: its side profile run across its width, the grain running across. */
function wedgeGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  standProfile().forEach(([b, h], i) => (i ? shape.lineTo(b, h) : shape.moveTo(b, h)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: STAND_W, bevelEnabled: false });
  // Shape x is front to back (b), shape y is height, the extrusion is across (a).
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -STAND_W / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  // Grain along the width on every face: u across, v from the side profile; the texture
  // spans the stand's width once, square texels on the faces (decision 229).
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / STAND_W + 0.5, (pos.getY(i) + pos.getZ(i)) / STAND_W);
  geo.computeVertexNormals();
  return geo;
}

let sharedWedge: THREE.BufferGeometry | null = null;
/** Its outline (decision 230): a black line along every edge where two faces meet. */
let sharedEdges: THREE.EdgesGeometry | null = null;
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
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
  sharedEdges ??= new THREE.EdgesGeometry(sharedWedge, 20);
  if (!sharedWood) {
    // Pushed back a touch in depth, so the outline on its edges never flickers into it.
    sharedWood = new THREE.MeshLambertMaterial({ color: WOOD_COLOUR, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    loadWood();
  }
  const group = new THREE.Group();
  const wedge = new THREE.Mesh(sharedWedge, sharedWood);
  wedge.castShadow = true;
  wedge.receiveShadow = true;
  const edges = new THREE.LineSegments(sharedEdges, edgeMaterial);
  const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_H);
  // Turned to face the back: readable from across the table, right way up (decision 220).
  geo.rotateZ(Math.PI);
  geo.rotateX(-BACK);
  const face = new THREE.Mesh(geo, plate);
  const mid = (RIDGE + STAND_D / 2) / 2;
  const n = new THREE.Vector3(0, Math.sin(BACK), Math.cos(BACK));
  face.position.set(0, mid, STAND_H / 2).addScaledVector(n, 0.4);
  face.receiveShadow = true;
  group.add(wedge, edges, face);
  return group;
}
