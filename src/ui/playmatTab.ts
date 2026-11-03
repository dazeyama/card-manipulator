// The playmat section of the Spawn panel's Accessories tab (decisions 144, 373): one decklist line, such as
// "Ragavan, Nimble Pilferer (MH2) 138", becomes a playmat with that exact
// printing's art. The art is Scryfall's art crop, the illustration alone.

import type { App } from '../app';
import { parseLine, type DeckEntry } from '../io/decklist';
import type { Mats } from '../mats';
import { scryfall } from '../scryfall/client';
import { resolveEntries } from '../scryfall/resolve';
import { h } from './dom';

interface ScryfallImages {
  art_crop?: string;
}
interface ScryfallCard {
  name: string;
  image_uris?: ScryfallImages;
  card_faces?: { image_uris?: ScryfallImages }[];
}

/** A card's art found from one decklist line: the printing and its art crop, or why not, said for the status line. */
export type FoundArt = { id: string; name: string; where: string; art: string } | { error: string };

/** The art crop of exactly the printing a line names (the front face of a double-faced card): playmats, and art sleeves (decision 360). */
export async function findArt(text: string): Promise<FoundArt> {
  const parsed = parseLine(text);
  if (!parsed) return { error: 'Type a card, with its set and number for an exact printing.' };
  try {
    const entry: DeckEntry = { ...parsed, count: 1, lines: [1], text };
    const { resolved } = await resolveEntries([entry]);
    const record = resolved[0]?.record;
    if (!record) return { error: `Couldn't find “${parsed.name}”${parsed.set ? ` in ${parsed.set.toUpperCase()}` : ''}.` };
    const card = await scryfall.getJson<ScryfallCard>(`/cards/${record.id}`);
    const art = card?.image_uris?.art_crop ?? card?.card_faces?.[0]?.image_uris?.art_crop;
    if (!art) return { error: `Scryfall has no art for ${record.name}.` };
    return { id: record.id, name: record.name, where: `${record.set.toUpperCase()} ${record.collector_number}`, art };
  } catch {
    return { error: 'Scryfall could not be reached. Try again in a moment.' };
  }
}

export function buildPlaymatTab(app: App, mats: Mats): HTMLElement {
  const line = h('input', { class: 'grow', placeholder: 'Ragavan, Nimble Pilferer (MH2) 138', spellcheck: 'false', 'aria-label': 'Card for the playmat' });
  const go = h('button', { class: 'btn primary' }, 'Spawn playmat');
  const status = h('div', { class: 'muted small' });

  const spawn = async () => {
    const text = line.value.trim();
    go.disabled = true;
    status.textContent = 'Finding the card…';
    try {
      const found = await findArt(text);
      if ('error' in found) {
        status.textContent = found.error;
        return;
      }
      mats.spawn(found.id, found.name, found.art, { x: app.rig.target.x, y: app.rig.target.y });
      status.textContent = `Spawned a ${found.name} playmat (${found.where}).`;
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void spawn());
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void spawn();
  });

  return h('div', {},
    h('div', { class: 'panel-section-title' }, 'Playmat'),
    h('div', { class: 'row' }, line),
    h('div', { class: 'row' }, go),
    h('p', { class: 'muted small' }, 'The card’s art on a 61 × 35 cm playmat, which always lies under the cards. Use set and number for an exact printing.'),
    status,
  );
}
