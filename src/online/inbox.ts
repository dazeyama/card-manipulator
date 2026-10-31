// What comes in from the room (ONLINE.md 11.2): confirmed ops, reveals,
// forgets and snapshots, applied to the store as changes from the room
// (`store.remote`), never sent back. `applyToStore` is the store-side twin of
// shared/apply.ts's applyOp; tests/apply.test.ts proves they agree.

import type { Store } from '../state/store';
import type { Op } from '../../shared/ops';
import type { Card } from '../state/types';

/**
 * Apply an op to the store through its mutation methods, so every listener
 * (the renderer, piles, autosave) hears of it as it would of a local change.
 * Holds (`grab`, `release`) are not table state: presence keeps them. Runs as
 * the store's current origin: the inbox wraps it in `store.remote`.
 */
export function applyToStore(store: Store, op: Op): void {
  switch (op.t) {
    case 'add':
      store.addCards(op.cards.map((c): Card => ({ ...c, laidAt: c.laidAt ? { ...c.laidAt } : undefined, pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null })));
      return;
    case 'remove':
      store.removeCards(op.uids);
      return;
    case 'move':
      store.moveCards(op.moves);
      return;
    case 'grab':
    case 'release':
      return;
    case 'reuid':
      store.renameCards(op.pairs);
      return;
    case 'named':
      store.setNamed(op.set ?? [], op.remove ?? []);
      return;
    case 'spread':
      store.setSpreads(op.set ?? [], op.remove ?? []);
      return;
    case 'mat': {
      for (const m of op.set ?? []) store.addMat({ ...m });
      for (const uid of op.remove ?? []) store.removeMat(uid);
      if (op.spill?.length) {
        const spilled = new Set(op.spill);
        const off = [...store.cards.values()].filter((c) => c.stand && spilled.has(c.stand)).map((c) => ({ uid: c.uid, stand: null }));
        if (off.length) store.moveCards(off);
        for (const uid of op.spill) store.removeMat(uid);
      }
      return;
    }
    case 'dice':
      if (op.set?.length) store.setDice(op.set);
      if (op.remove?.length) store.removeDice(op.remove);
      return;
    case 'basics':
      store.setBasics(JSON.parse(JSON.stringify(op.basics)) as typeof op.basics);
      return;
    case 'table':
      store.setName(op.name);
      return;
    case 'replace':
      store.replaceTable(op.table);
      return;
    case 'batch':
      for (const o of op.ops) applyToStore(store, o);
      return;
  }
}
