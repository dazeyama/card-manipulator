import { describe, expect, it } from 'vitest';
import { DESIGN_WIDTH, MIN_WIDTH, shrinkToFit, uiScale } from '../src/ui/fit';
import { autoCursorSize, scaleHotspot } from '../src/ui/cursorSize';

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

describe('fitting the bars by measure, and the cursor size (decision 289)', () => {
  it('shrinks further by exactly how much the bars overflow', () => {
    expect(shrinkToFit(0.8, 1)).toBe(0.8);
    expect(shrinkToFit(0.8, 0.9)).toBe(0.8);
    expect(shrinkToFit(0.8, 1.25)).toBeCloseTo(0.64, 9);
  });

  it('picks a smaller cursor on a laptop screen, and smaller again on a Mac', () => {
    expect(autoCursorSize(1920, false)).toBe('large');
    expect(autoCursorSize(1366, false)).toBe('medium');
    expect(autoCursorSize(1920, true)).toBe('medium');
    expect(autoCursorSize(1470, true)).toBe('small');
  });

  it('moves a hotspot with its cursor and keeps it inside', () => {
    expect(scaleHotspot(24, 48, 28)).toBe(14);
    expect(scaleHotspot(47, 48, 28)).toBe(27);
    expect(scaleHotspot(0, 48, 36)).toBe(0);
  });
});
