// Custom cursors that say what the mouse will do (decisions 116, 118-123).
// Over empty table, a pointy arrow with a dashed marquee box, hand-drawn at
// the gloves' size and style (cursorArrow.ts); over cards, cartoon white
// gloves: an open hand over a card, a fist while holding cards. An emoji in the corner shows what a
// held key adds: a magnet while Shift sweeps, numbers while Alt shows counts,
// a chain link for a formation drag, an arrow with a drawn plus or minus for marquee
// add and take (decision 168), a
// set square while Ctrl holds Tidy mode on for cards in hand, a tick for Ctrl + click
// toggling a card (decision 158), and the pointing glove on anything clickable, books for a whole pile, arrows to pan and orbit.
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
  openFormation: ['open', '🔢', 'grab'],
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

/** The glove with its emoji in the bottom right corner, as a CSS cursor value. */
function compose(img: HTMLImageElement, hand: Hand, emoji: string, fallback: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  if (emoji) drawEmoji(g, emoji, SIZE);
  // The gesture gloves hold their click point in the middle, like the open hand and the fist.
  const [hx, hy] = hand === 'open' || hand === 'fist' ? (hotspots[hand][VERSION] as [number, number]) : hand === 'holdOne' ? [SIZE / 2, SIZE / 2] : ARROW_TIP;
  return `url(${c.toDataURL()}) ${hx} ${hy}, ${fallback}`;
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
    app.onFrame(() => this.update());
  }

  private async build(): Promise<void> {
    const images = await Promise.all((Object.keys(ART) as Hand[]).map(async (h) => [h, await loadImage(ART[h])] as const));
    const art = new Map(images);
    for (const [state, [hand, emoji, fallback]] of Object.entries(STATES) as [State, [Hand, string, string]][]) {
      this.cursors[state] = compose(art.get(hand)!, hand, emoji, fallback);
    }
    // A badge lifts its whole pile.
    document.documentElement.style.setProperty('--cursor-pile', this.cursors.openPile!);
    // Buttons, tabs, chips and other clickable things: the pointing glove, not the system hand (decision 130).
    const point = await loadImage(pointUrl);
    const [px, py] = hotspots.point[VERSION] as [number, number];
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    c.getContext('2d')!.drawImage(point, 0, 0, SIZE, SIZE);
    document.documentElement.style.setProperty('--cursor-point', `url(${c.toDataURL()}) ${px} ${py}, pointer`);
    // Drawing a hand: the pointing glove with the number as a keycap (decision 143);
    // 0 (any number, decision 162) shows the numbers keycap.
    for (let n = 0; n <= 9; n++) {
      const d = document.createElement('canvas');
      d.width = d.height = SIZE;
      const g = d.getContext('2d')!;
      g.drawImage(point, 0, 0, SIZE, SIZE);
      drawEmoji(g, n ? `${n}️⃣` : '🔢', SIZE);
      this.drawCursors[n] = `url(${d.toDataURL()}) ${px} ${py}, pointer`;
    }
    const sp = document.createElement('canvas');
    sp.width = sp.height = SIZE;
    const sg = sp.getContext('2d')!;
    sg.drawImage(point, 0, 0, SIZE, SIZE);
    drawEmoji(sg, '🪟', SIZE);
    this.spreadCursor = `url(${sp.toDataURL()}) ${px} ${py}, pointer`;
    for (const [name, [url, emoji]] of Object.entries(GESTURES) as [Gesture, [string, string]][]) {
      // Each at its own size: Shuffle's two hands are drawn bigger (decisions 166, 167).
      const img = await loadImage(url);
      const side = img.naturalWidth || SIZE;
      const c = document.createElement('canvas');
      c.width = c.height = side;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, side, side);
      if (emoji) drawEmoji(g, emoji, side);
      this.gestureCursors[name] = `url(${c.toDataURL()}) ${side / 2} ${side / 2}, grabbing`;
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
      // Ctrl held over a card: a click toggles it in or out of the selection (decisions 88, 158).
      // The set square shows once cards are in hand, where Ctrl lands them tidy.
      if (ctrl) return 'openToggle';
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
        ? this.spreadCursor || 'pointer'
        : this.cursors[state] ?? STATES[state][2];
    if (next === this.shown) return;
    this.shown = next;
    this.app.canvas.parentElement!.style.cursor = next;
  }
}
