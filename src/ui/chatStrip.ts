// The room's chat (ONLINE.md 5.5, O35): a strip in the Online panel with the
// last 100 lines, each name in its player's colour, system lines in grey.
// Plain text up to 300 characters; Enter sends. Nothing is kept past the
// room's life. Keys don't reach the table while the field has focus.

import { CHAT_TEXT_MAX, type ChatLine } from '../../shared/protocol';
import type { RoomState } from '../online/room';
import type { Session } from '../online/session';
import { h } from './dom';

export class ChatStrip {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly field: HTMLInputElement;
  private room: RoomState | null = null;
  private session: Session | null = null;
  private stop: (() => void) | null = null;

  constructor() {
    this.list = h('div', { class: 'chat-lines', 'aria-live': 'polite' });
    this.field = h('input', { class: 'grow chat-field', placeholder: 'Say something…', maxlength: String(CHAT_TEXT_MAX), spellcheck: 'true', 'aria-label': 'Chat' });
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape') {
        this.field.blur();
      }
      // Keys typed here are the chat's, not the table's.
      e.stopPropagation();
    });
    this.el = h('div', { class: 'chat-strip' }, this.list, h('div', { class: 'row' }, this.field));
  }

  /** Follow a room's chat; null when offline. */
  attach(room: RoomState | null, session: Session | null): void {
    this.stop?.();
    this.stop = null;
    this.room = room;
    this.session = session;
    this.list.replaceChildren();
    if (!room) return;
    for (const line of room.chat) this.list.append(this.lineEl(line));
    this.stop = room.events.on('chat', (line) => this.add(line));
    this.scrollDown();
  }

  focus(): void {
    this.field.focus();
  }

  private send(): void {
    const text = this.field.value.trim().slice(0, CHAT_TEXT_MAX);
    if (!text || !this.session) return;
    this.session.send({ t: 'chat', text });
    this.field.value = '';
  }

  private add(line: ChatLine): void {
    const near = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 30;
    this.list.append(this.lineEl(line));
    while (this.list.childElementCount > 100) this.list.firstElementChild?.remove();
    if (near) this.scrollDown();
  }

  private lineEl(line: ChatLine): HTMLElement {
    if (!line.from) return h('div', { class: 'chat-line system' }, line.text);
    const p = this.room?.player(line.from);
    const name = h('span', { class: 'chat-name' }, p?.nickname ?? 'Someone');
    name.style.color = textColour(p?.colour);
    return h('div', { class: 'chat-line' }, name, ' ', line.text);
  }

  private scrollDown(): void {
    requestAnimationFrame(() => (this.list.scrollTop = this.list.scrollHeight));
  }
}

/** A player colour as name text: the white swatch reads as grey on the white panel. */
export function textColour(colour: string | undefined): string {
  if (!colour) return 'var(--text)';
  return colour.toLowerCase() === '#f1f5f9' ? '#8a8f98' : colour;
}
