// Room codes (ONLINE.md 4.2, O11): six characters from a 31-letter alphabet
// without look-alikes (no 0, O, 1, I, L), about 887 million codes. The server
// makes them; links and the join prompt check them. Pure.

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

const VALID = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A random code. `random` gives numbers in [0, 1); crypto's by default. */
export function newCode(random: () => number = cryptoRandom): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}

/** A code as typed or pasted: trimmed and upper case. */
export function normaliseCode(s: string): string {
  return s.trim().toUpperCase();
}

/** True for a well-formed code (after normaliseCode). */
export function isCode(s: string): boolean {
  return VALID.test(s);
}

function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}
