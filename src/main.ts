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
import { Commands } from './commands';
import { DragController } from './physics/feel';
import { Badges } from './render/badges';
import { RemovedTray } from './ui/tray';
import { Autosave } from './io/autosave';
import { Physics } from './physics/world';

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
const pileSync = installPileSync(app.store);
const commands = new Commands(app);
const drag = new DragController(app);
const tray = new RemovedTray(app, spawnPanel.trayHost);
const autosave = new Autosave(app);
const store = app.store;

// ---- mouse grammar (spec 16) ----

mouse.hooks.cardDrag = (uid, x, y, mods) => {
  // Ctrl + drag lifts the whole stack (decision 23); Ctrl + Shift is the formation fallback (decision 29).
  if (mods.ctrl && !mods.shift) {
    const pile = store.pileOf(uid);
    const uids = pile ? pile.cardUids : [uid];
    store.setSelection(uids);
    return drag.begin(uids, pile ? 'rigid' : 'single', x, y);
  }
  if (store.selection.has(uid) && store.selection.size > 1) {
    const formation = mods.alt || (mods.ctrl && mods.shift);
    return drag.begin([...store.selection], formation ? 'formation' : 'gather', x, y);
  }
  // Dragging an unselected card selects only it; on a stack this peels the top card.
  store.setSelection([uid]);
  return drag.begin([uid], 'single', x, y);
};
mouse.hooks.doubleClickCard = (uid) => commands.toggleSpread(uid);
// Right-click flips the card, or the whole selection if the card is in it (spec 10.5).
mouse.hooks.rightClickCard = (uid) => commands.flip(store.selection.has(uid) ? [...store.selection] : [uid]);

function pileCards(id: string): string[] {
  if (id.startsWith('spread:')) return store.spreads.get(id.slice(7))?.uids.filter((u) => store.cards.has(u)) ?? [];
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
        if (!inner && !id.startsWith('spread:') && Math.hypot(x - x0, y - y0) > 4) {
          // Dragging a badge lifts the whole pile, no modifier needed (spec 10.2).
          const uids = pileCards(id);
          store.setSelection(uids);
          inner = drag.begin(uids, 'rigid', x0, y0);
        }
        inner?.move(x, y, ev);
      },
      up: (x, y, ev) => {
        if (inner) inner.up(x, y, ev);
        else if (e.shiftKey) toggle(store, pileCards(id));
        else store.setSelection(pileCards(id));
      },
      cancel: () => inner?.cancel(),
    });
  },
  rightClick(id) {
    commands.flip(pileCards(id));
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
keyboard.bind('s', () => commands.stack());
keyboard.bind('x', () => commands.spread());
keyboard.bind('t', () => commands.tidy());
keyboard.bind('r', () => commands.rotate());
keyboard.bind('z', () => commands.frame());
keyboard.bind('f', () => commands.flip());
const removeSelection = () => {
  const n = tray.remove([...store.selection]);
  if (n) toast(`${n} card${n === 1 ? '' : 's'} moved to the Removed tray`);
};
keyboard.bind('delete', removeSelection);
keyboard.bind('backspace', removeSelection);

hud.addButton('Stack', 'Gather the selection into one neat stack (S)', () => commands.stack());
hud.addButton('Spread', 'Spread the selection in a grid (X)', () => commands.spread());
hud.addButton('Tidy', 'Square up each pile the selection touches (T)', () => commands.tidy());
hud.addButton('Flip', 'Flip the selection over (F)', () => commands.flip());

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

export const ui = { app, mouse, keyboard, topBar, spawnPanel, hud, commands, drag, badges, tray, autosave, pileSync, physics };

if (import.meta.env.DEV) {
  import('./dev/shot').then((m) => {
    m.installShot(app);
    m.installSpawnFile(app);
  });
  (window as unknown as { app: App; ui: typeof ui }).app = app;
  (window as unknown as { ui: typeof ui }).ui = ui;
}
