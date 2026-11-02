// The table document (spec 6.3): building one from the table and loading one
// back. Used by autosave and by Save / Load file.

import type { App } from '../app';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
import { readBasics } from '../state/basics';
import { cubesOnTable } from '../state/cubes';
import { DEFAULT_SETTINGS, type Card, type CardRecord, type TableDoc } from '../state/types';
import { HIDDEN, type TableState } from '../../shared/table';

/**
 * Is this card written as hidden (ONLINE.md 7.5, O75)? A non-crown browser in a
 * room writes what it may not see as an unknowable card; the crown's copy is
 * complete, and a card loaded as hidden stays hidden.
 */
function writtenHidden(app: App, c: Card): boolean {
  if (c.scryfallId === HIDDEN) return true;
  return !!app.online && !app.online.room.isCrown && !app.store.canSee(c);
}

export function toDoc(app: App, withCardData: boolean): TableDoc {
  const store = app.store;
  const cards = [...store.cards.values()].map((c) => ({
    ...(writtenHidden(app, c) ? { uid: c.uid, scryfallId: HIDDEN, finish: 'nonfoil' as const, hidden: true as const } : { uid: c.uid, scryfallId: c.scryfallId, finish: c.finish }),
    x: round(c.x), y: round(c.y), z: round(c.z), yaw: round(c.yaw, 5), faceUp: c.faceUp,
    pileId: c.pileId && store.named.has(c.pileId) ? c.pileId : null,
    spreadOf: c.spreadOf,
    // Rounded like x and y, so a card still where an X spread laid it stays flat after loading (decision 160).
    ...(c.laidAt ? { laidAt: { x: round(c.laidAt.x), y: round(c.laidAt.y) } } : {}),
    // On a card stand's slope (decision 221).
    ...(c.stand ? { stand: c.stand } : {}),
    // Last moved from the far side (decision 267).
    ...(c.side ? { side: c.side } : {}),
    // Spawned from a CubeCobra cube (decision 321).
    ...(c.cube ? { cube: c.cube } : {}),
  }));
  const cardData: Record<string, CardRecord> = {};
  if (withCardData) {
    for (const c of store.cards.values()) {
      const r = writtenHidden(app, c) ? undefined : store.records.get(c.scryfallId);
      if (r) cardData[r.id] = r;
    }
  }
  return {
    format: 'card-manipulator-table',
    version: 1,
    name: store.name,
    savedAt: new Date().toISOString(),
    settings: { ...store.settings },
    camera: app.rig.toState(),
    piles: [...store.named.values()].map((p) => ({ id: p.id, name: p.name, filter: p.filter, anchor: p.anchor, yaw: p.yaw })),
    cards,
    spreads: [...store.spreads.values()].map((s) => ({ ...s, uids: [...s.uids] })),
    cardData,
    mats: [...store.mats.values()].map((m) => ({ ...m, x: round(m.x), y: round(m.y), yaw: round(m.yaw, 5) })),
    elo: eloOnTable(app),
    basics: store.basics,
    dice: [...store.dice.values()].map((d) => ({ ...d, x: round(d.x), y: round(d.y), z: round(d.z), yaw: round(d.yaw, 5) })),
    cubes: cubesOnTable(store.cubes.values(), store.cards.values()),
    flags: [...store.flags.values()].map((f) => ({ ...f, x: round(f.x), y: round(f.y) })),
  };
}

/** The Elo ratings of the cards on the table, by oracle id (decision 192). */
function eloOnTable(app: App): Record<string, number> {
  const store = app.store;
  const out: Record<string, number> = {};
  for (const c of store.cards.values()) {
    const oracle = writtenHidden(app, c) ? undefined : store.records.get(c.scryfallId)?.oracle_id;
    const elo = oracle ? store.elo.get(oracle) : undefined;
    if (oracle && elo !== undefined) out[oracle] = round(elo, 1);
  }
  return out;
}

function round(v: number, places = 3): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

/** The table a document holds, as a room shares it (ONLINE.md 8.1). */
export function tableOfDoc(doc: TableDoc): TableState {
  return {
    name: doc.name || 'Untitled table',
    // A card saved as hidden from a room stays unknowable: a back forever (7.5).
    cards: doc.cards.map(({ hidden, ...c }): Card => ({ ...c, ...(hidden ? { scryfallId: HIDDEN, finish: 'nonfoil' as const } : {}), pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null })),
    named: (doc.piles ?? []).map((p) => ({ id: p.id, name: p.name, filter: p.filter ?? null, anchor: p.anchor ?? { x: 0, y: 0 }, yaw: p.yaw ?? 0 })),
    spreads: (doc.spreads ?? []).map((s) => ({ ...s, uids: [...s.uids] })),
    // A stand loaded from a file has no owner (ONLINE.md 6.3).
    mats: (doc.mats ?? []).map(({ owner, ...m }) => ({ ...m })),
    dice: Array.isArray(doc.dice) ? doc.dice.map((d) => ({ ...d })) : [],
    // Older files have no basics: they keep the defaults (decision 210).
    basics: readBasics(doc.basics),
    cubes: Array.isArray(doc.cubes) ? doc.cubes.map((c) => ({ ...c })) : [],
    flags: Array.isArray(doc.flags) ? doc.flags.map((f) => ({ ...f })) : [],
  };
}

/** Check the shape of a document read from a file. Returns an error message or null. */
export function validateDoc(doc: unknown): string | null {
  const d = doc as Partial<TableDoc> | null;
  if (!d || typeof d !== 'object') return 'Not a table file';
  if (d.format !== 'card-manipulator-table') return 'Not a Card Manipulator table file';
  if (d.version !== 1) return `Unsupported table version ${String(d.version)}`;
  if (!Array.isArray(d.cards)) return 'The file has no cards list';
  return null;
}

/**
 * Replace the table with a document. Card records come from the file, then
 * the local cache, then Scryfall; cards show as gray placeholders until
 * their record arrives (spec 6.3).
 */
export async function loadDoc(app: App, doc: TableDoc): Promise<void> {
  const store = app.store;
  store.updateSettings({ ...DEFAULT_SETTINGS, ...doc.settings });

  // A hidden card has no record to fetch (7.5).
  const ids = [...new Set(doc.cards.map((c) => c.scryfallId))].filter((id) => id !== HIDDEN);
  const records = new Map<string, CardRecord>(Object.entries(doc.cardData ?? {}));
  const missing = ids.filter((id) => !records.has(id) && !store.records.has(id));
  if (missing.length) {
    const cached = await getRecords(missing);
    for (const [id, r] of cached) records.set(id, r);
  }
  store.addRecords([...records.values()].filter((r) => !store.records.has(r.id)));

  // The whole table at once: in a room, the crown's Load file is one `replace` op (ONLINE.md 8.2).
  store.elo.clear();
  store.replaceTable(tableOfDoc(doc));
  if (doc.elo) store.setElo(Object.entries(doc.elo));
  if (doc.camera) app.rig.fromState(doc.camera);

  const stillMissing = ids.filter((id) => !store.records.has(id));
  if (stillMissing.length) {
    try {
      store.addRecords(await fetchByIds(stillMissing));
    } catch (err) {
      console.warn('Could not fetch card data for the loaded table', err);
    }
  }
}
