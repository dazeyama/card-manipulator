import { describe, expect, it } from 'vitest';
import { applyOp } from '../shared/apply';
import { emptyTable, type CardSnap } from '../shared/table';
import { diffCards } from '../src/state/history';
import { DEFAULT_SLEEVE, deckNameFor, isArtSleeve, isPack, nextDeckName, packSleeve, raiseOf, sleeveName, sleeveRim } from '../src/state/sleeves';
import { maxValue, valueRange } from '../src/state/dice';
import { groupLines } from '../src/io/exportDecklist';
import { parseDecklist } from '../src/io/decklist';

const ART = 'https://cards.scryfall.io/art_crop/front/1/2/12.jpg';

function card(uid: string, over: Partial<CardSnap> = {}): CardSnap {
  return { uid, scryfallId: `id-${uid}`, finish: 'nonfoil', x: 0, y: 0, z: 0.15, yaw: 0, faceUp: true, pileId: null, spreadOf: null, ...over };
}

describe('sleeve styles (decision 360)', () => {
  it('tells a color from art, and names them', () => {
    expect(isArtSleeve('#1f3a6e')).toBe(false);
    expect(isArtSleeve(ART)).toBe(true);
    expect(sleeveName('#1f3a6e')).toBe('Dark blue');
    expect(sleeveName(ART, 'Ragavan, Nimble Pilferer')).toBe('Ragavan, Nimble Pilferer art');
    expect(sleeveRim('#e0443e')).toBe('#e0443e');
    expect(sleeveRim(ART)).toBe('#1d1d1f');
  });

  it('reads a pack\'s sleeves: its art, else its color', () => {
    expect(packSleeve({ color: '#e0443e' })).toBe('#e0443e');
    expect(packSleeve({ color: '#1d1d1f', art: ART })).toBe(ART);
    expect(packSleeve({})).toBe(DEFAULT_SLEEVE);
    expect(isPack({ kind: 'pack' })).toBe(true);
    expect(isPack({ kind: 'd20' })).toBe(false);
  });

  it('never numbers a pack', () => {
    expect(maxValue('pack')).toBe(0);
    expect(valueRange('pack')).toEqual({ min: 1, max: 1 });
  });
});

describe('Shift + F (decision 360)', () => {
  it('raises a sleeved double-faced card face up, and lowers it again', () => {
    expect(raiseOf({ faceUp: true, sleeve: '#1f3a6e' }, true)).toEqual({ faceUp: true, raised: true });
    expect(raiseOf({ faceUp: false, sleeve: '#1f3a6e' }, true)).toEqual({ faceUp: true, raised: true });
    expect(raiseOf({ faceUp: true, sleeve: '#1f3a6e', raised: true }, true)).toEqual({ faceUp: true, raised: null });
    // Face down while raised, it comes up raised still.
    expect(raiseOf({ faceUp: false, sleeve: '#1f3a6e', raised: true }, true)).toEqual({ faceUp: true, raised: true });
  });

  it('flips an unsleeved double-faced card as F does, and leaves single-faced cards', () => {
    expect(raiseOf({ faceUp: true }, true)).toEqual({ faceUp: false, raised: null });
    expect(raiseOf({ faceUp: true, sleeve: '#1f3a6e' }, false)).toBeNull();
  });
});

describe('saved deck names (decision 360)', () => {
  it('takes the pile\'s name, else the cube\'s, else the next free Deck N', () => {
    expect(deckNameFor('Mono Red', 'Vintage Cube', [])).toEqual({ name: 'Mono Red', replaces: false });
    expect(deckNameFor(null, 'Vintage Cube', [])).toEqual({ name: 'Vintage Cube', replaces: false });
    expect(deckNameFor(null, null, ['Deck 1', 'deck 3'])).toEqual({ name: 'Deck 2', replaces: false });
    expect(nextDeckName([])).toBe('Deck 1');
  });

  it('replaces a saved deck of the same name, case aside', () => {
    expect(deckNameFor('mono red', null, ['Mono Red'])).toEqual({ name: 'mono red', replaces: true });
  });

  it('keeps exact printings and finishes, which read back as a list', () => {
    const text = groupLines([
      { name: 'Delver of Secrets', set: 'isd', number: '51', finish: 'nonfoil' },
      { name: 'Delver of Secrets', set: 'isd', number: '51', finish: 'nonfoil' },
      { name: 'Sol Ring', set: 'c21', number: '263', finish: 'foil' },
    ], true).join('\n');
    const { entries } = parseDecklist(text);
    expect(entries.map((e) => [e.count, e.name, e.set, e.number, e.finish])).toEqual([
      [2, 'Delver of Secrets', 'isd', '51', 'nonfoil'],
      [1, 'Sol Ring', 'c21', '263', 'foil'],
    ]);
  });
});

describe('sleeves on the table', () => {
  it('sleeves, raises and unsleeves cards with moves', () => {
    let t = { ...emptyTable('T'), cards: [card('a', { dfc: true })] };
    t = applyOp(t, { t: 'move', moves: [{ uid: 'a', sleeve: '#1f3a6e' }] });
    expect(t.cards[0].sleeve).toBe('#1f3a6e');
    t = applyOp(t, { t: 'move', moves: [{ uid: 'a', raised: true }] });
    expect(t.cards[0].raised).toBe(true);
    t = applyOp(t, { t: 'move', moves: [{ uid: 'a', sleeve: null, raised: null }] });
    expect(t.cards[0].sleeve).toBeUndefined();
    expect(t.cards[0].raised).toBeUndefined();
    expect(t.cards[0].dfc).toBe(true);
  });

  it('counts a sleeving as a change undo takes back', () => {
    const then = { ...emptyTable('T'), cards: [card('a')] };
    const now = { ...emptyTable('T'), cards: [card('a', { sleeve: '#1f3a6e' })] };
    expect(diffCards(now, then).move.map((c) => c.uid)).toEqual(['a']);
  });
});
