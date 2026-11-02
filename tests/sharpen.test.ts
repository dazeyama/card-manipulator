import { describe, expect, it } from 'vitest';
import { sharpen, sharpenArt, upscale } from '../src/render/sharpen';

/** A w x h RGBA image from one grey value per pixel (alpha 255). */
function grey(w: number, h: number, value: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = value(x, y);
      px[i + 3] = 255;
    }
  }
  return px;
}

const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4];

describe('playmat art sharpening (decision 323)', () => {
  it('doubles the size and leaves a flat colour flat', () => {
    const out = sharpenArt(grey(5, 3, () => 120), 5, 3);
    expect([out.w, out.h, out.data.length]).toEqual([10, 6, 10 * 6 * 4]);
    expect([...out.data].every((v, i) => (i % 4 === 3 ? v === 255 : Math.abs(v - 120) <= 1))).toBe(true);
  });

  it('upscales a gradient smoothly, without stairs', () => {
    const src = grey(8, 1, (x) => x * 30);
    const big = upscale(src, 8, 1, 2);
    const row = Array.from({ length: 16 }, (_, x) => at(big, 16, x, 0));
    // Away from the edges every step is about half the original step.
    for (let x = 3; x < 13; x++) expect(Math.abs(row[x + 1] - row[x] - 15)).toBeLessThanOrEqual(2);
  });

  it('steepens a soft edge', () => {
    const soft = grey(7, 1, (x) => [60, 60, 80, 120, 160, 180, 180][x]);
    const out = sharpen(soft, 7, 1);
    // Darker below the middle, lighter above it: the edge is steeper.
    expect(at(out, 7, 2, 0)).toBeLessThan(80);
    expect(at(out, 7, 4, 0)).toBeGreaterThan(160);
    expect(at(out, 7, 3, 0)).toBe(120);
  });

  it('keeps pure black and white as they are', () => {
    const out = sharpen(grey(4, 1, (x) => (x < 2 ? 0 : 255)), 4, 1);
    expect([0, 1, 2, 3].map((x) => at(out, 4, x, 0))).toEqual([0, 0, 255, 255]);
  });
});
