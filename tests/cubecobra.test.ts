import { describe, expect, it } from 'vitest';
import { cubeIdFrom, readCube } from '../src/cube/cubecobra';
import { compileQuery, type QueryCard } from '../src/query/evaluate';
import type { Card } from '../src/state/types';

describe('CubeCobra links (decision 192)', () => {
  it('finds the cube id in any of its links, or takes a bare id', () => {
    expect(cubeIdFrom('https://cubecobra.com/cube/list/classicmoderncube')).toBe('classicmoderncube');
    expect(cubeIdFrom('cubecobra.com/cube/overview/abc123?view=table')).toBe('abc123');
    expect(cubeIdFrom('https://www.cubecobra.com/cube/playtest/my-cube/')).toBe('my-cube');
    expect(cubeIdFrom('https://cubecobra.com/c/x9z')).toBe('x9z');
    expect(cubeIdFrom('  vintage  ')).toBe('vintage');
    expect(cubeIdFrom('not a cube')).toBeNull();
    expect(cubeIdFrom('')).toBeNull();
  });
});

describe('reading a cube (decision 192)', () => {
  const json = {
    name: 'Test Cube',
    cards: {
      mainboard: [
        { cardID: 'a', finish: 'Foil', details: { oracle_id: 'oa', elo: 1280.48 } },
        { cardID: 'b', finish: 'Non-foil', details: { oracle_id: 'ob', elo: 1502 } },
        { cardID: 'c', finish: 'Etched', details: { oracle_id: 'oc' } },
        { details: { oracle_id: 'od', elo: 1000 } },
      ],
      maybeboard: [{ cardID: 'm', details: { elo: 9999 } }],
    },
  };

  it('takes the mainboard with each card’s printing, finish and Elo', () => {
    const cube = readCube('t', json);
    expect(cube.name).toBe('Test Cube');
    expect(cube.cards.map((c) => c.scryfallId)).toEqual(['a', 'b', 'c']);
    expect(cube.cards.map((c) => c.finish)).toEqual(['foil', 'nonfoil', 'etched']);
    expect(cube.cards[0].elo).toBeCloseTo(1280.48, 6);
    expect(cube.cards[2].elo).toBeUndefined();
    expect(cube.cards[1].oracleId).toBe('ob');
  });

  it('copes with an empty or odd answer', () => {
    expect(readCube('x', null)).toEqual({ id: 'x', name: 'x', cards: [] });
    expect(readCube('x', { cards: [] }).cards).toEqual([]);
  });
});

describe('searching by Elo (decision 192)', () => {
  const qc = (elo?: number): QueryCard => ({
    card: { uid: 'u', scryfallId: 's', finish: 'nonfoil', x: 0, y: 0, z: 0, yaw: 0, faceUp: true, pileId: null, spreadOf: null } as Card,
    record: undefined,
    selected: false,
    pileName: null,
    elo,
  });

  it('compares Elo, and a card with none matches no Elo test', () => {
    const test = (q: string, elo?: number) => {
      const c = compileQuery(q);
      if (!c.ok) throw new Error(c.error);
      return c.test(qc(elo));
    };
    expect(test('elo>=1400', 1502)).toBe(true);
    expect(test('elo>=1400', 1280)).toBe(false);
    expect(test('elo<1300', 1280)).toBe(true);
    expect(test('elo>=0')).toBe(false);
  });
});
