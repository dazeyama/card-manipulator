// Boot: store, renderer, physics, UI (spec 4.3).

import './styles/app.css';
import { App } from './app';
import { MouseInput, type CustomGesture } from './input/mouse';
import { isTyping, KeyboardInput } from './input/keyboard';
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
import { confirmDialog, numberDialog } from './ui/confirm';
import { Cursors } from './ui/cursors';
import { Mats } from './mats';
import { buildPlaymatTab } from './ui/playmatTab';
import { ContextHints } from './ui/hints';
import { HelpPanel } from './ui/helpPanel';
import { buildQueryTab } from './ui/queryTab';
import { HiRes } from './render/hires';
import { installFit } from './ui/fit';
import pointUrl from '../art/cursors/point-48-bold.png';
import { installRecordUpgrade } from './scryfall/upgrade';
import { buildCubeTab } from './ui/cubeTab';
import { installClipboard } from './io/clipboard';
import { Undo } from './undo';
import { fitLayout, gridLayout } from './state/piles';
import { Graphics } from './graphics';
import { SelectionMarkers } from './render/markers';
import { SpreadPreview } from './ui/spreadPreview';
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
// Laid out for 1800 px: narrower windows shrink the panels, and below 1280 px a warning covers the page (decision 157).
installFit();

const app = new App(stageHost);
const mouse = new MouseInput(app);
const keyboard = new KeyboardInput(app, mouse);
const topBar = new TopBar(app, top);
const spawnPanel = new SpawnPanel(app, left);
const hud = new Hud(app, bottom);
app.rest = new RestSync(app);
const pileSync = installPileSync(app.store);
// Cards cached before EDHREC rank was kept are fetched again once (decision 187).
installRecordUpgrade(app.store);
const commands = new Commands(app);
const drag = new DragController(app);
// Cursors that show what the mouse will do (decision 116).
new Cursors(app, mouse, drag);
// A hint line in the play space showing the controls that matter right now (decision 134).
new ContextHints(app, mouse, drag);
const tray = new RemovedTray(app, spawnPanel.trayHost);
// Ctrl + Z: one-step undo; pressed again, redo (decision 204).
const undo = new Undo(app, tray, drag);
keyboard.beforeKey = (e) => undo.markKey(e);
keyboard.bind('ctrl+z', () => {
  const did = undo.swap();
  if (did === 'undo') toast('Undone (Ctrl + Z again to redo)', 'info', 1600);
  else if (did === 'redo') toast('Redone', 'info', 1200);
  else toast(drag.dragging ? 'Let go of the cards first' : 'Nothing to undo', 'info', 1400);
});
const autosave = new Autosave(app);
const store = app.store;
app.named = new NamedPiles(app);
const outlines = new Outlines(app);
const pileEditor = new PileEditor(app);
store.events.on('notice', (msg) => toast(msg, 'warn', 4200));
const inspect = new InspectPanel(app, right);
// Playmats (decision 144): drawn under the cards, dragged where no card is.
const mats = new Mats(app);
app.mats = mats;
// Pressing on the play space collapses the side panels for more room, unless pinned open
// (decisions 137, 139). The table widens under the press, so the camera shifts to keep the
// table point under the cursor where it was, before the press itself is handled.
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const before = app.canvas.getBoundingClientRect();
  const grab = app.rig.screenToPlane(e.clientX - before.left, e.clientY - before.top, 0);
  const folded = [spawnPanel.fold.autoCollapse(), inspect.fold.autoCollapse()].some(Boolean);
  if (!folded || !grab) return;
  const after = app.canvas.getBoundingClientRect();
  app.rig.panTo(grab, e.clientX - after.left, e.clientY - after.top);
}, true);
const exporter = new ExportPanel(app);
spawnPanel.addTab('query', 'Query', buildQueryTab(app, () => spawnPanel.options()));
// Ctrl + C copies the selection as a decklist; Ctrl + V spawns the clipboard's cards at the cursor (decision 202).
installClipboard(app, () => spawnPanel.options());
// The 4th tab: playmats from a card's art (decision 144).
spawnPanel.addTab('playmat', 'Playmat', buildPlaymatTab(app, mats));
// A whole CubeCobra cube, with each card's Elo (decision 192), second after List (decision 193).
spawnPanel.addTab('cube', 'Cube', buildCubeTab(app, () => spawnPanel.options()), { after: 'list' });
const hires = new HiRes(app);
// High or Low graphics, on the top bar beside the camera angle (decision 152).
const graphics = new Graphics(app, hires, mats);
topBar.addGraphics(graphics);
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
mouse.hooks.matPress = (x, y, mods) => {
  // A locked mat acts as empty table (decision 154).
  const mat = mats.movableAt(x, y);
  return mat ? mats.press(mat, x, y, mods) : null;
};
// Middle-click flips the card, or the whole selection if the card is in it (spec 10.5).
// Right-click while holding cards drops the bottom one, messy or (Ctrl) squared; held down,
// another every quarter second until the hand is empty or the button is let go (decisions 180, 182).
const DEAL_EVERY_MS = 250;
let dealTimer = 0;
const stopDealing = () => {
  clearInterval(dealTimer);
  dealTimer = 0;
};
/** Start dealing from the hand: one card now, then one every quarter second. False if nothing is held. */
// Each card dealt shows the dealing glove, as drawing a hand does (decision 185).
const dealOne = () => {
  app.showGesture('draw');
  drag.dropBottom();
};
const startDealing = (): boolean => {
  if (!drag.dragging) return false;
  dealOne();
  stopDealing();
  dealTimer = window.setInterval(() => {
    if (drag.dragging) dealOne();
    else stopDealing();
  }, DEAL_EVERY_MS);
  return true;
};
mouse.hooks.rightWhileHolding = startDealing;
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) stopDealing();
});
// Space does the same while cards are held, as it is the other pan control beside right-drag (decision 181).
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.repeat || isTyping()) return;
  if (startDealing()) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') stopDealing();
});
window.addEventListener('blur', stopDealing);
// Middle-click while holding cards flips them in the hand, as F does (decision 179).
mouse.hooks.middleWhileHolding = () => {
  if (!drag.dragging) return false;
  app.showGesture('flip');
  drag.flipHeld();
  return true;
};
mouse.hooks.middleClickCard = (uid) => {
  // Middle-click flips too, so it shows the flip gesture (decision 165).
  app.showGesture('flip');
  commands.flip(store.selection.has(uid) ? [...store.selection] : [uid]);
};

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
    app.showGesture('flip');
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
  // S S shows the shuffling hands until the cards settle (decision 165); S has no gesture.
  if (twice && (drag.dragging || hoveredPile().length)) app.showGesture('shuffle', drag.dragging ? drag.heldUids : hoveredPile());
  if (drag.dragging) {
    if (twice) drag.shuffleHeld();
    else drag.stackHeld();
  } else if (twice) commands.shuffle(hoveredPile());
  else commands.stack(hoveredPile());
});
// X (decision 159): the pointing glove; the next click spreads the selection (or the hovered
// pile) centred there, or a dragged box spreads it to fit inside the box. X on a spread
// restacks it at once; X twice quickly spreads in place, as X used to. Esc cancels.
let lastX = 0;
const startSpread = (source: string[]) => {
  app.drawing = null;
  app.placing = null;
  app.spreading = source.length ? { source } : null;
};
keyboard.bind('x', () => {
  if (drag.dragging) return drag.spreadHeld();
  const now = performance.now();
  const twice = now - lastX < 400;
  lastX = now;
  if (twice && app.spreading) {
    const { source } = app.spreading;
    app.spreading = null;
    return commands.spread(source);
  }
  const card = !store.selection.size && mouse.hovered ? store.cards.get(mouse.hovered) : undefined;
  if (card?.spreadOf && store.spreads.has(card.spreadOf)) return commands.restack(card.spreadOf);
  startSpread(hoveredPile());
});
keyboard.bind('t', () => {
  if (drag.dragging || hoveredPile().length) app.showGesture('tidy');
  if (drag.dragging) drag.tidyHeld();
  else commands.tidy(hoveredPile());
});
// C: curve out the selection or the hovered pile by mana value; Shift + C: everything
// (or the selection), sorted into a row per colour (decision 107).
keyboard.bind('c', () => {
  // C again on a curve stacks it back up, as S would (decision 108).
  if (!drag.dragging) commands.toggleCurve(curveTargets(), false);
});
// E: columns by EDHREC rank; E E: by CubeCobra Elo; E on cards already laid out that way
// stacks them back up (decision 198). E E takes the cards the first E took, wherever they moved.
let lastE = 0;
let eTargets: string[] = [];
keyboard.bind('e', () => {
  if (drag.dragging) return;
  const now = performance.now();
  if (now - lastE < DOUBLE_TAP_MS) {
    lastE = 0;
    commands.rankSort(eTargets, 'elo');
    return;
  }
  lastE = now;
  eTargets = curveTargets();
  commands.toggleRank(eTargets);
});
// C on a hovered card in a curve column is about the whole curve, not just that column.
const curveTargets = (): string[] => (store.selection.size || !mouse.hovered ? hoveredPile() : [mouse.hovered, ...hoveredPile()]);
const curveAll = () => {
  if (drag.dragging) return;
  // Laid out in the middle of the view, where you are looking (decision 191).
  const t = app.rig.target;
  commands.curve(store.selection.size ? [...store.selection] : [...store.cards.keys()], true, { x: t.x, y: t.y });
};
keyboard.bind('shift+c', curveAll);
// 1-9: draw that many cards from the hovered pile (or the selection); the next click on the
// table lays them out there as a fanned hand, face up (decision 143). Esc cancels.
for (let n = 1; n <= 9; n++) {
  keyboard.bind(String(n), () => {
    if (drag.dragging) return;
    const source = hoveredPile();
    app.spreading = null;
    app.placing = null;
    app.drawing = source.length ? { count: n, source } : null;
  });
}
// 0: the same, for any number of cards, asked for in a dialog: a whole sealed pool at once (decision 162).
let askingCount = false;
keyboard.bind('0', () => {
  if (drag.dragging || askingCount) return;
  const source = hoveredPile();
  if (!source.length) return;
  app.spreading = null;
  app.drawing = null;
  askingCount = true;
  const all = source.length;
  void numberDialog(`How many cards to draw? This pile has ${all.toLocaleString()}.`, { min: 1, max: all, value: all, ok: 'Draw' })
    .then((n) => {
      if (n && source.some((u) => store.cards.has(u))) app.drawing = { count: n, source };
    })
    .finally(() => (askingCount = false));
});
// Pointer mode (decision 189): the finger button beside the search box, then a click on the
// table moves the selection there as one stack (squared in Tidy mode). Esc cancels.
const pointBtn = h('button', { class: 'btn small point-btn', title: 'Move the selection (P): click here, then click the table where it should go, as a stack' }, h('img', { src: pointUrl, alt: 'Point' }), ' (P)');
/** Turn pointer mode on for some cards, or off. */
const togglePointer = (source: string[]) => {
  if (app.placing) {
    app.placing = null;
  } else if (source.length) {
    app.drawing = null;
    app.spreading = null;
    app.placing = { source };
  } else {
    toast('Select some cards first, then click where they should go', 'warn');
  }
};
pointBtn.addEventListener('click', () => togglePointer([...store.selection]));
// P does the same, for the selection or the pile under the cursor, like the other keys (decision 195).
keyboard.bind('p', () => {
  if (!drag.dragging) togglePointer(hoveredPile());
});
app.onFrame(() => pointBtn.classList.toggle('on', !!app.placing));
hud.addBesideSearch(pointBtn);
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const place = app.placing;
  if (!place || e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  app.placing = null;
  const r = app.canvas.getBoundingClientRect();
  const at = app.rig.screenToPlane(e.clientX - r.left, e.clientY - r.top, 0);
  const cards = place.source.filter((u) => store.cards.has(u));
  if (at && cards.length) commands.stackAt(cards, at);
}, true);
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const draw = app.drawing;
  if (!draw || e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  app.drawing = null;
  const r = app.canvas.getBoundingClientRect();
  const at = app.rig.screenToPlane(e.clientX - r.left, e.clientY - r.top, 0);
  if (at) {
    app.showGesture('draw');
    commands.dealHand(draw.source, draw.count, at);
  }
}, true);
// Spreading (decision 159): a click spreads the cards centred there; a drag draws a box they fit inside.
const spreadBox = h('div', { class: 'marquee' });
spreadBox.hidden = true;
app.overlay.append(spreadBox);
// While the box is dragged, the outlines of where the cards will land (decision 207).
const spreadPreview = new SpreadPreview(app);
let endSpreadGesture: (() => void) | null = null;
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const spreading = app.spreading;
  if (!spreading || e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const r = app.canvas.getBoundingClientRect();
  const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
  let x1 = x0, y1 = y0, boxed = false;
  const move = (ev: PointerEvent) => {
    x1 = ev.clientX - r.left;
    y1 = ev.clientY - r.top;
    if (!boxed && Math.hypot(x1 - x0, y1 - y0) > 4) boxed = true;
    if (!boxed) return;
    spreadBox.hidden = false;
    Object.assign(spreadBox.style, {
      left: `${Math.min(x0, x1)}px`,
      top: `${Math.min(y0, y1)}px`,
      width: `${Math.abs(x1 - x0)}px`,
      height: `${Math.abs(y1 - y0)}px`,
    });
    const box = tableBox(x0, y0, x1, y1);
    const count = spreading.source.filter((u) => store.cards.has(u)).length;
    if (box && count) spreadPreview.show(fitLayout(count, box));
    else spreadPreview.hide();
  };
  const end = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    spreadBox.hidden = true;
    spreadPreview.hide();
    endSpreadGesture = null;
  };
  const up = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    end();
    app.spreading = null;
    if (boxed) {
      const box = tableBox(x0, y0, x1, y1);
      if (box) commands.spreadTo(spreading.source, (n) => fitLayout(n, box));
      return;
    }
    const at = app.rig.screenToPlane(x0, y0, 0);
    if (at) commands.spreadTo(spreading.source, (n) => gridLayout(n, at));
  };
  endSpreadGesture = end;
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
}, true);
/**
 * The part of the table inside a box drawn on screen: the biggest table-aligned
 * rectangle about the box's centre whose corners all land inside it, since a
 * tilted camera turns the screen box into a trapezoid on the table.
 */
function tableBox(x0: number, y0: number, x1: number, y1: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const l = Math.min(x0, x1), rgt = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
  const rig = app.rig;
  const centre = rig.screenToPlane((l + rgt) / 2, (t + b) / 2, 0);
  const corners = [[l, t], [rgt, t], [rgt, b], [l, b]].map(([sx, sy]) => rig.screenToPlane(sx, sy, 0));
  if (!centre || corners.some((c) => !c)) return null;
  const c = { x: centre.x, y: centre.y };
  const hx = Math.max(...corners.map((p) => Math.abs(p!.x - c.x)));
  const hy = Math.max(...corners.map((p) => Math.abs(p!.y - c.y)));
  const fits = (s: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([dx, dy]) => {
    const p = rig.worldToScreen(c.x + dx * hx * s, c.y + dy * hy * s, 0);
    return p.x >= l - 0.5 && p.x <= rgt + 0.5 && p.y >= t - 0.5 && p.y <= b + 0.5;
  });
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { minX: c.x - hx * lo, minY: c.y - hy * lo, maxX: c.x + hx * lo, maxY: c.y + hy * lo };
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !(app.drawing || app.spreading || app.placing)) return;
  e.stopImmediatePropagation();
  app.drawing = null;
  app.spreading = null;
  app.placing = null;
  endSpreadGesture?.();
}, true);
// H: fan the selection or the hovered pile like a hand of cards; H again stacks it back (decision 141).
keyboard.bind('h', () => {
  if (drag.dragging) return;
  const targets = curveTargets();
  if (targets.length) app.showGesture('fan');
  commands.toggleFan(targets);
});
// Shift + T: Tidy mode on or off (decision 98).
keyboard.bind('shift+t', () => {
  const on = !store.settings.tidyDrops;
  store.updateSettings({ tidyDrops: on });
  toast(on ? 'Tidy mode on: everything lands squared up at 90°' : 'Tidy mode off: messy and physical', 'info', 1800);
});
// R turns the selection, or the card under the cursor when nothing is selected (decision 102).
// R twice quickly stands cards upright; while dragging, R turns the held cards (decision 103).
// R waits a moment to tell one press from two (decisions 184, 188): a single press turns a
// quarter after R_WAIT_MS; a second press within R_DOUBLE_MS stands the cards upright, straight
// from the first press if it comes during the wait, or from the quarter turn if just after.
// Held, R keeps turning a quarter every 0.25 s (decision 183). A playmat has no upright, so R
// turns it at once.
const R_WAIT_MS = 150;
const R_DOUBLE_MS = 300;
let pendingR = 0;
let lastRPress = 0;
let rTargets: string[] = [];
const turn = (upright: boolean, targets: string[]) => {
  if (drag.dragging || targets.length) app.showGesture('rotate');
  if (drag.dragging) drag.rotate(upright);
  else commands.rotate(targets, upright);
};
keyboard.bind('r', (e) => {
  if (e.repeat) {
    // Held: the wait is over, keep turning.
    clearTimeout(pendingR);
    pendingR = 0;
    turn(false, drag.dragging ? [] : hoveredCard());
    return;
  }
  const now = performance.now();
  if (now - lastRPress < R_DOUBLE_MS) {
    // The second press: upright, whether or not the quarter turn has happened yet.
    clearTimeout(pendingR);
    pendingR = 0;
    lastRPress = 0;
    turn(true, rTargets);
    return;
  }
  if (!drag.dragging && !store.selection.size && !mouse.hovered && mats.movable) {
    app.showGesture('rotate');
    mats.rotate(mats.movable);
    return;
  }
  lastRPress = now;
  // The cards are the ones under the cursor now, even if it moves while R waits.
  rTargets = hoveredCard();
  pendingR = window.setTimeout(() => {
    pendingR = 0;
    turn(false, rTargets);
  }, R_WAIT_MS);
}, { repeatMs: 250 });
keyboard.bind('z', () => commands.frame());
// F twice quickly faces every card up, so a mixed stack is fronted (decision 105). Like R, F
// waits a moment to tell one press from two (decision 206): a single press flips after
// F_WAIT_MS; a second press within F_DOUBLE_MS faces the cards up, straight from the first
// press if it comes during the wait, or from the flip if just after.
const F_WAIT_MS = R_WAIT_MS;
const F_DOUBLE_MS = R_DOUBLE_MS;
let pendingF = 0;
let lastFPress = 0;
let fTargets: string[] = [];
const flipOrFront = (front: boolean, targets: string[]) => {
  if (drag.dragging || targets.length) app.showGesture('flip');
  if (drag.dragging) {
    if (front) drag.frontHeld();
    else drag.flipHeld();
  } else if (front) commands.faceUp(targets);
  else commands.flip(targets);
};
keyboard.bind('f', () => {
  const now = performance.now();
  if (now - lastFPress < F_DOUBLE_MS) {
    // The second press: face up, whether or not the flip has happened yet.
    clearTimeout(pendingF);
    pendingF = 0;
    lastFPress = 0;
    flipOrFront(true, fTargets);
    return;
  }
  lastFPress = now;
  // The cards are the ones under the cursor now, even if it moves while F waits.
  fTargets = drag.dragging ? [] : hoveredCard();
  pendingF = window.setTimeout(() => {
    pendingF = 0;
    flipOrFront(false, fTargets);
  }, F_WAIT_MS);
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
  if (store.selection.size || (!mouse.hovered && mats.movable)) app.showGesture('remove');
  // Over a playmat with nothing selected: remove the mat (decision 144).
  if (!store.selection.size && !mouse.hovered && mats.movable) {
    mats.remove(mats.movable);
    return;
  }
  const n = tray.remove([...store.selection]);
  if (n) toast(`${n} card${n === 1 ? '' : 's'} moved to the Removed tray`);
};
keyboard.bind('delete', removeSelection);
keyboard.bind('backspace', removeSelection);

// Each button shows its key in brackets after the icon (decision 156).
hud.addButton('📚 (S) Stack', 'Gather the selection into one stack (S); neat in Tidy mode', () => commands.stack());
hud.addButton('🪟 (X) Spread', 'Spread the selection (X): then click the table to spread it there, or drag a box to fit it inside', () => startSpread([...store.selection]));
hud.addButton('🧹 (T) Tidy', 'Square up each pile the selection touches (T)', () => commands.tidy());
hud.addButton('🃏 (F) Flip', 'Flip the selection over (F)', () => commands.flip());
hud.addButton('🎴 (H) Fan', 'Fan the selection like a hand of cards, or stack a fan back up (H)', () => commands.toggleFan([...store.selection]));
// Before Curve (decision 200): the rank view, by EDHREC; a click again within a moment switches to Elo, like E E (decision 198).
let lastRankClick = 0;
hud.addButton('🏆 (E) Rank', 'Rank: columns by EDHREC rank (E), or by CubeCobra Elo (E E or a second click); again on a sorted view stacks it back up', () => {
  const now = performance.now();
  const twice = now - lastRankClick < DOUBLE_TAP_MS;
  lastRankClick = twice ? 0 : now;
  if (twice) commands.rankSort([...store.selection], 'elo');
  else commands.toggleRank([...store.selection]);
});
hud.addButton('📊 (C) Curve', 'Curve the selection out by mana value, or stack it back up if it already is (C)', () => commands.toggleCurve([...store.selection], false));
hud.addButton('🎨 (Shift C) Color', 'Color curve (Shift + C): curve everything (or the selection) out by colour, a row per colour (Shift + C)', curveAll);
// Split creatures: curves put creatures and non-creatures in separate bands (decision 107).
const splitBtn = hud.addButton('🐉 Split', 'Split creatures: curves and the rank view (E) put creatures and non-creatures in separate bands', () => store.updateSettings({ curveSplit: !store.settings.curveSplit }));
const syncSplit = () => {
  splitBtn.classList.toggle('on', store.settings.curveSplit);
  splitBtn.setAttribute('aria-pressed', String(store.settings.curveSplit));
};
store.events.on('settings', syncSplit);
syncSplit();
const exportBtn = hud.addButton('📤 (Ctrl E) Export', 'Export the selection as a decklist or CSV (Ctrl + E)', () => exportSelection());
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
void autosave.restore().then((had) => {
  if (!had) void loadWelcome();
});

/** A first visit, with no table saved in this browser, opens a table with cards on it to play with (decision 153). */
async function loadWelcome(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}welcome-table.json`);
    if (!res.ok) return;
    const doc: unknown = await res.json();
    // Something may have been spawned while it loaded: leave that alone.
    if (validateDoc(doc) || store.cards.size || store.mats.size) return;
    await loadDoc(app, doc as TableDoc);
  } catch {
    // No welcome table: start empty.
  }
}

const physics = new Physics(app);
physics
  .init()
  .then(() => (app.physics = physics))
  .catch((err) => console.warn('Physics failed to load; drops land without it', err));

export const ui = { app, mouse, keyboard, topBar, spawnPanel, hud, commands, undo, drag, badges, tray, autosave, pileSync, physics, outlines, pileEditor, inspect, exporter, saveFile, openFile, newTable, hires, markers };

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
