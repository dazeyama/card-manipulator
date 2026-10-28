// Boot: store, renderer, physics, UI (spec 4.3).

import './styles/app.css';
import { App } from './app';
import { MouseInput, type CustomGesture } from './input/mouse';
import { KeyboardInput } from './input/keyboard';
import { scryfall } from './scryfall/client';
import { SpawnPanel } from './ui/spawnPanel';
import { TopBar } from './ui/topBar';
import { setBanner, toast } from './ui/toasts';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { selectAll, toggle } from './state/selection';
import { installPileSync } from './state/pileSync';
import { RestSync } from './physics/restSync';
import { Commands, DOUBLE_TAP_MS } from './commands';
import { DragController } from './physics/feel';
import { Badges } from './render/badges';
import { RemovedTray } from './ui/tray';
import { Autosave } from './io/autosave';
import { Physics } from './physics/world';
import { NamedPiles } from './named';
import { Outlines } from './render/outlines';
import { PileEditor } from './ui/pileEditor';
import { InspectPanel } from './ui/inspectPanel';
import { ExportPanel } from './ui/exportPanel';
import { confirmDialog } from './ui/confirm';
import { Cursors } from './ui/cursors';
import { ContextHints } from './ui/hints';
import { HelpPanel } from './ui/helpPanel';
import { buildQueryTab } from './ui/queryTab';
import { HiRes } from './render/hires';
import { SelectionMarkers } from './render/markers';
import { ACCENT } from './app';
import { loadDoc, toDoc, validateDoc } from './io/saveFile';
import { downloadText, pickFile, slug } from './io/download';
import type { TableDoc } from './state/types';

const root = document.getElementById('app')!;
const top = h('div', { class: 'top-host' });
const middle = h('div', { class: 'middle' });
const left = h('div', { class: 'left-host' });
const stageHost = h('div', { class: 'stage-host' });
const right = h('div', { class: 'right-host' });
const bottom = h('div', { class: 'bottom-host' });
middle.append(left, stageHost, right);
root.append(top, middle, bottom);

const app = new App(stageHost);
const mouse = new MouseInput(app);
const keyboard = new KeyboardInput(app, mouse);
const topBar = new TopBar(app, top);
const spawnPanel = new SpawnPanel(app, left);
const hud = new Hud(app, bottom);
app.rest = new RestSync(app);
const pileSync = installPileSync(app.store);
const commands = new Commands(app);
const drag = new DragController(app);
// Cursors that show what the mouse will do (decision 116).
new Cursors(app, mouse, drag);
// A hint line in the play space showing the controls that matter right now (decision 134).
new ContextHints(app, mouse, drag);
const tray = new RemovedTray(app, spawnPanel.trayHost);
const autosave = new Autosave(app);
const store = app.store;
app.named = new NamedPiles(app);
const outlines = new Outlines(app);
const pileEditor = new PileEditor(app);
store.events.on('notice', (msg) => toast(msg, 'warn', 4200));
const inspect = new InspectPanel(app, right);
// Using the play space collapses the side panels for more room, unless pinned open (decision 137).
// They fold when the press ends: resizing the table under a press would move what it lands on.
let pressedTable = false;
app.canvas.parentElement!.addEventListener('pointerdown', () => (pressedTable = true), true);
window.addEventListener('pointerup', () => {
  if (!pressedTable) return;
  pressedTable = false;
  spawnPanel.fold.autoCollapse();
  inspect.fold.autoCollapse();
});
const exporter = new ExportPanel(app);
spawnPanel.addTab('query', 'Query', buildQueryTab(app, () => spawnPanel.options()));
const hires = new HiRes(app);
const markers = new SelectionMarkers(app, ACCENT);
mouse.hooks.hover = (uid) => {
  inspect.hover(uid);
  hires.hovered = uid;
};

// ---- mouse grammar (spec 16) ----

mouse.hooks.cardDrag = (uid, x, y, mods) => {
  // Holding Shift at any moment of a drag sweeps up the cards the cursor passes
  // over (decisions 89, 110). Ctrl + Shift is the formation fallback (decision 29).
  if (store.selection.has(uid) && store.selection.size > 1) {
    const formation = mods.alt || (mods.ctrl && mods.shift);
    return drag.begin([...store.selection], formation ? 'formation' : 'gather', x, y, uid);
  }
  // Dragging an unselected card selects only it; on a stack this peels the top card.
  store.setSelection([uid]);
  return drag.begin([uid], 'single', x, y, uid);
};
mouse.hooks.doubleClickCard = (uid) => commands.toggleSpread(uid);
// Middle-click flips the card, or the whole selection if the card is in it (spec 10.5).
mouse.hooks.middleClickCard = (uid) => commands.flip(store.selection.has(uid) ? [...store.selection] : [uid]);

function pileCards(id: string): string[] {
  if (id.startsWith('spread:')) return store.spreads.get(id.slice(7))?.uids.filter((u) => store.cards.has(u)) ?? [];
  if (id.startsWith('named:')) return [];
  return store.piles.get(id)?.cardUids ?? [];
}

const badges = new Badges(app, {
  press(id, e) {
    const r = app.canvas.getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const y0 = e.clientY - r.top;
    let inner: CustomGesture | null = null;
    mouse.startGesture({
      kind: 'custom',
      move: (x, y, ev) => {
        if (!inner && !id.includes(':') && Math.hypot(x - x0, y - y0) > 4) {
          // Dragging a badge lifts the whole pile, no modifier needed (spec 10.2).
          const uids = pileCards(id);
          store.setSelection(uids);
          inner = drag.begin(uids, 'rigid', x0, y0);
        }
        inner?.move(x, y, ev);
      },
      up: (x, y, ev) => {
        if (inner) inner.up(x, y, ev);
        else if (e.ctrlKey || e.metaKey) toggle(store, pileCards(id));
        else store.setSelection(pileCards(id));
      },
      cancel: () => inner?.cancel(),
    });
  },
  middleClick(id) {
    commands.flip(pileCards(id));
  },
  decorate(pileId, el) {
    // The pencil: name, filter, rename, un-name, delete (spec 11.3).
    const pencil = document.createElement('button');
    pencil.className = 'badge-btn';
    pencil.title = 'Name this pile, set its filter';
    pencil.textContent = '✎';
    pencil.addEventListener('pointerdown', (e) => e.stopPropagation());
    pencil.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      pileEditor.open(pileId, { x: r.left + r.width / 2, y: r.bottom });
    });
    el.append(pencil);
    // Export this pile as a decklist (spec 11.3, 14.1).
    const out = document.createElement('button');
    out.className = 'badge-btn export-trigger';
    out.title = 'Export this pile as a decklist';
    out.textContent = '⤓';
    out.addEventListener('pointerdown', (e) => e.stopPropagation());
    out.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const id = pileId;
      const uids = store.piles.get(id)?.cardUids ?? store.spreads.get(id)?.uids ?? [];
      exporter.open(uids, store.named.get(id)?.name ?? 'pile', { x: r.left + r.width / 2, y: r.bottom });
    });
    el.append(out);
  },
  doubleClick(id) {
    if (id.startsWith('spread:')) commands.restack(id.slice(7));
    else {
      const first = pileCards(id)[0];
      if (first) commands.toggleSpread(first);
    }
  },
});

// ---- keys (spec 16) ----

keyboard.bind('ctrl+a', () => selectAll(store));
keyboard.bind('escape', () => {
  if (!mouse.cancel()) store.clearSelection();
});
keyboard.bind('ctrl+f', () => hud.focus());
keyboard.bind('/', () => hud.focus());
// With nothing selected, the keys act on what is under the cursor (decisions 102, 103):
// F and R on that card, S, X and T on the whole pile it is in.
const hoveredCard = (): string[] => (store.selection.size ? [...store.selection] : mouse.hovered ? [mouse.hovered] : []);
const hoveredPile = (): string[] => {
  if (store.selection.size || !mouse.hovered) return [...store.selection];
  return store.pileOf(mouse.hovered)?.cardUids.slice() ?? [mouse.hovered];
};
// While dragging, S, X, T and F act on the cards in the hand (decision 104).
// S twice quickly shuffles: the stack's cards in a random order (decision 106).
let lastS = 0;
keyboard.bind('s', () => {
  const now = performance.now();
  const twice = now - lastS < DOUBLE_TAP_MS;
  lastS = twice ? 0 : now;
  if (drag.dragging) {
    if (twice) drag.shuffleHeld();
    else drag.stackHeld();
  } else if (twice) commands.shuffle(hoveredPile());
  else commands.stack(hoveredPile());
});
// X on a hovered card toggles its pile's spread, as a double-click does: spread it, or restack it.
keyboard.bind('x', () => (drag.dragging ? drag.spreadHeld() : !store.selection.size && mouse.hovered ? commands.toggleSpread(mouse.hovered) : commands.spread()));
keyboard.bind('t', () => (drag.dragging ? drag.tidyHeld() : commands.tidy(hoveredPile())));
// C: curve out the selection or the hovered pile by mana value; Shift + C: everything
// (or the selection), sorted into a row per colour (decision 107).
keyboard.bind('c', () => {
  // C again on a curve stacks it back up, as S would (decision 108).
  if (!drag.dragging) commands.toggleCurve(curveTargets(), false);
});
// C on a hovered card in a curve column is about the whole curve, not just that column.
const curveTargets = (): string[] => (store.selection.size || !mouse.hovered ? hoveredPile() : [mouse.hovered, ...hoveredPile()]);
const curveAll = () => {
  if (drag.dragging) return;
  commands.curve(store.selection.size ? [...store.selection] : [...store.cards.keys()], true);
};
keyboard.bind('shift+c', curveAll);
// Shift + T: Tidy mode on or off (decision 98).
keyboard.bind('shift+t', () => {
  const on = !store.settings.tidyDrops;
  store.updateSettings({ tidyDrops: on });
  toast(on ? 'Tidy mode on: everything lands squared up at 90°' : 'Tidy mode off: messy and physical', 'info', 1800);
});
// R turns the selection, or the card under the cursor when nothing is selected (decision 102).
// R twice quickly stands cards upright; while dragging, R turns the held cards (decision 103).
let lastR = 0;
keyboard.bind('r', () => {
  const now = performance.now();
  const twice = now - lastR < DOUBLE_TAP_MS;
  lastR = twice ? 0 : now;
  if (drag.dragging) drag.rotate(twice);
  else commands.rotate(hoveredCard(), twice);
});
keyboard.bind('z', () => commands.frame());
// F twice quickly faces every card up, so a mixed stack is fronted (decision 105).
let lastF = 0;
keyboard.bind('f', () => {
  const now = performance.now();
  const twice = now - lastF < DOUBLE_TAP_MS;
  lastF = twice ? 0 : now;
  if (drag.dragging) {
    if (twice) drag.frontHeld();
    else drag.flipHeld();
  } else if (twice) commands.faceUp(hoveredCard());
  else commands.flip(hoveredCard());
});
// N: name the selected pile; with nothing selected, a new empty bin at the cursor (spec 11.3).
keyboard.bind('n', () => {
  const near = { x: app.pointer.x + app.canvas.getBoundingClientRect().left, y: app.pointer.y + app.canvas.getBoundingClientRect().top };
  if (!store.selection.size) {
    const at = app.lastTablePoint;
    const id = `p${Date.now().toString(36)}`;
    store.named.set(id, { id, name: 'New pile', filter: null, anchor: { x: at.x, y: at.y }, yaw: 0 });
    store.events.emit('piles', undefined);
    pileEditor.open(id, near, true);
    return;
  }
  const ids = new Set<string>();
  for (const u of store.selection) {
    const c = store.cards.get(u);
    ids.add(c?.pileId ?? `loose:${u}`);
  }
  const [only] = ids;
  if (ids.size === 1 && !only.startsWith('loose:')) {
    const sp = [...store.spreads.values()].find((s) => s.id === only || s.pileId === only);
    const id = sp?.id ?? only;
    // Open beside the pile's badge.
    const badge = document.querySelector(`.badge[data-pile="${sp ? `spread:${id}` : id}"]`);
    const r = badge?.getBoundingClientRect();
    pileEditor.open(id, r && r.width ? { x: r.left + r.width / 2, y: r.bottom } : near);
  } else toast('Select one pile to name it (S stacks a selection into one pile)', 'warn');
});
const removeSelection = () => {
  const n = tray.remove([...store.selection]);
  if (n) toast(`${n} card${n === 1 ? '' : 's'} moved to the Removed tray`);
};
keyboard.bind('delete', removeSelection);
keyboard.bind('backspace', removeSelection);

hud.addButton('Stack', 'Gather the selection into one stack (S); neat in Tidy mode', () => commands.stack());
hud.addButton('Spread', 'Spread the selection in a grid (X)', () => commands.spread());
hud.addButton('Tidy', 'Square up each pile the selection touches (T)', () => commands.tidy());
hud.addButton('Flip', 'Flip the selection over (F)', () => commands.flip());
hud.addButton('Curve', 'Curve the selection out by mana value, or stack it back up if it already is (C)', () => commands.toggleCurve([...store.selection], false));
hud.addButton('By colour', 'Curve everything (or the selection) out by colour, a row per colour (Shift + C)', curveAll);
// Split creatures: curves put creatures and non-creatures in separate bands (decision 107).
const splitBtn = hud.addButton('Split creatures', 'Curves put creatures and non-creatures in separate bands', () => store.updateSettings({ curveSplit: !store.settings.curveSplit }));
const syncSplit = () => {
  splitBtn.classList.toggle('on', store.settings.curveSplit);
  splitBtn.setAttribute('aria-pressed', String(store.settings.curveSplit));
};
store.events.on('settings', syncSplit);
syncSplit();
const exportBtn = hud.addButton('Export', 'Export the selection as a decklist or CSV (Ctrl + E)', () => exportSelection());
exportBtn.classList.add('export-trigger');
function exportSelection(): void {
  const r = exportBtn.getBoundingClientRect();
  exporter.open([...store.selection], 'selection', { x: r.left + r.width / 2 - 120, y: r.top - 360 });
}
keyboard.bind('ctrl+e', () => exportSelection());

// ---- files (spec 14.3) ----

function saveFile(): void {
  const doc = toDoc(app, true);
  downloadText(`${slug(store.name)}.json`, JSON.stringify(doc), 'application/json');
  toast(`Saved ${store.name} (${store.cards.size.toLocaleString()} cards)`, 'ok');
}
async function openFile(): Promise<void> {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let doc: unknown;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    toast('That file is not valid JSON', 'error');
    return;
  }
  const err = validateDoc(doc);
  if (err) {
    toast(err, 'error');
    return;
  }
  if (store.cards.size && !(await confirmDialog(`Replace the table (${store.cards.size.toLocaleString()} cards) with ${file.name}?`, 'Replace'))) return;
  await loadDoc(app, doc as TableDoc);
  toast(`Loaded ${(doc as TableDoc).name}`, 'ok');
}
async function newTable(): Promise<void> {
  if (store.cards.size && !(await confirmDialog(`Clear the table (${store.cards.size.toLocaleString()} cards) and start a new one?`, 'New table'))) return;
  store.clear();
  store.setName('Untitled table');
  app.rig.reset(false);
}
keyboard.bind('ctrl+s', () => saveFile());
const fileBtn = (label: string, title: string, run: () => void) => {
  const b = h('button', { class: 'btn small', title }, label);
  b.addEventListener('click', run);
  topBar.actions.append(b);
  return b;
};
fileBtn('New', 'Clear the table and start a new one', () => void newTable());
fileBtn('Open…', 'Load a saved table file', () => void openFile());
fileBtn('Save', 'Save the table as a file (Ctrl + S)', () => saveFile());
fileBtn('Export', 'Export the whole table as a decklist or CSV', () => exporter.open([...store.cards.keys()], store.name)).classList.add('export-trigger');
// ?: the full controls list (decision 135).
const help = new HelpPanel();
fileBtn('?', 'All the controls (?)', () => help.toggle()).classList.add('help-trigger');
keyboard.bind('?', () => help.toggle());

// A 429 pauses the queue; say so while it lasts (spec 5.2).
let bannerTimer = 0;
scryfall.onStatus((s) => {
  const wait = s.pausedUntil - Date.now();
  if (wait > 0) {
    setBanner(`Scryfall asked us to slow down. Waiting ${Math.ceil(wait / 1000)} s…`);
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => setBanner(null), wait);
  }
});

app.start();
void autosave.restore();

const physics = new Physics(app);
physics
  .init()
  .then(() => (app.physics = physics))
  .catch((err) => console.warn('Physics failed to load; drops land without it', err));

export const ui = { app, mouse, keyboard, topBar, spawnPanel, hud, commands, drag, badges, tray, autosave, pileSync, physics, outlines, pileEditor, inspect, exporter, saveFile, openFile, newTable, hires, markers };

if (import.meta.env.DEV) {
  // The phase gate reads this to confirm the page logged no errors since it loaded.
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
    origError(...args);
  };
  (window as unknown as { __errors: string[] }).__errors = errors;
  import('./dev/shot').then((m) => {
    m.installShot(app);
    m.installSpawnFile(app);
  });
  import('./dev/regression').then((m) => m.installRegression(app, ui));
  (window as unknown as { app: App; ui: typeof ui }).app = app;
  (window as unknown as { ui: typeof ui }).ui = ui;
}
