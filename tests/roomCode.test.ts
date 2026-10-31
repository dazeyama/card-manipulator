import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, isCode, newCode, normaliseCode } from '../shared/roomCode';

describe('room codes', () => {
  it('uses 31 letters with no look-alikes', () => {
    expect(CODE_ALPHABET.length).toBe(31);
    for (const bad of ['0', 'O', '1', 'I', 'L']) expect(CODE_ALPHABET).not.toContain(bad);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
  });

  it('makes six-character codes from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c.length).toBe(CODE_LENGTH);
      expect(isCode(c)).toBe(true);
    }
  });

  it('covers the whole alphabet, ends included', () => {
    expect(newCode(() => 0)).toBe('222222');
    expect(newCode(() => 0.999999)).toBe('ZZZZZZ');
  });

  it('checks codes', () => {
    expect(isCode('7KQ2MX')).toBe(true);
    expect(isCode('7kq2mx')).toBe(false);
    expect(isCode(normaliseCode(' 7kq2mx '))).toBe(true);
    expect(isCode('7KQ2M')).toBe(false);
    expect(isCode('7KQ2MXX')).toBe(false);
    expect(isCode('7KQ2M0')).toBe(false);
    expect(isCode('')).toBe(false);
  });
});
