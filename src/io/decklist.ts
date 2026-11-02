// Decklist parsing (spec 12.2). Pure: no Scryfall, no DOM.
//
// Tolerant like the owner's other tools: counts optional ("4", "4x", "x4"),
// set codes in (), [] or bare before a collector number, foil markers,
// section headers and comments skipped, duplicates merged across sections
// (decision 30: the whole list spawns as one pile).

import type { Finish } from '../state/types';

export interface DeckEntry {
  count: number;
  /** The card name as written (trimmed). */
  name: string;
  /** Lower-case set code, if the line pinned one. */
  set?: string;
  /** Collector number, if the line pinned one. */
  number?: string;
  finish: Finish;
  /** 1-based line numbers this entry came from. */
  lines: number[];
  /** The first source line's text, for the preview. */
  text: string;
}

export interface ParseResult {
  entries: DeckEntry[];
  /** Lines recognized as headers or comments. */
  skipped: number;
  /** Total cards (sum of counts). */
  cards: number;
}

export interface ParseOptions {
  /** True if the token is a known set code. Without it, a bare set code is only read before a number. */
  isSetCode?: (code: string) => boolean;
}

const HEADER = /^(deck|main ?deck|mainboard|main|sideboard|side|sb|commander|commanders|companion|maybeboard|maybe|considering|tokens?|about|name .*)\s*:?\s*(\(\d+\))?$/i;

export function parseDecklist(text: string, opts: ParseOptions = {}): ParseResult {
  const merged = new Map<string, DeckEntry>();
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const parsed = parseLine(raw, opts);
    if (!parsed) {
      if (raw.trim()) skipped++;
      return;
    }
    const key = [parsed.name.toLowerCase(), parsed.set ?? '', parsed.number ?? '', parsed.finish].join('|');
    const prev = merged.get(key);
    if (prev) {
      prev.count += parsed.count;
      prev.lines.push(i + 1);
    } else {
      merged.set(key, { ...parsed, lines: [i + 1], text: raw.trim() });
    }
  });
  const entries = [...merged.values()];
  return { entries, skipped, cards: entries.reduce((n, e) => n + e.count, 0) };
}

/** One line to an entry, or null for blank lines, headers and comments. */
export function parseLine(raw: string, opts: ParseOptions = {}): Omit<DeckEntry, 'lines' | 'text'> | null {
  let s = raw.replace(/ /g, ' ').trim();
  if (!s) return null;
  if (s.startsWith('//') || s.startsWith('#')) return null;
  // "SB: 2 Duress" is a card in a sideboard section; a bare "SB:" is a header.
  s = s.replace(/^(sb|sideboard|commander|maybeboard|companion)\s*:\s*/i, (m) => (s.length > m.length ? '' : m));
  if (HEADER.test(s)) return null;

  let finish: Finish = 'nonfoil';
  // Foil markers at the end: *F*, *E* (etched), (foil), (etched), a lone F.
  const markers: [RegExp, Finish][] = [
    [/\s*\*f\*\s*$/i, 'foil'],
    [/\s*\*e\*\s*$/i, 'etched'],
    [/\s*\((foil|f)\)\s*$/i, 'foil'],
    [/\s*\[(foil|f)\]\s*$/i, 'foil'],
    [/\s*\((etched|foil etched)\)\s*$/i, 'etched'],
    [/\s+(foil)\s*$/i, 'foil'],
    [/\s+F\s*$/, 'foil'],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [re, f] of markers) {
      if (re.test(s)) {
        s = s.replace(re, '');
        finish = f;
        changed = true;
      }
    }
  }

  // Count: leading "4", "4x", "4 x" or trailing "x4".
  let count = 1;
  const lead = s.match(/^(\d+)\s*x?\s+(.+)$/i);
  if (lead) {
    count = parseInt(lead[1], 10);
    s = lead[2];
  } else {
    const trail = s.match(/^(.+?)\s+x\s*(\d+)$/i);
    if (trail) {
      count = parseInt(trail[2], 10);
      s = trail[1];
    }
  }
  if (count <= 0) return null;

  let set: string | undefined;
  let number: string | undefined;
  // "(M11) 149", "[M11] 149", "(M11)", "[M11]"
  const bracket = s.match(/^(.+?)\s*[([]\s*([a-z0-9]{2,6})\s*[)\]]\s*([^\s()[\]]+)?\s*$/i);
  if (bracket) {
    s = bracket[1];
    set = bracket[2].toLowerCase();
    number = bracket[3];
  } else {
    // Bare "M11 149" at the end: only when the token is a known set code, or
    // (without a set list) looks like one and is followed by a number.
    const bare = s.match(/^(.+?)\s+([a-z0-9]{2,6})\s+([0-9][0-9a-z★†\-]*|[a-z]{1,4}-?[0-9]+[a-z]?)$/i);
    if (bare) {
      const code = bare[2];
      const known = opts.isSetCode ? opts.isSetCode(code) : /\d/.test(code) || code === code.toUpperCase();
      if (known) {
        s = bare[1];
        set = code.toLowerCase();
        number = bare[3];
      }
    }
  }

  const name = s.replace(/\s+/g, ' ').trim();
  if (!name || /^\d+$/.test(name)) return null;
  return { count, name, set, number, finish };
}

/** "A // B" faces; a plain name is one face. */
export function nameFaces(name: string): string[] {
  return name.split(/\s*\/\/\s*|\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
}
