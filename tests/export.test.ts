import { describe, expect, it } from 'vitest';
import { decklistText } from '../src/io/exportDecklist';
import { csvField, csvText } from '../src/io/exportCsv';
import { parseDecklist } from '../src/io/decklist';

const bolt = { name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'nonfoil' as const };
const boltFoil = { ...bolt, finish: 'foil' as const };
const ring = { name: 'Sol Ring', set: 'c21', number: '263', finish: 'etched' as const };
const fireIce = { name: 'Fire // Ice', set: 'mh2', number: '290', finish: 'nonfoil' as const };

describe('decklistText (spec 14.1)', () => {
  it('merges identical cards with a count, A to Z', () => {
    expect(decklistText([{ title: null, cards: [ring, bolt, bolt, bolt, bolt] }], false)).toBe('4 Lightning Bolt\n1 Sol Ring *E*\n');
  });
  it('can include set code and collector number, with *F* after foils', () => {
    expect(decklistText([{ title: 'Keep', cards: [bolt, boltFoil, bolt] }], true)).toBe('2 Lightning Bolt (M11) 149\n1 Lightning Bolt (M11) 149 *F*\n');
  });
  it('writes a header line per pile when several piles are exported', () => {
    const text = decklistText([{ title: 'Keep', cards: [bolt] }, { title: 'Sell', cards: [ring] }, { title: 'Empty', cards: [] }], false);
    expect(text).toBe('// Keep\n1 Lightning Bolt\n\n// Sell\n1 Sol Ring *E*\n');
  });
  it('round-trips through the decklist parser', () => {
    const text = decklistText([{ title: 'Keep', cards: [bolt, boltFoil, fireIce] }, { title: 'Sell', cards: [ring, bolt] }], true);
    const parsed = parseDecklist(text);
    expect(parsed.cards).toBe(5);
    expect(parsed.entries.find((e) => e.name === 'Fire // Ice')).toMatchObject({ set: 'mh2', number: '290' });
    expect(parsed.entries.find((e) => e.finish === 'foil')).toMatchObject({ name: 'Lightning Bolt', set: 'm11', number: '149' });
    expect(parsed.entries.find((e) => e.name === 'Sol Ring')).toMatchObject({ finish: 'etched' });
  });
});

describe('csvText (spec 14.2)', () => {
  it('writes one row per pile, printing and finish with a quantity', () => {
    const rows = csvText([
      { pile: 'Keep', name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'nonfoil', scryfallId: 'id1' },
      { pile: 'Keep', name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'nonfoil', scryfallId: 'id1' },
      { pile: 'Keep', name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'foil', scryfallId: 'id1' },
      { pile: 'Sell', name: 'Lightning Bolt', set: 'm11', number: '149', finish: 'nonfoil', scryfallId: 'id1' },
    ]).trim().split('\r\n');
    expect(rows[0]).toBe('pile,quantity,name,set,collector_number,finish,scryfall_id');
    expect(rows.slice(1)).toEqual([
      'Keep,2,Lightning Bolt,m11,149,nonfoil,id1',
      'Keep,1,Lightning Bolt,m11,149,foil,id1',
      'Sell,1,Lightning Bolt,m11,149,nonfoil,id1',
    ]);
  });
  it('quotes fields with commas and quotes', () => {
    expect(csvField('Jace, the Mind Sculptor')).toBe('"Jace, the Mind Sculptor"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField('Plain')).toBe('Plain');
  });
});

import { withoutExtras } from '../src/scryfall/search';

describe('query spawn (decision 31)', () => {
  it('always excludes extras, keeping the owner query intact', () => {
    expect(withoutExtras('set:ltr r:rare')).toBe('(set:ltr r:rare) -is:extra');
    expect(withoutExtras(' t:goblin or t:elf ')).toBe('(t:goblin or t:elf) -is:extra');
  });
});
