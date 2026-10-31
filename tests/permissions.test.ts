import { describe, expect, it } from 'vitest';
import { addAction, allowed, isGamePiece, isTokenLayout, needs, rankAtLeast, refusal, removeAction, RANKS, type Action, type Need, type Rank } from '../shared/permissions';

// Every row of ONLINE.md 6.2, as the table says it.
const TABLE: [Action, Need][] = [
  ['camera', 'view'], ['hover', 'view'], ['inspect', 'view'], ['search', 'view'], ['refine', 'view'], ['select', 'view'], ['chat', 'view'],
  ['download', 'view'],
  ['move', 'move'],
  ['standCards', 'move'],
  ['grab', 'move'],
  ['named', 'move'], ['spread', 'move'],
  ['dice', 'move'],
  ['diceAdd', 'tokens'], ['diceRemove', 'tokens'],
  ['mat', 'move'],
  ['standOwn', 'move'],
  ['standRemoveOwn', 'move'],
  ['addTokens', 'tokens'],
  ['removeTokens', 'tokens'],
  ['addCards', 'cards'],
  ['removeCards', 'cards'],
  ['matAdd', 'move'], ['matRemove', 'move'],
  ['standClaim', 'everything'], ['standSpill', 'everything'],
  ['basics', 'everything'],
  ['table', 'crown'], ['replace', 'crown'], ['reuid', 'crown'],
  ['rank', 'crown'], ['kick', 'crown'], ['ban', 'crown'], ['pass', 'crown'], ['settings', 'crown'], ['close', 'crown'],
];

describe('permissions', () => {
  it('orders the ladder View, Move, Tokens, Cards, Everything (O21)', () => {
    expect(RANKS).toEqual(['view', 'move', 'tokens', 'cards', 'everything']);
    expect(rankAtLeast('cards', 'move')).toBe(true);
    expect(rankAtLeast('move', 'cards')).toBe(false);
    expect(rankAtLeast('view', 'view')).toBe(true);
  });

  it('gives every action of 6.2 the rank the table says', () => {
    for (const [action, need] of TABLE) expect(needs(action), action).toBe(need);
  });

  it('lets each rank do what it and the ranks below it may, and no more', () => {
    for (const [action, need] of TABLE) {
      for (const rank of RANKS) {
        const expected = need !== 'crown' && RANKS.indexOf(rank) >= RANKS.indexOf(need);
        expect(allowed(rank, action), `${rank} ${action}`).toBe(expected);
      }
    }
  });

  it('lets the crown do anything (O23)', () => {
    for (const [action] of TABLE) {
      expect(allowed('crown', action)).toBe(true);
      expect(allowed('crown', action, { locked: true, downloads: false })).toBe(true);
    }
  });

  it('keeps room actions the crown’s even for Everything (O24)', () => {
    for (const a of ['rank', 'kick', 'ban', 'pass', 'settings', 'close', 'table', 'replace', 'reuid'] as Action[]) {
      expect(allowed('everything', a)).toBe(false);
      expect(refusal('everything', a)).toBe('Only the crown can do that');
    }
  });

  it('puts everyone below the crown at View for table actions while the table is locked (O51)', () => {
    const locked = { locked: true };
    expect(allowed('everything', 'move', locked)).toBe(false);
    expect(allowed('everything', 'addCards', locked)).toBe(false);
    expect(allowed('move', 'dice', locked)).toBe(false);
    expect(refusal('cards', 'move', locked)).toBe('The table is locked');
    // Looking, chat and exports are unaffected.
    for (const a of ['camera', 'hover', 'inspect', 'search', 'refine', 'select', 'chat', 'download'] as Action[]) {
      expect(allowed('view', a, locked), a).toBe(true);
    }
    // Unlocking restores everyone as they were.
    expect(allowed('everything', 'move', { locked: false })).toBe(true);
  });

  it('turns Save a copy and exports off for all but the crown when Downloads is off (O50)', () => {
    expect(allowed('everything', 'download', { downloads: false })).toBe(false);
    expect(refusal('view', 'download', { downloads: false })).toBe('Downloads are off in this room');
    expect(allowed('view', 'download', { downloads: true })).toBe(true);
    expect(allowed('view', 'download')).toBe(true);
    expect(allowed('crown', 'download', { downloads: false })).toBe(true);
  });

  it('words a missing rank as the toast does (12.4)', () => {
    expect(refusal('view', 'move')).toBe('Move or higher needed');
    expect(refusal('move', 'addCards')).toBe('Cards or higher needed');
    expect(refusal('move', 'diceAdd')).toBe('Tokens or higher needed');
    expect(refusal('cards', 'standSpill')).toBe('Everything or higher needed');
    expect(refusal('view', 'matAdd')).toBe('Move or higher needed');
    expect(refusal('move', 'move')).toBeNull();
  });

  it('removing follows adding (O25, O67, O78): Tokens adds and removes tokens and dice, Cards any card', () => {
    const tokensMay: Action[] = ['addTokens', 'removeTokens', 'diceAdd', 'diceRemove'];
    for (const a of tokensMay) {
      expect(allowed('tokens', a), a).toBe(true);
      expect(allowed('move', a), a).toBe(false);
    }
    expect(allowed('tokens', 'addCards')).toBe(false);
    expect(allowed('tokens', 'removeCards')).toBe(false);
    expect(allowed('cards', 'removeCards')).toBe(true);
  });

  it('counts tokens and basic lands as game pieces a Tokens player adds and removes (O60, O67)', () => {
    const token = { layout: 'token', type_line: 'Token Creature — Goblin' };
    const basic = { layout: 'normal', type_line: 'Basic Land — Forest' };
    const snowBasic = { layout: 'normal', type_line: 'Basic Snow Land — Island' };
    const bolt = { layout: 'normal', type_line: 'Instant' };
    expect(addAction([token, basic, snowBasic])).toBe('addTokens');
    expect(addAction([token, bolt])).toBe('addCards');
    expect(addAction([undefined])).toBe('addCards');
    expect(addAction([])).toBe('addCards');
    expect(removeAction([token])).toBe('removeTokens');
    expect(removeAction([basic, bolt])).toBe('removeCards');
    expect(isGamePiece({ layout: 'normal', type_line: 'Land — Urza’s Mine' })).toBe(false);
  });

  it('knows which layouts are tokens (O67)', () => {
    for (const l of ['token', 'emblem', 'double_faced_token']) expect(isTokenLayout(l)).toBe(true);
    for (const l of ['normal', 'transform', 'art_series', '', undefined]) expect(isTokenLayout(l)).toBe(false);
  });

  it('lets a Move player do the whole of a game at a real table (O26, O52, O59)', () => {
    const play: Action[] = ['move', 'grab', 'named', 'spread', 'dice', 'mat', 'matAdd', 'matRemove', 'standOwn', 'standRemoveOwn', 'standCards'];
    for (const a of play) expect(allowed('move' as Rank, a), a).toBe(true);
    for (const a of ['standClaim', 'standSpill', 'basics'] as Action[]) expect(allowed('move', a), a).toBe(false);
  });
});
