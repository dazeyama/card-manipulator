// Basic lands on the Card tab (decision 210): a chip per basic spawns one, a
// number under each spawns several at once, and Choose basics picks which
// printing each one is. The printings are kept with the table.

import type { App } from '../app';
import { parseLine, type DeckEntry } from '../io/decklist';
import { printingsOf } from '../scryfall/basics';
import { resolveEntries } from '../scryfall/resolve';
import { spawnCards, type SpawnItem, type SpawnOptions } from '../spawn';
import { BASIC_NAMES, BASIC_PIP, basicLine, filterPrintings, isBasicName, type BasicChoice, type BasicName, type Basics, type Printing } from '../state/basics';
import { h } from './dom';
import { toast } from './toasts';

/** At most this many printings are listed at once; typing narrows them. */
const LIST_MAX = 80;

/** The Card tab's Basic lands section. */
export function buildBasics(app: App, options: () => SpawnOptions): HTMLElement {
  const store = app.store;
  const grid = h('div', { class: 'basics-grid' });
  const counts = new Map<BasicName, HTMLInputElement>();
  const chips = new Map<BasicName, HTMLButtonElement>();
  for (const b of BASIC_NAMES) {
    const chip = h('button', { class: `chip basic-chip ${BASIC_PIP[b]}` }, b);
    chip.addEventListener('click', () => void spawnBasics(app, [[b, 1]], options()));
    const count = h('input', { type: 'number', min: '0', max: '400', value: '0', 'aria-label': `How many ${b}` });
    chips.set(b, chip);
    counts.set(b, count);
    grid.append(h('div', { class: 'basics-col' }, chip, count));
  }
  const titles = () => {
    for (const [b, chip] of chips) {
      const c = store.basics[b];
      chip.title = `Spawn one ${basicLine(c)}${c.foil ? ', foil' : ''}`;
    }
  };
  store.events.on('basics', titles);
  titles();

  const spawnAll = h('button', { class: 'btn primary' }, 'Spawn basics');
  spawnAll.addEventListener('click', async () => {
    const want: [BasicName, number][] = [];
    for (const [b, input] of counts) {
      const n = Math.max(0, Math.min(400, Math.round(Number(input.value)) || 0));
      if (n) want.push([b, n]);
    }
    if (!want.length) {
      toast('Put a number under the basics you want first', 'warn');
      return;
    }
    spawnAll.disabled = true;
    try {
      if (await spawnBasics(app, want, options())) for (const input of counts.values()) input.value = '0';
    } finally {
      spawnAll.disabled = false;
    }
  });
  const choose = h('button', { class: 'btn small' }, 'Choose basics…');
  choose.addEventListener('click', () => chooseBasics(app));

  return h('div', { class: 'basics' },
    h('div', { class: 'basics-head' }, h('span', { class: 'basics-title' }, 'Basic lands'), choose),
    grid,
    h('div', { class: 'row' }, spawnAll),
  );
}

/** Spawn basics as one pile, like the Card tab's Spawn. True if any were spawned. */
async function spawnBasics(app: App, want: [BasicName, number][], opts: SpawnOptions): Promise<boolean> {
  const basics = app.store.basics;
  const entries: DeckEntry[] = want.map(([b, n], i) => {
    const c = basics[b];
    return { count: n, name: c.name, set: c.set, number: c.number, finish: c.foil ? 'foil' : 'nonfoil', lines: [i + 1], text: basicLine(c) };
  });
  try {
    const res = await resolveEntries(entries);
    for (const u of res.unresolved) toast(`Not found: ${u.text}`, 'warn');
    if (!res.resolved.length) return false;
    const items: SpawnItem[] = res.resolved.map((r) => {
      // A printing that was never made in foil comes nonfoil.
      const foil = r.entry.finish === 'foil' && r.record.finishes.includes('foil');
      if (r.entry.finish === 'foil' && !foil) toast(`${r.entry.text} has no foil, so it came nonfoil`, 'info', 2600);
      return { record: r.record, finish: foil ? 'foil' : 'nonfoil', count: r.entry.count };
    });
    spawnCards(app, items, opts);
    const total = items.reduce((n, i) => n + i.count, 0);
    toast(items.length === 1 ? `Spawned ${total} × ${items[0].record.name}` : `Spawned ${total} basics`, 'ok');
    return true;
  } catch (err) {
    toast(`Could not reach Scryfall: ${String((err as Error).message ?? err)}`, 'error', 5000);
    return false;
  }
}

/** The Choose basics dialog: a printing and a Foil tick for each basic, saved with the table. */
function chooseBasics(app: App): void {
  const store = app.store;
  const rows = BASIC_NAMES.map((b) => basicRow(b, store.basics[b]));
  const error = h('div', { class: 'pe-error' });
  const save = h('button', { class: 'btn primary' }, 'Save');
  const cancel = h('button', { class: 'btn' }, 'Cancel');
  const box = h('div', { class: 'modal basics-modal' },
    h('p', {}, h('strong', {}, 'Choose basics')),
    h('p', { class: 'muted small' }, 'Type to search every printing, or paste a line like Plains (ZEN) 230. The chips spawn these, and they are saved with this table.'),
    ...rows.map((r) => r.el),
    error,
    h('div', { class: 'row end' }, cancel, save),
  );
  const back = h('div', { class: 'modal-back' }, box);
  document.body.append(back);
  rows[0].input.focus();
  const close = () => back.remove();

  const accept = async () => {
    error.textContent = '';
    const next = { ...store.basics } as Basics;
    const entries: DeckEntry[] = [];
    for (const r of rows) {
      r.el.classList.remove('bad');
      const parsed = parseLine(r.input.value);
      if (!parsed || !isBasicName(r.basic, parsed.name) || !parsed.set || !parsed.number) {
        r.el.classList.add('bad');
        error.textContent = `Pick a ${r.basic} from the list, or type one like ${r.basic} (ZEN) ${store.basics[r.basic].number}.`;
        r.input.focus();
        return;
      }
      if (parsed.finish === 'foil') r.foil.checked = true;
      entries.push({ count: 1, name: parsed.name, set: parsed.set, number: parsed.number, finish: 'nonfoil', lines: [entries.length + 1], text: r.input.value.trim() });
    }
    save.disabled = true;
    error.textContent = 'Checking with Scryfall…';
    try {
      const res = await resolveEntries(entries);
      const bad = rows.filter((_, i) => !res.resolved.some((x) => x.entry.lines[0] === i + 1));
      if (bad.length) {
        for (const r of bad) r.el.classList.add('bad');
        error.textContent = `Not found: ${bad.map((r) => r.input.value.trim()).join(', ')}`;
        return;
      }
      for (const x of res.resolved) {
        const r = rows[x.entry.lines[0] - 1];
        next[r.basic] = { name: x.record.name, set: x.record.set, number: x.record.collector_number, foil: r.foil.checked };
      }
      store.setBasics(next);
      toast('Basics saved with this table', 'ok', 1600);
      close();
    } catch (err) {
      error.textContent = `Could not reach Scryfall: ${String((err as Error).message ?? err)}`;
    } finally {
      save.disabled = false;
    }
  };
  save.addEventListener('click', () => void accept());
  cancel.addEventListener('click', close);
  back.addEventListener('keydown', (e) => {
    // Keys typed here never reach the table.
    e.stopPropagation();
    // Esc closes an open list first, then the dialog.
    if (e.key === 'Escape' && !e.defaultPrevented) close();
    if (e.key === 'Enter' && !e.defaultPrevented) void accept();
  });
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
}

interface BasicRow {
  basic: BasicName;
  el: HTMLElement;
  input: HTMLInputElement;
  foil: HTMLInputElement;
}

/** One basic's row: a searchable list of its printings and a Foil tick. */
function basicRow(basic: BasicName, choice: BasicChoice): BasicRow {
  const chosen = basicLine(choice);
  const input = h('input', { class: 'grow', value: chosen, spellcheck: 'false', autocomplete: 'off', 'aria-label': `${basic} printing` });
  const list = h('div', { class: 'suggest', hidden: '' });
  const foil = h('input', { type: 'checkbox', 'aria-label': `${basic} foil` });
  foil.checked = choice.foil;
  let all: Printing[] | null = null;
  let shown: Printing[] = [];
  let active = -1;

  const pick = (p: Printing) => {
    input.value = basicLine(p);
    list.hidden = true;
  };
  const render = () => {
    if (!all) {
      list.replaceChildren(h('div', { class: 'suggest-item muted' }, `Loading every ${basic}…`));
      list.hidden = false;
      return;
    }
    const found = filterPrintings(all, input.value, chosen);
    shown = found.slice(0, LIST_MAX);
    const items = shown.map((p, i) => {
      const el = h('div', { class: 'suggest-item' + (i === active ? ' active' : '') },
        basicLine(p), h('span', { class: 'muted' }, ` · ${p.setName}${p.foil ? '' : ' · no foil'}`));
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(p);
      });
      return el;
    });
    if (found.length > LIST_MAX) items.push(h('div', { class: 'suggest-item muted' }, `${found.length - LIST_MAX} more: type to narrow`));
    if (!found.length) items.push(h('div', { class: 'suggest-item muted' }, 'No printing matches'));
    list.replaceChildren(...items);
    list.hidden = false;
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    render();
    if (!all) {
      printingsOf(basic).then((l) => {
        all = l;
        if (document.activeElement === input) render();
      }, () => {
        list.replaceChildren(h('div', { class: 'suggest-item muted' }, 'Scryfall could not be reached; type a line instead'));
      });
    }
  };
  input.addEventListener('focus', open);
  input.addEventListener('input', () => {
    active = -1;
    open();
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !shown.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      render();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      list.hidden = true;
    }
  });

  const el = h('div', { class: 'basics-row' },
    h('span', { class: `basics-name chip ${BASIC_PIP[basic]}` }, basic),
    h('div', { class: 'suggest-wrap grow' }, input, list),
    h('label', { class: 'inline' }, foil, 'Foil'),
  );
  return { basic, el, input, foil };
}
