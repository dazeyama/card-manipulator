import { describe, expect, it } from 'vitest';
import { validateDoc } from '../src/io/saveFile';

describe('validateDoc (spec 6.3)', () => {
  it('accepts a version 1 table document', () => {
    expect(validateDoc({ format: 'card-manipulator-table', version: 1, cards: [], piles: [], cardData: {} })).toBeNull();
  });
  it('rejects other files with a reason', () => {
    expect(validateDoc(null)).toMatch(/Not a table/);
    expect(validateDoc({ format: 'something-else', version: 1, cards: [] })).toMatch(/Not a Card Manipulator/);
    expect(validateDoc({ format: 'card-manipulator-table', version: 2, cards: [] })).toMatch(/version 2/);
    expect(validateDoc({ format: 'card-manipulator-table', version: 1 })).toMatch(/no cards/);
  });
});
