// Custom cursors that say what the mouse will do (decision 116). An open hand
// over a card, a closed fist while holding cards, an arrow over empty table
// (a marquee). A small blue badge in the corner shows what a held key adds:
// a magnet while Shift sweeps, a grid while Alt (or Ctrl + Shift) keeps the
// formation, plus or minus for marquee add and subtract, a stack for a whole
// pile. Pan and orbit get their own cursors. Drawn as inline SVG.

import type { App } from '../app';
import type { DragController } from '../physics/feel';
import type { MouseInput } from '../input/mouse';

const INK = '#1e293b';
const ACCENT = '#2563eb';
const S = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;

/** An open hand, palm toward the viewer. */
const OPEN = `
  <rect x="8.6" y="3.4" width="3.6" height="13" rx="1.8" fill="#fff" ${S}/>
  <rect x="12.2" y="2" width="3.6" height="14" rx="1.8" fill="#fff" ${S}/>
  <rect x="15.8" y="3" width="3.6" height="13" rx="1.8" fill="#fff" ${S}/>
  <rect x="19.4" y="5.6" width="3.4" height="11" rx="1.7" fill="#fff" ${S}/>
  <rect x="8" y="12" width="15" height="14.5" rx="4.5" fill="#fff" ${S}/>
  <rect x="3" y="13.5" width="3.6" height="9" rx="1.8" fill="#fff" ${S} transform="rotate(-35 4.8 18)"/>
  <path d="M8.2 18 h1.6" ${S} fill="none"/>`;

/** A closed fist, holding something. */
const FIST = `
  <rect x="7" y="9.5" width="17" height="15" rx="5" fill="#fff" ${S}/>
  <path d="M11.2 9.8 v4.4 M15.4 9.6 v4.6 M19.6 9.8 v4.4" ${S} fill="none"/>
  <rect x="4.4" y="13" width="9.5" height="4" rx="2" fill="#fff" ${S} transform="rotate(-12 9 15)"/>`;

/** An arrow, with a dashed marquee box. */
const ARROW = `
  <rect x="16" y="17" width="12" height="10" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="2 1.6"/>
  <path d="M3 3 V21 L7.4 16.8 L10.6 24 L13.6 22.6 L10.4 15.6 H16.4 Z" fill="#fff" ${S}/>`;

/** Four arrows: pan. */
const PAN = `
  <path d="M16 3 L12 7.5 H14.6 V14.6 H7.5 V12 L3 16 L7.5 20 V17.4 H14.6 V24.5 H12 L16 29 L20 24.5 H17.4 V17.4 H24.5 V20 L29 16 L24.5 12 V14.6 H17.4 V7.5 H20 Z" fill="#fff" ${S}/>`;

/** A circling arrow: orbit. */
const ORBIT = `
  <path d="M25 16 A9 9 0 1 1 20.5 8.2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M25 16 A9 9 0 1 1 20.5 8.2" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <path d="M17.5 4.5 L23.5 7.5 L19.5 12.5 Z" fill="${INK}" stroke="#fff" stroke-width="1"/>
  <circle cx="16" cy="16" r="2" fill="${INK}"/>`;

/** The blue corner badge and the glyph in it. */
function badge(glyph: string): string {
  return `<circle cx="25" cy="25" r="6.3" fill="${ACCENT}" stroke="#fff" stroke-width="1.4"/>${glyph}`;
}
const W = `stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none"`;
const GLYPH = {
  /** A horseshoe magnet: Shift sweeps cards in. */
  magnet: `<path d="M22.2 21.6 V25.4 A2.8 2.8 0 0 0 27.8 25.4 V21.6" ${W}/><path d="M21.4 21.6 H23 M27 21.6 H28.6" ${W}/>`,
  /** A 2 x 2 grid: Alt keeps the formation. */
  grid: `<rect x="21.8" y="21.8" width="2.6" height="2.6" fill="#fff"/><rect x="25.6" y="21.8" width="2.6" height="2.6" fill="#fff"/><rect x="21.8" y="25.6" width="2.6" height="2.6" fill="#fff"/><rect x="25.6" y="25.6" width="2.6" height="2.6" fill="#fff"/>`,
  plus: `<path d="M25 21.8 V28.2 M21.8 25 H28.2" ${W}/>`,
  minus: `<path d="M21.8 25 H28.2" ${W}/>`,
  /** Plus over minus: Ctrl toggles a card in or out of the selection. */
  toggle: `<path d="M25 21 V25 M23 23 H27 M23 27.6 H27" ${W}/>`,
  /** Three lines: a whole pile. */
  stack: `<path d="M22 22.6 H28 M22 25 H28 M22 27.4 H28" ${W}/>`,
};

/** A data URL cursor from SVG content, with its hotspot and a fallback. */
function cursor(body: string, hx: number, hy: number, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}

export const CURSORS = {
  arrow: cursor(ARROW, 3, 3, 'default'),
  arrowAdd: cursor(ARROW + badge(GLYPH.plus), 3, 3, 'copy'),
  arrowSub: cursor(ARROW + badge(GLYPH.minus), 3, 3, 'default'),
  open: cursor(OPEN, 15, 14, 'grab'),
  openSweep: cursor(OPEN + badge(GLYPH.magnet), 15, 14, 'grab'),
  openFormation: cursor(OPEN + badge(GLYPH.grid), 15, 14, 'grab'),
  openToggle: cursor(OPEN + badge(GLYPH.toggle), 15, 14, 'pointer'),
  openPile: cursor(OPEN + badge(GLYPH.stack), 15, 14, 'grab'),
  fist: cursor(FIST, 15, 15, 'grabbing'),
  fistSweep: cursor(FIST + badge(GLYPH.magnet), 15, 15, 'grabbing'),
  fistFormation: cursor(FIST + badge(GLYPH.grid), 15, 15, 'grabbing'),
  pan: cursor(PAN, 16, 16, 'move'),
  orbit: cursor(ORBIT, 16, 16, 'all-scroll'),
};

/** Picks the cursor every frame from what is under the mouse, what is held and which keys are down. */
export class Cursors {
  private shift = false;
  private alt = false;
  private ctrl = false;
  private shown = '';

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
    // A badge lifts its whole pile.
    document.documentElement.style.setProperty('--cursor-pile', CURSORS.openPile);
    app.onFrame(() => this.update());
  }

  private pick(): string {
    const { shift, alt, ctrl } = this;
    const gesture = this.mouse.gestureKind;
    if (gesture === 'pan' || (this.mouse.spaceDown && !this.drag.dragging)) return CURSORS.pan;
    if (gesture === 'orbit') return CURSORS.orbit;
    if (this.drag.dragging) {
      if (shift && !ctrl) return CURSORS.fistSweep;
      if (this.drag.heldMode === 'formation') return CURSORS.fistFormation;
      return CURSORS.fist;
    }
    if (gesture === 'marquee') {
      const mode = this.mouse.marqueeMode;
      return mode === 'add' ? CURSORS.arrowAdd : mode === 'subtract' ? CURSORS.arrowSub : CURSORS.arrow;
    }
    if (this.mouse.hovered) {
      if (alt || (ctrl && shift)) return CURSORS.openFormation;
      if (shift) return CURSORS.openSweep;
      if (ctrl) return CURSORS.openToggle;
      return CURSORS.open;
    }
    // Empty table: a marquee; Ctrl adds to the selection, Shift takes away (decision 88).
    if (ctrl) return CURSORS.arrowAdd;
    if (shift) return CURSORS.arrowSub;
    return CURSORS.arrow;
  }

  private update(): void {
    const next = this.pick();
    if (next === this.shown) return;
    this.shown = next;
    this.app.canvas.parentElement!.style.cursor = next;
  }
}
