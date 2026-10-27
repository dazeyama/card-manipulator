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

export const ui = { app, mouse, keyboard, topBar, spawnPanel };

if (import.meta.env.DEV) {
  import('./dev/shot').then((m) => m.installShot(app));
  (window as unknown as { app: App; ui: typeof ui }).app = app;
  (window as unknown as { ui: typeof ui }).ui = ui;
}
