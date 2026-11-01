// A context hint line inside the play space (decision 134): a thin strip in
// the bottom left corner showing only the controls that matter right now,
// changing with what is under the mouse, what is held and which keys are down.
// The cursor shows what is happening; the strip shows what you could do next.
// A held key's hint lights up.

import type { App } from '../app';
import type { DragController } from '../physics/feel';
import type { MouseInput } from '../input/mouse';

type Key = 'shift' | 'ctrl' | 'alt';
/** One hint: its icon, its words, and the key that lights it up while held. */
type Hint = [string, string, Key?];

// Short on purpose (decision 297): "Key: what it does", no status lines, as the cursor shows those.
const HINTS: Record<string, Hint[]> = {
  holding: [
    ['✋', 'Release: drop'],
    ['🧲', 'Shift: sweep', 'shift'],
    ['📐', 'Ctrl: tidy', 'ctrl'],
    ['🔃', 'R: turn'],
    ['🃏', 'F: flip'],
    ['👇', 'Right-click: deal'],
    ['🪟', 'X: spread'],
    ['⎋', 'Esc: put back'],
  ],
  formation: [
    ['✋', 'Release: drop in place'],
    ['🧲', 'Shift: sweep', 'shift'],
    ['⎋', 'Esc: put back'],
  ],
  card: [
    ['🖐️', 'Drag: pick up'],
    ['🧲', 'Shift: sweep', 'shift'],
    ['📐', 'Ctrl: tidy · toggle', 'ctrl'],
    ['🔗', 'Alt: formation', 'alt'],
    ['🃏', 'Middle-click: flip'],
    ['🔄', 'Double-click: tap'],
    ['📊', 'C: curve'],
    ['🏆', 'E: EDHREC'],
    ['🎴', 'H: fan'],
    ['🖐️', '1–9: draw'],
    ['⭕', 'Space: menu'],
  ],
  table: [
    ['⬚', 'Drag: select'],
    ['➕', 'Ctrl: add', 'ctrl'],
    ['➖', 'Shift: remove', 'shift'],
    ['🔢', 'Alt: counts', 'alt'],
    ['↔️', 'Right-drag: pan'],
    ['🔄', 'Middle-drag: orbit'],
    ['🎥', 'V: camera'],
  ],
  marquee: [
    ['⬚', 'Release: select'],
    ['➕', 'Ctrl: add', 'ctrl'],
    ['➖', 'Shift: remove', 'shift'],
    ['⎋', 'Esc: cancel'],
  ],
  mat: [
    ['🖐️', 'Drag: move'],
    ['🔗', 'Alt + drag: carry cards', 'alt'],
    ['🔃', 'R: turn'],
    ['🗑️', 'Delete: remove'],
  ],
  matDrag: [
    ['✋', 'Release: place'],
    ['⎋', 'Esc: put back'],
  ],
  pan: [
    ['🖱️', 'Double right-click: straighten'],
  ],
  orbit: [
    ['🎥', 'V: camera'],
  ],
};

/** Remembered in this browser (decision 234). */
const HIDDEN_KEY = 'hints.hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export class ContextHints {
  private readonly el: HTMLDivElement;
  private readonly keys = { shift: false, ctrl: false, alt: false };
  private shown = '';

  /** The ? panel's "Hide control hints" (decision 234). */
  get hidden(): boolean {
    return this.el.hidden;
  }

  set hidden(on: boolean) {
    this.el.hidden = on;
    try {
      localStorage.setItem(HIDDEN_KEY, on ? '1' : '0');
    } catch {
      // Private window or blocked storage: it just isn't remembered.
    }
  }

  constructor(private readonly app: App, private readonly mouse: MouseInput, private readonly drag: DragController) {
    this.el = document.createElement('div');
    this.el.className = 'context-hints';
    this.el.hidden = readHidden();
    app.overlay.append(this.el);
    const keys = (e: KeyboardEvent | PointerEvent) => {
      this.keys.shift = e.shiftKey;
      this.keys.ctrl = e.ctrlKey || e.metaKey;
      this.keys.alt = e.altKey;
    };
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    window.addEventListener('pointermove', keys);
    window.addEventListener('pointerdown', keys);
    window.addEventListener('blur', () => (this.keys.shift = this.keys.ctrl = this.keys.alt = false));
    app.onFrame(() => this.update());
  }

  /** Which set of hints fits what the mouse is doing. */
  private context(): string {
    if (this.app.drawing) return 'draw';
    if (this.app.spreading) return 'spread';
    if (this.app.placing) return 'place';
    const gesture = this.mouse.gestureKind;
    if (gesture === 'pan') return 'pan';
    if (gesture === 'orbit') return 'orbit';
    if (this.app.mats?.dragging) return 'matDrag';
    if (this.drag.dragging) return this.drag.heldMode === 'formation' ? 'formation' : 'holding';
    if (gesture === 'marquee') return 'marquee';
    if (this.mouse.hovered) return 'card';
    // A locked mat acts as table (decision 154).
    return this.app.mats?.movable ? 'mat' : 'table';
  }

  /** Is the card under the cursor lying on a stand's slope? */
  private onStand(): boolean {
    const uid = this.mouse.hovered;
    return !!uid && !!this.app.store.cards.get(uid)?.stand;
  }

  /** The card hints, with H H's size after H: wide on the table, the usual size on a stand (decision 306). */
  private cardHints(): Hint[] {
    const hints = [...HINTS.card];
    const i = hints.findIndex((h) => h[1] === 'H: fan');
    hints.splice(i + 1, 0, ['↔️', this.onStand() ? 'H H: usual size' : 'H H: wide']);
    return hints;
  }

  private update(): void {
    const context = this.context();
    const lit = (key?: Key) => !!key && this.keys[key];
    // Drawing a hand (decision 143): what the next click does.
    const n = this.app.drawing?.count ?? 0;
    const spreadCount = this.app.spreading?.source.length ?? 0;
    const placeCount = this.app.placing?.source.length ?? 0;
    const hints: Hint[] = context === 'draw'
      ? this.app.drawing?.faceDown
        ? [['👆', `Click: deal ${n} face down`], ['⎋', 'Esc: cancel']]
        : [['👆', `Click: hand of ${n}`], ['⎋', 'Esc: cancel']]
      : context === 'place' && this.app.placing?.faceDown
        ? [['📦', `Click: pack of ${placeCount}`], ['👆', 'P: face up'], ['⎋', 'Esc: cancel']]
      : context === 'place'
        ? [['👆', `Click: stack of ${placeCount}`], ['📦', 'P: face down'], ['⎋', 'Esc: cancel']]
      : context === 'spread' && this.app.spreading?.reverse
        ? [['👉', `Click: reverse spread ${spreadCount}`], ['🔲', 'Drag: fit to box'], ['🪟', 'X: plain'], ['⎋', 'Esc: cancel']]
      : context === 'spread'
        ? [['👆', `Click: spread ${spreadCount}`], ['🔲', 'Drag: fit to box'], ['🪟', 'X: reverse'], ['⎋', 'Esc: cancel']]
        : context === 'card'
          ? this.cardHints()
          : HINTS[context];
    const signature = context + (context === 'card' && this.onStand() ? 's' : '') +(this.app.drawing?.faceDown ? 'f' : '') + (this.app.spreading?.reverse ? 'r' : '') + (this.app.placing?.faceDown ? 'd' : '') + n + spreadCount + placeCount + hints.map((hint) => (lit(hint[2]) ? '1' : '0')).join('');
    if (signature === this.shown) return;
    this.shown = signature;
    this.el.replaceChildren(
      ...hints.map(([icon, text, key]) => {
        const item = document.createElement('span');
        item.className = 'context-hint' + (lit(key) ? ' on' : '');
        const i = document.createElement('span');
        i.className = 'context-hint-icon';
        i.textContent = icon;
        item.append(i, text);
        return item;
      }),
    );
  }
}
