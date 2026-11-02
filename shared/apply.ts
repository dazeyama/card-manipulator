// The one place an op changes a plain table (ONLINE.md 11.1): applyOp is the
// pure twin of the Store's mutation methods, with no events. The server keeps
// its mirror with it; the client's inbox applies the same ops through the
// Store (src/online/inbox.ts applyToStore), and tests/apply.test.ts proves the
// two give the same table.
//
// The table passed in is never changed: the result shares whatever an op did
// not touch. Adding something whose uid (or id) is already there replaces it
// where it stands, as a Map's set does in the Store.

import type { Op } from './ops';
import type { CardSnap, Die, Mat, NamedPile, Spread, TableState } from './table';

function copyCard(c: CardSnap): CardSnap {
  return { ...c, laidAt: c.laidAt ? { ...c.laidAt } : undefined };
}

function copyNamed(p: NamedPile): NamedPile {
  return { ...p, anchor: { ...p.anchor } };
}

function copySpread(s: Spread): Spread {
  return { ...s, anchor: { ...s.anchor }, uids: [...s.uids] };
}

/** Put each item in place of the one with the same key, or at the end. */
function upsert<T>(list: T[], items: T[], key: (t: T) => string, copy: (t: T) => T): T[] {
  if (!items.length) return list;
  const out = list.slice();
  const at = new Map(out.map((t, i) => [key(t), i]));
  for (const item of items) {
    const k = key(item);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push(copy(item));
    } else out[i] = copy(item);
  }
  return out;
}

function without<T>(list: T[], keys: string[] | undefined, key: (t: T) => string): T[] {
  if (!keys?.length) return list;
  const gone = new Set(keys);
  return list.filter((t) => !gone.has(key(t)));
}

const byUid = (t: { uid: string }) => t.uid;
const byId = (t: { id: string }) => t.id;

/** A deep copy of a table. */
export function copyTable(t: TableState): TableState {
  return {
    name: t.name,
    cards: t.cards.map(copyCard),
    named: t.named.map(copyNamed),
    spreads: t.spreads.map(copySpread),
    mats: t.mats.map((m) => ({ ...m })),
    dice: t.dice.map((d) => ({ ...d })),
    basics: JSON.parse(JSON.stringify(t.basics)) as TableState['basics'],
    cubes: (t.cubes ?? []).map((c) => ({ ...c })),
    flags: (t.flags ?? []).map((f) => ({ ...f })),
  };
}

/** The table after the op. Holds (`grab`, `release`) are not table state: the table comes back as it was. */
export function applyOp(table: TableState, op: Op): TableState {
  switch (op.t) {
    case 'add':
      return { ...table, cards: upsert(table.cards, op.cards, byUid, (c) => ({ ...copyCard(c), pileId: c.pileId ?? null, spreadOf: c.spreadOf ?? null })) };
    case 'remove':
      return { ...table, cards: without(table.cards, op.uids, byUid) };
    case 'move': {
      if (!op.moves.length) return table;
      const index = new Map(table.cards.map((c, i) => [c.uid, i]));
      const cards = table.cards.slice();
      for (const m of op.moves) {
        const i = index.get(m.uid);
        if (i === undefined) continue;
        const c = { ...cards[i] };
        if (m.x !== undefined) c.x = m.x;
        if (m.y !== undefined) c.y = m.y;
        if (m.z !== undefined) c.z = m.z;
        if (m.yaw !== undefined) c.yaw = m.yaw;
        if (m.faceUp !== undefined) c.faceUp = m.faceUp;
        if (m.stand !== undefined) c.stand = m.stand ?? undefined;
        if (m.side !== undefined) c.side = m.side || undefined;
        if (m.pileId !== undefined) c.pileId = m.pileId;
        if (m.spreadOf !== undefined) c.spreadOf = m.spreadOf;
        if (m.laidAt !== undefined) c.laidAt = m.laidAt ? { ...m.laidAt } : undefined;
        cards[i] = c;
      }
      return { ...table, cards };
    }
    case 'grab':
    case 'release':
      return table;
    case 'reuid': {
      if (!op.pairs.length) return table;
      const to = new Map(op.pairs);
      const rename = (u: string) => to.get(u) ?? u;
      return {
        ...table,
        cards: table.cards.map((c) => (to.has(c.uid) ? { ...c, uid: rename(c.uid) } : c)),
        spreads: table.spreads.map((s) => (s.uids.some((u) => to.has(u)) ? { ...s, uids: s.uids.map(rename) } : s)),
      };
    }
    case 'named':
      return { ...table, named: upsert(without(table.named, op.remove, byId), op.set ?? [], byId, copyNamed) };
    case 'spread':
      return { ...table, spreads: upsert(without(table.spreads, op.remove, byId), op.set ?? [], byId, copySpread) };
    case 'mat': {
      let mats = upsert(table.mats, op.set ?? [], byUid, (m: Mat) => ({ ...m }));
      mats = without(without(mats, op.remove, byUid), op.spill, byUid);
      let cards = table.cards;
      // A spilled stand's cards are on the table now; the crown's batch lays them out (6.3).
      if (op.spill?.length) {
        const spilled = new Set(op.spill);
        cards = cards.map((c) => (c.stand && spilled.has(c.stand) ? { ...c, stand: undefined } : c));
      }
      return { ...table, mats, cards };
    }
    case 'dice':
      return { ...table, dice: without(upsert(table.dice, op.set ?? [], byUid, (d: Die) => ({ ...d })), op.remove, byUid) };
    case 'basics':
      return { ...table, basics: JSON.parse(JSON.stringify(op.basics)) as TableState['basics'] };
    case 'cubes':
      return { ...table, cubes: without(upsert(table.cubes ?? [], op.set ?? [], byId, (c) => ({ ...c })), op.remove, byId) };
    case 'flag':
      return { ...table, flags: without(upsert(table.flags ?? [], op.set ?? [], byUid, (f) => ({ ...f })), op.remove, byUid) };
    case 'table':
      return { ...table, name: op.name.trim() || 'Untitled table' };
    case 'replace':
      return copyTable(op.table);
    case 'batch':
      return op.ops.reduce(applyOp, table);
  }
}
