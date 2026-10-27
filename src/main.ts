// Boot: store, renderer, physics, UI (spec 4.3).

import './styles/app.css';
import { App, levelZ } from './app';
import { MouseInput } from './input/mouse';
import { KeyboardInput } from './input/keyboard';
import { newUid } from './state/store';
import type { Card } from './state/types';

const app = new App(document.getElementById('app')!);
const mouse = new MouseInput(app);
new KeyboardInput(app, mouse);

// Phase 1: fifty numbered placeholder cards through the instanced path.
function placeholderCards(): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < 40; i++) {
    const col = i % 8;
    const row = Math.floor(i / 8);
    cards.push({
      uid: newUid(), scryfallId: `placeholder:${i + 1}`, finish: i === 5 ? 'foil' : 'nonfoil',
      x: (col - 3.5) * 75, y: (2 - row) * 100, z: levelZ(0), yaw: 0, faceUp: i !== 7, pileId: null, spreadOf: null,
    });
  }
  for (let i = 0; i < 10; i++) {
    cards.push({
      uid: newUid(), scryfallId: `placeholder:${41 + i}`, finish: 'nonfoil',
      x: 420, y: 0, z: levelZ(i), yaw: 0, faceUp: true, pileId: null, spreadOf: null,
    });
  }
  return cards;
}

app.store.addCards(placeholderCards());
app.start();

if (import.meta.env.DEV) {
  import('./dev/shot').then((m) => m.installShot(app));
  (window as unknown as { app: App }).app = app;
}
