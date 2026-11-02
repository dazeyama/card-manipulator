// The Spawn panel's Cube tab (decision 192): a CubeCobra link spawns every card
// of the cube's mainboard, in its printings and finishes, and the table learns
// each card's CubeCobra Elo.

import type { App } from '../app';
import { cubeIdFrom, fetchCube } from '../cube/cubecobra';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
import { spawnCards, type SpawnOptions } from '../spawn';
import type { CardRecord } from '../state/types';
import { h } from './dom';
import { toast } from './toasts';

export function buildCubeTab(app: App, options: () => SpawnOptions): HTMLElement {
  const line = h('input', { class: 'grow', placeholder: 'cubecobra.com/cube/list/…', spellcheck: 'false', 'aria-label': 'CubeCobra cube link' });
  const go = h('button', { class: 'btn primary' }, 'Spawn cube');
  const status = h('div', { class: 'muted small' });

  const spawn = async () => {
    const id = cubeIdFrom(line.value);
    if (!id) {
      status.textContent = 'Paste a CubeCobra cube link, or its id.';
      return;
    }
    go.disabled = true;
    try {
      status.textContent = 'Asking CubeCobra…';
      const cube = await fetchCube(id);
      if (!cube.cards.length) {
        status.textContent = `${cube.name} has no cards.`;
        return;
      }
      // Card data from the cache where we have it, the rest from Scryfall through the queue.
      const ids = [...new Set(cube.cards.map((c) => c.scryfallId))];
      const records = new Map<string, CardRecord>();
      for (const id of ids) {
        const r = app.store.records.get(id);
        if (r) records.set(id, r);
      }
      for (const [id, r] of await getRecords(ids.filter((i) => !records.has(i)))) records.set(id, r);
      const missing = ids.filter((i) => !records.has(i));
      if (missing.length) {
        status.textContent = `${cube.name}: getting card data for ${missing.length.toLocaleString()} cards…`;
        for (const r of await fetchByIds(missing)) records.set(r.id, r);
      }
      // Elo by oracle id, so every printing of a card shares it.
      const elo: [string, number][] = [];
      for (const c of cube.cards) {
        const oracle = records.get(c.scryfallId)?.oracle_id ?? c.oracleId;
        if (oracle && c.elo !== undefined) elo.push([oracle, c.elo]);
      }
      const items = cube.cards.flatMap((c) => {
        const record = records.get(c.scryfallId);
        return record ? [{ record, finish: c.finish, count: 1 }] : [];
      });
      app.store.addRecords([...records.values()].filter((r) => !app.store.records.has(r.id)));
      app.store.setElo(elo);
      // The cube's chip at the top of the play space (decision 321), shown while any of its cards are on the table.
      app.store.setCubes([{ id: cube.id, name: cube.name, size: cube.cards.length }]);
      const uids = spawnCards(app, items, { ...options(), cube: cube.id });
      const lost = cube.cards.length - items.length;
      status.textContent = `Spawned ${cube.name}: ${uids.length.toLocaleString()} cards, ${elo.length.toLocaleString()} with Elo${lost ? `; ${lost} Scryfall didn't know` : ''}.`;
      toast(`Spawned ${cube.name} (${uids.length.toLocaleString()} cards)`, 'ok');
    } catch (err) {
      status.textContent = `Couldn't load that cube: ${String((err as Error).message ?? err)}`;
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void spawn());
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void spawn();
  });

  return h('div', {},
    h('div', { class: 'row' }, line),
    h('div', { class: 'row' }, go),
    h('p', { class: 'muted small' }, 'Spawns the cube’s mainboard from CubeCobra in its own printings and finishes, with each card’s CubeCobra Elo (shown in Inspect, searchable as elo>=1400).'),
    status,
  );
}
