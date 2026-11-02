import { describe, expect, it } from 'vitest';
import { BLOCKED, WHOLE_WORDS, clean, isBlocked, normalise, words } from '../shared/words';

describe('the name filter', () => {
  it('normalizes case, accents, look-alike digits and punctuation', () => {
    expect(normalise('Hé11o, W0rld!')).toBe('heiioworld');
    expect(normalise('5h1t-7est 4 @ $')).toBe('shittestaas');
    expect(normalise('  Vintage cube pass 3 ')).toBe('vintagecubepasse');
  });

  it('blocks a listed word however it is dressed up', () => {
    expect(isBlocked('fuck')).toBe(true);
    expect(isBlocked('F U C K')).toBe(true);
    expect(isBlocked('f.u.c.k')).toBe(true);
    expect(isBlocked('5H1T table')).toBe(true);
    expect(isBlocked('Nazi cube')).toBe(true);
    expect(isBlocked('h1tl3r')).toBe(true);
  });

  it('lets ordinary table and player names through', () => {
    for (const name of ['Vintage cube pass 3', 'Grapeshot storm', 'Cockatrice & friends', 'Glasshouse', 'Dazey', 'Sam', 'Therapist cube', 'Class of 2026', 'Peasant cube', 'Legacy league', 'Scott', 'Dickens', 'Bassett', 'Assassin draft',
      // Across word boundaries and inside words (final review #4, O106).
      'Friday Night Watch', 'Saltwater', 'Sweetwater', 'Hot Water', 'Nightwatch', 'Crush It', 'CrushIt', 'Push It', 'Smash It', 'Finish It', 'Scunthorpe', 'Magic Untapped', 'Basic Untapped Lands']) {
      expect(isBlocked(name), name).toBe(false);
    }
  });

  it('blocks the whole-word entries where a word begins with them', () => {
    expect(words('5h1t-7est, Sh1tty!')).toEqual(['shit', 'test', 'shitty']);
    for (const name of ['Shit', 'shitty deck', 'Sh1tty', 'twats', 'Cunt cube', 'the shit list']) expect(isBlocked(name), name).toBe(true);
  });

  it('replaces a blocked name with the fallback', () => {
    expect(clean('shit table', 'Table 7KQ2MX')).toBe('Table 7KQ2MX');
    expect(clean('Nice table', 'Table 7KQ2MX')).toBe('Nice table');
  });

  it('keeps the list short, lower case, letters only (O79)', () => {
    expect(BLOCKED.length).toBeGreaterThanOrEqual(30);
    expect(BLOCKED.length).toBeLessThanOrEqual(60);
    for (const w of [...BLOCKED, ...WHOLE_WORDS]) expect(w).toMatch(/^[a-z]+$/);
  });
});
