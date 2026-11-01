// The radial menu on Space (decision 298, RADIAL.md): what is on it, and which
// wedge or outer-ring item a point is over. Pure, so it is tested; the overlay
// that draws it and the Space key live in src/ui/radialMenu.ts.

/**
 * One thing the menu can do: the key presses it stands for, in order (S S is a
 * shuffle). The bottom bar shows every item too (decision 302), with its own
 * icon and `title`, what it does, on hover.
 */
export type RadialItem = { label: string; key: string; presses: string[]; icon: string; title: string };

/** One wedge of the inner ring. Its first item is what letting go on it does; with more, they are its outer ring. */
export type RadialWedge = { label: string; icon: string; cards: boolean; items: RadialItem[] };

/** Clockwise from the top. `cards`: needs a selection or a pile under the cursor. */
export const RADIAL_MENU: RadialWedge[] = [
  { label: 'Stack', icon: '📚', cards: true, items: [
    { label: 'Stack', key: 'S', presses: ['s'], icon: '📚', title: 'Gather into one stack; neat in Tidy mode' },
    { label: 'Shuffle', key: 'S S', presses: ['s', 's'], icon: '🔀', title: 'Stack and shuffle' },
    { label: 'Tidy', key: 'T', presses: ['t'], icon: '🧹', title: 'Square up each pile' },
  ] },
  { label: 'Flip', icon: '🃏', cards: true, items: [
    { label: 'Flip', key: 'F', presses: ['f'], icon: '🃏', title: 'Flip over' },
    { label: 'Face all up', key: 'F F', presses: ['f', 'f'], icon: '👁️', title: 'Turn every card face up' },
  ] },
  { label: 'Turn', icon: '🔃', cards: true, items: [
    { label: 'Turn 90°', key: 'R', presses: ['r'], icon: '🔃', title: 'Turn 90°, to tap' },
    { label: 'Upright', key: 'R R', presses: ['r', 'r'], icon: '⬆️', title: 'Stand upright again' },
  ] },
  { label: 'Spread', icon: '🪟', cards: true, items: [
    { label: 'Spread', key: 'X', presses: ['x'], icon: '🪟', title: 'Spread out: then click the table, or drag a box to fit it inside' },
    { label: 'Reverse', key: 'X X', presses: ['x', 'x'], icon: '🔁', title: 'Spread in reverse order: then click the table, or drag a box' },
  ] },
  { label: 'Hand', icon: '🎴', cards: true, items: [
    { label: 'Fan as hand', key: 'H', presses: ['h'], icon: '🎴', title: 'Fan like a hand of cards; again stacks it back up' },
    { label: 'Full size', key: 'H H', presses: ['h', 'h'], icon: '🖼️', title: 'On a stand: the hand at its usual size, not the slope’s width' },
  ] },
  { label: 'Sort', icon: '📊', cards: true, items: [
    { label: 'Curve', key: 'C', presses: ['c'], icon: '📊', title: 'Curve out by mana value; again stacks it back up' },
    { label: 'Colour columns', key: 'C C', presses: ['c', 'c'], icon: '🎨', title: 'A column per colour, W U B R G, colourless, multicolour, lands' },
    { label: 'Curve per colour', key: 'Shift C', presses: ['shift+c'], icon: '🌈', title: 'Curve everything out in a row per colour, in the middle of the view' },
    { label: 'EDHREC', key: 'E', presses: ['e'], icon: '🏆', title: 'Columns by EDHREC rank; again stacks it back up' },
    { label: 'Elo', key: 'E E', presses: ['e', 'e'], icon: '📈', title: 'Columns by CubeCobra Elo' },
  ] },
  // A count, then click where the hand goes, as the keys do; N asks how many (decision 300).
  { label: 'Draw', icon: '🖐️', cards: true, items: [
    { label: '1 card', key: '1', presses: ['1'], icon: '1️⃣', title: 'Draw 1 card: then click where it goes' },
    { label: '7 cards', key: '7', presses: ['7'], icon: '7️⃣', title: 'Draw 7 cards: then click where the hand goes' },
    { label: 'N cards', key: '0', presses: ['0'], icon: '🔢', title: 'Draw any number: type how many, then click' },
  ] },
  // One-step undo: Ctrl + Z again is the redo, so a Redo item would do the same (decision 298).
  { label: 'Undo', icon: '↩️', cards: false, items: [{ label: 'Undo', key: 'Ctrl Z', presses: ['ctrl+z'], icon: '↩️', title: 'Undo the last change; again redoes it' }] },
];

/** Radii in CSS pixels at medium cursor size: the hole in the middle, the inner ring, the outer ring. */
export type RadialGeometry = { hole: number; innerFrom: number; inner: number; outerFrom: number; outer: number };

export const BASE_GEOMETRY: RadialGeometry = { hole: 36, innerFrom: 40, inner: 116, outerFrom: 122, outer: 192 };

/** The geometry at a scale (the cursor size setting). */
export function scaledGeometry(s: number): RadialGeometry {
  const g = BASE_GEOMETRY;
  return { hole: g.hole * s, innerFrom: g.innerFrom * s, inner: g.inner * s, outerFrom: g.outerFrom * s, outer: g.outer * s };
}

const TAU = Math.PI * 2;

/** The angle of a screen offset (y down): 0 straight up, growing clockwise, in [0, 2π). */
export function angleOf(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + TAU : a;
}

/** Which of `count` wedges an angle falls in; wedge 0 is centred straight up. */
export function wedgeAt(angle: number, count: number): number {
  const step = TAU / count;
  return Math.floor((((angle + step / 2) % TAU) + TAU) % TAU / step) % count;
}

/** The angle each outer-ring item takes: up to 32°, narrower when there are many. */
export function itemSpan(n: number): number {
  return Math.min(0.56, 2.9 / n);
}

/** Where wedge `w`'s outer ring of `n` items starts, as an angle; it is centred on the wedge. */
export function outerStart(w: number, count: number, n: number): number {
  return w * (TAU / count) - (itemSpan(n) * n) / 2;
}

/** Which of wedge `w`'s `n` outer items an angle is over, or -1 outside its arc. */
export function itemAt(angle: number, w: number, count: number, n: number): number {
  const rel = (((angle - outerStart(w, count, n)) % TAU) + TAU) % TAU;
  const i = Math.floor(rel / itemSpan(n));
  return i < n ? i : -1;
}

/** What the pointer is over: a wedge (or -1), and an item of its outer ring (or -1 for the wedge itself). */
export type RadialPick = { wedge: number; item: number };

export const NO_PICK: RadialPick = { wedge: -1, item: -1 };

/**
 * What an offset from the centre points at. Inside the hole: nothing. On the
 * inner ring: the wedge by angle. Past it: the outer item under the pointer,
 * keeping the wedge you came through while you stay over its outer ring (that
 * ring is wider than the wedge), and with no ring, the wedge itself. There is
 * no outer limit, so a flick that overshoots still counts.
 */
export function pick(menu: RadialWedge[], dx: number, dy: number, g: RadialGeometry, prev: RadialPick = NO_PICK): RadialPick {
  const r = Math.hypot(dx, dy);
  if (r < g.hole) return NO_PICK;
  const a = angleOf(dx, dy);
  const w = wedgeAt(a, menu.length);
  if (r <= g.inner) return { wedge: w, item: -1 };
  for (const c of [prev.wedge, w]) {
    const n = c >= 0 ? menu[c].items.length : 0;
    if (n < 2) continue;
    const item = itemAt(a, c, menu.length, n);
    if (item >= 0) return { wedge: c, item };
  }
  return { wedge: w, item: -1 };
}

/** The item a pick stands for: the outer item, or the wedge's first. */
export function itemOf(menu: RadialWedge[], p: RadialPick): RadialItem | null {
  if (p.wedge < 0) return null;
  const items = menu[p.wedge].items;
  return items[p.item >= 0 ? p.item : 0] ?? null;
}

/** A Space press shorter than this, never leaving the hole, leaves the menu open to click. */
export const TAP_MS = 250;

/**
 * Letting go of Space: pick what is under the pointer once it has left the
 * hole; a quick tap that never left it keeps the menu open for a click; a long
 * hold in the middle cancels.
 */
export function onRelease(leftHole: boolean, heldMs: number): 'pick' | 'stay' | 'cancel' {
  if (leftHole) return 'pick';
  return heldMs < TAP_MS ? 'stay' : 'cancel';
}
