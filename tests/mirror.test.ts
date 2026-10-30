import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/camera';
import { alignTo } from '../src/state/stand';

describe('mirror mode (decision 267)', () => {
  it('swings the camera round to the far side of the table, and back', () => {
    const rig = new CameraRig();
    rig.resize(1600, 900);
    // Normally it looks from the near side, below the target.
    expect(rig.camera.position.y).toBeLessThan(rig.target.y);
    rig.setMirrored(true);
    expect(rig.mirrored).toBe(true);
    rig.step(performance.now() + 10_000);
    expect(rig.camera.position.y).toBeGreaterThan(rig.target.y);
    rig.setMirrored(false);
    rig.step(performance.now() + 20_000);
    expect(rig.camera.position.y).toBeLessThan(rig.target.y);
  });

  it('builds a layout the right way up from the far side', () => {
    // A row left to right from the near side reads left to right from the far side once turned.
    const row = [{ x: -10, y: 5, yaw: 0 }, { x: 10, y: 5, yaw: 0 }];
    const far = alignTo(row, { x: 0, y: 0 }, Math.PI);
    expect(far[0].x).toBeCloseTo(10, 6);
    expect(far[0].y).toBeCloseTo(-5, 6);
    expect(far[1].x).toBeCloseTo(-10, 6);
    expect(far[0].yaw).toBeCloseTo(Math.PI, 6);
  });
});
