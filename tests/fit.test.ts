import { describe, expect, it } from 'vitest';
import { DESIGN_WIDTH, MIN_WIDTH, uiScale } from '../src/ui/fit';

describe('fitting the interface to the window (decision 157)', () => {
  it('shows the panels at full size from 1800 px', () => {
    expect(uiScale(DESIGN_WIDTH)).toBe(1);
    expect(uiScale(2560)).toBe(1);
  });

  it('shrinks them to fit between 1280 and 1800 px', () => {
    expect(uiScale(1440)).toBeCloseTo(0.8, 9);
    expect(uiScale(MIN_WIDTH)).toBeCloseTo(MIN_WIDTH / DESIGN_WIDTH, 9);
  });

  it('gives up below 1280 px, for the warning', () => {
    expect(uiScale(MIN_WIDTH - 1)).toBeNull();
    expect(uiScale(800)).toBeNull();
  });
});
