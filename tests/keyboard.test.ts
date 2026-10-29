import { describe, expect, it } from 'vitest';
import { repeatDue } from '../src/input/keyboard';

describe('held hotkeys (decision 183)', () => {
  it('fire once per press unless bound with a repeat pace', () => {
    expect(repeatDue(undefined, 0, 10_000)).toBe(false);
  });

  it('repeat no faster than their pace', () => {
    expect(repeatDue(250, 1000, 1100)).toBe(false);
    expect(repeatDue(250, 1000, 1249)).toBe(false);
    expect(repeatDue(250, 1000, 1250)).toBe(true);
  });
});
