// Basic lands on the Card tab (decision 210): which printing each of the five
// basics spawns, kept with the table, and the line and filter the Choose basics
// dialog uses. Pure, tested without a browser.

export const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;
export type BasicName = (typeof BASIC_NAMES)[number];

/** The pip colour class for each basic's chip, as on the HUD. */
export const BASIC_PIP: Record<BasicName, string> = { Plains: 'pip-w', Island: 'pip-u', Swamp: 'pip-b', Mountain: 'pip-r', Forest: 'pip-g' };

/** One basic's printing. `name` can be the snow-covered one, such as "Snow-Covered Island". */
export interface BasicChoice {
  name: string;
  set: string;
  number: string;
  foil: boolean;
}

export type Basics = Record<BasicName, BasicChoice>;

/** Until a table chooses its own: the original Zendikar full-art basics, the first art of each. */
export function defaultBasics(): Basics {
  return {
    Plains: { name: 'Plains', set: 'zen', number: '230', foil: false },
    Island: { name: 'Island', set: 'zen', number: '234', foil: false },
    Swamp: { name: 'Swamp', set: 'zen', number: '238', foil: false },
    Mountain: { name: 'Mountain', set: 'zen', number: '242', foil: false },
    Forest: { name: 'Forest', set: 'zen', number: '246', foil: false },
  };
}

/** A table file's basics, with anything missing or malformed taken from the defaults. */
export function readBasics(raw: unknown): Basics {
  const out = defaultBasics();
  if (!raw || typeof raw !== 'object') return out;
  for (const b of BASIC_NAMES) {
    const c = (raw as Record<string, Partial<BasicChoice> | undefined>)[b];
    if (c && typeof c.name === 'string' && typeof c.set === 'string' && typeof c.number === 'string' && isBasicName(b, c.name)) {
      out[b] = { name: c.name, set: c.set.toLowerCase(), number: c.number, foil: !!c.foil };
    }
  }
  return out;
}

/** True if a card name is this basic: "Island" or "Snow-Covered Island". */
export function isBasicName(basic: BasicName, name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === basic.toLowerCase() || n === `snow-covered ${basic.toLowerCase()}`;
}

/** The Moxfield-style line for a printing: "Plains (ZEN) 230". */
export function basicLine(c: { name: string; set: string; number: string }): string {
  return `${c.name} (${c.set.toUpperCase()}) ${c.number}`;
}

/** A printing in the dialog's list. */
export interface Printing {
  name: string;
  set: string;
  setName: string;
  number: string;
  foil: boolean;
}

/**
 * The printings matching what is typed: every word must appear in the line or
 * the set's name, so "zen 23" or "alpha" or "snow kald" all narrow the list.
 * The line that is already chosen, typed in full, shows everything.
 */
export function filterPrintings(list: Printing[], typed: string, chosen?: string): Printing[] {
  const q = typed.trim().toLowerCase();
  if (!q || (chosen && q === chosen.toLowerCase())) return list;
  const words = q.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    const hay = `${basicLine(p)} ${p.setName}`.toLowerCase().replace(/[()]/g, ' ');
    return words.every((w) => hay.includes(w));
  });
}
