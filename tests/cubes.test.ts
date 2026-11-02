import { describe, expect, it } from 'vitest';
import { cubeLinkText, cubesOnTable, cubeUrl } from '../src/state/cubes';

const vintage = { id: 'vintage', name: 'Vintage Cube', size: 540 };
const pauper = { id: 'thepaupercube', name: 'The Pauper Cube', size: 450 };

describe('cube chips (decision 321)', () => {
  it('shows a cube while at least one of its cards is on the table', () => {
    const cards = [{ cube: 'vintage' }, {}, { cube: 'vintage' }];
    expect(cubesOnTable([vintage, pauper], cards)).toEqual([vintage]);
  });

  it('shows every cube with cards, in the order they were spawned', () => {
    expect(cubesOnTable([pauper, vintage], [{ cube: 'vintage' }, { cube: 'thepaupercube' }])).toEqual([pauper, vintage]);
  });

  it('shows none on a table without cube cards', () => {
    expect(cubesOnTable([vintage], [{}, {}])).toEqual([]);
    expect(cubesOnTable([], [{ cube: 'vintage' }])).toEqual([]);
  });

  it('links to the cube on CubeCobra', () => {
    expect(cubeUrl('vintage')).toBe('https://cubecobra.com/cube/overview/vintage');
    expect(cubeUrl('a b')).toBe('https://cubecobra.com/cube/overview/a%20b');
    expect(cubeLinkText('vintage')).toBe('cubecobra.com/c/vintage');
  });
});
