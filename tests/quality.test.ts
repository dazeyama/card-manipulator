import { describe, expect, it } from 'vitest';
import { AUTO_LOW_ABOVE, effectiveMode, GRAPHICS, pixelRatioFor } from '../src/render/quality';

describe('graphics modes (decision 152)', () => {
  it('keeps Low exactly the original budget', () => {
    const low = GRAPHICS.low;
    expect(pixelRatioFor(low, 1)).toBe(1);
    expect(pixelRatioFor(low, 3)).toBe(2);
    expect(low.shadowMapSize).toBe(4096);
    expect([low.anisotropy, low.hiresAbovePx, low.hiresMax, low.hiresPool, low.hiresImage]).toEqual([8, 160, 32, 64, 'normal']);
    expect([low.mirrorEveryMs, low.mirrorMax, low.mirrorSamples]).toEqual([33, 1920, 4]);
  });

  it('turns every dial up in High', () => {
    const { low, high } = GRAPHICS;
    expect(pixelRatioFor(high, 1)).toBe(2);
    expect(pixelRatioFor(high, 2)).toBe(3);
    expect(high.shadowMapSize).toBeGreaterThan(low.shadowMapSize);
    expect(high.anisotropy).toBeGreaterThan(low.anisotropy);
    expect(high.hiresAbovePx).toBeLessThan(low.hiresAbovePx);
    expect(high.hiresMax).toBeGreaterThan(low.hiresMax);
    expect(high.hiresPool).toBeGreaterThanOrEqual(high.hiresMax);
    expect(high.hiresImage).toBe('large');
    expect(high.mirrorEveryMs).toBeLessThan(low.mirrorEveryMs);
    expect(high.mirrorSamples).toBeGreaterThan(low.mirrorSamples);
  });

  it('drops High to Low above 1000 cards, unless High was asked for anyway', () => {
    expect(effectiveMode('high', false, AUTO_LOW_ABOVE)).toBe('high');
    expect(effectiveMode('high', false, AUTO_LOW_ABOVE + 1)).toBe('low');
    expect(effectiveMode('high', true, AUTO_LOW_ABOVE + 1)).toBe('high');
    expect(effectiveMode('low', false, 10)).toBe('low');
    expect(effectiveMode('low', true, 10)).toBe('low');
  });
});
