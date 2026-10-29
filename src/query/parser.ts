// Parser for the local query language (spec 9.4): implicit AND between terms,
// `or`, parentheses and `-` negation. Unknown or unsupported terms are errors,
// never a silent empty match.

import { QueryError, lex, type Op, type Token } from './lexer';

export type Field =
  | 'name' | 'oracle' | 'type' | 'color' | 'identity' | 'mv' | 'pow' | 'tou' | 'loy'
  | 'rarity' | 'set' | 'number' | 'keyword' | 'is' | 'format' | 'pile' | 'edhrec';

export type Node =
  | { type: 'and'; children: Node[] }
  | { type: 'or'; children: Node[] }
  | { type: 'not'; child: Node }
  | { type: 'term'; field: Field; op: Op; value: string; raw: string }
  | { type: 'name'; value: string; exact: boolean; raw: string }
  | { type: 'all' };

const KEYS: Record<string, Field> = {
  name: 'name', n: 'name',
  o: 'oracle', oracle: 'oracle',
  t: 'type', type: 'type',
  c: 'color', color: 'color', colour: 'color',
  id: 'identity', ci: 'identity', identity: 'identity', commander: 'identity',
  mv: 'mv', cmc: 'mv', manavalue: 'mv',
  pow: 'pow', power: 'pow',
  tou: 'tou', toughness: 'tou',
  loy: 'loy', loyalty: 'loy',
  r: 'rarity', rarity: 'rarity',
  s: 'set', set: 'set', e: 'set', edition: 'set',
  cn: 'number', number: 'number',
  kw: 'keyword', keyword: 'keyword',
  is: 'is',
  f: 'format', format: 'format', legal: 'format',
  pile: 'pile',
  // EDHREC rank, this tool's own (decision 187): edhrec<=500 is the 500 most played.
  edhrec: 'edhrec', edhrecrank: 'edhrec',
};

/** Scryfall keys the table deliberately doesn't support in version one. */
const UNSUPPORTED = new Set([
  'art', 'atag', 'arttag', 'function', 'otag', 'oracletag', 'flavor', 'ft', 'a', 'artist', 'year', 'date',
  'usd', 'eur', 'tix', 'prefer', 'order', 'unique', 'display', 'direction', 'not', 'has', 'new', 'in',
  'game', 'frame', 'border', 'stamp', 'wm', 'watermark', 'lang', 'language', 'block', 'b', 'st', 'cube',
  'banned', 'restricted', 'devotion', 'produces', 'm', 'mana', 'fo', 'fulloracle', 'keywords', 'include',
  'sets', 'papersets', 'prints', 'paperprints', 'powtou', 'pt', 'cheapest', 'illustrations', 'kw2',
]);

export const IS_VALUES = new Set(['foil', 'nonfoil', 'etched', 'dfc', 'mdfc', 'transform', 'split', 'permanent', 'spell', 'faceup', 'facedown', 'selected', 'multicolor', 'colorless', 'historic', 'legendary']);

const NUMERIC: Field[] = ['mv', 'pow', 'tou', 'loy', 'edhrec'];
const ORDERED: Field[] = ['mv', 'pow', 'tou', 'loy', 'rarity', 'color', 'identity', 'number', 'edhrec'];

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: string; pos: number };

export function parseQuery(input: string): ParseResult {
  try {
    const tokens = lex(input);
    if (!tokens.length) return { ok: true, ast: { type: 'all' } };
    const p = new Parser(tokens);
    const ast = p.parseOr();
    if (!p.done()) {
      const t = p.peek()!;
      throw new QueryError(t.kind === 'rparen' ? 'Unmatched closing parenthesis' : 'Unexpected input', t.pos);
    }
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof QueryError) return { ok: false, error: err.message, pos: err.pos };
    throw err;
  }
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  done(): boolean {
    return this.i >= this.tokens.length;
  }

  peek(): Token | undefined {
    return this.tokens[this.i];
  }

  parseOr(): Node {
    const parts = [this.parseAnd()];
    while (this.peek()?.kind === 'or') {
      const orTok = this.tokens[this.i++];
      if (this.done() || this.peek()!.kind === 'rparen' || this.peek()!.kind === 'or') throw new QueryError('Nothing after "or"', orTok.pos);
      parts.push(this.parseAnd());
    }
    return parts.length === 1 ? parts[0] : { type: 'or', children: parts };
  }

  private parseAnd(): Node {
    const parts: Node[] = [];
    while (!this.done()) {
      const t = this.peek()!;
      if (t.kind === 'or' || t.kind === 'rparen') break;
      parts.push(this.parseUnary());
    }
    if (!parts.length) {
      const t = this.peek();
      throw new QueryError(t?.kind === 'or' ? '"or" needs a term before it' : 'Empty group', t?.pos ?? 0);
    }
    return parts.length === 1 ? parts[0] : { type: 'and', children: parts };
  }

  private parseUnary(): Node {
    const t = this.tokens[this.i++];
    if (t.kind === 'not') {
      if (this.done()) throw new QueryError('Nothing after "-"', t.pos);
      return { type: 'not', child: this.parseUnary() };
    }
    if (t.kind === 'lparen') {
      if (this.peek()?.kind === 'rparen') throw new QueryError('Empty parentheses', t.pos);
      const inner = this.parseOr();
      if (this.peek()?.kind !== 'rparen') throw new QueryError('Missing closing parenthesis', t.pos);
      this.i++;
      return inner;
    }
    if (t.kind === 'rparen') throw new QueryError('Unmatched closing parenthesis', t.pos);
    if (t.kind === 'or') throw new QueryError('"or" needs a term before it', t.pos);
    if (t.kind === 'word') {
      if (!t.quoted && /^\/.*\/$/.test(t.value)) throw new QueryError(`Not supported on the table: \`${t.raw}\``, t.pos);
      return { type: 'name', value: t.value, exact: t.exact, raw: t.raw };
    }
    return termNode(t);
  }
}

function termNode(t: Extract<Token, { kind: 'term' }>): Node {
  if (UNSUPPORTED.has(t.key)) throw new QueryError(`Not supported on the table: \`${t.raw}\``, t.pos);
  const field = KEYS[t.key];
  if (!field) throw new QueryError(`Unknown term \`${t.key}${t.op}\``, t.pos);
  if (!t.quoted && /^\/.*\/$/.test(t.value)) throw new QueryError(`Not supported on the table: \`${t.raw}\``, t.pos);
  if (!t.value) throw new QueryError(`\`${t.key}${t.op}\` needs a value`, t.pos);
  if (t.op !== ':' && t.op !== '=' && t.op !== '!=' && !ORDERED.includes(field)) {
    throw new QueryError(`\`${t.key}\` can't use ${t.op}`, t.pos);
  }
  if (NUMERIC.includes(field) && !/^-?\d+(\.\d+)?$|^\*$/.test(t.value)) {
    throw new QueryError(`\`${t.key}\` needs a number`, t.pos);
  }
  if (field === 'is' && !IS_VALUES.has(t.value.toLowerCase())) {
    throw new QueryError(`Not supported on the table: \`${t.raw}\``, t.pos);
  }
  if (field === 'rarity' && !rarityRank(t.value)) throw new QueryError(`Unknown rarity \`${t.value}\``, t.pos);
  if ((field === 'color' || field === 'identity') && !parseColors(t.value)) {
    throw new QueryError(`Unknown colour \`${t.value}\``, t.pos);
  }
  return { type: 'term', field, op: t.op, value: t.value, raw: t.raw };
}

const RARITIES: Record<string, number> = { c: 1, common: 1, u: 2, uncommon: 2, r: 3, rare: 3, m: 4, mythic: 4, s: 5, special: 5, b: 6, bonus: 6 };

export function rarityRank(v: string): number {
  return RARITIES[v.toLowerCase()] ?? 0;
}

const NAMED_COLORS: Record<string, string> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
  azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw',
  orzhov: 'wb', izzet: 'ur', golgari: 'bg', boros: 'rw', simic: 'gu',
  bant: 'gwu', esper: 'wub', grixis: 'ubr', jund: 'brg', naya: 'rgw',
  abzan: 'wbg', jeskai: 'urw', sultai: 'bgu', mardu: 'rwb', temur: 'gur',
  wubrg: 'wubrg', rainbow: 'wubrg',
};

/** A colour value as a set of letters; 'colorless' and 'multicolor' are special. */
export type ColorQuery = { kind: 'set'; colors: Set<string> } | { kind: 'colorless' } | { kind: 'multicolor' };

export function parseColors(v: string): ColorQuery | null {
  const s = v.toLowerCase();
  if (s === 'c' || s === 'colorless' || s === 'colourless') return { kind: 'colorless' };
  if (s === 'm' || s === 'multicolor' || s === 'multicolour' || s === 'multi') return { kind: 'multicolor' };
  const letters = NAMED_COLORS[s] ?? s;
  if (!/^[wubrg]+$/.test(letters)) return null;
  return { kind: 'set', colors: new Set(letters.toUpperCase().split('')) };
}
