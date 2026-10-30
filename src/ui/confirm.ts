// A small confirm dialog (load file, new table: spec 14.3).

import { h } from './dom';

/** A small modal confirm (load file, new table: spec 14.3). */
export function confirmDialog(message: string, ok = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    const yes = h('button', { class: 'btn primary' }, ok);
    const no = h('button', { class: 'btn' }, 'Cancel');
    const box = h('div', { class: 'modal' }, h('p', {}, message), h('div', { class: 'row end' }, no, yes));
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    yes.focus();
    const done = (v: boolean) => {
      back.remove();
      resolve(v);
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    });
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) done(false);
    });
  });
}

/** A small modal asking for one line of text (a card stand's name plate, decision 220). Resolves with it, or null if cancelled. */
export function textDialog(message: string, opts: { value: string; ok?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'grow', value: opts.value, maxlength: '60', spellcheck: 'false', 'aria-label': message });
    const yes = h('button', { class: 'btn primary' }, opts.ok ?? 'OK');
    const no = h('button', { class: 'btn' }, 'Cancel');
    const box = h('div', { class: 'modal' }, h('p', {}, message), h('div', { class: 'row' }, input), h('div', { class: 'row end' }, no, yes));
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    input.focus();
    input.select();
    const done = (v: string | null) => {
      back.remove();
      resolve(v);
    };
    yes.addEventListener('click', () => done(input.value));
    no.addEventListener('click', () => done(null));
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') done(input.value);
    });
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) done(null);
    });
  });
}

/**
 * A small modal asking for a whole number from `min` to `max` (0 to draw
 * any number of cards, decision 162). Resolves with the number, or null if
 * cancelled. Out-of-range numbers are brought into range.
 */
export function numberDialog(message: string, opts: { min: number; max: number; value: number; ok?: string }): Promise<number | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'number', class: 'grow', min: String(opts.min), max: String(opts.max), step: '1', value: String(opts.value), 'aria-label': message });
    const yes = h('button', { class: 'btn primary' }, opts.ok ?? 'OK');
    const no = h('button', { class: 'btn' }, 'Cancel');
    const box = h('div', { class: 'modal' }, h('p', {}, message), h('div', { class: 'row' }, input), h('div', { class: 'row end' }, no, yes));
    const back = h('div', { class: 'modal-back' }, box);
    document.body.append(back);
    input.focus();
    input.select();
    const done = (v: number | null) => {
      back.remove();
      resolve(v);
    };
    const accept = () => {
      const n = Math.round(Number(input.value));
      done(Number.isFinite(n) && input.value.trim() !== '' ? Math.min(opts.max, Math.max(opts.min, n)) : null);
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
