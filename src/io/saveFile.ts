// The table document (spec 6.3): building one from the table and loading one
// back. Used by autosave and by Save / Load file.

import type { App } from '../app';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
import { DEFAULT_SETTINGS, type Card, type CardRecord, type TableDoc } from '../state/types';

export function toDoc(app: App, withCardData: boolean): TableDoc {
  const store = app.store;
  const cards = [...store.cards.values()].map((c) => ({
    uid: c.uid, scryfallId: c.scryfallId, finish: c.finish,
    x: round(c.x), y: round(c.y), z: round(c.z), yaw: round(c.yaw, 5), faceUp: c.faceUp,
    pileId: c.pileId && store.named.has(c.pileId) ? c.pileId : null,
    spreadOf: c.spreadOf,
    // Rounded like x and y, so a card still where an X spread laid it stays flat after loading (decision 160).
    ...(c.laidAt ? { laidAt: { x: round(c.laidAt.x), y: round(c.laidAt.y) } } : {}),
  }));
  const cardData: Record<string, CardRecord> = {};
  if (withCardData) {
    for (const c of store.cards.values()) {
      const r = store.records.get(c.scryfallId);
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
    elo: eloOnTable(store),
  };
}

/** The Elo ratings of the cards on the table, by oracle id (decision 192). */
function eloOnTable(store: App['store']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of store.cards.values()) {
    const oracle = store.records.get(c.scryfallId)?.oracle_id;
    const elo = oracle ? store.elo.get(oracle) : undefined;
    if (oracle && elo !== undefined) out[oracle] = round(elo, 1);
  }
  return out;
}

function round(v: number, places = 3): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
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
 * the local cache, then Scryfall; cards show as grey placeholders until
 * their record arrives (spec 6.3).
 */
export async function loadDoc(app: App, doc: TableDoc): Promise<void> {
  const store = app.store;
  store.clear();
  store.setName(doc.name || 'Untitled table');
  store.updateSettings({ ...DEFAULT_SETTINGS, ...doc.settings });

  const ids = [...new Set(doc.cards.map((c) => c.scryfallId))];
  const records = new Map<string, CardRecord>(Object.entries(doc.cardData ?? {}));
  const missing = ids.filter((id) => !records.has(id) && !store.records.has(id));
  if (missing.length) {
    const cached = await getRecords(missing);
    for (const [id, r] of cached) records.set(id, r);
  }
  store.addRecords([...records.values()].filter((r) => !store.records.has(r.id)));

  for (const p of doc.piles ?? []) {
    store.named.set(p.id, { id: p.id, name: p.name, filter: p.filter ?? null, anchor: p.anchor ?? { x: 0, y: 0 }, yaw: p.yaw ?? 0 });
  }
  for (const s of doc.spreads ?? []) store.spreads.set(s.id, { ...s, uids: [...s.uids] });
  const cards: Card[] = doc.cards.map((c) => ({ ...c, pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null }));
  store.addCards(cards);
  for (const m of doc.mats ?? []) store.addMat({ ...m });
  if (doc.elo) store.setElo(Object.entries(doc.elo));
  if (doc.camera) app.rig.fromState(doc.camera);
  store.events.emit('settled', cards.map((c) => c.uid));
  store.events.emit('piles', undefined);

  const stillMissing = ids.filter((id) => !store.records.has(id));
  if (stillMissing.length) {
    try {
      store.addRecords(await fetchByIds(stillMissing));
    } catch (err) {
      console.warn('Could not fetch card data for the loaded table', err);
    }
  }
}
