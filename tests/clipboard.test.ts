import { describe, expect, it } from 'vitest';
import { copyText } from '../src/io/clipboard';
import { parseDecklist } from '../src/io/decklist';

describe('copying cards (decision 202)', () => {
  const cards = [
    { name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'foil' as const },
    { name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'foil' as const },
    { name: 'Counterspell', set: 'mh2', number: '267', finish: 'nonfoil' as const },
    { name: 'Sol Ring', set: 'c21', number: '263', finish: 'etched' as const },
  ];

  it('writes a decklist of exact printings, identical cards merged', () => {
    expect(copyText(cards)).toBe('1 Counterspell (MH2) 267\n2 Lightning Bolt (M11) 149 *F*\n1 Sol Ring (C21) 263 *E*\n');
    expect(copyText([])).toBe('');
  });

  it('reads back as the same printings and finishes', () => {
    const { entries } = parseDecklist(copyText(cards));
    expect(entries.map((e) => [e.count, e.name, e.set, e.number, e.finish])).toEqual([
      [1, 'Counterspell', 'mh2', '267', 'nonfoil'],
      [2, 'Lightning Bolt', 'm11', '149', 'foil'],
      [1, 'Sol Ring', 'c21', '263', 'etched'],
    ]);
  });
});
