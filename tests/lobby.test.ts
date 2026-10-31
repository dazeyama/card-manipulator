import { describe, expect, it } from 'vitest';
import { LobbyBook, type LobbyBeat } from '../server/src/lobbyBook';

function beat(code: string, over: Partial<LobbyBeat> = {}): LobbyBeat {
  return { code, name: `Table ${code}`, players: 1, max: 8, password: false, tag: 'cube', crown: 'Ann', cards: 100, since: 1000, visibility: 'public', locked: false, ...over };
}

describe('the Lobby', () => {
  it('lists public and password rooms, not unlisted ones, most players first then longest up', () => {
    const l = new LobbyBook();
    l.beat(beat('AAAAAA', { players: 2, since: 300 }), 0);
    l.beat(beat('BBBBBB', { players: 5, since: 900 }), 0);
    l.beat(beat('CCCCCC', { players: 2, since: 100, visibility: 'password', password: true }), 0);
    l.beat(beat('DDDDDD', { players: 8, visibility: 'unlisted' }), 0);
    expect(l.publicList().map((r) => r.code)).toEqual(['BBBBBB', 'CCCCCC', 'AAAAAA']);
    expect(l.publicList()[1].password).toBe(true);
    expect(Object.keys(l.publicList()[0]).sort()).toEqual(['cards', 'code', 'crown', 'max', 'name', 'password', 'players', 'since', 'tag']);
  });

  it('drops a room that turns unlisted at its next heartbeat', () => {
    const l = new LobbyBook();
    l.beat(beat('AAAAAA'), 0);
    l.beat(beat('AAAAAA', { visibility: 'unlisted' }), 10);
    expect(l.publicList()).toEqual([]);
    expect(l.adminList().length).toBe(1);
  });

  it('forgets rooms silent for three minutes, and closed ones', () => {
    const l = new LobbyBook();
    l.beat(beat('AAAAAA'), 0);
    l.beat(beat('BBBBBB'), 100_000);
    expect(l.prune(181_000)).toEqual(['AAAAAA']);
    expect(l.isOpen('BBBBBB')).toBe(true);
    l.remove('BBBBBB');
    expect(l.isOpen('BBBBBB')).toBe(false);
  });

  it('delists a room after three distinct reporters; the admin relists it', () => {
    const l = new LobbyBook();
    l.beat(beat('AAAAAA'), 0);
    expect(l.report('AAAAAA', 'r1', 0)).toBe('ok');
    expect(l.report('AAAAAA', 'r1', 1)).toBe('ok');
    expect(l.report('AAAAAA', 'r2', 2)).toBe('ok');
    expect(l.publicList().length).toBe(1);
    expect(l.report('AAAAAA', 'r3', 3)).toBe('ok');
    expect(l.publicList()).toEqual([]);
    expect(l.adminList()[0]).toMatchObject({ reports: 3, delisted: true });
    l.relist('AAAAAA');
    expect(l.publicList().length).toBe(1);
    expect(l.adminList()[0]).toMatchObject({ reports: 0, delisted: false });
  });

  it('limits reports to three an hour per identity, and refuses closed rooms', () => {
    const l = new LobbyBook();
    for (const c of ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD']) l.beat(beat(c), 0);
    expect(['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'].map((c) => l.report(c, 'r1', 10))).toEqual(['ok', 'ok', 'ok', 'rate']);
    expect(l.report('ZZZZZZ', 'r2', 10)).toBe('closed');
  });

  it('the admin can delist by hand', () => {
    const l = new LobbyBook();
    l.beat(beat('AAAAAA'), 0);
    l.delist('AAAAAA');
    expect(l.publicList()).toEqual([]);
  });

  it('allows 5 new rooms an hour per ip and per identity', () => {
    const l = new LobbyBook();
    for (let i = 0; i < 5; i++) expect(l.allowCreate('1.2.3.4', `id${i}`, i)).toBe(true);
    expect(l.allowCreate('1.2.3.4', 'id9', 10)).toBe(false);
    for (let i = 0; i < 5; i++) expect(l.allowCreate(`10.0.0.${i}`, 'same', i)).toBe(true);
    expect(l.allowCreate('10.0.0.9', 'same', 10)).toBe(false);
    expect(l.allowCreate('1.2.3.4', 'id9', 3_600_001)).toBe(true);
  });

  it('allows 30 joins an hour per ip', () => {
    const l = new LobbyBook();
    for (let i = 0; i < 30; i++) expect(l.allowJoin('1.2.3.4', i)).toBe(true);
    expect(l.allowJoin('1.2.3.4', 31)).toBe(false);
    expect(l.allowJoin('5.6.7.8', 31)).toBe(true);
  });

  it('with limits off (local development), creation and joins are never refused', () => {
    const l = new LobbyBook(false);
    for (let i = 0; i < 50; i++) {
      expect(l.allowCreate('1.2.3.4', 'same', i)).toBe(true);
      expect(l.allowJoin('1.2.3.4', i)).toBe(true);
    }
  });
});
