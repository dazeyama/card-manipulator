// Pile geometry and layouts (spec 10.6, 10.7, 11.1). Pure functions over
// plain positions, so they are tested without a browser.

import { CARD_H, CARD_T, CARD_W } from './types';

export interface Footprint {
  x: number;
  y: number;
  yaw: number;
}

export interface Placed extends Footprint {
  z: number;
}

const HALF_W = CARD_W / 2;
const HALF_H = CARD_H / 2;

/** True if two card rectangles overlap (separating axis test). `margin` shrinks both. */
export function overlaps(a: Footprint, b: Footprint, margin = 0): boolean {
  const hw = HALF_W - margin;
  const hh = HALF_H - margin;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Quick reject on the bounding circle.
  const r = 2 * Math.hypot(hw, hh);
  if (dx * dx + dy * dy > r * r) return false;
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const projA = extent(a.yaw, ax, ay, hw, hh);
    const projB = extent(b.yaw, ax, ay, hw, hh);
    const dist = Math.abs(dx * ax + dy * ay);
    if (dist >= projA + projB) return false;
  }
  return true;
}

function extent(yaw: number, ax: number, ay: number, hw: number, hh: number): number {
  const ux = Math.cos(yaw), uy = Math.sin(yaw);
  const vx = -uy, vy = ux;
  return hw * Math.abs(ux * ax + uy * ay) + hh * Math.abs(vx * ax + vy * ay);
}

/** Points across a card's face, in its own frame, for judging how much of it shows. */
const SHOW_COLS = 7;
const SHOW_ROWS = 9;
const SHOW_POINTS: [number, number][] = [];
for (let i = 0; i < SHOW_COLS; i++) {
  for (let j = 0; j < SHOW_ROWS; j++) {
    SHOW_POINTS.push([-HALF_W + (CARD_W * (i + 0.5)) / SHOW_COLS, -HALF_H + (CARD_H * (j + 0.5)) / SHOW_ROWS]);
  }
}

/**
 * The share of a card's face (0 to 1) that no card above it covers, seen from
 * above, sampled on a grid across the face (decision 101).
 */
export function visibleShare(card: Footprint, above: Footprint[]): number {
  if (!above.length) return 1;
  const cos = Math.cos(card.yaw), sin = Math.sin(card.yaw);
  // Each covering card's frame, once.
  const covers = above
    .filter((a) => overlaps(card, a))
    .map((a) => ({ x: a.x, y: a.y, cos: Math.cos(a.yaw), sin: Math.sin(a.yaw) }));
  if (!covers.length) return 1;
  let shown = 0;
  for (const [s, t] of SHOW_POINTS) {
    const px = card.x + s * cos - t * sin;
    const py = card.y + s * sin + t * cos;
    let hidden = false;
    for (const c of covers) {
      const dx = px - c.x, dy = py - c.y;
      if (Math.abs(dx * c.cos + dy * c.sin) <= HALF_W && Math.abs(-dx * c.sin + dy * c.cos) <= HALF_H) {
        hidden = true;
        break;
      }
    }
    if (!hidden) shown++;
  }
  return shown / SHOW_POINTS.length;
}

/** Height of the highest card top under a footprint, or 0 for bare table. */
export function surfaceTop(cards: Iterable<Placed>, at: Footprint): number {
  let top = 0;
  for (const c of cards) {
    if (overlaps(c, at, 1)) top = Math.max(top, c.z + CARD_T / 2);
  }
  return top;
}

/** A neat stack: every card squared up at one spot, one card thickness apart. */
export function stackLayout(count: number, at: Footprint, baseTop = 0): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) out.push({ x: at.x, y: at.y, yaw: at.yaw, z: baseTop + CARD_T / 2 + i * CARD_T });
  return out;
}

/** A small deterministic random generator so layouts are testable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** A messy pile: small random offsets and angles, each card above the last (spec 2). */
/** A loose stack (decision 94): each card up to this far off the centre, in mm... */
export const LOOSE_OFFSET = 9;
/** ...and turned up to this much either way, in radians (about 8 degrees). */
export const LOOSE_TURN = 0.14;

/**
 * A hand-made stack: every card roughly on the same spot, a little off centre
 * and a little turned, bottom card first. Tidy squares it up.
 */
export function looseStackLayout(count: number, at: Footprint, baseTop = 0, random: () => number = Math.random): Placed[] {
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    // Most cards sit near the middle; a few stray towards the edge.
    const r = LOOSE_OFFSET * random() ** 1.5;
    out.push({
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r,
      yaw: at.yaw + (random() * 2 - 1) * LOOSE_TURN,
      z: baseTop + CARD_T / 2 + i * CARD_T,
    });
  }
  return out;
}

export function messyLayout(count: number, at: Footprint, baseTop = 0, random: () => number = Math.random): Placed[] {
  const out: Placed[] = [];
  // Bigger piles spread a little wider, as a dropped handful does.
  const spread = Math.min(28, 8 + Math.sqrt(count) * 1.6);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = spread * Math.sqrt(random());
    out.push({
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r,
      yaw: at.yaw + (random() - 0.5) * 0.5,
      z: baseTop + CARD_T / 2 + i * CARD_T,
    });
  }
  return out;
}

/** Grid for a spread: rows of up to ten, top card first, to the right of the anchor (spec 10.6). */
export function spreadLayout(count: number, anchor: { x: number; y: number }, gap = 6): Placed[] {
  const cols = Math.min(10, count);
  const out: Placed[] = [];
  const startX = anchor.x + CARD_W + gap * 3;
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ x: startX + col * (CARD_W + gap), y: anchor.y - row * (CARD_H + gap), yaw: 0, z: CARD_T / 2 });
  }
  return out;
}

/** A grid centred on a point (the Spread command on a selection, spec 10.7). */
export function gridLayout(count: number, centre: { x: number; y: number }, gap = 6): Placed[] {
  const cols = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(count * 1.4))));
  const rows = Math.ceil(count / cols);
  const w = cols * CARD_W + (cols - 1) * gap;
  const h = rows * CARD_H + (rows - 1) * gap;
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      x: centre.x - w / 2 + CARD_W / 2 + col * (CARD_W + gap),
      y: centre.y + h / 2 - CARD_H / 2 - row * (CARD_H + gap),
      yaw: 0,
      z: CARD_T / 2,
    });
  }
  return out;
}

/**
 * The order to lay a spread's spots in (decision 215); each card laid lands on
 * top of those before it. Plain: as given, so each card covers the right side
 * of the one before and the names along the left show. Reversed: rows still
 * top to bottom, so each card's top shows, but right to left within a row, so
 * each card covers the left side of the one after it and the mana costs along
 * the right show, the first card whole at the far left.
 */
export function layOrder(spots: Placed[], reverse: boolean): number[] {
  const order = spots.map((_, i) => i);
  if (!reverse) return order;
  const row = (i: number) => Math.round(spots[i].y * 100);
  return order.sort((a, b) => row(b) - row(a) || spots[b].x - spots[a].x);
}

/**
 * A grid that fits inside a box on the table (decision 159), top card first,
 * left to right and rows top to bottom. With room to spare the cards keep the
 * usual gap, centred in the box; short of room they overlap evenly, so they
 * stay inside the box however small it is (cards don't shrink, so a box
 * narrower or shorter than one card holds them centred on it). Of the grid
 * shapes, the one that leaves the most of each card showing wins; among
 * shapes that show every card whole, the one closest to the box's shape.
 */
export function fitLayout(count: number, box: { minX: number; minY: number; maxX: number; maxY: number }, gap = 6): Placed[] {
  if (count < 1) return [];
  const w = Math.max(0, box.maxX - box.minX);
  const h = Math.max(0, box.maxY - box.minY);
  const pitchX = CARD_W + gap, pitchY = CARD_H + gap;
  const boxShape = Math.log(Math.max(1, w) / Math.max(1, h));
  let best = { cols: 1, rows: count, stepX: 0, stepY: 0, score: -1, shape: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const stepX = cols > 1 ? Math.min(pitchX, Math.max(0, (w - CARD_W) / (cols - 1))) : 0;
    const stepY = rows > 1 ? Math.min(pitchY, Math.max(0, (h - CARD_H) / (rows - 1))) : 0;
    // How much of each card the next one along leaves showing, across and down.
    const showX = cols > 1 ? Math.min(1, stepX / CARD_W) : 1;
    const showY = rows > 1 ? Math.min(1, stepY / CARD_H) : 1;
    const score = showX * showY;
    const shape = Math.abs(Math.log((cols * pitchX) / (rows * pitchY)) - boxShape);
    if (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && shape < best.shape)) {
      best = { cols, rows, stepX, stepY, score, shape };
    }
  }
  const { cols, rows, stepX, stepY } = best;
  const usedW = CARD_W + (cols - 1) * stepX;
  const usedH = CARD_H + (rows - 1) * stepY;
  const left = (box.minX + box.maxX) / 2 - usedW / 2 + CARD_W / 2;
  const top = (box.minY + box.maxY) / 2 + usedH / 2 - CARD_H / 2;
  const out: Placed[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: left + (i % cols) * stepX, y: top - Math.floor(i / cols) * stepY, yaw: 0, z: CARD_T / 2 });
  }
  return out;
}

// ---- detection (spec 11.1) ----

export interface PileCard extends Placed {
  uid: string;
}

export interface DetectedPile {
  id: string;
  kind: 'stack' | 'messy';
  /** Bottom to top. */
  cardUids: string[];
  anchor: { x: number; y: number };
  yaw: number;
  /** Height of the top card's upper face. */
  top: number;
  /** Named piles whose cards all ended up in this one (a merge). */
  merged: string[];
}

const STACK_TOLERANCE = 2;
const YAW_TOLERANCE = 0.02;

/** Two yaws describe the same squared-up rectangle (a card turned 180 degrees still squares up). */
export function sameYaw(a: number, b: number): boolean {
  const d = Math.abs((((a - b) % Math.PI) + Math.PI) % Math.PI);
  return d < YAW_TOLERANCE || Math.PI - d < YAW_TOLERANCE;
}

/** Cards whose footprints overlap, grouped transitively. */
function overlapGroups(cards: PileCard[]): PileCard[][] {
  const n = cards.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // Spatial hash on centres: overlapping cards are within 108 mm of each other.
  const CELL = 110;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  cards.forEach((c, i) => {
    const k = key(Math.floor(c.x / CELL), Math.floor(c.y / CELL));
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  });
  cards.forEach((c, i) => {
    const cx = Math.floor(c.x / CELL);
    const cy = Math.floor(c.y / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const ri = find(i);
          const rj = find(j);
          if (ri === rj) continue;
          if (overlaps(c, cards[j], 1)) parent[rj] = ri;
        }
      }
    }
  });

  const groups = new Map<number, PileCard[]>();
  cards.forEach((c, i) => {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(c);
  });
  return [...groups.values()];
}

/**
 * A group that holds a fenced pile (a named pile with a filter, decision 324)
 * split so the fenced pile takes only its own cards and the cards just put
 * down on it: cards that moved, or belonged to no pile, that touch a card it
 * already held. Nothing joins through another card that is joining, so a long
 * chain laid against it adds only its near end; and another pile's resting
 * cards never join, however much of it touches, so a bin set beside a big
 * pile leaves it whole. What is left is grouped again by overlap.
 */
function fence(group: PileCard[], fenced: Set<string>, oldOf: Map<string, string>, moved: Set<string>): PileCard[][] {
  const here = new Set<string>();
  for (const c of group) {
    const o = oldOf.get(c.uid);
    if (o && fenced.has(o)) here.add(o);
  }
  if (!here.size) return [group];
  const out: PileCard[][] = [];
  const taken = new Set<string>();
  for (const id of here) {
    const members = group.filter((c) => oldOf.get(c.uid) === id);
    for (const c of members) taken.add(c.uid);
    // Newcomers: what the user just put down, or loose cards that were in no pile.
    const candidates = group.filter((c) => !taken.has(c.uid) && (moved.has(c.uid) || !oldOf.has(c.uid)));
    const held = members.length;
    for (let i = 0; i < held; i++) {
      for (let j = candidates.length - 1; j >= 0; j--) {
        if (!overlaps(members[i], candidates[j], 1)) continue;
        taken.add(candidates[j].uid);
        members.push(candidates[j]);
        candidates.splice(j, 1);
      }
    }
    out.push(members);
  }
  out.push(...overlapGroups(group.filter((c) => !taken.has(c.uid))));
  return out;
}

/**
 * Group cards whose footprints overlap, transitively. Groups of two or more
 * are piles: a stack when every card shares the bottom card's centre within
 * 2 mm and its yaw, otherwise messy. `prev` maps old pile ids to their cards
 * so a pile keeps its id while it keeps most of its cards. Named piles keep
 * their id however many cards join or leave, down to a single card. A
 * `fenced` pile (a filtered one) never takes in another pile's resting cards
 * by touching them (decision 324).
 */
export function detectPiles(
  cards: PileCard[],
  prev: Map<string, string[]> = new Map(),
  makeId: () => string = defaultId,
  opts: { named?: Set<string>; moved?: Set<string>; fenced?: Set<string> } = {},
): DetectedPile[] {
  // Old pile of each card, to keep ids stable.
  const oldOf = new Map<string, string>();
  for (const [id, uids] of prev) for (const u of uids) oldOf.set(u, id);
  const named = opts.named ?? new Set<string>();
  const moved = opts.moved ?? new Set<string>();
  const fenced = opts.fenced ?? new Set<string>();
  const groups = overlapGroups(cards).flatMap((g) => (fenced.size ? fence(g, fenced, oldOf, moved) : [g]));

  interface Group {
    cards: PileCard[];
    votes: Map<string, { all: number; stayed: number }>;
  }
  const list: Group[] = [];
  for (const g of groups) {
    const votes = new Map<string, { all: number; stayed: number }>();
    for (const c of g) {
      const o = oldOf.get(c.uid);
      if (!o) continue;
      const v = votes.get(o) ?? { all: 0, stayed: 0 };
      v.all++;
      if (!moved.has(c.uid)) v.stayed++;
      votes.set(o, v);
    }
    // A lone card is not a pile, unless it is all that is left of a named pile.
    if (g.length < 2 && ![...votes.keys()].some((o) => named.has(o))) continue;
    list.push({ cards: g, votes });
  }

  // Hand out old ids, strongest claims first: named piles before emergent
  // ones, then the group holding the most cards that stayed put (the
  // receiving pile, spec 11.4), then the most cards overall.
  const claims: { group: Group; id: string; rank: number[] }[] = [];
  for (const group of list) {
    for (const [id, v] of group.votes) claims.push({ group, id, rank: [named.has(id) ? 1 : 0, v.stayed, v.all] });
  }
  claims.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2]);
  const idOf = new Map<Group, string>();
  const usedIds = new Set<string>();
  for (const c of claims) {
    if (idOf.has(c.group) || usedIds.has(c.id)) continue;
    // A single leftover card never takes an emergent pile's id.
    if (c.group.cards.length < 2 && !named.has(c.id)) continue;
    idOf.set(c.group, c.id);
    usedIds.add(c.id);
  }

  const out: DetectedPile[] = [];
  for (const group of list) {
    const g = group.cards;
    let id = idOf.get(group);
    if (!id) {
      if (g.length < 2) continue;
      id = makeId();
    }
    g.sort((a, b) => a.z - b.z);
    const bottom = g[0];
    const isStack = g.every((c) => Math.hypot(c.x - bottom.x, c.y - bottom.y) <= STACK_TOLERANCE && sameYaw(c.yaw, bottom.yaw));
    const anchor = isStack
      ? { x: bottom.x, y: bottom.y }
      : { x: g.reduce((s, c) => s + c.x, 0) / g.length, y: g.reduce((s, c) => s + c.y, 0) / g.length };
    // Named piles that were folded into this one (spec 11.4: the receiving name wins).
    const mergedNamed = [...group.votes.keys()].filter((o) => o !== id && named.has(o) && !usedIds.has(o));
    out.push({
      id,
      kind: isStack ? 'stack' : 'messy',
      cardUids: g.map((c) => c.uid),
      anchor,
      yaw: bottom.yaw,
      top: g[g.length - 1].z + CARD_T / 2,
      merged: mergedNamed,
    });
  }
  return out;
}

let pileCounter = 0;
function defaultId(): string {
  pileCounter++;
  return `p${Date.now().toString(36)}${pileCounter.toString(36)}`;
}

/**
 * R (decision 102): the next quarter turn clockwise seen from above, so a card
 * at an odd angle squares up to the quarter turn just past it.
 */
export function nextQuarterClockwise(yaw: number): number {
  const q = Math.PI / 2;
  return (Math.ceil(yaw / q - 1e-3) - 1) * q;
}

/** Double-tap R (decision 102): upright, the way the card reads from the default camera, by the shortest turn. */
export function uprightYaw(yaw: number, facing = 0): number {
  // Upright for whoever is looking: `facing` is a half turn in mirror mode (decision 268).
  return facing + Math.round((yaw - facing) / (2 * Math.PI)) * 2 * Math.PI;
}

/** A shuffled copy (Fisher-Yates): every order equally likely (decision 106). */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * How many cards a cut lifts off the top of a stack of `count` (decision 314):
 * 40 to 60 % of it, uneven at random but close to half, and always at least
 * one card left on each side. `r` is a random number in [0, 1).
 */
export function cutCount(count: number, r: number): number {
  if (count < 2) return 0;
  return Math.min(count - 1, Math.max(1, Math.round(count * (0.4 + 0.2 * r))));
}

/** Yaw snapped to the nearest quarter turn (tidy cards are 0 or +-90 degrees, spec 6.1). */
export function snapYaw(yaw: number): number {
  return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
}
