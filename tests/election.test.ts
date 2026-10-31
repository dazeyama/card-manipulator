import { describe, expect, it } from 'vitest';
import { cleanNickname, cleanRoomName, colourFree, electCrown, newMeta, pickColour, playersOf, roomInfo, type Seat } from '../server/src/meta';
import { PLAYER_COLOURS } from '../shared/protocol';

function seat(id: string, rank: Seat['rank'], joinedAt: number, connected = true, colour = ''): Seat {
  return { id, nickname: id.toUpperCase(), colour, rank, side: 0, connected, joinedAt };
}

describe('crown election', () => {
  it('picks the highest rank present', () => {
    expect(electCrown([seat('a', 'move', 1), seat('b', 'cards', 2), seat('c', 'tokens', 3)])).toBe('b');
  });

  it('picks the longest present among equals', () => {
    expect(electCrown([seat('a', 'move', 5), seat('b', 'move', 2), seat('c', 'move', 3)])).toBe('b');
  });

  it('skips away players and the one leaving', () => {
    expect(electCrown([seat('a', 'everything', 1, false), seat('b', 'move', 2), seat('c', 'move', 3)])).toBe('b');
    expect(electCrown([seat('a', 'everything', 1), seat('b', 'move', 2)], 'a')).toBe('b');
  });

  it('takes View if that is all there is', () => {
    expect(electCrown([seat('a', 'view', 1)])).toBe('a');
  });

  it('finds nobody when nobody is connected', () => {
    expect(electCrown([seat('a', 'everything', 1, false)])).toBeNull();
    expect(electCrown([])).toBeNull();
  });
});

describe('room meta', () => {
  it('starts with the maker, no crown, the default settings', () => {
    const m = newMeta('7KQ2MX', 'maker', '  Vintage   cube ', 'cube', 100);
    expect(m.maker).toBe('maker');
    expect(m.crown).toBeNull();
    expect(m.settings).toEqual({ name: 'Vintage cube', visibility: 'unlisted', tag: 'cube', newcomers: 'move', locked: false, downloads: true });
    expect(m.passwordHash).toBeNull();
  });

  it('marks the crown and maker in the player list', () => {
    const m = newMeta('7KQ2MX', 'a', 'T', 'play', 0);
    m.seats.push(seat('a', 'everything', 1), seat('b', 'move', 2));
    m.crown = 'b';
    const p = playersOf(m);
    expect(p.map((x) => [x.id, x.isCrown, x.isMaker])).toEqual([['a', false, true], ['b', true, false]]);
  });

  it('answers the join prompt: connected count, crown name, taken colours; closed rooms are not open', () => {
    const m = newMeta('7KQ2MX', 'a', 'T', 'play', 0);
    m.seats.push(seat('a', 'everything', 1, true, PLAYER_COLOURS[0]), seat('b', 'move', 2, false, PLAYER_COLOURS[3]));
    m.crown = 'a';
    const info = roomInfo(m);
    expect(info).toMatchObject({ name: 'T', players: 1, max: 8, password: false, tag: 'play', open: true, crown: 'A' });
    expect(info.taken).toEqual([{ colour: PLAYER_COLOURS[0], initial: 'A' }, { colour: PLAYER_COLOURS[3], initial: 'B' }]);
    expect(roomInfo(null).open).toBe(false);
  });

  it('gives the colour asked for when free, else the first free one', () => {
    const m = newMeta('7KQ2MX', 'a', 'T', 'cube', 0);
    m.seats.push(seat('a', 'move', 1, true, PLAYER_COLOURS[0]), seat('b', 'move', 2, false, PLAYER_COLOURS[1]));
    expect(pickColour(m, PLAYER_COLOURS[4], 'c')).toBe(PLAYER_COLOURS[4]);
    // Held by an away seat still counts (O19).
    expect(pickColour(m, PLAYER_COLOURS[1], 'c')).toBe(PLAYER_COLOURS[2]);
    expect(pickColour(m, '#123456', 'c')).toBe(PLAYER_COLOURS[2]);
    // Your own colour is yours.
    expect(pickColour(m, PLAYER_COLOURS[0], 'a')).toBe(PLAYER_COLOURS[0]);
    expect(colourFree(m, PLAYER_COLOURS[1], 'a')).toBe(false);
    expect(colourFree(m, PLAYER_COLOURS[5], 'a')).toBe(true);
  });

  it('with every colour held, picks one no connected player has', () => {
    const m = newMeta('7KQ2MX', 'a', 'T', 'cube', 0);
    PLAYER_COLOURS.forEach((c, i) => m.seats.push(seat(`p${i}`, 'move', i, i !== 6, c)));
    expect(pickColour(m, PLAYER_COLOURS[0], 'new')).toBe(PLAYER_COLOURS[6]);
  });

  it('cleans names', () => {
    expect(cleanNickname('  Sam   Smith ', 2)).toBe('Sam Smith');
    expect(cleanNickname('', 3)).toBe('Player 3');
    expect(cleanNickname(42, 3)).toBe('Player 3');
    expect(cleanNickname('x'.repeat(40), 1).length).toBe(20);
    expect(cleanRoomName('', '7KQ2MX')).toBe('Table 7KQ2MX');
    expect(cleanRoomName('y'.repeat(80), '7KQ2MX').length).toBe(60);
  });
});
