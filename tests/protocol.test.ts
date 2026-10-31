import { describe, expect, it } from 'vitest';
import {
  PROTOCOL, MAX_MESSAGE_BYTES, MAX_OP_BYTES, MAX_SNAPSHOT_PART_BYTES, byteLength, isClientMsg, isServerMsg, joinSnapshot, maxBytes, playerIdOf, splitSnapshot,
} from '../shared/protocol';
import { emptyTable, type TableState } from '../shared/table';
import { cardsTouched, diceTouched } from '../shared/ops';
import type { CardSnap } from '../src/state/history';

function card(i: number): CardSnap {
  return { uid: `c${i}`, scryfallId: `s${i % 7}`, finish: 'nonfoil', x: i, y: -i, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null };
}

function table(n: number): TableState {
  return { ...emptyTable('Test'), cards: Array.from({ length: n }, (_, i) => card(i)), dice: [{ uid: 'd1', x: 1, y: 2, z: 10, yaw: 0, value: 4 }] };
}

describe('protocol', () => {
  it('speaks version 1', () => {
    expect(PROTOCOL).toBe(1);
  });

  it('splits a table into a head and parts of 1,000 cards, and joins it back in any order', () => {
    const t = table(2500);
    const parts = splitSnapshot(t);
    expect(parts.length).toBe(4);
    expect(parts.every((p) => p.parts === 4)).toBe(true);
    expect(parts[0].count).toBe(2500);
    expect(parts[0].cards).toBeUndefined();
    expect(parts.slice(1).map((p) => p.cards!.length)).toEqual([1000, 1000, 500]);
    expect(joinSnapshot([...parts].reverse())).toEqual(t);
  });

  it('sends an empty table as one part', () => {
    const parts = splitSnapshot(emptyTable());
    expect(parts.length).toBe(1);
    expect(joinSnapshot(parts)).toEqual(emptyTable());
  });

  it('waits for every part before joining', () => {
    const parts = splitSnapshot(table(1500));
    expect(joinSnapshot(parts.slice(0, 2))).toBeNull();
    expect(joinSnapshot([])).toBeNull();
  });

  it('keeps a part of 1,000 cards under the snapshot size limit', () => {
    const parts = splitSnapshot(table(1000));
    expect(byteLength(JSON.stringify(parts[1]))).toBeLessThan(MAX_SNAPSHOT_PART_BYTES);
    expect(maxBytes('snapshot')).toBe(MAX_SNAPSHOT_PART_BYTES);
    expect(maxBytes('chat')).toBe(MAX_MESSAGE_BYTES);
    // A whole cube in one spawn (O104): ops and confirms get Cloudflare's 1 MiB.
    expect(maxBytes('op')).toBe(MAX_OP_BYTES);
    expect(maxBytes('confirm')).toBe(MAX_OP_BYTES);
    expect(maxBytes('stream')).toBe(MAX_MESSAGE_BYTES);
  });

  it('counts bytes as UTF-8', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('👑')).toBe(4);
  });

  it('tells client and server messages by their type', () => {
    expect(isClientMsg({ t: 'hello', v: 1 })).toBe(true);
    expect(isClientMsg({ t: 'welcome' })).toBe(false);
    expect(isClientMsg({ t: 'propose' })).toBe(false);
    expect(isClientMsg(null)).toBe(false);
    expect(isClientMsg('hello')).toBe(false);
    expect(isServerMsg({ t: 'propose' })).toBe(true);
    expect(isServerMsg({ t: 'hello' })).toBe(false);
  });

  it('makes a 16-character player id from a token, the same every time', async () => {
    const a = await playerIdOf('token-a');
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await playerIdOf('token-a')).toBe(a);
    expect(await playerIdOf('token-b')).not.toBe(a);
  });
});

describe('ops', () => {
  it('names the cards and dice an op touches, through batches', () => {
    expect(cardsTouched({ t: 'move', moves: [{ uid: 'a', x: 1 }, { uid: 'b' }] })).toEqual(['a', 'b']);
    expect(cardsTouched({ t: 'batch', ops: [{ t: 'remove', uids: ['a'] }, { t: 'move', moves: [{ uid: 'a' }, { uid: 'c' }] }] })).toEqual(['a', 'c']);
    expect(cardsTouched({ t: 'reuid', pairs: [['a', 'x']] })).toEqual(['a', 'x']);
    expect(cardsTouched({ t: 'table', name: 'n' })).toEqual([]);
    expect(diceTouched({ t: 'dice', set: [{ uid: 'd1', x: 0, y: 0, z: 10, yaw: 0, value: 1 }], remove: ['d2'] })).toEqual(['d1', 'd2']);
    expect(diceTouched({ t: 'grab', uids: [], dice: ['d3'] })).toEqual(['d3']);
  });
});
