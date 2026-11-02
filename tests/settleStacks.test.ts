import { describe, expect, it } from 'vitest';
import { settledHeights } from '../src/settleStacks';
import { CARD_T } from '../src/state/types';

const stack = (n: number, from = 0) => Array.from({ length: n }, (_, k) => CARD_T / 2 + (from + k) * CARD_T);

describe('tidy stacks settle (decision 349)', () => {
  it('leaves a stack with no gap alone', () => {
    expect(settledHeights(stack(10))).toBeNull();
    expect(settledHeights([])).toBeNull();
  });

  it('drops the cards above a gap onto the cards under it', () => {
    // Cards 3 to 6 were pulled out from under the rest.
    const zs = [...stack(3), ...stack(4, 7)];
    expect(settledHeights(zs)).toEqual(stack(7));
  });

  it('brings a stack whose bottom cards went down to the table', () => {
    expect(settledHeights(stack(5, 20))).toEqual(stack(5));
  });
});
