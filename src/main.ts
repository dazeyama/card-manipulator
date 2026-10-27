// Boot: store, renderer, physics, UI (spec 4.3).

import './styles/app.css';
import { App } from './app';
import { MouseInput } from './input/mouse';
import { KeyboardInput } from './input/keyboard';
import { scryfall } from './scryfall/client';
import { SpawnPanel } from './ui/spawnPanel';
import { TopBar } from './ui/topBar';
import { setBanner } from './ui/toasts';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { selectAll } from './state/selection';

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

keyboard.bind('ctrl+a', () => selectAll(app.store));
keyboard.bind('escape', () => {
  if (!mouse.cancel()) app.store.clearSelection();
});
keyboard.bind('ctrl+f', () => hud.focus());
keyboard.bind('/', () => hud.focus());

// A 429 pauses the queue; say so while it lasts (spec 5.2).
let bannerTimer = 0;
scryfall.onStatus((s) => {
  const left = s.pausedUntil - Date.now();
  if (left > 0) {
    setBanner(`Scryfall asked us to slow down. Waiting ${Math.ceil(left / 1000)} s…`);
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => setBanner(null), left);
  }
});

app.start();

export const ui = { app, mouse, keyboard, topBar, spawnPanel, hud };

if (import.meta.env.DEV) {
  import('./dev/shot').then((m) => {
    m.installShot(app);
    m.installSpawnFile(app);
  });
  (window as unknown as { app: App; ui: typeof ui }).app = app;
  (window as unknown as { ui: typeof ui }).ui = ui;
}
