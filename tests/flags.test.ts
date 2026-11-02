import { describe, expect, it } from 'vitest';
import { clearOf, FLAG_COLOURS, FLAG_REACH, flagAt, flagMembership, flagOfCard, membersOf, nextColour, nextName, outsideSpot, type Flag } from '../src/state/flags';

const flag = (uid: string, x: number, y: number, extra: Partial<Flag> = {}): Flag => ({ uid, name: uid, filter: null, colour: '#e63946', x, y, ...extra });

describe('flags (decision 327)', () => {
  it('a card belongs to the flag whose zone holds its center', () => {
    const flags = [flag('a', 0, 0), flag('b', 1000, 0)];
    expect(flagAt(flags, 340, 0)?.uid).toBe('a');
    expect(flagAt(flags, 0, 351)).toBeNull();
    expect(flagAt(flags, 700, 0)?.uid).toBe('b');
    expect(flagAt(flags, 500, 0)).toBeNull();
  });

  it('a card on a card stand is no flag\'s', () => {
    expect(flagOfCard([flag('a', 0, 0)], { x: 0, y: 0, stand: 's1' })).toBeNull();
    expect(flagOfCard([flag('a', 0, 0)], { x: 0, y: 0 })?.uid).toBe('a');
  });

  it('lists a flag\'s cards', () => {
    const flags = [flag('a', 0, 0), flag('b', 1000, 0)];
    const cards = [{ uid: '1', x: 10, y: 0 }, { uid: '2', x: 990, y: 0 }, { uid: '3', x: 500, y: 0 }, { uid: '4', x: -300, y: 100 }];
    expect(membersOf(flags[0], flags, cards).map((c) => c.uid)).toEqual(['1', '4']);
  });

  it('a pile touching the zone counts whole, even where it reaches out of the circle (decision 354)', () => {
    const flags = [flag('a', 0, 0)];
    // A curve column from inside the circle out past its edge, and a loose card outside.
    const column = Array.from({ length: 20 }, (_, i) => ({ uid: `c${i}`, x: 0, y: 200 + i * 22, pileId: 'col' }));
    const loose = { uid: 'x', x: 0, y: 900, pileId: null };
    const m = flagMembership(flags, [...column, loose]);
    expect(column.every((c) => m.get(c.uid)?.uid === 'a')).toBe(true);
    expect(m.has('x')).toBe(false);
  });

  it('a pile reaching two zones: cards in a circle stay its flag\'s, the rest go to the flag with more of it', () => {
    const flags = [flag('a', 0, 0), flag('b', 700, 0)];
    const pile = [
      { uid: 'a1', x: 300, y: 0, pileId: 'p' }, { uid: 'a2', x: 320, y: 0, pileId: 'p' },
      { uid: 'mid', x: 350, y: 400, pileId: 'p' },
      { uid: 'b1', x: 400, y: 0, pileId: 'p' },
    ];
    const m = flagMembership(flags, pile);
    expect(m.get('a1')?.uid).toBe('a');
    expect(m.get('b1')?.uid).toBe('b');
    expect(m.get('mid')?.uid).toBe('a');
  });

  it('with a filter, a card joined only through its pile counts only if it matches', () => {
    const flags = [flag('a', 0, 0, { filter: 't:creature' })];
    const pile = [{ uid: 'in', x: 0, y: 300, pileId: 'p' }, { uid: 'yes', x: 0, y: 400, pileId: 'p' }, { uid: 'no', x: 0, y: 420, pileId: 'p' }];
    const m = flagMembership(flags, pile, (_f, uid) => uid !== 'no');
    expect([...m.keys()].sort()).toEqual(['in', 'yes']);
  });

  it('zones never overlap: a flag set too close is pushed out until they touch', () => {
    const p = clearOf({ x: 300, y: 0 }, [{ x: 0, y: 0 }]);
    expect(p.x).toBeCloseTo(FLAG_REACH * 2);
    expect(p.y).toBeCloseTo(0);
    // Far enough already: it stays.
    expect(clearOf({ x: 800, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 800, y: 0 });
    // Between two: clear of both.
    const q = clearOf({ x: 350, y: 10 }, [{ x: 0, y: 0 }, { x: 700, y: 0 }]);
    for (const o of [{ x: 0, y: 0 }, { x: 700, y: 0 }]) expect(Math.hypot(q.x - o.x, q.y - o.y)).toBeGreaterThanOrEqual(FLAG_REACH * 2 - 0.1);
  });

  it('turns a card away to just past the edge, straight out, and clear of a neighbor\'s zone', () => {
    const a = flag('a', 0, 0);
    const out = outsideSpot(a, { x: 100, y: 0 }, [a]);
    expect(out.y).toBeCloseTo(0);
    expect(out.x).toBeGreaterThan(FLAG_REACH + 50);
    expect(flagAt([a], out.x, out.y)).toBeNull();
    // A neighbor to the right: the card goes round instead of into it.
    const b = flag('b', FLAG_REACH * 2, 0);
    const round = outsideSpot(a, { x: 100, y: 0 }, [a, b]);
    expect(flagAt([a, b], round.x, round.y)).toBeNull();
  });

  it('picks a fresh color and name for each new flag', () => {
    expect(nextColour([])).toBe(FLAG_COLOURS[0]);
    expect(nextColour([flag('a', 0, 0, { colour: FLAG_COLOURS[0] })])).toBe(FLAG_COLOURS[1]);
    expect(nextName([flag('x', 0, 0, { name: 'Flag 1' })])).toBe('Flag 2');
  });
});
