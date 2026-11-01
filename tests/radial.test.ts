import { describe, expect, it } from 'vitest';
import { angleOf, BASE_GEOMETRY, itemAt, itemOf, NO_PICK, onRelease, pick, RADIAL_MENU, scaledGeometry, wedgeAt } from '../src/input/radial';

const g = BASE_GEOMETRY;
/** An offset at a compass angle in degrees (0 up, clockwise) and a distance. */
const at = (deg: number, r: number) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r] as const;
const labelOf = (deg: number, r: number, prev = NO_PICK) => {
  const p = pick(RADIAL_MENU, ...at(deg, r), g, prev);
  return itemOf(RADIAL_MENU, p)?.label ?? null;
};

describe('radial menu contents', () => {
  it('has the eight agreed wedges, clockwise from the top', () => {
    expect(RADIAL_MENU.map((w) => w.label)).toEqual(['Stack', 'Flip', 'Turn', 'Spread', 'Hand', 'Sort', 'Draw', 'Point']);
  });

  it('starts every wedge with its main action, and every wedge needs cards', () => {
    expect(RADIAL_MENU.map((w) => w.items[0].presses.join(' '))).toEqual(['s', 'f', 'r', 'x', 'h', 'c', '1', 'p']);
    expect(RADIAL_MENU.filter((w) => !w.cards)).toEqual([]);
  });

  it('gives every wedge an outer ring', () => {
    expect(RADIAL_MENU.filter((w) => w.items.length < 2)).toEqual([]);
  });

  it('points, or passes a pack with P P (decision 305)', () => {
    const point = RADIAL_MENU.find((w) => w.label === 'Point')!;
    expect(point.items.map((i) => `${i.label}: ${i.presses.join(' ')}`)).toEqual(['Point: p', 'Pass pack: p p']);
  });

  it('gives every item an icon and a title for the bottom bar', () => {
    const items = RADIAL_MENU.flatMap((w) => w.items);
    expect(items).toHaveLength(25);
    for (const i of items) {
      expect(i.icon, i.label).not.toBe('');
      expect(i.title, i.label).not.toBe('');
    }
  });

  it('names H H by where it acts: wide on the table, usual size on a stand', () => {
    const hh = RADIAL_MENU.flatMap((w) => w.items).find((i) => i.key === 'H H')!;
    expect(hh.label).toBe('Wide hand');
    expect(hh.onStand?.label).toBe('Usual size');
  });

  it('has Tokens in Stack’s ring, usable with no cards (decision 308)', () => {
    const stack = RADIAL_MENU.find((w) => w.label === 'Stack')!;
    const tokens = stack.items.find((i) => i.label === 'Tokens')!;
    expect(tokens.presses).toEqual(['t', 't']);
    expect(tokens.anywhere).toBe(true);
  });

  it('draws 1, 7 or N cards, or searches the pile with L or L L (decision 310)', () => {
    const draw = RADIAL_MENU.find((w) => w.label === 'Draw')!;
    expect(draw.items.map((i) => i.presses.join(' '))).toEqual(['1', '7', '0', 'l', 'l l']);
  });
});

describe('angles and wedges', () => {
  it('measures 0 straight up, clockwise', () => {
    expect(angleOf(0, -10)).toBeCloseTo(0);
    expect(angleOf(10, 0)).toBeCloseTo(Math.PI / 2);
    expect(angleOf(0, 10)).toBeCloseTo(Math.PI);
    expect(angleOf(-10, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('centres wedge 0 on straight up, including just left of it', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(wedgeAt(deg(0), 8)).toBe(0);
    expect(wedgeAt(deg(350), 8)).toBe(0);
    expect(wedgeAt(deg(23), 8)).toBe(1);
    expect(wedgeAt(deg(180), 8)).toBe(4);
    expect(wedgeAt(deg(337), 8)).toBe(7);
  });

  it('wraps the outer ring of the top wedge across straight up', () => {
    // Stack's three items span 96°, centred on 0°: from 312° round to 48°.
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(itemAt(deg(320), 0, 8, 3)).toBe(0);
    expect(itemAt(deg(0), 0, 8, 3)).toBe(1);
    expect(itemAt(deg(40), 0, 8, 3)).toBe(2);
    expect(itemAt(deg(60), 0, 8, 3)).toBe(-1);
  });
});

describe('pick', () => {
  it('picks nothing in the hole', () => {
    expect(pick(RADIAL_MENU, ...at(90, g.hole - 1), g)).toEqual(NO_PICK);
  });

  it('picks the wedge on the inner ring', () => {
    expect(labelOf(0, 80)).toBe('Stack');
    expect(labelOf(90, 80)).toBe('Turn 90°');
    expect(labelOf(225, 80)).toBe('Curve');
    expect(labelOf(315, 80)).toBe('Point');
  });

  it('picks an outer item past the inner ring, and overshoot still counts', () => {
    // Sort is centred on 225°; its five items span 160°, the second from 177° to 209°.
    const fromSort = pick(RADIAL_MENU, ...at(225, 80), g);
    expect(labelOf(196, 150, fromSort)).toBe('Colour columns');
    expect(labelOf(196, 600, fromSort)).toBe('Colour columns');
    expect(labelOf(225, 150, fromSort)).toBe('Curve per colour');
    // Straight out from Hand, the same angle is Hand's own ring.
    expect(labelOf(196, 150, pick(RADIAL_MENU, ...at(180, 80), g))).toBe('Wide hand');
  });

  it('keeps the wedge you came through while over its wider outer ring', () => {
    // 270° is Draw's wedge by angle, but Sort's outer ring reaches it.
    const fromSort = pick(RADIAL_MENU, ...at(225, 80), g);
    expect(labelOf(285, 150, fromSort)).toBe('Elo');
    // Coming from Draw, the same spot is Draw's own ring: N cards, from 254° to 286°.
    const fromDraw = pick(RADIAL_MENU, ...at(270, 80), g);
    expect(labelOf(285, 150, fromDraw)).toBe('N cards');
  });

  it('falls back to the wedge itself where there is no ring', () => {
    const menu = [RADIAL_MENU[0], { ...RADIAL_MENU[7], items: RADIAL_MENU[7].items.slice(0, 1) }];
    // Two wedges: the second is centred straight down, with one item and so no ring.
    expect(itemOf(menu, pick(menu, ...at(180, 170), g))?.label).toBe('Point');
  });

  it('scales with the cursor size', () => {
    const big = scaledGeometry(1.5);
    expect(big.inner).toBeCloseTo(g.inner * 1.5);
    expect(pick(RADIAL_MENU, ...at(0, g.hole + 2), big)).toEqual(NO_PICK);
  });
});

describe('letting go of Space', () => {
  it('picks once the pointer has left the hole', () => {
    expect(onRelease(true, 50)).toBe('pick');
    expect(onRelease(true, 3000)).toBe('pick');
  });

  it('stays open after a quick tap, and cancels after a long hold in the middle', () => {
    expect(onRelease(false, 120)).toBe('stay');
    expect(onRelease(false, 900)).toBe('cancel');
  });
});
