// Playmat art, sharpened (decision 323). Scryfall's art crop is 626 px wide,
// stretched over a 61 cm mat, so up close every image pixel covers two or
// three screen pixels and the GPU's straight-line blend between them looks
// soft. In High graphics the art is redrawn once at twice the size with a
// Catmull-Rom (bicubic) resize, which keeps edges firmer than that blend, and
// then given contrast-adaptive sharpening after AMD's FidelityFX CAS: flat and
// already-crisp areas are left nearly alone, so JPEG blocks and edges don't
// ring. Pure: RGBA bytes in, RGBA bytes out; the worker runs it off the page.

/** How strongly CAS sharpens, 0 to 1: a light touch, so painted art doesn't turn gritty. */
export const SHARPNESS = 0.5;

/** Catmull-Rom weights for the four samples around a point `t` (0 to 1) past the second one. */
function weights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    (-t3 + 2 * t2 - t) / 2,
    (3 * t3 - 5 * t2 + 2) / 2,
    (-3 * t3 + 4 * t2 + t) / 2,
    (t3 - t2) / 2,
  ];
}

/**
 * Resize RGBA pixels to `scale` times the size with Catmull-Rom, one direction
 * at a time. Edge pixels repeat past the border. Alpha is resized like colour.
 */
export function upscale(src: Uint8ClampedArray, w: number, h: number, scale: number): Uint8ClampedArray {
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  // Across first, into floats so the second pass doesn't round twice.
  const mid = new Float32Array(W * h * 4);
  for (let X = 0; X < W; X++) {
    const sx = (X + 0.5) / scale - 0.5;
    const x0 = Math.floor(sx);
    const k = weights(sx - x0);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let ch = 0; ch < 4; ch++) {
        let v = 0;
        for (let i = 0; i < 4; i++) {
          const x = Math.min(w - 1, Math.max(0, x0 - 1 + i));
          v += k[i] * src[(row + x) * 4 + ch];
        }
        mid[(y * W + X) * 4 + ch] = v;
      }
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / scale - 0.5;
    const y0 = Math.floor(sy);
    const k = weights(sy - y0);
    const rows = [0, 1, 2, 3].map((i) => Math.min(h - 1, Math.max(0, y0 - 1 + i)) * W);
    for (let X = 0; X < W; X++) {
      for (let ch = 0; ch < 4; ch++) {
        let v = 0;
        for (let i = 0; i < 4; i++) v += k[i] * mid[(rows[i] + X) * 4 + ch];
        out[(Y * W + X) * 4 + ch] = v;
      }
    }
  }
  return out;
}

/**
 * Contrast-adaptive sharpening (FidelityFX CAS, the plus-shaped form): each
 * colour channel is pushed away from its four neighbours, by less where they
 * already span a wide range or sit near black or white. Alpha is kept.
 */
export function sharpen(src: Uint8ClampedArray, w: number, h: number, sharpness = SHARPNESS): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const peak = -1 / (8 - 3 * sharpness);
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - 1);
      const right = Math.min(w - 1, x + 1);
      const i = (row + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const c = src[i + ch] / 255;
        const a = src[(up + x) * 4 + ch] / 255;
        const b = src[(row + left) * 4 + ch] / 255;
        const d = src[(row + right) * 4 + ch] / 255;
        const e = src[(down + x) * 4 + ch] / 255;
        const mn = Math.min(a, b, c, d, e);
        const mx = Math.max(a, b, c, d, e);
        const amp = mx > 0 ? Math.sqrt(Math.min(1, Math.max(0, Math.min(mn, 1 - mx) / mx))) : 0;
        const wgt = amp * peak;
        out[i + ch] = ((c + wgt * (a + b + d + e)) / (1 + 4 * wgt)) * 255;
      }
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

/** The whole treatment: twice the size, then sharpened. */
export function sharpenArt(src: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; w: number; h: number } {
  const big = upscale(src, w, h, 2);
  return { data: sharpen(big, w * 2, h * 2), w: w * 2, h: h * 2 };
}
