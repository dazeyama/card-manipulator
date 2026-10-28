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

const HINTS: Record<string, Hint[]> = {
  holding: [
    ['✋', 'Release to drop'],
    ['🧲', 'Shift sweeps cards in', 'shift'],
    ['📐', 'Ctrl lands tidy', 'ctrl'],
    ['🔃', 'R turns'],
    ['🃏', 'F flips'],
    ['🪟', 'X spreads'],
    ['⎋', 'Esc puts back'],
  ],
  formation: [
    ['✋', 'Release to drop each where it is'],
    ['🔗', 'Moving in formation'],
    ['🧲', 'Shift sweeps cards in', 'shift'],
    ['⎋', 'Esc puts back'],
  ],
  card: [
    ['🖐️', 'Drag to pick up'],
    ['🧲', 'Shift sweeps', 'shift'],
    ['📐', 'Ctrl tidy · click toggles', 'ctrl'],
    ['🔗', 'Alt keeps formation', 'alt'],
    ['🃏', 'Middle-click flips'],
    ['📖', 'Double-click spreads'],
    ['📊', 'C curves'],
    ['🎴', 'H fans'],
  ],
  table: [
    ['⬚', 'Drag to select'],
    ['➕', 'Ctrl adds', 'ctrl'],
    ['➖', 'Shift takes away', 'shift'],
    ['🔢', 'Alt shows counts', 'alt'],
    ['↔️', 'Right-drag pans'],
    ['🔄', 'Middle-drag orbits'],
    ['🎥', 'V camera angle'],
  ],
  marquee: [
    ['⬚', 'Release to select'],
    ['➕', 'Ctrl adds', 'ctrl'],
    ['➖', 'Shift takes away', 'shift'],
    ['⎋', 'Esc cancels'],
  ],
  pan: [
    ['↔️', 'Panning'],
    ['🖱️', 'Double right-click straightens the view'],
  ],
  orbit: [
    ['🔄', 'Orbiting'],
    ['🎥', 'V cycles camera angles'],
  ],
};

export class ContextHints {
  private readonly el: HTMLDivElement;
  private readonly keys = { shift: false, ctrl: false, alt: false };
  private shown = '';

  constructor(app: App, private readonly mouse: MouseInput, private readonly drag: DragController) {
    this.el = document.createElement('div');
    this.el.className = 'context-hints';
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
    const gesture = this.mouse.gestureKind;
    if (gesture === 'pan' || (this.mouse.spaceDown && !this.drag.dragging)) return 'pan';
    if (gesture === 'orbit') return 'orbit';
    if (this.drag.dragging) return this.drag.heldMode === 'formation' ? 'formation' : 'holding';
    if (gesture === 'marquee') return 'marquee';
    return this.mouse.hovered ? 'card' : 'table';
  }

  private update(): void {
    const context = this.context();
    const lit = (key?: Key) => !!key && this.keys[key];
    const hints = HINTS[context];
    const signature = context + hints.map((hint) => (lit(hint[2]) ? '1' : '0')).join('');
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
