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
