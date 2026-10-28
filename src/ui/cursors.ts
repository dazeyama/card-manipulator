// Custom cursors that say what the mouse will do (decisions 116, 118-121).
// Over empty table, an arrow with a dashed marquee box, the size of an ordinary
// cursor; over cards, cartoon white gloves: an open hand over a card, a fist
// while holding cards. An emoji in the corner shows what a
// held key adds: a magnet while Shift sweeps, numbers while Alt shows counts,
// a set square for a formation drag, plus or minus for marquee add and take, a
// tick for Ctrl's toggle, books for a whole pile, arrows to pan and orbit.
// The glove art is made by devtools/makeCursors.ts; the emoji is drawn onto it
// here with a canvas, so it uses the system's emoji font.

import type { App } from '../app';
import type { DragController } from '../physics/feel';
import type { MouseInput } from '../input/mouse';
import openUrl from '../../art/cursors/open-48-bold.png';
import fistUrl from '../../art/cursors/fist-48-bold.png';
import hotspots from '../../art/cursors/cursors.json';

const SIZE = 48;
const VERSION = '48-bold';

/**
 * The empty-table arrow with its dashed marquee box (decision 121), drawn on a
 * 32-unit grid and placed at an ordinary cursor's size in the 48 px image.
 */
const INK = '#1e293b';
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect x="16" y="17" width="12" height="10" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="2 1.6"/>
  <path d="M3 3 V21 L7.4 16.8 L10.6 24 L13.6 22.6 L10.4 15.6 H16.4 Z" fill="#fff" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;
const arrowUrl = `data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}`;
/** The arrow is drawn this much bigger than its 32-unit grid: about an ordinary cursor's size. */
const ARROW_SCALE = 1.1;
/** The arrow's tip, its click point, in the 48 px image. */
const ARROW_TIP: [number, number] = [Math.round(3 * ARROW_SCALE), Math.round(3 * ARROW_SCALE)];

type Hand = 'arrow' | 'open' | 'fist';
const ART: Record<Hand, string> = { arrow: arrowUrl, open: openUrl, fist: fistUrl };

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

/** The glove with its emoji in the bottom right corner, as a CSS cursor value. */
function compose(img: HTMLImageElement, hand: Hand, emoji: string, fallback: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  if (hand === 'arrow') g.drawImage(img, 0, 0, 32 * ARROW_SCALE, 32 * ARROW_SCALE);
  else g.drawImage(img, 0, 0, SIZE, SIZE);
  if (emoji) {
    g.font = `${Math.round(SIZE * 0.46)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillText(emoji, SIZE, SIZE + Math.round(SIZE * 0.04));
  }
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
