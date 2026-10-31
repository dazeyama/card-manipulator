// Whole-page states of a room (ONLINE.md 12.7): the room closed, kicked,
// banned, a page older than the room server, the free plan's daily limit, and
// the desktop-only page. One covers the page at a time, above everything but
// the too-narrow warning; keys don't reach the table while it shows.

import { h } from './dom';

export interface StateButton {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface RoomStateView {
  title: string;
  /** Lines under the title; a line may hold an element (the room's name in italics). */
  lines: (string | Node)[];
  buttons: StateButton[];
}

let shown: { el: HTMLElement; stopKeys: (e: KeyboardEvent) => void } | null = null;

/** Cover the page with a state, replacing any shown. */
export function showRoomState(view: RoomStateView): void {
  hideRoomState();
  const buttons = view.buttons.map((b) => {
    const btn = h('button', { class: b.primary ? 'btn primary' : 'btn' }, b.label);
    btn.addEventListener('click', b.run);
    return btn;
  });
  const el = h('div', { class: 'room-state', role: 'alertdialog' },
    h('div', { class: 'room-state-box' },
      h('h2', {}, view.title),
      ...view.lines.map((l) => h('p', {}, l)),
      h('div', { class: 'row room-state-buttons' }, ...buttons),
    ),
  );
  document.body.append(el);
  const stopKeys = (e: KeyboardEvent) => {
    if (e.target instanceof Node && el.contains(e.target)) return;
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', stopKeys, true);
  shown = { el, stopKeys };
  buttons.find((_, i) => view.buttons[i].primary)?.focus();
}

export function hideRoomState(): void {
  if (!shown) return;
  window.removeEventListener('keydown', shown.stopKeys, true);
  shown.el.remove();
  shown = null;
}

export function roomStateShown(): boolean {
  return shown !== null;
}

/** "Room: <i>name</i>", for the pages that name the room. */
export function roomNameLine(prefix: string, name: string): Node {
  const p = document.createDocumentFragment();
  p.append(prefix, h('em', {}, name));
  return p;
}
