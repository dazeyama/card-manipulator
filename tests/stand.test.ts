import { describe, expect, it } from 'vitest';
import { bottomAt, restOn } from '../src/state/rest';
import { LIP_H, SLOPE, STAND_D, STAND_H, STAND_W, onStand, profileHeight, standHeightAt, standSupports, standTopUnder } from '../src/state/stand';
import { CARD_H, CARD_T, CARD_W, type Mat } from '../src/state/types';

const stand = (x = 0, y = 0, yaw = 0): Mat => ({ uid: 's', kind: 'stand', scryfallId: '', name: 'Sarah', art: '', x, y, yaw });

describe('card stand (decision 220)', () => {
  it('has a lip, a 25 degree slope and a steeper back', () => {
    expect(profileHeight(0, -STAND_D / 2 + 2)).toBe(LIP_H);
    expect(STAND_H).toBeGreaterThan(60);
    expect(STAND_H).toBeLessThan(80);
    // Highest at the ridge, back to the table at the back edge, nothing off the stand.
    const heights = Array.from({ length: 201 }, (_, i) => profileHeight(0, -100 + i));
    expect(Math.max(...heights)).toBeCloseTo(STAND_H, 0);
    expect(profileHeight(0, STAND_D / 2)).toBeCloseTo(0, 6);
    expect(profileHeight(STAND_W, 0)).toBe(0);
  });

  it('turns with the stand', () => {
    const s = stand(100, 50, Math.PI / 2);
    expect(onStand(s, 100, 50)).toBe(true);
    // Turned a quarter, its width runs along y.
    expect(onStand(s, 100, 50 + STAND_W / 2 - 5)).toBe(true);
    expect(onStand(s, 100 + STAND_D / 2 + 5, 50)).toBe(false);
    expect(standHeightAt(s, 100, 50)).toBeCloseTo(profileHeight(0, 0), 6);
  });

  it('lays a card on the slope at its angle, its whole face on the slope', () => {
    const s = stand();
    // A card on the middle of the slope, upright like the stand.
    const at = { x: 0, y: -20, yaw: 0 };
    const rest = restOn(at, standSupports(s));
    expect(rest.tiltX).toBeCloseTo(SLOPE, 3);
    // Its underside touches the slope at its centre and stays on it at its ends.
    for (const t of [-CARD_H / 2, 0, CARD_H / 2]) {
      expect(bottomAt(rest, 0, t)).toBeCloseTo(standHeightAt(s, 0, -20 + t), 0);
    }
    expect(rest.z).toBeGreaterThan(CARD_T);
  });

  it('knows the top of the stand under a card', () => {
    const s = stand();
    expect(standTopUnder(s, { x: 0, y: 0, yaw: 0 }, CARD_W / 2, CARD_H / 2)).toBeGreaterThan(30);
    expect(standTopUnder(s, { x: 1000, y: 0, yaw: 0 }, CARD_W / 2, CARD_H / 2)).toBe(0);
  });
});
