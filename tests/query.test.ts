import { describe, expect, it } from 'vitest';
import { compileQuery, type QueryCard } from '../src/query/evaluate';
import { parseQuery } from '../src/query/parser';
import { lex } from '../src/query/lexer';
import type { Card, CardRecord } from '../src/state/types';

function rec(p: Partial<CardRecord> & { name: string }): CardRecord {
  return {
    id: p.name, oracle_id: p.name, set: 'tst', set_name: 'Test', collector_number: '1', rarity: 'common', lang: 'en', layout: 'normal',
    mana_cost: '', cmc: 0, type_line: '', oracle_text: '', colors: [], color_identity: [], keywords: [], produced_mana: [],
    legalities: {}, finishes: ['nonfoil'], prices: { usd: null, usd_foil: null }, faces: [], fetched_at: 0, ...p,
  };
}

const records: CardRecord[] = [
  rec({ name: 'Lightning Bolt', set: 'm11', collector_number: '149', mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'], color_identity: ['R'], legalities: { modern: 'legal', vintage: 'legal', commander: 'legal' } }),
  rec({ name: 'Counterspell', cmc: 2, rarity: 'uncommon', type_line: 'Instant', oracle_text: 'Counter target spell.', colors: ['U'], color_identity: ['U'], legalities: { vintage: 'legal', commander: 'legal' } }),
  rec({ name: 'Serra Angel', cmc: 5, rarity: 'uncommon', type_line: 'Creature — Angel', oracle_text: 'Flying\nVigilance', colors: ['W'], color_identity: ['W'], power: '4', toughness: '4', keywords: ['Flying', 'Vigilance'], legalities: { commander: 'legal' } }),
  rec({ name: 'Tarmogoyf', cmc: 2, rarity: 'mythic', type_line: 'Creature — Lhurgoyf', colors: ['G'], color_identity: ['G'], power: '*', toughness: '1+*', legalities: { modern: 'legal' } }),
  rec({ name: 'Sol Ring', cmc: 1, rarity: 'uncommon', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', legalities: { commander: 'legal', vintage: 'restricted' } }),
  rec({ name: 'Dimir Signet', cmc: 2, type_line: 'Artifact', colors: [], color_identity: ['U', 'B'] }),
  rec({ name: 'Fire // Ice', cmc: 4, rarity: 'uncommon', layout: 'split', type_line: 'Instant // Instant', colors: ['R', 'U'], color_identity: ['R', 'U'],
    faces: [{ name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose among one or two targets.', colors: ['R'] }, { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.', colors: ['U'] }] }),
  rec({ name: 'Delver of Secrets // Insectile Aberration', cmc: 1, layout: 'transform', type_line: 'Creature — Human Wizard // Creature — Human Insect', colors: ['U'], color_identity: ['U'], power: '1', toughness: '1', back_image_small: 'x',
    faces: [{ name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'Look at the top card of your library.', colors: ['U'], power: '1', toughness: '1' }, { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying', colors: ['U'], power: '3', toughness: '2' }] }),
  rec({ name: 'Jace, the Mind Sculptor', cmc: 4, rarity: 'mythic', type_line: 'Legendary Planeswalker — Jace', colors: ['U'], color_identity: ['U'], loyalty: '3' }),
  rec({ name: 'Island', type_line: 'Basic Land — Island', rarity: 'common', color_identity: ['U'] }),
  rec({ name: 'Lim-D\u00fbl\'s Vault', cmc: 2, rarity: 'uncommon', type_line: 'Instant', colors: ['U', 'B'], color_identity: ['U', 'B'] }),
  rec({ name: 'Craterhoof Behemoth', cmc: 8, rarity: 'mythic', type_line: 'Creature — Beast', colors: ['G'], color_identity: ['G'], power: '5', toughness: '5' }),
];

function qcards(): QueryCard[] {
  return records.map((r, i) => {
    const card: Card = { uid: `u${i}`, scryfallId: r.id, finish: i === 0 ? 'foil' : i === 4 ? 'etched' : 'nonfoil', x: 0, y: 0, z: 0, yaw: 0, faceUp: i !== 2, pileId: null, spreadOf: null };
    return { card, record: r, selected: i < 3, pileName: i < 4 ? 'Keep' : i === 5 ? 'Deck A' : null };
  });
}

function names(q: string): string[] {
  const c = compileQuery(q);
  if (!c.ok) throw new Error(c.error);
  return qcards().filter(c.test).map((x) => x.record!.name);
}

function error(q: string): string {
  const c = compileQuery(q);
  if (c.ok) throw new Error(`expected an error for ${q}`);
  return c.error;
}

describe('lexer', () => {
  it('splits terms, words, quotes, parentheses and negation', () => {
    expect(lex('t:creature -o:"draw a card" (c:r or c:g) bolt').map((t) => t.kind)).toEqual(['term', 'not', 'term', 'lparen', 'term', 'or', 'term', 'rparen', 'word']);
    expect(lex('mv<=2')[0]).toMatchObject({ key: 'mv', op: '<=', value: '2' });
    expect(lex('c!=u')[0]).toMatchObject({ key: 'c', op: '!=', value: 'u' });
  });
});

describe('bare words and name:', () => {
  it('match the name, case and accent insensitive', () => {
    expect(names('bolt')).toEqual(['Lightning Bolt']);
    expect(names('LIGHTNING')).toEqual(['Lightning Bolt']);
    expect(names('"lightning bolt"')).toEqual(['Lightning Bolt']);
    expect(names('lim-dul')).toEqual(['Lim-D\u00fbl\'s Vault']);
    expect(names('n:serra')).toEqual(['Serra Angel']);
    expect(names('name:"mind sculptor"')).toEqual(['Jace, the Mind Sculptor']);
  });
  it('match any face of a multi-face card', () => {
    expect(names('ice')).toEqual(['Fire // Ice']);
    expect(names('aberration')).toEqual(['Delver of Secrets // Insectile Aberration']);
  });
  it('!"Name" is an exact name', () => {
    expect(names('!"Fire"')).toEqual(['Fire // Ice']);
    expect(names('!Island')).toEqual(['Island']);
  });
});

describe('o: and t:', () => {
  it('search oracle text on every face', () => {
    expect(names('o:"draw a card"')).toEqual(['Fire // Ice']);
    expect(names('oracle:flying')).toEqual(['Serra Angel', 'Delver of Secrets // Insectile Aberration']);
    expect(names('o:"~ deals 3"')).toEqual(['Lightning Bolt']);
  });
  it('search the type line', () => {
    expect(names('t:creature')).toEqual(['Serra Angel', 'Tarmogoyf', 'Delver of Secrets // Insectile Aberration', 'Craterhoof Behemoth']);
    expect(names('type:legendary')).toEqual(['Jace, the Mind Sculptor']);
    expect(names('t:insect')).toEqual(['Delver of Secrets // Insectile Aberration']);
  });
});

describe('c: colour', () => {
  it('c: means at least these colours', () => {
    expect(names('c:r')).toEqual(['Lightning Bolt', 'Fire // Ice']);
    expect(names('c:ur')).toEqual(['Fire // Ice']);
    expect(names('color:red')).toEqual(['Lightning Bolt', 'Fire // Ice']);
  });
  it('supports every operator', () => {
    expect(names('c=r')).toEqual(['Lightning Bolt']);
    expect(names('c>=ur')).toEqual(['Fire // Ice']);
    expect(names('c<=ub')).toEqual(['Counterspell', 'Sol Ring', 'Dimir Signet', 'Delver of Secrets // Insectile Aberration', 'Jace, the Mind Sculptor', 'Island', 'Lim-D\u00fbl\'s Vault']);
    expect(names('c<ub')).toEqual(['Counterspell', 'Sol Ring', 'Dimir Signet', 'Delver of Secrets // Insectile Aberration', 'Jace, the Mind Sculptor', 'Island']);
    expect(names('c>u')).toEqual(['Fire // Ice', 'Lim-D\u00fbl\'s Vault']);
    expect(names('c!=u')).not.toContain('Counterspell');
  });
  it('knows colorless and multicolor', () => {
    expect(names('c:colorless')).toEqual(['Sol Ring', 'Dimir Signet', 'Island']);
    expect(names('c:c')).toEqual(['Sol Ring', 'Dimir Signet', 'Island']);
    expect(names('c:multicolor')).toEqual(['Fire // Ice', 'Lim-D\u00fbl\'s Vault']);
    expect(names('c:m')).toEqual(['Fire // Ice', 'Lim-D\u00fbl\'s Vault']);
    expect(names('c:izzet')).toEqual(['Fire // Ice']);
  });
});

describe('id: colour identity', () => {
  it('id: means within this identity', () => {
    expect(names('id<=bg')).toEqual(['Tarmogoyf', 'Sol Ring', 'Craterhoof Behemoth']);
    expect(names('id:ub')).toEqual(['Counterspell', 'Sol Ring', 'Dimir Signet', 'Delver of Secrets // Insectile Aberration', 'Jace, the Mind Sculptor', 'Island', 'Lim-D\u00fbl\'s Vault']);
    expect(names('ci=ub')).toEqual(['Dimir Signet', 'Lim-D\u00fbl\'s Vault']);
    expect(names('identity:c')).toEqual(['Sol Ring']);
  });
});

describe('numbers: mv, pow, tou, loy', () => {
  it('compare mana value', () => {
    expect(names('mv<=1')).toEqual(['Lightning Bolt', 'Sol Ring', 'Delver of Secrets // Insectile Aberration', 'Island']);
    expect(names('mv=4')).toEqual(['Fire // Ice', 'Jace, the Mind Sculptor']);
    expect(names('cmc:2')).toEqual(['Counterspell', 'Tarmogoyf', 'Dimir Signet', 'Lim-D\u00fbl\'s Vault']);
    expect(names('manavalue>6')).toEqual(['Craterhoof Behemoth']);
    expect(names('mv!=0')).not.toContain('Island');
  });
  it('compare power, toughness and loyalty, with * as 0', () => {
    expect(names('pow>=4')).toEqual(['Serra Angel', 'Craterhoof Behemoth']);
    expect(names('pow=0')).toEqual(['Tarmogoyf']);
    expect(names('tou<2')).toEqual(['Tarmogoyf', 'Delver of Secrets // Insectile Aberration']);
    expect(names('pow>2')).toContain('Delver of Secrets // Insectile Aberration');
    expect(names('loy=3')).toEqual(['Jace, the Mind Sculptor']);
  });
});

describe('rarity, set, number, keyword, format', () => {
  it('rarity with order', () => {
    expect(names('r:mythic')).toEqual(['Tarmogoyf', 'Jace, the Mind Sculptor', 'Craterhoof Behemoth']);
    expect(names('r>=rare')).toEqual(['Tarmogoyf', 'Jace, the Mind Sculptor', 'Craterhoof Behemoth']);
    expect(names('rarity<uncommon')).toEqual(['Lightning Bolt', 'Dimir Signet', 'Delver of Secrets // Insectile Aberration', 'Island']);
  });
  it('set and collector number', () => {
    expect(names('s:m11')).toEqual(['Lightning Bolt']);
    expect(names('set:M11')).toEqual(['Lightning Bolt']);
    expect(names('e:m11 cn:149')).toEqual(['Lightning Bolt']);
    expect(names('number:149')).toEqual(['Lightning Bolt']);
    expect(names('cn>100')).toEqual(['Lightning Bolt']);
  });
  it('keyword', () => {
    expect(names('kw:flying')).toEqual(['Serra Angel']);
    expect(names('keyword:vigilance')).toEqual(['Serra Angel']);
  });
  it('format legality, restricted counts as legal', () => {
    expect(names('f:modern')).toEqual(['Lightning Bolt', 'Tarmogoyf']);
    expect(names('format:vintage')).toEqual(['Lightning Bolt', 'Counterspell', 'Sol Ring']);
    expect(names('f:edh')).toEqual(['Lightning Bolt', 'Counterspell', 'Serra Angel', 'Sol Ring']);
  });
});

describe('is: and pile:', () => {
  it('the card-level is: values', () => {
    expect(names('is:foil')).toEqual(['Lightning Bolt', 'Sol Ring']);
    expect(names('is:nonfoil')).toHaveLength(records.length - 2);
    expect(names('is:dfc')).toEqual(['Delver of Secrets // Insectile Aberration']);
    expect(names('is:permanent')).toContain('Island');
    expect(names('is:permanent')).not.toContain('Counterspell');
    expect(names('is:spell')).not.toContain('Island');
    expect(names('is:spell')).toContain('Counterspell');
  });
  it('the tool\'s own is: values', () => {
    expect(names('is:faceup')).not.toContain('Serra Angel');
    expect(names('is:facedown')).toEqual(['Serra Angel']);
    expect(names('is:selected')).toEqual(['Lightning Bolt', 'Counterspell', 'Serra Angel']);
  });
  it('pile: matches the named pile', () => {
    expect(names('pile:keep')).toEqual(['Lightning Bolt', 'Counterspell', 'Serra Angel', 'Tarmogoyf']);
    expect(names('pile:"deck a"')).toEqual(['Dimir Signet']);
  });
});

describe('negation, or, parentheses', () => {
  it('negates any term', () => {
    expect(names('t:instant -c:r')).toEqual(['Counterspell', 'Lim-D\u00fbl\'s Vault']);
    expect(names('-t:land -t:creature -t:instant -t:planeswalker')).toEqual(['Sol Ring', 'Dimir Signet']);
  });
  it('combines with or and parentheses, and binds and tighter than or', () => {
    expect(names('(c:r or c:g) mv<=2')).toEqual(['Lightning Bolt', 'Tarmogoyf']);
    expect(names('c:r or c:g mv<=2')).toEqual(['Lightning Bolt', 'Tarmogoyf', 'Fire // Ice']);
    expect(names('-(t:creature or t:land) mv=2')).toEqual(['Counterspell', 'Dimir Signet', 'Lim-D\u00fbl\'s Vault']);
    expect(names('t:creature and c:g')).toEqual(['Tarmogoyf', 'Craterhoof Behemoth']);
  });
  it('an empty query matches everything', () => {
    expect(names('')).toHaveLength(records.length);
  });
});

describe('errors (spec 9.4: never a silent empty match)', () => {
  it('rejects unsupported Scryfall terms with the spec message', () => {
    expect(error('art:dragon')).toBe('Not supported on the table: `art:dragon`');
    expect(error('flavor:bird')).toBe('Not supported on the table: `flavor:bird`');
    expect(error('a:"john avon"')).toBe('Not supported on the table: `a:"john avon"`');
    expect(error('year>2000')).toBe('Not supported on the table: `year>2000`');
    expect(error('usd<1')).toBe('Not supported on the table: `usd<1`');
    expect(error('prefer:oldest')).toBe('Not supported on the table: `prefer:oldest`');
    expect(error('order:cmc')).toBe('Not supported on the table: `order:cmc`');
    expect(error('unique:prints')).toBe('Not supported on the table: `unique:prints`');
    expect(error('o:/draw.*card/')).toBe('Not supported on the table: `o:/draw.*card/`');
    expect(error('is:reprint')).toBe('Not supported on the table: `is:reprint`');
  });
  it('rejects unknown keys, bad values and broken syntax', () => {
    expect(error('foo:bar')).toMatch(/Unknown term/);
    expect(error('mv<=x')).toMatch(/needs a number/);
    expect(error('c:purple')).toMatch(/Unknown colour/);
    expect(error('r:shiny')).toMatch(/Unknown rarity/);
    expect(error('(t:creature')).toMatch(/Missing closing parenthesis/);
    expect(error('t:creature)')).toMatch(/Unmatched/);
    expect(error('o:"draw')).toMatch(/quote/);
    expect(error('t:creature or')).toMatch(/Nothing after/);
    expect(error('t>creature')).toMatch(/can't use/);
  });
  it('reports the position', () => {
    const r = parseQuery('t:creature art:x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pos).toBe(11);
  });
});
