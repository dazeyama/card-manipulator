import { describe, expect, it } from 'vitest';
import { CameraRig, DEFAULT_PITCH, VIEW_PRESETS } from '../src/render/camera';
import { shortAngle } from '../src/physics/motion';

function rig(): CameraRig {
  const r = new CameraRig();
  r.resize(1920, 1080);
  return r;
}

describe('camera rig', () => {
  it('keeps pitch and yaw inside the orbit limits (decision 25)', () => {
    const r = rig();
    r.orbit(-100000, 100000);
    expect(r.pitch).toBe(89);
    expect(r.yaw).toBe(60);
    r.orbit(100000, -100000);
    expect(r.pitch).toBe(25);
    expect(r.yaw).toBe(-60);
  });

  it('zooms toward the point under the cursor', () => {
    const r = rig();
    const before = r.screenToPlane(1500, 300)!;
    r.zoomAt(1500, 300, 0.5);
    const after = r.screenToPlane(1500, 300)!;
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it('pans so the grabbed table point stays under the cursor', () => {
    const r = rig();
    const grab = r.screenToPlane(900, 500)!;
    r.panTo(grab, 1200, 700);
    const now = r.screenToPlane(1200, 700)!;
    expect(now.x).toBeCloseTo(grab.x, 3);
    expect(now.y).toBeCloseTo(grab.y, 3);
  });

  it('limits zoom to roughly 150 mm to 3,600 mm of visible table', () => {
    const r = rig();
    r.zoomAt(960, 540, 0.0001);
    expect(r.visibleWidth()).toBeCloseTo(150, 0);
    r.zoomAt(960, 540, 10000);
    expect(r.visibleWidth()).toBeCloseTo(3600, 0);
  });

  it('Home resets the view', () => {
    const r = rig();
    r.orbit(50, 50);
    r.target.set(100, 200, 0);
    r.reset(false);
    expect(r.pitch).toBe(DEFAULT_PITCH);
    expect(r.yaw).toBe(0);
    expect(r.target.length()).toBe(0);
  });

  it('cycles view presets, keeping position and zoom, and resets to the current preset', () => {
    const r = rig();
    r.target.set(100, 200, 0);
    r.distance = 900;
    r.update();
    const p = r.cycle();
    expect(p.name).toBe('Top-down');
    r.step(performance.now() + 1000);
    expect(r.swinging).toBe(false);
    expect(r.pitch).toBe(VIEW_PRESETS[1].pitch);
    expect(r.target.x).toBeCloseTo(100, 6);
    expect(r.target.y).toBeCloseTo(200, 6);
    expect(r.distance).toBeCloseTo(900, 6);
    for (let i = 0; i < VIEW_PRESETS.length; i++) r.cycle();
    expect(r.preset).toBe(1);
    r.reset();
    r.step(performance.now() + 1000);
    expect(r.pitch).toBe(VIEW_PRESETS[1].pitch);
    expect(r.target.length()).toBe(0);
  });

  it('a manual camera move interrupts a swing', () => {
    const r = rig();
    r.cycle();
    r.orbit(10, 0);
    expect(r.swinging).toBe(false);
  });

  it('round-trips through the save state', () => {
    const r = rig();
    r.orbit(40, -30);
    const s = r.toState();
    const r2 = rig();
    r2.fromState(s);
    expect(r2.toState()).toEqual(s);
  });
});

describe('shortAngle', () => {
  it('wraps to the shortest turn', () => {
    expect(shortAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(shortAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
    expect(shortAngle(0.3)).toBeCloseTo(0.3);
  });
});
