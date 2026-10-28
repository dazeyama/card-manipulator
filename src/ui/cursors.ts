// Custom cursors that say what the mouse will do (decisions 116, 118-123).
// Over empty table, a pointy arrow with a dashed marquee box, hand-drawn at
// the gloves' size and style (cursorArrow.ts); over cards, cartoon white
// gloves: an open hand over a card, a fist while holding cards. An emoji in the corner shows what a
// held key adds: a magnet while Shift sweeps, numbers while Alt shows counts,
// a set square for a formation drag, plus or minus for marquee add and take, a
// tick for Ctrl's toggle, books for a whole pile, arrows to pan and orbit.
// The glove art is made by devtools/makeCursors.ts; the emoji is drawn onto it
// here with a canvas, so it uses the system's emoji font.

import type { App } from '../app';
import type { DragController } from '../physics/feel';
import type { MouseInput } from '../input/mouse';
import { ARROW_TIP, ARROW_URL } from './cursorArrow';
import openUrl from '../../art/cursors/open-48-bold.png';
import fistUrl from '../../art/cursors/fist-48-bold.png';
import hotspots from '../../art/cursors/cursors.json';

const SIZE = 48;
const VERSION = '48-bold';

type Hand = 'arrow' | 'open' | 'fist';
const ART: Record<Hand, string> = { arrow: ARROW_URL, open: openUrl, fist: fistUrl };

/** Every cursor: its glove, its emoji (if any), and the browser cursor used until the art loads. */
const STATES = {
  arrow: ['arrow', '', 'default'],
  arrowAdd: ['arrow', '➕', 'copy'],
  arrowSub: ['arrow', '➖', 'default'],
  open: ['open', '', 'grab'],
  openSweep: ['open', '🧲', 'grab'],
  openFormation: ['open', '🔢', 'grab'],
  openToggle: ['open', '☑️', 'pointer'],
  openPile: ['open', '📚', 'grab'],
  fist: ['fist', '', 'grabbing'],
  fistSweep: ['fist', '🧲', 'grabbing'],
  fistFormation: ['fist', '📐', 'grabbing'],
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
const EMOJI_SHARE = 0.46;

/**
 * Draw an emoji in the bottom right corner of a square cursor image, placed by
 * its measured outline so no part of it is cut off (decision 124). Emoji fonts
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
  // One pixel in from the right and bottom edges.
  g.fillText(emoji, size - 1 - m.actualBoundingBoxRight, size - 1 - m.actualBoundingBoxDescent);
}

/** The glove with its emoji in the bottom right corner, as a CSS cursor value. */
function compose(img: HTMLImageElement, hand: Hand, emoji: string, fallback: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, SIZE, SIZE);
  if (emoji) drawEmoji(g, emoji, SIZE);
  const [hx, hy] = hand === 'arrow' ? ARROW_TIP : (hotspots[hand][VERSION] as [number, number]);
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
    this.shown = '';
  }

  private pick(): State {
    const { shift, alt, ctrl } = this;
    const gesture = this.mouse.gestureKind;
    if (gesture === 'pan' || (this.mouse.spaceDown && !this.drag.dragging)) return 'pan';
    if (gesture === 'orbit') return 'orbit';
    if (this.drag.dragging) {
      if (shift && !ctrl) return 'fistSweep';
      if (this.drag.heldMode === 'formation') return 'fistFormation';
      return 'fist';
    }
    if (gesture === 'marquee') {
      const mode = this.mouse.marqueeMode;
      return mode === 'add' ? 'arrowAdd' : mode === 'subtract' ? 'arrowSub' : 'arrow';
    }
    if (this.mouse.hovered) {
      if (alt || (ctrl && shift)) return 'openFormation';
      if (shift) return 'openSweep';
      if (ctrl) return 'openToggle';
      return 'open';
    }
    // Empty table: a marquee; Ctrl adds to the selection, Shift takes away (decision 88).
    if (ctrl) return 'arrowAdd';
    if (shift) return 'arrowSub';
    return 'arrow';
  }

  private update(): void {
    const state = this.pick();
    const next = this.cursors[state] ?? STATES[state][2];
    if (next === this.shown) return;
    this.shown = next;
    this.app.canvas.parentElement!.style.cursor = next;
  }
}
