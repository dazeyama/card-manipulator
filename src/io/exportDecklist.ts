// Decklist export (spec 14.1). Pure: groups of cards to text.

import type { Finish } from '../state/types';

export interface ExportCard {
  name: string;
  set: string;
  number: string;
  finish: Finish;
}

export interface ExportGroup {
  /** A pile's name, written as a header line when more than one group is exported. */
  title: string | null;
  cards: ExportCard[];
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function finishMark(f: Finish): string {
  return f === 'foil' ? ' *F*' : f === 'etched' ? ' *E*' : '';
}

/** One group's lines: identical cards merged with a count, A to Z. */
export function groupLines(cards: ExportCard[], withSet: boolean): string[] {
  const counts = new Map<string, { card: ExportCard; n: number }>();
  for (const c of cards) {
    const key = withSet ? `${c.name}|${c.set}|${c.number}|${c.finish}` : `${c.name}|${c.finish}`;
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { card: c, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => collator.compare(a.card.name, b.card.name) || collator.compare(a.card.set, b.card.set) || collator.compare(a.card.number, b.card.number))
    .map(({ card, n }) => `${n} ${card.name}${withSet ? ` (${card.set.toUpperCase()}) ${card.number}` : ''}${finishMark(card.finish)}`);
}

/**
 * The decklist for some groups. A single group is plain lines; several
 * groups each get a `// Name` header line, which this tool's parser and
 * Moxfield both read as a comment.
 */
export function decklistText(groups: ExportGroup[], withSet: boolean): string {
  const nonEmpty = groups.filter((g) => g.cards.length);
  if (nonEmpty.length === 1) return groupLines(nonEmpty[0].cards, withSet).join('\n') + '\n';
  return nonEmpty
    .map((g, i) => [`// ${g.title ?? `Pile ${i + 1}`}`, ...groupLines(g.cards, withSet)].join('\n'))
    .join('\n\n') + '\n';
}
