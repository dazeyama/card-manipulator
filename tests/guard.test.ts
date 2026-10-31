import { describe, expect, it } from 'vitest';
import { Guard, keyAction, mayManagePlayer, touchable } from '../src/online/guard';
import type { App } from '../src/app';
import type { Card, Mat } from '../src/state/types';

const card = (uid: string, stand?: string): Card => ({ uid, scryfallId: 'x', finish: 'nonfoil', x: 0, y: 0, z: 0, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...(stand ? { stand } : {}) });
const stand = (uid: string, owner?: string): Mat => ({ uid, kind: 'stand', scryfallId: '', name: 'Plate', art: '', x: 0, y: 0, yaw: 0, ...(owner ? { owner } : {}) });

/** Just enough of the app for the guard: a store with cards and mats, and a room (or none). */
function fakeApp(online: { me: string; crown?: boolean } | null): App {
  const cards = new Map([['t', card('t')], ['mine', card('mine', 's-me')], ['bea', card('bea', 's-bea')], ['nobody', card('nobody', 's-none')]]);
  const mats = new Map([['s-me', stand('s-me', 'me')], ['s-bea', stand('s-bea', 'bea')], ['s-none', stand('s-none')]]);
  const room = online ? { me: online.me, isCrown: !!online.crown, nameOf: (id: string) => (id === 'bea' ? 'Bea' : 'Someone'), connected: true, rank: 'move', locked: false, downloads: true } : null;
  return { store: { cards, mats }, online: room ? { room } : null } as unknown as App;
}

describe('the guard (ONLINE.md 6.4)', () => {
  it('leaves Shift + T alone: your own Tidy mode is a personal setting (O44)', () => {
    expect(keyAction('shift+t')).toBeNull();
    expect(keyAction('t')).toBe('move');
    expect(keyAction('shift+c')).toBe('move');
    expect(keyAction('m')).toBeNull();
    expect(keyAction('ctrl+e')).toBe('download');
  });

  it('lets the crown manage any other player and Everything only those below it (O111)', () => {
    const crown = { me: 'c', isCrown: true, rank: 'everything' as const };
    const coHost = { me: 'e', isCrown: false, rank: 'everything' as const };
    const cards = { me: 'k', isCrown: false, rank: 'cards' as const };
    const p = (id: string, rank: 'move' | 'cards' | 'everything', isCrown = false) => ({ id, rank, isCrown });
    expect(mayManagePlayer(crown, p('e', 'everything'))).toBe(true);
    expect(mayManagePlayer(crown, p('c', 'everything', true))).toBe(false);
    expect(mayManagePlayer(coHost, p('k', 'cards'))).toBe(true);
    expect(mayManagePlayer(coHost, p('e2', 'everything'))).toBe(false);
    expect(mayManagePlayer(coHost, p('c', 'everything', true))).toBe(false);
    expect(mayManagePlayer(coHost, p('e', 'everything'))).toBe(false);
    expect(mayManagePlayer(cards, p('m', 'move'))).toBe(false);
  });

  it('keeps cards on other players’ and unowned stands out of a command’s targets (6.3)', () => {
    new Guard(fakeApp({ me: 'me' }));
    expect(touchable(['t', 'mine', 'bea', 'nobody'], true)).toEqual(['t', 'mine']);
  });

  it('applies the same rule to the crown, whose UI hides what anyone’s would (7.1)', () => {
    new Guard(fakeApp({ me: 'me', crown: true }));
    expect(touchable(['t', 'bea', 'nobody', 'mine'], true)).toEqual(['t', 'mine']);
  });

  it('keeps every card offline, where the table is one player (O32)', () => {
    new Guard(fakeApp(null));
    expect(touchable(['t', 'mine', 'bea', 'nobody'])).toEqual(['t', 'mine', 'bea', 'nobody']);
  });
});
