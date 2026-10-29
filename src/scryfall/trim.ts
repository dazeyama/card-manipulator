// Scryfall's card object and the trimmed record the tool keeps (spec 5.3).
// Pure, so scripts run by Node can use it too.

import type { CardFace, CardRecord } from '../state/types';

/** Scryfall's card object, only the parts we read. */
export interface ScryfallCard {
  object: string;
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  lang: string;
  layout: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  keywords?: string[];
  produced_mana?: string[];
  legalities?: Record<string, string>;
  finishes?: string[];
  prices?: { usd?: string | null; usd_foil?: string | null };
  edhrec_rank?: number;
  image_uris?: { small?: string; normal?: string };
  card_faces?: {
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    loyalty?: string;
    oracle_id?: string;
    image_uris?: { small?: string; normal?: string };
  }[];
}

const FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander', 'oathbreaker', 'brawl', 'historic', 'timeless', 'premodern', 'penny', 'duel', 'oldschool', 'predh'];

/** Trim Scryfall's card to the record the tool keeps. */
export function trimCard(c: ScryfallCard, now = Date.now()): CardRecord {
  const faces: CardFace[] = (c.card_faces ?? []).map((f) => ({
    name: f.name,
    mana_cost: f.mana_cost ?? '',
    type_line: f.type_line ?? '',
    oracle_text: f.oracle_text ?? '',
    colors: f.colors ?? c.colors ?? [],
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    image_small: f.image_uris?.small,
    image_normal: f.image_uris?.normal,
  }));
  const legalities: Record<string, string> = {};
  for (const f of FORMATS) {
    const v = c.legalities?.[f];
    if (v === 'legal' || v === 'restricted') legalities[f] = v;
  }
  // Double-faced cards keep their images per face; split and adventure cards share one image.
  const faceImages = faces.length > 1 && faces[0].image_small;
  const colors = c.colors ?? [...new Set(faces.flatMap((f) => f.colors))];
  return {
    id: c.id,
    oracle_id: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? c.id,
    name: c.name,
    set: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    rarity: c.rarity,
    lang: c.lang,
    layout: c.layout,
    mana_cost: c.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    cmc: c.cmc ?? 0,
    type_line: c.type_line ?? faces.map((f) => f.type_line).join(' // '),
    oracle_text: c.oracle_text ?? faces.map((f) => f.oracle_text).join('\n//\n'),
    colors,
    color_identity: c.color_identity ?? [],
    power: c.power ?? faces[0]?.power,
    toughness: c.toughness ?? faces[0]?.toughness,
    loyalty: c.loyalty ?? faces[0]?.loyalty,
    keywords: c.keywords ?? [],
    produced_mana: c.produced_mana ?? [],
    legalities,
    finishes: c.finishes ?? ['nonfoil'],
    prices: { usd: c.prices?.usd ?? null, usd_foil: c.prices?.usd_foil ?? null },
    edhrec_rank: c.edhrec_rank ?? null,
    faces,
    image_small: faceImages ? faces[0].image_small : c.image_uris?.small,
    image_normal: faceImages ? faces[0].image_normal : c.image_uris?.normal,
    back_image_small: faceImages ? faces[1].image_small : undefined,
    back_image_normal: faceImages ? faces[1].image_normal : undefined,
    fetched_at: now,
  };
}

/** True if the card has a printed back face of its own (spec 9.4 is:dfc). */
export function isDfc(r: CardRecord): boolean {
  return Boolean(r.back_image_small);
}
