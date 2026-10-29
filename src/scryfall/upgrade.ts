// Card records cached before a field was kept are fetched again once, in the
// background, through the shared Scryfall queue (decision 187: EDHREC rank).

import type { Store } from '../state/store';
import type { CardRecord } from '../state/types';
import { fetchByIds } from './resolve';

/** Wait this long after records arrive, so a big load is fetched in one go. */
const SETTLE_MS = 2000;

/** True if a record predates a field the tool now keeps. */
export function isOutdated(r: CardRecord): boolean {
  return r.edhrec_rank === undefined;
}

export function installRecordUpgrade(store: Store): void {
  const asked = new Set<string>();
  let timer = 0;
  const run = async () => {
    timer = 0;
    const ids = [...store.records.values()].filter((r) => isOutdated(r) && !asked.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    for (const id of ids) asked.add(id);
    try {
      store.addRecords(await fetchByIds(ids));
    } catch (err) {
      // Offline or refused: try again next time records arrive.
      for (const id of ids) asked.delete(id);
      console.warn('Card data refresh failed', err);
    }
  };
  store.events.on('records', () => {
    if (!timer) timer = window.setTimeout(() => void run(), SETTLE_MS);
  });
}
