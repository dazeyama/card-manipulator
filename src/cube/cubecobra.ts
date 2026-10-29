// CubeCobra cubes (decision 192): a cube's link or id, its card list, and each
// card's CubeCobra Elo. CubeCobra has no documented API; its cube JSON
// (/cube/api/cubeJSON/<id>) lists the mainboard with each card's Scryfall id,
// finish and details, Elo among them, and lets any page read it.

import type { Finish } from '../state/types';

const ORIGIN = 'https://cubecobra.com';

/**
 * The cube id from a CubeCobra link (overview, list, playtest, analysis... or
 * the short /c/ form) or from a bare id. Null if it isn't one.
 */
export function cubeIdFrom(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const link = /cubecobra\.com\/(?:cube\/[a-z]+|c)\/([^/?#\s]+)/i.exec(text);
  if (link) return decodeURIComponent(link[1]);
  // A bare id: no spaces or slashes.
  return /^[\w.~-]+$/.test(text) ? text : null;
}

/** One card of a cube: its printing, finish and Elo (undefined if CubeCobra has none). */
export interface CubeCard {
  scryfallId: string;
  oracleId: string | null;
  finish: Finish;
  elo: number | undefined;
}

export interface Cube {
  id: string;
  name: string;
  cards: CubeCard[];
}

interface RawCard {
  cardID?: string;
  finish?: string;
  details?: { scryfall_id?: string; oracle_id?: string; elo?: number };
}

function finishOf(raw: string | undefined): Finish {
  if (!raw) return 'nonfoil';
  if (/etched/i.test(raw)) return 'etched';
  return /^foil/i.test(raw) ? 'foil' : 'nonfoil';
}

/** Read CubeCobra's cube JSON: the mainboard only, in list order. */
export function readCube(id: string, json: unknown): Cube {
  const doc = (json ?? {}) as { name?: string; cards?: { mainboard?: RawCard[] } | RawCard[] };
  const list = Array.isArray(doc.cards) ? doc.cards : doc.cards?.mainboard ?? [];
  const cards: CubeCard[] = [];
  for (const c of list) {
    const scryfallId = c.cardID ?? c.details?.scryfall_id;
    if (!scryfallId) continue;
    const elo = c.details?.elo;
    cards.push({ scryfallId, oracleId: c.details?.oracle_id ?? null, finish: finishOf(c.finish), elo: typeof elo === 'number' && Number.isFinite(elo) ? elo : undefined });
  }
  return { id, name: doc.name?.trim() || id, cards };
}

/** Fetch a cube. One request; a cube of 540 cards is about 2.5 MB. */
export async function fetchCube(id: string): Promise<Cube> {
  const res = await fetch(`${ORIGIN}/cube/api/cubeJSON/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('CubeCobra has no cube with that id.');
  if (!res.ok) throw new Error(`CubeCobra answered ${res.status}.`);
  return readCube(id, await res.json());
}
