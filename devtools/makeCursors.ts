// Turn the generated glove art into cursor images (decision 118). Dev only.
// For each hand in art/cursors/raw: key out the flat green background, trim
// to the hand, optionally thicken the black outline so it survives shrinking,
// fit it in a square and scale it down by area averaging. Also finds the
// click point: the fingertip for the pointing hand, the middle otherwise.
//
//   node --experimental-transform-types devtools/makeCursors.ts
//
// Writes art/cursors/<hand>-<size>[-bold].png and art/cursors/cursors.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

/** The source art for each hand, and where its click point is. */
const HANDS: { name: string; file: string; hotspot: 'fingertip' | 'centre' }[] = [
  { name: 'point', file: 'art/cursors/raw/point2-2.png', hotspot: 'fingertip' },
  { name: 'open', file: 'art/cursors/raw/open-back-1.png', hotspot: 'centre' },
  { name: 'fist', file: 'art/cursors/raw/fist2.png', hotspot: 'centre' },
];
/** Output sizes, and the outline thickness (in output pixels) a bold version aims for. */
const VARIANTS: { size: number; bold: number | null }[] = [
  { size: 32, bold: null },
  { size: 32, bold: 1.5 },
  { size: 48, bold: 1.7 },
];
/** The hand fills this share of the square, leaving a little room round it. */
const FILL = 0.94;
/** The source outline is roughly this thick, in source pixels. */
const SOURCE_OUTLINE = 11;

interface Image {
  w: number;
  h: number;
  /** RGBA, 0 to 255, straight (not premultiplied) alpha. */
  px: Uint8ClampedArray;
}

function read(file: string): Image {
  const png = PNG.sync.read(readFileSync(file));
  return { w: png.width, h: png.height, px: new Uint8ClampedArray(png.data) };
}

function write(file: string, img: Image): void {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.px);
  writeFileSync(file, PNG.sync.write(png));
}

/** Make the green background transparent and take the green tint off the edges. */
function keyGreen(img: Image): void {
  const p = img.px;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const green = g - Math.max(r, b);
    const a = 1 - Math.min(1, Math.max(0, (green - 60) / 100));
    p[i + 3] = Math.round(a * 255);
    if (green > 0) p[i + 1] = Math.max(r, b);
  }
}

/** The box around the solid part of the image. */
function bounds(img: Image): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.px[(y * img.w + x) * 4 + 3] > 128) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/** Thicken the black lines by `radius` source pixels all round. */
function boldLines(img: Image, radius: number): Image {
  const { w, h, px } = img;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
    if (a > 128 && 0.3 * r + 0.59 * g + 0.11 * b < 100) dark[i] = 1;
  }
  const out = new Uint8ClampedArray(px);
  const offsets: [number, number][] = [];
  const r2 = radius * radius;
  for (let dy = -Math.ceil(radius); dy <= radius; dy++) for (let dx = -Math.ceil(radius); dx <= radius; dx++) if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dark[y * w + x]) continue;
      for (const [dx, dy] of offsets) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && dark[yy * w + xx]) {
          const i = (y * w + x) * 4;
          out[i] = out[i + 1] = out[i + 2] = 0;
          out[i + 3] = 255;
          break;
        }
      }
    }
  }
  return { w, h, px: out };
}

/** Copy a square region (side `side`, top-left `sx, sy`, may run off the image) scaled down to `size` by area averaging. */
function shrink(img: Image, sx: number, sy: number, side: number, size: number): Image {
  const out = new Uint8ClampedArray(size * size * 4);
  const k = side / size;
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const fx0 = sx + tx * k, fx1 = fx0 + k, fy0 = sy + ty * k, fy1 = fy0 + k;
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
        const wy = Math.min(y + 1, fy1) - Math.max(y, fy0);
        if (y < 0 || y >= img.h) continue;
        for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
          if (x < 0 || x >= img.w) continue;
          const wgt = wy * (Math.min(x + 1, fx1) - Math.max(x, fx0));
          const i = (y * img.w + x) * 4;
          const a = (img.px[i + 3] / 255) * wgt;
          ar += img.px[i] * a;
          ag += img.px[i + 1] * a;
          ab += img.px[i + 2] * a;
          aa += a;
        }
      }
      const o = (ty * size + tx) * 4;
      if (aa > 0) {
        out[o] = ar / aa;
        out[o + 1] = ag / aa;
        out[o + 2] = ab / aa;
      }
      out[o + 3] = Math.round((aa / (k * k)) * 255);
    }
  }
  return { w: size, h: size, px: out };
}

/** The fingertip: the solid pixel furthest up and to the left. */
function fingertip(img: Image): { x: number; y: number } {
  let best = { x: 0, y: 0 }, score = Infinity;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.px[(y * img.w + x) * 4 + 3] > 128 && x + y < score) {
        score = x + y;
        best = { x, y };
      }
    }
  }
  return best;
}

// --gestures: the action gestures (shuffle, tidy, flip...), bold only, into
// art/cursors/gestures/, leaving the hands in use and cursors.json alone. Most are
// 48 px; Shuffle shows two hands side by side, so it is twice the size to keep each
// hand as big as the others (decision 166).
const GESTURE_SIZE: Record<string, number> = { shuffle: 96 };
if (process.argv.includes('--gestures')) {
  const { readdirSync, mkdirSync } = await import('node:fs');
  mkdirSync('art/cursors/gestures', { recursive: true });
  for (const file of readdirSync('art/cursors/raw/gestures').filter((f) => f.endsWith('.png'))) {
    const size = GESTURE_SIZE[file.replace('.png', '')] ?? 48;
    const src = read(`art/cursors/raw/gestures/${file}`);
    keyGreen(src);
    const b = bounds(src);
    const side = Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) / FILL;
    const sx = (b.x0 + b.x1 + 1) / 2 - side / 2, sy = (b.y0 + b.y1 + 1) / 2 - side / 2;
    const art = boldLines(src, Math.max(0, (1.7 * (side / size) - SOURCE_OUTLINE) / 2));
    const name = file.replace('.png', `-${size}-bold.png`);
    write(`art/cursors/gestures/${name}`, shrink(art, sx, sy, side, size));
    console.log(`gestures/${name}`);
  }
  process.exit(0);
}

const hotspots: Record<string, Record<string, [number, number]>> = {};
for (const hand of HANDS) {
  const src = read(hand.file);
  keyGreen(src);
  const b = bounds(src);
  const side = Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) / FILL;
  const sx = (b.x0 + b.x1 + 1) / 2 - side / 2, sy = (b.y0 + b.y1 + 1) / 2 - side / 2;
  const tip = fingertip(src);
  hotspots[hand.name] = {};
  for (const v of VARIANTS) {
    const k = side / v.size;
    const art = v.bold ? boldLines(src, Math.max(0, (v.bold * k - SOURCE_OUTLINE) / 2)) : src;
    const out = shrink(art, sx, sy, side, v.size);
    const name = `${hand.name}-${v.size}${v.bold ? '-bold' : ''}`;
    write(`art/cursors/${name}.png`, out);
    // The click point, nudged a pixel inside the fingertip so it isn't on the very edge.
    const hx = hand.hotspot === 'fingertip' ? (tip.x - sx) / k + 1 : v.size / 2;
    const hy = hand.hotspot === 'fingertip' ? (tip.y - sy) / k + 1 : v.size / 2;
    hotspots[hand.name][`${v.size}${v.bold ? '-bold' : ''}`] = [Math.round(hx), Math.round(hy)];
    console.log(`${name}.png  hotspot ${Math.round(hx)},${Math.round(hy)}`);
  }
}
writeFileSync('art/cursors/cursors.json', JSON.stringify(hotspots, null, 2) + '\n');
