// The card-name catalog (7-day cache) and set list (1-day cache), with name
// canonicalisation for decklist lines and fuse.js autocomplete (spec 5.1, 12.1).

import Fuse from 'fuse.js';
import { scryfall } from './client';
import { DAY, storedOrDownload } from './db';
import { fold } from '../query/text';
import { nameFaces } from '../io/decklist';

export interface SetInfo {
  code: string;
  name: string;
  released_at: string | null;
  set_type: string;
  digital: boolean;
}

let namesPromise: Promise<string[]> | null = null;
let setsPromise: Promise<Map<string, SetInfo>> | null = null;
let setsByCode: Map<string, SetInfo> | null = null;

export function loadNames(): Promise<string[]> {
  namesPromise ??= storedOrDownload('scryfall.names.v1', 7 * DAY, async () => {
    const data = await scryfall.getJson<{ data: string[] }>('/catalog/card-names');
    if (!data) throw new Error('No card names');
    return data.data;
  }).catch((err) => {
    namesPromise = null;
    throw err;
  });
  return namesPromise;
}

export function loadSets(): Promise<Map<string, SetInfo>> {
  setsPromise ??= storedOrDownload('scryfall.sets.v1', DAY, async () => {
    const data = await scryfall.getJson<{ data: SetInfo[] }>('/sets');
    if (!data) throw new Error('No sets');
    return data.data.map((s) => ({ code: s.code, name: s.name, released_at: s.released_at ?? null, set_type: s.set_type, digital: Boolean(s.digital) }));
  })
    .then((list) => {
      setsByCode = new Map(list.map((s) => [s.code.toLowerCase(), s]));
      return setsByCode;
    })
    .catch((err) => {
      setsPromise = null;
      throw err;
    });
  return setsPromise;
}

/** True if Scryfall knows this set code; undefined if the list hasn't loaded. */
export function isSetCode(code: string): boolean | undefined {
  return setsByCode ? setsByCode.has(code.toLowerCase()) : undefined;
}

export function setName(code: string): string | undefined {
  return setsByCode?.get(code.toLowerCase())?.name;
}

/** Name lookup over the catalog: exact (folded) match by full name or any face, and fuzzy suggestions. */
export class NameIndex {
  private readonly byFolded = new Map<string, string>();
  private readonly folded: { name: string; f: string }[];
  private fuse: Fuse<string> | null = null;

  constructor(readonly names: string[]) {
    this.folded = names.map((name) => ({ name, f: fold(name) }));
    for (const { name, f } of this.folded) this.byFolded.set(f, name);
    // Faces of multi-face cards map to the card (front face name first wins).
    for (const name of names) {
      const faces = nameFaces(name);
      if (faces.length < 2) continue;
      for (const face of faces) {
        const k = fold(face);
        if (!this.byFolded.has(k)) this.byFolded.set(k, name);
      }
    }
  }

  /** The catalog's spelling of a name typed in a list, or null. */
  canonical(name: string): string | null {
    return this.byFolded.get(fold(name)) ?? null;
  }

  /** Up to n suggestions: prefix matches, then word matches, then typo-tolerant ones. */
  suggest(query: string, n = 8): string[] {
    const q = fold(query);
    if (!q) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (s: string) => {
      if (!seen.has(s) && out.length < n) {
        seen.add(s);
        out.push(s);
      }
    };
    for (const { name, f } of this.folded) if (f.startsWith(q)) push(name);
    if (out.length < n) for (const { name, f } of this.folded) if (f.includes(` ${q}`) || f.includes(q)) push(name);
    if (out.length < n && q.length >= 3) {
      this.fuse ??= new Fuse(this.names, { threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2 });
      for (const r of this.fuse.search(query, { limit: n })) push(r.item);
    }
    return out;
  }
}

let indexPromise: Promise<NameIndex> | null = null;
export function nameIndex(): Promise<NameIndex> {
  indexPromise ??= loadNames().then((names) => new NameIndex(names)).catch((err) => {
    indexPromise = null;
    throw err;
  });
  return indexPromise;
}
