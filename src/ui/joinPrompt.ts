// The join prompt (ONLINE.md 12.3, O64): a modal over the empty table asking
// for a nickname (prefilled from this browser's identity), one of the eight
// colors (taken ones grayed with their holder's initial) and the password
// when the room has one and the link didn't carry it. Join or Not now; errors
// show inline. Also the color picker the Go online form shares, and the box
// for pasting a room link or code (the welcome note's Join a table).

import { NICKNAME_MAX, PASSWORD_MAX, PLAYER_COLOURS, type RoomInfo } from '../../shared/protocol';
import { codeFromText, type RoomRoute } from '../online/link';
import { isBlocked } from '../../shared/words';
import { h } from './dom';

/** The eight swatches, the taken ones grayed with their holder's initial. */
export class ColourPicker {
  readonly el: HTMLElement;
  value: string;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(taken: { colour: string; initial: string }[], preferred: string) {
    const takenBy = new Map(taken.map((t) => [t.colour.toLowerCase(), t.initial]));
    const free = PLAYER_COLOURS.filter((c) => !takenBy.has(c.toLowerCase()));
    this.value = free.find((c) => c.toLowerCase() === preferred.toLowerCase()) ?? free[0] ?? PLAYER_COLOURS[0];
    this.el = h('div', { class: 'colour-picker', role: 'radiogroup', 'aria-label': 'Your color' });
    for (const c of PLAYER_COLOURS) {
      const initial = takenBy.get(c.toLowerCase());
      const b = h('button', { class: 'swatch big', type: 'button', role: 'radio', title: initial ? `Taken by ${initial}…` : 'Take this color' }, initial ?? '');
      b.style.background = c;
      if (initial) {
        b.disabled = true;
        b.classList.add('taken');
      }
      b.addEventListener('click', () => this.pick(c));
      this.buttons.set(c, b);
      this.el.append(b);
    }
    this.pick(this.value);
  }

  private pick(c: string): void {
    this.value = c;
    for (const [colour, b] of this.buttons) {
      const on = colour === c;
      b.classList.toggle('picked', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
}

export interface JoinAnswer {
  nickname: string;
  colour: string;
  /** The password typed, when the room asked for one. */
  key?: string;
}

export interface JoinPromptOptions {
  info: RoomInfo;
  /** Ask for the password: the room has one and the link didn't carry it (or it was wrong). */
  needPassword: boolean;
  nickname: string;
  colour: string;
  /** An inline error from the last try: "Wrong password", "The room is full", ... */
  error?: string;
}

/** Ask how to join. Resolves with the answer, or null for Not now. */
export function joinPrompt(opts: JoinPromptOptions): Promise<JoinAnswer | null> {
  return new Promise((resolve) => {
    const { info } = opts;
    const nick = h('input', { class: 'grow', value: opts.nickname, maxlength: String(NICKNAME_MAX), spellcheck: 'false', placeholder: 'Your name at the table', 'aria-label': 'Nickname' });
    const colours = new ColourPicker(info.taken ?? [], opts.colour);
    const pass = h('input', { class: 'grow', type: 'password', maxlength: String(PASSWORD_MAX), placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'off' });
    const error = h('div', { class: 'join-error' }, opts.error ?? '');
    const join = h('button', { class: 'btn primary' }, 'Join');
    const notNow = h('button', { class: 'btn' }, 'Not now');
    const title = h('h3', { class: 'join-title' }, 'Join ', h('em', {}, info.name));
    const players = `${info.players} of ${info.max} player${info.max === 1 ? '' : 's'}`;
    const sub = h('p', { class: 'muted' }, info.crown ? `${players} · hosted by ${info.crown}` : players);
    const box = h('div', { class: 'modal join-prompt' },
      title, sub,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nickname'), nick),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), colours.el),
      ...(opts.needPassword ? [h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), pass)] : []),
      error,
      h('div', { class: 'row end' }, notNow, join),
    );
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    (opts.needPassword && opts.nickname ? pass : nick).focus();
    const done = (v: JoinAnswer | null) => {
      back.remove();
      resolve(v);
    };
    const accept = () => {
      const nickname = nick.value.trim();
      if (!nickname) {
        error.textContent = 'Pick a nickname first';
        nick.focus();
        return;
      }
      // The word filter (10.4): the server would rename a blocked name anyway.
      if (isBlocked(nickname)) {
        error.textContent = 'That name is not allowed';
        nick.focus();
        return;
      }
      if (opts.needPassword && !pass.value) {
        error.textContent = 'This room has a password';
        pass.focus();
        return;
      }
      done({ nickname, colour: colours.value, ...(opts.needPassword ? { key: pass.value } : {}) });
    };
    join.addEventListener('click', accept);
    notNow.addEventListener('click', () => done(null));
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') accept();
    });
  });
}

/** Ask for a room link or code (the welcome note's Join a table). Resolves with the room, or null. */
export function joinByCodeDialog(): Promise<RoomRoute | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'grow', placeholder: 'A room link, or its six-letter code', spellcheck: 'false', 'aria-label': 'Room link or code' });
    const error = h('div', { class: 'join-error' });
    const yes = h('button', { class: 'btn primary' }, 'Join');
    const no = h('button', { class: 'btn' }, 'Cancel');
    const box = h('div', { class: 'modal' }, h('p', {}, 'Join a table: paste the link a friend sent you, or type its code.'), h('div', { class: 'row' }, input), error, h('div', { class: 'row end' }, no, yes));
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    input.focus();
    const done = (v: RoomRoute | null) => {
      back.remove();
      resolve(v);
    };
    const accept = () => {
      const r = codeFromText(input.value);
      if (r) done(r);
      else error.textContent = 'That is not a room link or code (six letters and numbers, like 7KQ2MX)';
    };
    yes.addEventListener('click', accept);
    no.addEventListener('click', () => done(null));
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') accept();
    });
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) done(null);
    });
  });
}
