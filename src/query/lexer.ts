// Lexer for the local Scryfall-subset query language (spec 9.4).

export type Op = ':' | '=' | '!=' | '>=' | '<=' | '>' | '<';

export type Token =
  | { kind: 'lparen'; pos: number }
  | { kind: 'rparen'; pos: number }
  | { kind: 'or'; pos: number }
  | { kind: 'not'; pos: number }
  /** key op value, e.g. t:creature, mv<=2, o:"draw a card". */
  | { kind: 'term'; key: string; op: Op; value: string; quoted: boolean; raw: string; pos: number }
  /** A bare word or quoted phrase: matched against the name. `exact` for !"Name". */
  | { kind: 'word'; value: string; quoted: boolean; exact: boolean; raw: string; pos: number };

export class QueryError extends Error {
  constructor(message: string, readonly pos = 0) {
    super(message);
    this.name = 'QueryError';
  }
}

const OPS: Op[] = ['!=', '>=', '<=', ':', '=', '>', '<'];

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

  while (i < n) {
    const c = input[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen', pos: i++ });
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', pos: i++ });
      continue;
    }
    if (c === '-' && i + 1 < n && !isSpace(input[i + 1])) {
      tokens.push({ kind: 'not', pos: i++ });
      continue;
    }
    const start = i;
    // !"Exact Name" or !Name
    let exact = false;
    if (c === '!' && input[i + 1] !== '=') {
      exact = true;
      i++;
    }
    if (input[i] === '"' || input[i] === "'") {
      const { value, end } = readQuoted(input, i);
      i = end;
      tokens.push({ kind: 'word', value, quoted: true, exact, raw: input.slice(start, i), pos: start });
      continue;
    }
    // A key followed by an operator, or a bare word.
    const keyMatch = /^[a-zA-Z]+/.exec(input.slice(i));
    if (keyMatch && !exact) {
      const after = i + keyMatch[0].length;
      const op = OPS.find((o) => input.startsWith(o, after));
      if (op) {
        let j = after + op.length;
        let value: string;
        let quoted = false;
        if (input[j] === '"' || input[j] === "'") {
          const q = readQuoted(input, j);
          value = q.value;
          j = q.end;
          quoted = true;
        } else {
          const vs = j;
          while (j < n && !isSpace(input[j]) && input[j] !== ')' && input[j] !== '(') j++;
          value = input.slice(vs, j);
        }
        tokens.push({ kind: 'term', key: keyMatch[0].toLowerCase(), op, value, quoted, raw: input.slice(start, j), pos: start });
        i = j;
        continue;
      }
    }
    while (i < n && !isSpace(input[i]) && input[i] !== '(' && input[i] !== ')') i++;
    const word = input.slice(exact ? start + 1 : start, i);
    if (!exact && /^or$/i.test(word)) tokens.push({ kind: 'or', pos: start });
    else if (!exact && /^and$/i.test(word)) continue;
    else if (word) tokens.push({ kind: 'word', value: word, quoted: false, exact, raw: input.slice(start, i), pos: start });
  }
  return tokens;
}

function readQuoted(input: string, at: number): { value: string; end: number } {
  const q = input[at];
  const close = input.indexOf(q, at + 1);
  if (close === -1) throw new QueryError('Missing closing quote', at);
  return { value: input.slice(at + 1, close), end: close + 1 };
}
