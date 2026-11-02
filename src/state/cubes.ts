// CubeCobra cubes on the table (decision 321): the cube chips at the top of
// the play space show each cube that still has at least one card here.

import type { CubeInfo } from './types';

/** The cubes with at least one card on the table, in the order they were spawned. */
export function cubesOnTable(cubes: Iterable<CubeInfo>, cards: Iterable<{ cube?: string }>): CubeInfo[] {
  const present = new Set<string>();
  for (const c of cards) if (c.cube) present.add(c.cube);
  return [...cubes].filter((c) => present.has(c.id));
}

/** The cube's page on CubeCobra. */
export function cubeUrl(id: string): string {
  return `https://cubecobra.com/cube/overview/${encodeURIComponent(id)}`;
}

/** The short form of the link, as the chip shows it. */
export function cubeLinkText(id: string): string {
  return `cubecobra.com/c/${id}`;
}
