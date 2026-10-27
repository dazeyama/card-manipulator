// Evaluates a parsed query against the cards on the table. Never calls
// Scryfall: everything comes from the card record and the table state.

import type { Card, CardRecord } from '../state/types';
import type { Op } from './lexer';
import { parseColors, parseQuery, rarityRank, type Node } from './parser';
import { fold } from './text';

/** What a query sees for one card. */
export interface QueryCard {
  card: Card;
  record: CardRecord | undefined;
  selected: boolean;
  /** The named pile this card is in, if any. */
  pileName: string | null;
}

export type Predicate = (c: QueryCard) => boolean;

export type CompileResult = { ok: true; test: Predicate } | { ok: false; error: string };

export function compileQuery(input: string): CompileResult {
  const parsed = parseQuery(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, test: compile(parsed.ast) };
}

export function compile(node: Node): Predicate {
  switch (node.type) {
    case 'all':
      return () => true;
    case 'and': {
      const parts = node.children.map(compile);
      return (c) => parts.every((p) => p(c));
    }
    case 'or': {
      const parts = node.children.map(compile);
      return (c) => parts.some((p) => p(c));
    }
    case 'not': {
      const inner = compile(node.child);
      return (c) => !inner(c);
    }
    case 'name': {
      const want = fold(node.value);
      if (node.exact) return (c) => !!c.record && namesOf(c.record).some((n) => n === want);
      return (c) => !!c.record && namesOf(c.record).some((n) => n.includes(want));
    }
    case 'term':
      return compileTerm(node.field, node.op, node.value);
  }
}

/** Folded full name plus each face's name. */
function namesOf(r: CardRecord): string[] {
  return [fold(r.name), ...r.faces.map((f) => fold(f.name))];
}

function compileTerm(field: string, op: Op, raw: string): Predicate {
  const value = raw.trim();
  const want = fold(value);
  switch (field) {
    case 'name':
      return (c) => !!c.record && namesOf(c.record).some((n) => n.includes(want));
    case 'oracle':
      return (c) => {
        if (!c.record) return false;
        const texts = [c.record.oracle_text, ...c.record.faces.map((f) => f.oracle_text)];
        const nameWant = want.replace(/~/g, fold(c.record.faces[0]?.name ?? c.record.name));
        return texts.some((t) => fold(t ?? '').includes(nameWant));
      };
    case 'type':
      return (c) => !!c.record && [c.record.type_line, ...c.record.faces.map((f) => f.type_line)].some((t) => fold(t ?? '').includes(want));
    case 'color':
    case 'identity': {
      const q = parseColors(value)!;
      // Scryfall: c: means "at least these colours", id: means "within this identity".
      const effOp: Op = op === ':' ? (field === 'color' ? '>=' : '<=') : op;
      return (c) => {
        if (!c.record) return false;
        const have = new Set(field === 'color' ? c.record.colors : c.record.color_identity);
        if (q.kind === 'colorless') return compareSets(have, new Set(), effOp === '>=' ? '=' : effOp);
        if (q.kind === 'multicolor') {
          const ok = have.size >= 2;
          return op === '!=' ? !ok : ok;
        }
        return compareSets(have, q.colors, effOp);
      };
    }
    case 'mv':
      return numeric(op, Number(value), (r) => [r.cmc]);
    case 'pow':
      return numeric(op, starNumber(value), (r) => statValues(r, 'power'));
    case 'tou':
      return numeric(op, starNumber(value), (r) => statValues(r, 'toughness'));
    case 'loy':
      return numeric(op, starNumber(value), (r) => statValues(r, 'loyalty'));
    case 'rarity': {
      const rank = rarityRank(value);
      return (c) => !!c.record && cmp(rarityRank(c.record.rarity), op === ':' ? '=' : op, rank);
    }
    case 'set':
      return (c) => !!c.record && eqOp(op, c.record.set.toLowerCase() === want);
    case 'number': {
      const n = parseFloat(value);
      return (c) => {
        if (!c.record) return false;
        const cn = c.record.collector_number.toLowerCase();
        if (op === ':' || op === '=' || op === '!=') return eqOp(op, cn === want);
        const have = parseFloat(cn);
        return !Number.isNaN(have) && !Number.isNaN(n) && cmp(have, op, n);
      };
    }
    case 'keyword':
      return (c) => !!c.record && eqOp(op, c.record.keywords.some((k) => fold(k) === want));
    case 'format': {
      const fmt = want === 'edh' ? 'commander' : want;
      return (c) => !!c.record && eqOp(op, !!c.record.legalities[fmt]);
    }
    case 'pile':
      return (c) => eqOp(op, c.pileName !== null && fold(c.pileName) === want);
    case 'is':
      return isTest(want, op);
  }
  return () => false;
}

function isTest(v: string, op: Op): Predicate {
  const test: Predicate = (() => {
    switch (v) {
      case 'foil':
        return (c: QueryCard) => c.card.finish !== 'nonfoil';
      case 'nonfoil':
        return (c: QueryCard) => c.card.finish === 'nonfoil';
      case 'etched':
        return (c: QueryCard) => c.card.finish === 'etched';
      case 'dfc':
        return (c: QueryCard) => !!c.record?.back_image_small;
      case 'mdfc':
        return (c: QueryCard) => c.record?.layout === 'modal_dfc';
      case 'transform':
        return (c: QueryCard) => c.record?.layout === 'transform';
      case 'split':
        return (c: QueryCard) => c.record?.layout === 'split';
      case 'permanent':
        return (c: QueryCard) => !!c.record && /\b(artifact|creature|enchantment|land|planeswalker|battle)\b/i.test(c.record.type_line.split('//')[0]);
      case 'spell':
        return (c: QueryCard) => !!c.record && !/\bland\b/i.test(c.record.type_line.split('//')[0]);
      case 'faceup':
        return (c: QueryCard) => c.card.faceUp;
      case 'facedown':
        return (c: QueryCard) => !c.card.faceUp;
      case 'selected':
        return (c: QueryCard) => c.selected;
      case 'multicolor':
        return (c: QueryCard) => (c.record?.colors.length ?? 0) >= 2;
      case 'colorless':
        return (c: QueryCard) => !!c.record && c.record.colors.length === 0;
      case 'legendary':
        return (c: QueryCard) => !!c.record && /\blegendary\b/i.test(c.record.type_line);
      case 'historic':
        return (c: QueryCard) => !!c.record && /\b(legendary|artifact|saga)\b/i.test(c.record.type_line);
    }
    return () => false;
  })();
  return op === '!=' ? (c) => !test(c) : test;
}

function eqOp(op: Op, match: boolean): boolean {
  return op === '!=' ? !match : match;
}

function starNumber(v: string): number {
  return v === '*' ? 0 : Number(v);
}

/** Power, toughness or loyalty of every face that has one; '*' counts as 0. */
function statValues(r: CardRecord, key: 'power' | 'toughness' | 'loyalty'): number[] {
  const raw = [r[key], ...r.faces.map((f) => f[key])].filter((v): v is string => v !== undefined && v !== null);
  return raw.map((v) => {
    const n = parseFloat(v.replace(/\*/g, '0'));
    return Number.isNaN(n) ? 0 : n;
  });
}

function numeric(op: Op, want: number, values: (r: CardRecord) => number[]): Predicate {
  const o: Op = op === ':' ? '=' : op;
  return (c) => !!c.record && values(c.record).some((v) => cmp(v, o, want));
}

function cmp(a: number, op: Op, b: number): boolean {
  switch (op) {
    case ':':
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
  }
}

function compareSets(have: Set<string>, want: Set<string>, op: Op): boolean {
  const superset = [...want].every((x) => have.has(x));
  const subset = [...have].every((x) => want.has(x));
  switch (op) {
    case ':':
    case '>=':
      return superset;
    case '=':
      return superset && subset;
    case '!=':
      return !(superset && subset);
    case '<=':
      return subset;
    case '>':
      return superset && have.size > want.size;
    case '<':
      return subset && have.size < want.size;
  }
}
