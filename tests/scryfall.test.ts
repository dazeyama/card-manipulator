import { describe, expect, it } from 'vitest';
import { isDfc, trimCard, type ScryfallCard } from '../src/scryfall/cardData';
import { isOutdated } from '../src/scryfall/upgrade';
import { NameIndex } from '../src/scryfall/names';
import { identifierFor, matches } from '../src/scryfall/resolve';
import { ScryfallClient } from '../src/scryfall/client';
import type { DeckEntry } from '../src/io/decklist';

const bolt: ScryfallCard = {
  object: 'card', id: 'b1', oracle_id: 'o1', name: 'Lightning Bolt', set: 'm11', set_name: 'Magic 2011', collector_number: '149',
  rarity: 'common', lang: 'en', layout: 'normal', mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'], color_identity: ['R'], keywords: [], legalities: { modern: 'legal', standard: 'not_legal', vintage: 'legal' }, finishes: ['nonfoil', 'foil'],
  prices: { usd: '1.00', usd_foil: '5.00' }, image_uris: { small: 'https://x/s.jpg', normal: 'https://x/n.jpg' },
};

const delver: ScryfallCard = {
  object: 'card', id: 'd1', name: 'Delver of Secrets // Insectile Aberration', set: 'isd', set_name: 'Innistrad', collector_number: '51',
  rarity: 'common', lang: 'en', layout: 'transform', cmc: 1, color_identity: ['U'], finishes: ['nonfoil'],
  card_faces: [
    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of your upkeep…', colors: ['U'], power: '1', toughness: '1', oracle_id: 'od', image_uris: { small: 'https://x/d1.jpg', normal: 'https://x/d1n.jpg' } },
    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying', colors: ['U'], power: '3', toughness: '2', image_uris: { small: 'https://x/d2.jpg', normal: 'https://x/d2n.jpg' } },
  ],
};

const fireIce: ScryfallCard = {
  object: 'card', id: 'f1', oracle_id: 'of', name: 'Fire // Ice', set: 'mh2', set_name: 'Modern Horizons 2', collector_number: '290', rarity: 'uncommon', lang: 'en',
  layout: 'split', mana_cost: '{1}{R} // {1}{U}', cmc: 4, type_line: 'Instant // Instant', colors: ['R', 'U'], color_identity: ['R', 'U'], finishes: ['nonfoil'],
  image_uris: { small: 'https://x/fi.jpg', normal: 'https://x/fin.jpg' },
  card_faces: [
    { name: 'Fire', mana_cost: '{1}{R}', type_line: 'Instant', oracle_text: 'Fire deals 2 damage divided as you choose…' },
    { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent. Draw a card.' },
  ],
};

describe('trimCard (spec 5.3)', () => {
  it('keeps the fields the query engine needs', () => {
    const r = trimCard(bolt, 1);
    expect(r).toMatchObject({ id: 'b1', name: 'Lightning Bolt', cmc: 1, colors: ['R'], image_small: 'https://x/s.jpg', fetched_at: 1 });
    expect(r.legalities).toEqual({ modern: 'legal', vintage: 'legal' });
    expect(isDfc(r)).toBe(false);
  });

  it('keeps the EDHREC rank, null when Scryfall has none, so old records stand out (decision 187)', () => {
    expect(trimCard({ ...bolt, edhrec_rank: 42 }).edhrec_rank).toBe(42);
    const none = trimCard(bolt);
    expect(none.edhrec_rank).toBeNull();
    expect(isOutdated(none)).toBe(false);
    const { edhrec_rank: _drop, ...old } = none;
    expect(isOutdated(old)).toBe(true);
  });

  it('keeps both faces and both images of a double-faced card', () => {
    const r = trimCard(delver);
    expect(r.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    expect(r.image_small).toBe('https://x/d1.jpg');
    expect(r.back_image_small).toBe('https://x/d2.jpg');
    expect(r.type_line).toBe('Creature — Human Wizard // Creature — Human Insect');
    expect(r.oracle_id).toBe('od');
    expect(isDfc(r)).toBe(true);
  });

  it('uses the shared image for split cards and has no back face', () => {
    const r = trimCard(fireIce);
    expect(r.image_small).toBe('https://x/fi.jpg');
    expect(r.back_image_small).toBeUndefined();
    expect(r.oracle_text).toContain('Draw a card');
  });
});

describe('NameIndex', () => {
  const idx = new NameIndex(['Lightning Bolt', 'Lim-Dûl\'s Vault', 'Delver of Secrets // Insectile Aberration', 'Fire // Ice', 'Counterspell', 'Lightning Helix']);

  it('finds the catalog spelling, ignoring case and accents', () => {
    expect(idx.canonical('lightning bolt')).toBe('Lightning Bolt');
    expect(idx.canonical('Lim-Dul\'s Vault')).toBe('Lim-Dûl\'s Vault');
    expect(idx.canonical('Insectile Aberration')).toBe('Delver of Secrets // Insectile Aberration');
    expect(idx.canonical('ice')).toBe('Fire // Ice');
    expect(idx.canonical('Lightnig Bolt')).toBeNull();
  });

  it('suggests prefix matches first, then typo matches', () => {
    expect(idx.suggest('light')).toEqual(['Lightning Bolt', 'Lightning Helix']);
    expect(idx.suggest('counterspel')[0]).toBe('Counterspell');
    expect(idx.suggest('lightnig bolt')).toContain('Lightning Bolt');
  });
});

describe('collection identifiers', () => {
  const entry = (e: Partial<DeckEntry>): DeckEntry => ({ count: 1, name: '', finish: 'nonfoil', lines: [1], text: '', ...e });
  const idx = new NameIndex(['Delver of Secrets // Insectile Aberration', 'Lim-Dûl\'s Vault']);

  it('pins set and number when both are given', () => {
    expect(identifierFor(entry({ name: 'Lightning Bolt', set: 'm11', number: '149' }), null)).toEqual({ set: 'm11', collector_number: '149' });
    expect(identifierFor(entry({ name: 'Lightning Bolt', set: 'm11' }), null)).toEqual({ name: 'Lightning Bolt', set: 'm11' });
  });

  it('sends the front face for a back-face name, and the catalog spelling', () => {
    expect(identifierFor(entry({ name: 'Insectile Aberration' }), idx)).toEqual({ name: 'Delver of Secrets' });
    expect(identifierFor(entry({ name: 'lim-dul\'s vault' }), idx)).toEqual({ name: 'Lim-Dûl\'s Vault' });
  });

  it('matches answers back to identifiers', () => {
    expect(matches(delver, { name: 'Delver of Secrets' })).toBe(true);
    expect(matches(delver, { name: 'Insectile Aberration' })).toBe(true);
    expect(matches(bolt, { set: 'M11', collector_number: '149' })).toBe(true);
    expect(matches(bolt, { name: 'Lightning Bolt', set: 'lea' })).toBe(false);
  });
});

describe('ScryfallClient queue (spec 5.2)', () => {
  it('spaces requests at least 100 ms apart, searches 550 ms, one at a time', async () => {
    const starts: [string, number][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fake = (async (url: string) => {
      starts.push([url, Date.now()]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response('{"ok":1}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = new ScryfallClient(fake);
    await Promise.all([c.getJson('/a'), c.getJson('/b'), c.getJson('/s1', { kind: 'search' }), c.getJson('/s2', { kind: 'search' })]);
    expect(maxInFlight).toBe(1);
    expect(starts[1][1] - starts[0][1]).toBeGreaterThanOrEqual(95);
    expect(starts[3][1] - starts[2][1]).toBeGreaterThanOrEqual(545);
  });

  it('waits out a 429 for as long as Scryfall asks', async () => {
    let n = 0;
    const fake = (async () => {
      n++;
      return n === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0.3' } }) : new Response('{"ok":1}', { status: 200 });
    }) as unknown as typeof fetch;
    const c = new ScryfallClient(fake);
    const paused: number[] = [];
    c.onStatus((s) => {
      if (s.pausedUntil) paused.push(s.pausedUntil);
    });
    const t0 = Date.now();
    expect(await c.getJson('/x')).toEqual({ ok: 1 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    expect(paused.length).toBeGreaterThan(0);
  });
});
