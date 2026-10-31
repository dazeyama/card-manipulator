// Ties card records to atlas slots: a placeholder with the card's name at
// once, the real `small` image when it arrives (spec 8.2).

import type { Store } from '../state/store';
import type { Card, CardRecord } from '../state/types';
import { Atlas, BACK_KEY, IMG_H, IMG_W, drawPlaceholder, type Slot } from './atlas';
import type { CardLayer } from './cards';
import { ImageLoader } from './images';
import { HIDDEN } from '../../shared/table';

export class CardImages {
  readonly loader = new ImageLoader(IMG_W, IMG_H);
  private readonly requested = new Set<string>();
  /** Image keys still waiting for their image. */
  private readonly waiting = new Set<string>();

  constructor(private readonly atlas: Atlas, private readonly layer: CardLayer, private readonly store: Store) {
    store.events.on('records', (ids) => this.refreshCards(new Set(ids)));
  }

  /** Load Scryfall's card back into slot 0 (spec 5.4). */
  async loadBack(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}card-back.jpg`);
      const bmp = await createImageBitmap(await res.blob(), { resizeWidth: IMG_W, resizeHeight: IMG_H, resizeQuality: 'high' });
      this.atlas.draw(this.atlas.get(BACK_KEY)!, bmp);
      bmp.close();
    } catch (err) {
      console.warn('Card back failed to load; using the stand-in', err);
    }
  }

  get pending(): number {
    return this.waiting.size;
  }

  /**
   * May this card's face be drawn (rooms, ONLINE.md 7.3)? Set by
   * src/online/hidden.ts; a card it refuses shows the Magic back on both faces.
   */
  gate: ((card: Card) => boolean) | null = null;

  slotsFor(card: Card): { front: Slot; back: Slot } {
    if (card.scryfallId === HIDDEN || (this.gate && !this.gate(card))) {
      const back = this.atlas.get(BACK_KEY)!;
      return { front: back, back };
    }
    const r = this.store.records.get(card.scryfallId);
    if (!r) {
      const key = `missing:${card.scryfallId}`;
      let front = this.atlas.get(key);
      if (!front) {
        front = this.atlas.allocate(key);
        this.atlas.draw(front, drawPlaceholder('…', 'loading card data'));
      }
      return { front, back: this.atlas.get(BACK_KEY)! };
    }
    const front = this.slot(r.image_small, r, r.faces[0]?.name ?? r.name);
    const back = r.back_image_small ? this.slot(r.back_image_small, r, r.faces[1]?.name ?? r.name) : this.atlas.get(BACK_KEY)!;
    return { front, back };
  }

  private slot(url: string | undefined, r: CardRecord, label: string): Slot {
    const key = url ?? `noimg:${r.id}:${label}`;
    let slot = this.atlas.get(key);
    if (slot) return slot;
    slot = this.atlas.allocate(key);
    this.atlas.draw(slot, drawPlaceholder(label, `${r.set.toUpperCase()} ${r.collector_number}`));
    if (url && !this.requested.has(url)) {
      this.requested.add(url);
      this.waiting.add(url);
      const s = slot;
      this.loader
        .load(url)
        .then((bmp) => {
          this.atlas.draw(s, bmp);
          bmp.close();
        })
        .catch((err) => console.warn(String(err)))
        .finally(() => this.waiting.delete(url));
    }
    return slot;
  }

  /** Cards whose records just arrived get their real slots. */
  private refreshCards(ids: Set<string>): void {
    for (const card of this.store.cards.values()) {
      if (!ids.has(card.scryfallId) || !this.layer.has(card.uid)) continue;
      const { front, back } = this.slotsFor(card);
      this.layer.setSlots(card.uid, front, back);
    }
  }
}
