import { describe, expect, it } from 'vitest';
import { BLOCKED, clean, isBlocked, normalise } from '../shared/words';

describe('the name filter', () => {
  it('normalises case, accents, look-alike digits and punctuation', () => {
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
    for (const name of ['Vintage cube pass 3', 'Grapeshot storm', 'Cockatrice & friends', 'Glasshouse', 'Dazey', 'Sam', 'Therapist cube', 'Class of 2026', 'Peasant cube', 'Legacy league', 'Scott', 'Dickens', 'Bassett', 'Assassin draft']) {
      expect(isBlocked(name), name).toBe(false);
    }
  });

  it('replaces a blocked name with the fallback', () => {
    expect(clean('shit table', 'Table 7KQ2MX')).toBe('Table 7KQ2MX');
    expect(clean('Nice table', 'Table 7KQ2MX')).toBe('Nice table');
  });

  it('keeps the list short, lower case, letters only (O79)', () => {
    expect(BLOCKED.length).toBeGreaterThanOrEqual(30);
    expect(BLOCKED.length).toBeLessThanOrEqual(60);
    for (const w of BLOCKED) expect(w).toMatch(/^[a-z]+$/);
  });
});
