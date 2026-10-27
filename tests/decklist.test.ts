import { describe, expect, it } from 'vitest';
import { nameFaces, parseDecklist, parseLine } from '../src/io/decklist';

const sets = new Set(['m11', 'lea', 'ltr', 'dmu', 'mh2', 'plst']);
const isSetCode = (c: string) => sets.has(c.toLowerCase());

describe('parseLine (spec 12.2)', () => {
  it('reads counts in every form', () => {
    expect(parseLine('4 Lightning Bolt')).toMatchObject({ count: 4, name: 'Lightning Bolt' });
    expect(parseLine('4x Lightning Bolt')).toMatchObject({ count: 4, name: 'Lightning Bolt' });
    expect(parseLine('4 x Lightning Bolt')).toMatchObject({ count: 4, name: 'Lightning Bolt' });
    expect(parseLine('Lightning Bolt x4')).toMatchObject({ count: 4, name: 'Lightning Bolt' });
    expect(parseLine('Lightning Bolt')).toMatchObject({ count: 1, name: 'Lightning Bolt' });
  });

  it('reads set codes and collector numbers', () => {
    expect(parseLine('1 Lightning Bolt (M11) 149')).toMatchObject({ name: 'Lightning Bolt', set: 'm11', number: '149' });
    expect(parseLine('1 Lightning Bolt (M11)')).toMatchObject({ name: 'Lightning Bolt', set: 'm11', number: undefined });
    expect(parseLine('1 Lightning Bolt [M11]')).toMatchObject({ name: 'Lightning Bolt', set: 'm11' });
    expect(parseLine('1 Lightning Bolt M11 149', { isSetCode })).toMatchObject({ name: 'Lightning Bolt', set: 'm11', number: '149' });
    expect(parseLine('1 Lightning Bolt M11 149')).toMatchObject({ set: 'm11', number: '149' });
    expect(parseLine('1 Sol Ring (PLST) C21-263')).toMatchObject({ name: 'Sol Ring', set: 'plst', number: 'C21-263' });
  });

  it('does not mistake a name for a set code when the set list says otherwise', () => {
    expect(parseLine('1 Borrowing 100,000 Arrows', { isSetCode })).toMatchObject({ name: 'Borrowing 100,000 Arrows' });
    expect(parseLine('1 Hazard Lane 3', { isSetCode })).toMatchObject({ name: 'Hazard Lane 3', set: undefined });
  });

  it('reads foil and etched markers', () => {
    expect(parseLine('1 Lightning Bolt *F*')).toMatchObject({ finish: 'foil', name: 'Lightning Bolt' });
    expect(parseLine('1 Lightning Bolt (M11) 149 *F*')).toMatchObject({ finish: 'foil', set: 'm11', number: '149' });
    expect(parseLine('1 Lightning Bolt (foil)')).toMatchObject({ finish: 'foil', name: 'Lightning Bolt' });
    expect(parseLine('1 Lightning Bolt F')).toMatchObject({ finish: 'foil', name: 'Lightning Bolt' });
    expect(parseLine('1 Sol Ring *E*')).toMatchObject({ finish: 'etched', name: 'Sol Ring' });
    expect(parseLine('1 Lightning Bolt')).toMatchObject({ finish: 'nonfoil' });
  });

  it('skips headers, blank lines and comments', () => {
    for (const l of ['', '   ', 'Sideboard', 'Sideboard:', 'SB:', 'Commander', 'Maybeboard', 'Deck', '// comment', '# note', 'Companion']) {
      expect(parseLine(l)).toBeNull();
    }
  });

  it('reads a card after an SB: prefix', () => {
    expect(parseLine('SB: 2 Duress')).toMatchObject({ count: 2, name: 'Duress' });
  });

  it('keeps double-faced and split names', () => {
    expect(parseLine('1 Delver of Secrets // Insectile Aberration')).toMatchObject({ name: 'Delver of Secrets // Insectile Aberration' });
    expect(parseLine('2 Fire // Ice')).toMatchObject({ count: 2, name: 'Fire // Ice' });
  });
});

describe('parseDecklist', () => {
  it('merges duplicates across sections and sums counts (decision 30)', () => {
    const r = parseDecklist('Deck\n2 Duress\n4 Lightning Bolt\n\nSideboard\n1 Duress\n2 Lightning Bolt (M11) 149\n');
    expect(r.entries).toHaveLength(3);
    expect(r.entries.find((e) => e.name === 'Duress')).toMatchObject({ count: 3, lines: [2, 6] });
    expect(r.cards).toBe(9);
    expect(r.skipped).toBe(2);
  });

  it('keeps different finishes and printings apart', () => {
    const r = parseDecklist('1 Lightning Bolt\n1 Lightning Bolt *F*\n1 Lightning Bolt (M11) 149');
    expect(r.entries).toHaveLength(3);
  });

  it('copes with Windows line endings and non-breaking spaces', () => {
    const r = parseDecklist('1 Sol Ring\r\n1 Mox Pearl\r\n');
    expect(r.entries.map((e) => e.name)).toEqual(['Sol Ring', 'Mox Pearl']);
  });
});

describe('nameFaces', () => {
  it('splits faces', () => {
    expect(nameFaces('Fire // Ice')).toEqual(['Fire', 'Ice']);
    expect(nameFaces('Lightning Bolt')).toEqual(['Lightning Bolt']);
  });
});
