// Custom cursors that say what the mouse will do (decisions 116, 118-123).
// Over empty table, a pointy arrow with a dashed marquee box, hand-drawn at
// the gloves' size and style (cursorArrow.ts); over cards, cartoon white
// gloves: an open hand over a card, a fist while holding cards. An emoji in the corner shows what a
// held key adds: a magnet while Shift sweeps, numbers while Alt shows counts,
// a chain link for a formation drag, an arrow with a drawn plus or minus for marquee
// add and take (decision 168), a
// set square while Ctrl holds Tidy mode on, a tick once Ctrl + clicks are checking
// cards in and out (decision 170), and the pointing glove on anything clickable, books for a whole pile, arrows to pan and orbit.
// The glove art is made by devtools/makeCursors.ts; the emoji is drawn onto it
// here with a canvas, so it uses the system's emoji font.

import type { App, Gesture } from '../app';
import type { DragController } from '../physics/feel';
import type { MouseInput } from '../input/mouse';
import { ARROW_COUNT_URL, ARROW_MINUS_URL, ARROW_PLUS_URL, ARROW_TIP, ARROW_URL } from './cursorArrow';
import pointUrl from '../../art/cursors/point-48-bold.png';
import openUrl from '../../art/cursors/open-48-bold.png';
import fistUrl from '../../art/cursors/fist-48-bold.png';
import holdOneUrl from '../../art/cursors/gestures/holdOne-48-bold.png';
import shuffleUrl from '../../art/cursors/gestures/shuffle-72-bold.png';
import tidyUrl from '../../art/cursors/gestures/tidy-48-bold.png';
import flipUrl from '../../art/cursors/gestures/flip-48-bold.png';
import rotateUrl from '../../art/cursors/gestures/rotate-48-bold.png';
import drawUrl from '../../art/cursors/gestures/draw-48-bold.png';
import removeUrl from '../../art/cursors/gestures/remove-48-bold.png';
import fanUrl from '../../art/cursors/gestures/fan-48-bold.png';
import hotspots from '../../art/cursors/cursors.json';
import { CURSOR_PX, CURSOR_SIZE_EVENT, cursorSizeNow, scaleHotspot } from './cursorSize';

/** The size the art is drawn at; each finished cursor is then scaled to the chosen size (decision 289). */
const SIZE = 48;
const VERSION = '48-bold';

type Hand = 'arrow' | 'arrowPlus' | 'arrowMinus' | 'arrowCount' | 'open' | 'fist' | 'holdOne';
// holdOne: the glove holding up one card, while a single card is dragged (decision 164).
// arrowPlus, arrowMinus: the arrow with a drawn plus or minus sign instead of the marquee (decision 168);
// arrowCount: with a drawn numbers keycap, for Alt (decision 169).
const ART: Record<Hand, string> = { arrow: ARROW_URL, arrowPlus: ARROW_PLUS_URL, arrowMinus: ARROW_MINUS_URL, arrowCount: ARROW_COUNT_URL, open: openUrl, fist: fistUrl, holdOne: holdOneUrl };

/** Each action's gesture glove and its badge, shown for a moment after the key (decision 164). */
const GESTURES: Record<Gesture, [string, string]> = {
  shuffle: [shuffleUrl, ''],
  tidy: [tidyUrl, ''],
  flip: [flipUrl, ''],
  rotate: [rotateUrl, ''],
  draw: [drawUrl, ''],
  remove: [removeUrl, '❌'],
  fan: [fanUrl, ''],
};
/** How long a gesture shows, ms; one waiting for cards to settle shows at most GESTURE_MAX_MS. */
const GESTURE_MS = 500;
const GESTURE_MAX_MS = 3000;

/** Every cursor: its glove, its emoji (if any), and the browser cursor used until the art loads. */
const STATES = {
  arrow: ['arrow', '', 'default'],
  arrowAdd: ['arrowPlus', '', 'copy'],
  arrowSub: ['arrowMinus', '', 'default'],
  arrowCounts: ['arrowCount', '', 'default'],
  open: ['open', '', 'grab'],
  openSweep: ['open', '🧲', 'grab'],
  // Alt over a card or a mat: the chain link, as the drag will be linked; numbers are for empty table (decision 171).
  openFormation: ['open', '🔗', 'grab'],
  openTidy: ['open', '📐', 'grab'],
  openToggle: ['open', '☑️', 'pointer'],
  openPile: ['open', '📚', 'grab'],
  fist: ['fist', '', 'grabbing'],
  fistSweep: ['fist', '🧲', 'grabbing'],
  fistFormation: ['fist', '🔗', 'grabbing'],
  fistTidy: ['fist', '📐', 'grabbing'],
  holdOne: ['holdOne', '', 'grabbing'],
  holdOneTidy: ['holdOne', '📐', 'grabbing'],
  pan: ['open', '↔️', 'move'],
  orbit: ['fist', '🔄', 'all-scroll'],
} satisfies Record<string, [Hand, string, string]>;
type State = keyof typeof STATES;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Emoji take up to this share of the cursor's width and height. */
const EMOJI_SHARE = 0.48;
/** Gaps between the emoji's outline and the image's right and bottom edges, px. */
const EMOJI_RIGHT = 2;
const EMOJI_BOTTOM = 0;

/**
 * Draw an emoji in the bottom right corner of a square cursor image, placed by
 * its measured outline so no part of it is cut off (decisions 124, 127). Emoji fonts
 * draw some glyphs below the text baseline, so the font's nominal box isn't
 * enough; a glyph too big for its corner is drawn smaller.
 */
/** The X spread's 🪟 tints: blue, and pink in the reverse spread, matching the laser preview (decision 216). */
const SPREAD_TINT = 'rgba(40, 140, 255, 0.55)';
const REVERSE_TINT = 'rgba(255, 60, 170, 0.55)';

function drawEmoji(g: CanvasRenderingContext2D, emoji: string, size: number): void {
  let px = Math.round(size * EMOJI_SHARE);
  const font = (n: number) => `${n}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.font = font(px);
  let m = g.measureText(emoji);
  const box = size * EMOJI_SHARE + 2;
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (w > box || h > box) {
    px = Math.floor(px * Math.min(box / w, box / h));
    g.font = font(px);
    m = g.measureText(emoji);
  }
  // Two pixels in from the right edge and down to the bottom edge, so it lines up with the arrow's marquee box (decision 127).
  g.fillText(emoji, size - EMOJI_RIGHT - m.actualBoundingBoxRight, size - EMOJI_BOTTOM - m.actualBoundingBoxDescent);
}

/** An emoji in the bottom right corner of its own canvas, tinted a colour (the X spread's 🪟, decision 216). */
function tintedEmoji(emoji: string, tint: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  drawEmoji(g, emoji, SIZE);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.fillRect(0, 0, SIZE, SIZE);
  return c;
}

/**
 * A finished cursor image as a CSS cursor value, scaled from the 48 px art to
 * `px` (a gesture image of another size scales by the same share), its click
 * point moved with it (decision 289).
 */
function cursorValue(c: HTMLCanvasElement, hx: number, hy: number, fallback: string, px: number): string {
  if (px === SIZE) return `url(${c.toDataURL()}) ${hx} ${hy}, ${fallback}`;
  const side = Math.max(1, Math.round((c.width * px) / SIZE));
  const out = document.createElement('canvas');
  out.width = out.height = side;
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, side, side);
  return `url(${out.toDataURL()}) ${scaleHotspot(hx, c.width, side)} ${scaleHotspot(hy, c.width, side)}, ${fallback}`;
}

/** The glove with its emoji in the bottom right corner, as a CSS cursor value. */
function compose(img: HTMLImageElement, hand: Hand, emoji: string, fallback: string, px: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  if (emoji) drawEmoji(g, emoji, SIZE);
  // The gesture gloves hold their click point in the middle, like the open hand and the fist.
  const [hx, hy] = hand === 'open' || hand === 'fist' ? (hotspots[hand][VERSION] as [number, number]) : hand === 'holdOne' ? [SIZE / 2, SIZE / 2] : ARROW_TIP;
  return cursorValue(c, hx, hy, fallback, px);
}

/** Picks the cursor every frame from what is under the mouse, what is held and which keys are down. */
export class Cursors {
  private shift = false;
  private alt = false;
  private ctrl = false;
  private shown = '';
  /** The finished cursors, once the glove art has loaded. */
  private cursors: Partial<Record<State, string>> = {};
  /** Pointing gloves with a number, while a hand is being drawn (index = how many). */
  private readonly drawCursors: string[] = [];
  /** The pointing glove with a window pane, while picking where to spread (decision 159). */
  private spreadCursor = '';
  /** The reverse spread: the same glove mirrored, pointing the other way (decisions 215, 216). */
  private reverseCursor = '';
  /** The plain pointing glove, for pointer mode (decision 189). */
  private pointCursor = '';
  /** P P: the pointing glove with a 📦, the cards going down face down like a pack (decision 226). */
  private packCursor = '';
  private gestureCursors: Partial<Record<Gesture, string>> = {};

  constructor(private readonly app: App, private readonly mouse: MouseInput, private readonly drag: DragController) {
    const keys = (e: KeyboardEvent | PointerEvent) => {
      this.shift = e.shiftKey;
      this.alt = e.altKey;
      this.ctrl = e.ctrlKey || e.metaKey;
    };
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('pointermove', keys);
    window.addEventListener('pointerdown', keys);
    window.addEventListener('blur', () => (this.shift = this.alt = this.ctrl = false));
    void this.build();
    // The ? panel's Cursor size (decision 289): every cursor is drawn again at the new size.
    window.addEventListener(CURSOR_SIZE_EVENT, () => void this.build());
    app.onFrame(() => this.update());
  }

  /** Counts builds, so a slower earlier one never overwrites a later size. */
  private builds = 0;

  private async build(): Promise<void> {
    const run = ++this.builds;
    const size = CURSOR_PX[cursorSizeNow()];
    const value = (c: HTMLCanvasElement, hx: number, hy: number, fallback: string) => cursorValue(c, hx, hy, fallback, size);
    const images = await Promise.all((Object.keys(ART) as Hand[]).map(async (h) => [h, await loadImage(ART[h])] as const));
    if (run !== this.builds) return;
    const art = new Map(images);
    for (const [state, [hand, emoji, fallback]] of Object.entries(STATES) as [State, [Hand, string, string]][]) {
      this.cursors[state] = compose(art.get(hand)!, hand, emoji, fallback, size);
    }
    // A badge lifts its whole pile.
    document.documentElement.style.setProperty('--cursor-pile', this.cursors.openPile!);
    // Buttons, tabs, chips and other clickable things: the pointing glove, not the system hand (decision 130).
    const point = await loadImage(pointUrl);
    if (run !== this.builds) return;
    const [px, py] = hotspots.point[VERSION] as [number, number];
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    c.getContext('2d')!.drawImage(point, 0, 0, SIZE, SIZE);
    this.pointCursor = value(c, px, py, 'pointer');
    const pk = document.createElement('canvas');
    pk.width = pk.height = SIZE;
    const pg = pk.getContext('2d')!;
    pg.drawImage(point, 0, 0, SIZE, SIZE);
    drawEmoji(pg, '📦', SIZE);
    this.packCursor = value(pk, px, py, 'pointer');
    document.documentElement.style.setProperty('--cursor-point', this.pointCursor);
    // Drawing a hand: the pointing glove with the number as a keycap (decision 143);
    // 0 (any number, decision 162) shows the numbers keycap.
    for (let n = 0; n <= 9; n++) {
      const d = document.createElement('canvas');
      d.width = d.height = SIZE;
      const g = d.getContext('2d')!;
      g.drawImage(point, 0, 0, SIZE, SIZE);
      drawEmoji(g, n ? `${n}️⃣` : '🔢', SIZE);
      this.drawCursors[n] = value(d, px, py, 'pointer');
    }
    // X: the glove with a blue-tinted 🪟; the reverse spread mirrors the glove to point
    // the other way and tints the 🪟 pink, still in the bottom right corner (decision 216).
    const sp = document.createElement('canvas');
    sp.width = sp.height = SIZE;
    const sg = sp.getContext('2d')!;
    sg.drawImage(point, 0, 0, SIZE, SIZE);
    sg.drawImage(tintedEmoji('🪟', SPREAD_TINT), 0, 0);
    this.spreadCursor = value(sp, px, py, 'pointer');
    const rv = document.createElement('canvas');
    rv.width = rv.height = SIZE;
    const rg = rv.getContext('2d')!;
    rg.save();
    rg.translate(SIZE, 0);
    rg.scale(-1, 1);
    rg.drawImage(point, 0, 0, SIZE, SIZE);
    rg.restore();
    rg.drawImage(tintedEmoji('🪟', REVERSE_TINT), 0, 0);
    this.reverseCursor = value(rv, SIZE - 1 - px, py, 'pointer');
    for (const [name, [url, emoji]] of Object.entries(GESTURES) as [Gesture, [string, string]][]) {
      // Each at its own size: Shuffle's two hands are drawn bigger (decisions 166, 167).
      const img = await loadImage(url);
      if (run !== this.builds) return;
      const side = img.naturalWidth || SIZE;
      const c = document.createElement('canvas');
      c.width = c.height = side;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, side, side);
      if (emoji) drawEmoji(g, emoji, side);
      this.gestureCursors[name] = value(c, side / 2, side / 2, 'grabbing');
    }
    this.shown = '';
  }

  private pick(): State {
    const { shift, alt, ctrl } = this;
    const gesture = this.mouse.gestureKind;
    if (gesture === 'pan' || (this.mouse.spaceDown && !this.drag.dragging)) return 'pan';
    if (gesture === 'orbit') return 'orbit';
    // Dragging a playmat: the fist, linked when it carries its cards (decision 144).
    const mats = this.app.mats;
    if (mats?.dragging) return mats.dragging.carrying ? 'fistFormation' : 'fist';
    // Dice (decision 260): the fist while carrying any, the open hand over one.
    const dice = this.app.dice;
    if (dice?.dragging) return 'fist';
    if (dice?.hovered && !this.drag.dragging && gesture !== 'marquee') return 'open';
    if (this.drag.dragging) {
      if (shift && !ctrl) return 'fistSweep';
      if (this.drag.heldMode === 'formation') return 'fistFormation';
      // One card in hand: the glove holding it up; more: the fist (decision 164).
      const one = this.drag.heldUids.length === 1;
      // Ctrl held: the cards land tidy (decision 129).
      if (ctrl) return one ? 'holdOneTidy' : 'fistTidy';
      return one ? 'holdOne' : 'fist';
    }
    if (gesture === 'marquee') {
      const mode = this.mouse.marqueeMode;
      return mode === 'add' ? 'arrowAdd' : mode === 'subtract' ? 'arrowSub' : 'arrow';
    }
    if (this.mouse.hovered) {
      if (alt || (ctrl && shift)) return 'openFormation';
      if (shift) return 'openSweep';
      // Ctrl held over a card: the set square, a drag lands tidy (decision 170). Once a
      // Ctrl + click has checked a card in or out, the tick until Ctrl is let go.
      if (ctrl) return this.mouse.ctrlChecking ? 'openToggle' : 'openTidy';
      return 'open';
    }
    // Over a playmat with no card above: the open glove; Alt carries the cards on it.
    if (mats?.movable && !ctrl && !shift) return alt ? 'openFormation' : 'open';
    // Empty table: a marquee; Ctrl adds to the selection, Shift takes away (decision 88).
    if (ctrl) return 'arrowAdd';
    if (shift) return 'arrowSub';
    // Alt shows every pile's count, wherever the mouse is (decision 125).
    if (alt) return 'arrowCounts';
    return 'arrow';
  }

  private update(): void {
    const draw = this.app.drawing;
    const state = this.pick();
    // Just after an action key, its gesture shows for a moment (decision 164).
    const g = this.app.gesture;
    const age = g ? performance.now() - g.at : Infinity;
    const settling = !!g?.settle && age < GESTURE_MAX_MS && g.settle.some((u) => this.app.motion.isAnimating(u));
    const gesture = g && (age < GESTURE_MS || settling) ? this.gestureCursors[g.name] : undefined;
    const next = gesture
      ? gesture
      : draw
      ? this.drawCursors[draw.count <= 9 ? draw.count : 0] ?? 'pointer'
      : this.app.spreading
        ? (this.app.spreading.reverse ? this.reverseCursor : this.spreadCursor) || 'pointer'
        : this.app.placing
          ? (this.app.placing.faceDown ? this.packCursor : this.pointCursor) || 'pointer'
          : this.cursors[state] ?? STATES[state][2];
    if (next === this.shown) return;
    this.shown = next;
    this.app.canvas.parentElement!.style.cursor = next;
  }
}
