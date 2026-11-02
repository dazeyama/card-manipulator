// The room's chat (ONLINE.md 5.5, O35, O117): a small box in the bottom left
// of the play space, above the control hints, instead of a section of the
// Online panel. A new line pops in with the last few above it, and they fade
// out a few seconds after the last one. Enter on the table opens it with a
// text box (O116); Enter sends and gives the keys back to the table, as does
// Esc. Plain text up to 300 characters; nothing is kept past the room's life.

import type { App } from '../app';
import { CHAT_TEXT_MAX, type ChatLine } from '../../shared/protocol';
import type { RoomState } from '../online/room';
import type { Session } from '../online/session';
import { h } from './dom';

/** Lines shown at once; the room keeps its last 100 for joiners. */
const LINES = 5;
/** How long the lines stay after the last one arrived, before fading. */
const SHOW_MS = 8000;

export class QuickChat {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly field: HTMLInputElement;
  private room: RoomState | null = null;
  private session: Session | null = null;
  private stop: (() => void) | null = null;
  private fadeTimer = 0;

  constructor(private readonly app: App) {
    this.list = h('div', { class: 'quick-chat-lines', 'aria-live': 'polite' });
    this.field = h('input', { class: 'quick-chat-field', placeholder: 'Say something… (Enter sends, Esc closes)', maxlength: String(CHAT_TEXT_MAX), spellcheck: 'true', 'aria-label': 'Chat' });
    this.field.hidden = true;
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
      // Keys typed here are the chat's, not the table's.
      e.stopPropagation();
    });
    this.field.addEventListener('blur', () => {
      if (!this.field.hidden) this.close();
    });
    this.el = h('div', { class: 'quick-chat faded' }, this.list, this.field);
    this.el.hidden = true;
    app.overlay.append(this.el);
  }

  /** Follow a room's chat; null when offline. */
  attach(room: RoomState | null, session: Session | null): void {
    this.stop?.();
    this.stop = null;
    this.room = room;
    this.session = session;
    this.list.replaceChildren();
    this.el.hidden = !room;
    if (!room) return this.close();
    for (const line of room.chat.slice(-LINES)) this.list.append(this.lineEl(line));
    this.stop = room.events.on('chat', (line) => this.add(line));
  }

  get isOpen(): boolean {
    return !this.field.hidden;
  }

  /** Enter on the table (O116): the recent lines and a text box, the cursor in it. */
  open(): void {
    if (!this.room) return;
    clearTimeout(this.fadeTimer);
    this.el.classList.remove('faded');
    this.field.hidden = false;
    this.field.focus();
  }

  /** Back to the table: the text box goes, and the lines fade a little later. */
  close(): void {
    if (this.field.hidden) return;
    this.field.hidden = true;
    if (document.activeElement === this.field) this.field.blur();
    this.app.canvas.focus();
    this.fadeLater();
  }

  private send(): void {
    const text = this.field.value.trim().slice(0, CHAT_TEXT_MAX);
    this.field.value = '';
    if (text && this.session) this.session.send({ t: 'chat', text });
  }

  /** A new line: shown at once with the ones before it, fading after a while unless the box is open. */
  private add(line: ChatLine): void {
    this.list.append(this.lineEl(line));
    while (this.list.childElementCount > LINES) this.list.firstElementChild?.remove();
    this.el.classList.remove('faded');
    if (!this.isOpen) this.fadeLater();
  }

  private fadeLater(): void {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      if (!this.isOpen) this.el.classList.add('faded');
    }, SHOW_MS);
  }

  private lineEl(line: ChatLine): HTMLElement {
    if (!line.from) return h('div', { class: 'quick-chat-line system' }, line.text);
    const p = this.room?.player(line.from);
    const name = h('span', { class: 'quick-chat-name' }, p?.nickname ?? 'Someone');
    name.style.color = textColour(p?.colour);
    return h('div', { class: 'quick-chat-line' }, name, ' ', line.text);
  }
}

/** A player color as name text: the white swatch reads as gray on the white box. */
export function textColour(colour: string | undefined): string {
  if (!colour) return 'var(--text)';
  return colour.toLowerCase() === '#f1f5f9' ? '#8a8f98' : colour;
}
