// The spawn panel's Query tab (spec 12.1): a Scryfall query, a Preview count
// before spawning, a cap, and Spawn. Extras are always excluded (decision 31).

import type { App } from '../app';
import { searchCards, searchCount } from '../scryfall/search';
import { spawnCards } from '../spawn';
import { h } from './dom';
import { toast } from './toasts';

export function buildQueryTab(app: App, options: () => { arrival: 'messy' | 'stack'; faceUp: boolean; where: 'cursor' | 'center' }): HTMLElement {
  const q = h('input', { class: 'grow mono', placeholder: 'set:ltr r:rare', spellcheck: 'false', 'aria-label': 'Scryfall query' });
  const preview = h('button', { class: 'btn' }, 'Preview count');
  const cap = h('input', { class: 'short', type: 'number', min: '1', max: '2000', 'aria-label': 'Cap' });
  const go = h('button', { class: 'btn primary' }, 'Spawn');
  const status = h('div', { class: 'preview' });
  const syncCap = () => {
    cap.max = '2000';
    cap.value = String(app.store.settings.queryCap);
  };
  syncCap();
  app.store.events.on('settings', syncCap);
  let counted: { query: string; total: number } | null = null;

  const capValue = () => Math.max(1, Math.min(2000, Math.round(Number(cap.value) || app.store.settings.queryCap)));

  const doPreview = async () => {
    const query = q.value.trim();
    if (!query) return;
    preview.disabled = true;
    status.textContent = 'Asking Scryfall…';
    status.classList.remove('bad');
    try {
      const total = await searchCount(query);
      counted = { query, total };
      const c = capValue();
      status.textContent = total === 0
        ? 'No cards match.'
        : `${total.toLocaleString()} card${total === 1 ? '' : 's'} match` + (total > c ? `; Spawn will take the first ${c.toLocaleString()} by name (cap).` : '.');
      go.textContent = total ? `Spawn ${Math.min(total, c).toLocaleString()}` : 'Spawn';
    } catch (err) {
      status.textContent = String((err as Error).message ?? err);
      status.classList.add('bad');
    } finally {
      preview.disabled = false;
    }
  };

  const doSpawn = async () => {
    const query = q.value.trim();
    if (!query) return;
    if (!counted || counted.query !== query) await doPreview();
    if (!counted || counted.total === 0) return;
    go.disabled = true;
    try {
      const records = await searchCards(query, capValue(), (n) => (status.textContent = `Fetching… ${n.toLocaleString()} cards`));
      const uids = spawnCards(app, records.map((record) => ({ record, finish: 'nonfoil' as const, count: 1 })), options());
      status.textContent = `Spawned ${uids.length.toLocaleString()} cards.`;
      toast(`Spawned ${uids.length.toLocaleString()} cards from Scryfall`, 'ok');
    } catch (err) {
      toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
    } finally {
      go.disabled = false;
    }
  };

  preview.addEventListener('click', () => void doPreview());
  go.addEventListener('click', () => void doSpawn());
  q.addEventListener('input', () => {
    counted = null;
    go.textContent = 'Spawn';
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void doPreview();
  });
  cap.addEventListener('change', () => {
    if (counted) void doPreview();
  });

  return h('div', {},
    h('div', { class: 'row' }, q),
    h('div', { class: 'row' }, preview, h('span', { class: 'muted small' }, 'Cap'), cap, go),
    h('p', { class: 'muted small' }, 'Tokens, emblems and art cards are always left out (the search adds -is:extra). Each card spawns once.'),
    status,
  );
}
