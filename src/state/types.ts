// The table model (spec Section 6). Distances are millimetres. The table is
// the plane z = 0; x runs right and y runs away from the default camera.

export const CARD_W = 63;
export const CARD_H = 88;
/** Rendered thickness of one card, and the height step between cards in a stack. */
export const CARD_T = 0.3;

export type Finish = 'nonfoil' | 'foil' | 'etched';

export interface Card {
  uid: string;
  scryfallId: string;
  finish: Finish;
  /** Centre of the card. z is the centre height above the table. */
  x: number;
  y: number;
  z: number;
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  faceUp: boolean;
  /** Detected pile, or the named pile this card belongs to. */
  pileId: string | null;
  /** Set while the card is part of a spread: the id of the stack it came from. */
  spreadOf: string | null;
  /**
   * Where an X spread laid the card (decision 160). While it stays there it lies
   * flat, even over other cards, instead of tipping to rest on them.
   */
  laidAt?: { x: number; y: number };
}

export type PileKind = 'stack' | 'messy';

export interface Pile {
  id: string;
  /** Non-null for a named pile. */
  name: string | null;
  kind: PileKind;
  anchor: { x: number; y: number };
  /** Bottom to top. */
  cardUids: string[];
  /** A named pile's own query. */
  filter: string | null;
}

/** A named pile's identity, kept even when every card has left it (decision 27). */
export interface NamedPile {
  id: string;
  name: string;
  filter: string | null;
  /** Last known footprint, so an empty named pile can draw its outline. */
  anchor: { x: number; y: number };
  yaw: number;
}

export interface CardFace {
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text: string;
  colors: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_small?: string;
  image_normal?: string;
}

/** The trimmed Scryfall record we keep (spec Section 5.3). */
export interface CardRecord {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  lang: string;
  layout: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  keywords: string[];
  produced_mana: string[];
  legalities: Record<string, string>;
  finishes: string[];
  prices: { usd: string | null; usd_foil: string | null };
  faces: CardFace[];
  image_small?: string;
  image_normal?: string;
  back_image_small?: string;
  back_image_normal?: string;
  fetched_at: number;
}

export type Arrival = 'messy' | 'stack';
export type FlickSetting = 'off' | 'normal' | 'sensitive';

export interface Settings {
  tidyDrops: boolean;
  arrival: Arrival;
  spawnFaceUp: boolean;
  spawnWhere: 'cursor' | 'center';
  queryCap: number;
  flick: FlickSetting;
  /** Decklist export includes set code and collector number. */
  exportWithSet: boolean;
  /** Curve view puts creatures and non-creatures in separate bands (decision 107). */
  curveSplit: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  tidyDrops: false,
  arrival: 'messy',
  spawnFaceUp: true,
  spawnWhere: 'center',
  queryCap: 500,
  flick: 'normal',
  exportWithSet: false,
  curveSplit: false,
};

export interface CameraState {
  target: [number, number, number];
  distance: number;
  /** Degrees from horizontal. */
  pitch: number;
  /** Degrees from the default view. */
  yaw: number;
}

/** Save format v1 (spec Section 6.3). */
/** A playmat (decision 144): a card's art on a 61 x 35 cm mat lying on the table, under every card. */
export interface Mat {
  uid: string;
  scryfallId: string;
  /** The card's name, for the hint and the mirror window's title. */
  name: string;
  /** Scryfall's art crop of that printing. */
  art: string;
  x: number;
  y: number;
  yaw: number;
  /** Locked in place (decision 154): not dragged, turned or removed until unlocked. */
  locked?: boolean;
}

export const MAT_W = 610;
export const MAT_H = 350;

export interface TableDoc {
  format: 'card-manipulator-table';
  version: 1;
  name: string;
  savedAt: string;
  settings: Partial<Settings>;
  camera: CameraState;
  piles: { id: string; name: string; filter: string | null; anchor?: { x: number; y: number }; yaw?: number }[];
  cards: {
    uid: string;
    scryfallId: string;
    finish: Finish;
    x: number;
    y: number;
    z: number;
    yaw: number;
    faceUp: boolean;
    pileId: string | null;
    spreadOf?: string | null;
  }[];
  /** Open spreads (agent decision 61); older files have none. */
  spreads?: { id: string; anchor: { x: number; y: number }; yaw: number; uids: string[]; pileId: string | null }[];
  cardData: Record<string, CardRecord>;
  /** Playmats (decision 144); older files have none. */
  mats?: Mat[];
}
