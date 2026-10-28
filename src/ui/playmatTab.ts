// The Spawn panel's Playmat tab (decision 144): one decklist line, such as
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

export function buildPlaymatTab(app: App, mats: Mats): HTMLElement {
  const line = h('input', { class: 'grow', placeholder: 'Ragavan, Nimble Pilferer (MH2) 138', spellcheck: 'false', 'aria-label': 'Card for the playmat' });
  const go = h('button', { class: 'btn primary' }, 'Spawn playmat');
  const status = h('div', { class: 'muted small' });

  const spawn = async () => {
    const text = line.value.trim();
    const parsed = parseLine(text);
    if (!parsed) {
      status.textContent = 'Type a card, with its set and number for an exact printing.';
      return;
    }
    go.disabled = true;
    status.textContent = 'Finding the card…';
    try {
      const entry: DeckEntry = { ...parsed, count: 1, lines: [1], text };
      const { resolved } = await resolveEntries([entry]);
      const record = resolved[0]?.record;
      if (!record) {
        status.textContent = `Couldn't find “${parsed.name}”${parsed.set ? ` in ${parsed.set.toUpperCase()}` : ''}.`;
        return;
      }
      // The art crop of exactly that printing (the front face of a double-faced card).
      const card = await scryfall.getJson<ScryfallCard>(`/cards/${record.id}`);
      const art = card?.image_uris?.art_crop ?? card?.card_faces?.[0]?.image_uris?.art_crop;
      if (!art) {
        status.textContent = `Scryfall has no art for ${record.name}.`;
        return;
      }
      mats.spawn(record.id, record.name, art, { x: app.rig.target.x, y: app.rig.target.y });
      status.textContent = `Spawned a ${record.name} playmat (${record.set.toUpperCase()} ${record.collector_number}).`;
    } catch {
      status.textContent = 'Scryfall could not be reached. Try again in a moment.';
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => void spawn());
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void spawn();
  });

  return h('div', {},
    h('div', { class: 'row' }, line),
    h('div', { class: 'row' }, go),
    h('p', { class: 'muted small' }, 'The card’s art on a 61 × 35 cm playmat, which always lies under the cards. Use set and number for an exact printing.'),
    status,
  );
}
