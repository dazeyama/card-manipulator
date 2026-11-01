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
import { Commands, DOUBLE_TAP_MS, standOf } from './commands';
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
import { buildStandSection } from './ui/standTab';
import { installStandSnap } from './standSnap';
import { LifeCounters } from './ui/lifeCounter';
import { TokenMenu } from './ui/tokenMenu';
import { TokenSearch } from './ui/tokenSearch';
import { DeckSearch } from './ui/deckSearch';
import { DiceColours } from './ui/diceColours';
import { maxValue, valueRange } from './state/dice';
import { Dice } from './dice';
import { DiceLayer } from './render/dice';
import { DiceNumbers } from './ui/diceNumbers';
import { HandCount } from './ui/handCount';
import { alignTo, fromSlope, isStand, raySlope, raySlopeLocal, slopeArea } from './state/stand';
import { uprightYaw, type Placed } from './state/piles';
import type { Mat } from './state/types';
import { buildPlaymatTab } from './ui/playmatTab';
import { ContextHints } from './ui/hints';
import { HelpPanel } from './ui/helpPanel';
import { RadialMenu } from './ui/radialMenu';
import { RADIAL_MENU, type RadialItem } from './input/radial';
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
// Rooms: Rules & UI.
import { OnlineUi, showWelcomeNote } from './ui/onlinePanel';
// Rooms: Sync.
import { RoomLayer } from './online/connect';
import { parseHash } from './online/link';
import { HiddenGate } from './online/hidden';
import { allowedNow, Guard, mayMoveCards } from './online/guard';
import type { Action } from '../shared/permissions';

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
const keyboard = new KeyboardInput(app);
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
const hints = new ContextHints(app, mouse, drag);
const tray = new RemovedTray(app, spawnPanel.trayHost);
// Ctrl + Z: one-step undo; pressed again, redo (decision 204).
const undo = new Undo(app, tray, drag);
keyboard.beforeKey = (e) => undo.markKey(e);
keyboard.bind('ctrl+z', () => {
  const did = undo.swap();
  if (did === 'undo') toast('Undone (Ctrl + Z again to redo)', 'info', 1600);
  else if (did === 'redo') toast('Redone', 'info', 1200);
  // In a room: someone else moved what your last action moved (ONLINE.md 12.4).
  else if (did === 'touched') toast('Someone else has moved those since', 'warn', 2000);
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
// No card is ever under a card stand (decision 222).
installStandSnap(app);
// Dice (decision 255): D drops one at the cursor; they select and drag like cards, above them.
const diceLayer = new DiceLayer(app);
const dice = new Dice(app, diceLayer);
app.dice = dice;
// The number over a die when hovered, or over every die when they're small on screen (decision 265).
new DiceNumbers(app, dice, diceLayer);
// Dragging selected dice brings the selected cards too (decision 274).
dice.cardsAlong = (x, y, alt, aside) => (drag.dragging ? null : drag.begin([...store.selection], alt ? 'formation' : 'gather', x, y, undefined, aside));
mouse.hooks.objectPress = (x, y, mods) => {
  const uid = diceLayer.pick(x, y);
  return uid ? dice.press(uid, x, y, mods) : null;
};
mouse.hooks.marquee = (rect, mode) => {
  const inside = dice.inRect(rect);
  if (mode === 'replace') dice.select(inside);
  else if (mode === 'add') dice.select(inside, true);
  else {
    for (const u of inside) dice.selected.delete(u);
    dice.select(dice.selected, true);
  }
};
// M: mirror mode, the far side of the table (decision 267).
keyboard.bind('m', () => {
  app.rig.setMirrored(!app.rig.mirrored);
  toast(app.rig.mirrored ? 'Mirror mode: the far side of the table' : 'Back to your side of the table', 'info', 1400);
});
// D D: a d20 instead, swapped in where the six-sided die just landed (decision 278).
let lastD: { at: number; uid: string; spot: { x: number; y: number } } | null = null;
keyboard.bind('d', () => {
  if (drag.dragging) return;
  const now = performance.now();
  if (lastD && now - lastD.at < DOUBLE_TAP_MS) {
    dice.remove([lastD.uid]);
    dice.spawn(lastD.spot, 'd20');
    lastD = null;
    return;
  }
  const spot = { x: app.lastTablePoint.x, y: app.lastTablePoint.y };
  lastD = { at: now, uid: dice.spawn(spot), spot };
});
// The wheel over a die turns its number up or down, Shift 5 at a time (decision 278).
mouse.hooks.wheelObject = (x, y, up, shift) => {
  if (!diceLayer.pick(x, y)) return false;
  dice.step(dice.targets(), (up ? 1 : -1) * (shift ? 5 : 1));
  return true;
};
// C over a die (or with only dice selected) opens its colour menu (decision 278).
const diceColours = new DiceColours(dice);
const colourTargets = (): string[] => (dice.hovered || (!store.selection.size && !mouse.hovered) ? dice.targets() : []);
// A life counter on every playmat (decision 239).
new LifeCounters(app, mats);
// A hovered stand counts the cards on it (decision 250).
new HandCount(app, mats);
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
// Card stands are spawned from the Playmat tab too, below the playmat (decisions 220, 235).
const playmatPane = buildPlaymatTab(app, mats);
playmatPane.append(buildStandSection(app, mats));
spawnPanel.addTab('playmat', 'Playmat', playmatPane);
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
  // Selected dice come along with the selected cards (decision 274).
  const withDice = store.selection.has(uid) && dice.selected.size > 0;
  if (store.selection.has(uid) && (store.selection.size > 1 || withDice)) {
    const formation = mods.alt || (mods.ctrl && mods.shift);
    const g = drag.begin([...store.selection], formation ? 'formation' : 'gather', x, y, uid);
    return withDice ? dice.along(g, x, y, formation) : g;
  }
  // Dragging an unselected card selects only it, even with Ctrl held; on a stack this peels the top card.
  dice.select([]);
  store.setSelection([uid]);
  return drag.begin([uid], 'single', x, y, uid);
};
// Double-click taps, a quarter turn each, and untaps back to 0 degrees the next time (decisions
// 245, 246, 248, 292): the selection if the card was in it, else just the card. A face-down card selects its stack (decision 291).
// Dealing onto a stand's slope makes everything there one hand (decision 249).
drag.onDealt = (m, uids) => commands.joinSlopeHand(m, uids);
mouse.hooks.doubleClickCard = (uid, before) => {
  if (!store.cards.has(uid)) return;
  // A face-down card: select its whole stack, never turn it; tapping is for face-up cards (decision 291).
  if (!store.cards.get(uid)!.faceUp) {
    store.setSelection(store.pileOf(uid)?.cardUids.slice() ?? [uid]);
    return;
  }
  let targets: string[];
  if (before.length > 1 && before.includes(uid)) {
    targets = before.filter((u) => store.cards.has(u));
    store.setSelection(targets);
    // Otherwise just the card, never the rest of its stack (decision 292).
  } else targets = [uid];
  // All upright: tap them; any turned: untap them all.
  const upright = targets.every((u) => {
    const c = store.cards.get(u)!;
    return Math.abs(c.yaw - uprightYaw(c.yaw, app.facing)) < 1e-3;
  });
  app.showGesture('rotate', targets);
  commands.rotate(targets, !upright);
};
mouse.hooks.matPress = (x, y, mods) => {
  // A locked mat acts as empty table (decision 154).
  const mat = mats.movableAt(x, y);
  return mat ? mats.press(mat, x, y, mods) : null;
};
// A click on bare table unselects the mat; on a locked mat or stand, a double-click still selects its cards (decision 233).
mouse.hooks.emptyClick = (x, y) => {
  // A click on the table drops the dice selection too (decision 255).
  dice.select([]);
  mats.clicked(mats.matAt(x, y));
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
          // In a room: Move, and the owner of a stand the pile lies on (ONLINE.md 6.4).
          if (!mayMoveCards(uids)) return;
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
    // In a room, restacking or spreading a pile needs Move (ONLINE.md 6.2); Commands leaves out stands you may not touch.
    if (!allowedNow('move')) return;
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
/**
 * Hover comes before the selection (decisions 247, 254): a key pressed over a card
 * that isn't selected drops the selection first, so it acts on that card or its
 * pile; over a selected card or bare table it acts on the selection.
 */
const hoverFirst = () => {
  if (mouse.hovered && !store.selection.has(mouse.hovered)) store.clearSelection();
};
const hoveredCard = (): string[] => {
  hoverFirst();
  return store.selection.size ? [...store.selection] : mouse.hovered ? [mouse.hovered] : [];
};
const hoveredPile = (): string[] => {
  hoverFirst();
  if (store.selection.size || !mouse.hovered) return [...store.selection];
  return store.pileOf(mouse.hovered)?.cardUids.slice() ?? [mouse.hovered];
};
/** What 1-9 and 0 draw from (decision 247). */
const drawSource = hoveredPile;
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
// restacks it at once. Once armed, each X switches to the reverse spread, rows laid right to
// left so the mana costs show, and back, even while the box is being drawn (decisions 215, 216).
// Esc cancels.
const startSpread = (source: string[]) => {
  app.drawing = null;
  app.placing = null;
  app.spreading = source.length ? { source } : null;
};
keyboard.bind('x', () => {
  if (drag.dragging) return drag.spreadHeld();
  if (app.spreading) {
    // The same object, so a box being drawn sees the change.
    app.spreading.reverse = !app.spreading.reverse;
    refreshSpreadPreview?.();
    return;
  }
  const card = !store.selection.size && mouse.hovered ? store.cards.get(mouse.hovered) : undefined;
  if (card?.spreadOf && store.spreads.has(card.spreadOf)) return commands.restack(card.spreadOf);
  startSpread(hoveredPile());
});
// T T over a card: the tokens it makes, from its Scryfall data (decision 264); over empty
// table, a small token search there, spawning at that spot (decision 308).
const tokenMenu = new TokenMenu(app, () => spawnPanel.options());
const tokenSearch = new TokenSearch(app, () => spawnPanel.options());
let lastT = 0;
keyboard.bind('t', () => {
  const now = performance.now();
  const twice = now - lastT < DOUBLE_TAP_MS;
  lastT = twice ? 0 : now;
  if (twice && !drag.dragging) {
    const r = app.canvas.getBoundingClientRect();
    const at = { x: r.left + app.pointer.x, y: r.top + app.pointer.y };
    if (mouse.hovered) void tokenMenu.open(mouse.hovered, at);
    else tokenSearch.open(at, app.tablePointUnderCursor());
    return;
  }
  if (drag.dragging || hoveredPile().length) app.showGesture('tidy');
  if (drag.dragging) drag.tidyHeld();
  else commands.tidy(hoveredPile());
});
// C: curve out the selection or the hovered pile by mana value; Shift + C: everything
// (or the selection), sorted into a row per colour (decision 107). C C: the same cards in a
// column per colour, W U B R G C M L (decision 217), as E E follows E.
let lastC = 0;
let cTargets: string[] = [];
keyboard.bind('c', () => {
  if (drag.dragging) return;
  const painting = colourTargets();
  if (painting.length) {
    const r = app.canvas.getBoundingClientRect();
    diceColours.show(painting, { x: r.left + app.pointer.x, y: r.top + app.pointer.y });
    return;
  }
  const now = performance.now();
  if (now - lastC < DOUBLE_TAP_MS) {
    lastC = 0;
    commands.colourSort(cTargets);
    return;
  }
  lastC = now;
  cTargets = curveTargets();
  // C again on a curve stacks it back up, as S would (decision 108).
  commands.toggleCurve(cTargets, false);
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
// Shift + 1-9 deals them face down instead, as 0 with Face down? ticked does (decision 271).
for (let n = 1; n <= 9; n++) {
  keyboard.bind(String(n), () => {
    if (drag.dragging) return;
    // 1-9 over a die, or with dice selected, set the number on top, on each die that has it (decisions 255, 278).
    // A number no die there has (7 on a six-sided die) still draws cards.
    const set = dice.targets().filter((u) => n <= maxValue(store.dice.get(u)?.kind));
    if (set.length) {
      dice.set(set, n);
      return;
    }
    const source = drawSource();
    app.spreading = null;
    app.placing = null;
    app.drawing = source.length ? { count: n, source } : null;
  });
  keyboard.bind(`shift+${n}`, () => {
    if (drag.dragging) return;
    const source = drawSource();
    app.spreading = null;
    app.placing = null;
    app.drawing = source.length ? { count: n, source, faceDown: true } : null;
  });
}
// 0: the same, for any number of cards, asked for in a dialog: a whole sealed pool at once (decision 162).
// Shift + 0 opens it with Face down? ticked (decision 271).
let askingCount = false;
let zeroFaceDown = false;
const askCount = (faceDown: boolean) => {
  if (drag.dragging || askingCount) return;
  const source = drawSource();
  if (!source.length) return;
  app.spreading = null;
  app.drawing = null;
  askingCount = true;
  const all = source.length;
  // Face down? deals them as face-down messy piles instead of a hand (decision 236); the tick is remembered.
  void numberDialog(`How many cards to draw? This pile has ${all.toLocaleString()}.`, { min: 1, max: all, value: all, ok: 'Draw', check: { label: 'Face down? (in piles of 15, not a hand)', checked: faceDown } })
    .then((r) => {
      if (!r) return;
      zeroFaceDown = r.checked;
      if (source.some((u) => store.cards.has(u))) app.drawing = { count: r.value, source, faceDown: r.checked };
    })
    .finally(() => (askingCount = false));
};
// 0 over a die, or with dice selected, asks for the number to show, as for drawing (decision 278);
// a d20 takes any number from 0 to 999,999 (decision 279).
keyboard.bind('0', () => {
  const set = dice.targets();
  if (!set.length) return askCount(zeroFaceDown);
  if (drag.dragging || askingCount) return;
  const ranges = set.map((u) => valueRange(store.dice.get(u)?.kind));
  const min = Math.min(...ranges.map((r) => r.min)), max = Math.max(...ranges.map((r) => r.max));
  askingCount = true;
  void numberDialog('Set the die to:', { min, max, value: store.dice.get(set[0])?.value ?? 1, ok: 'Set' })
    .then((r) => {
      if (r) dice.set(set, r.value);
    })
    .finally(() => (askingCount = false));
});
keyboard.bind('shift+0', () => askCount(true));
// Pointer mode (decision 189): the finger button beside the search box, then a click on the
// table moves the selection there as one stack (squared in Tidy mode). Esc cancels.
const pointBtn = h('button', { class: 'btn small point-btn', title: 'Move the selection (P): click here, then click the table where it should go, as a stack. Click again (or P) to switch to face down, like a pack, and back; Esc cancels' }, h('img', { src: pointUrl, alt: 'Point' }), ' (P)');
/**
 * Turn pointer mode on for some cards; once on, each press switches between
 * placing them as they are and face down like a pack, as X switches its two
 * spreads (decisions 216, 228). Esc turns it off.
 */
const togglePointer = (source: string[]) => {
  if (app.placing) {
    // The same object, as the click reads it.
    app.placing.faceDown = !app.placing.faceDown;
  } else if (source.length) {
    app.drawing = null;
    app.spreading = null;
    app.placing = { source };
  } else {
    toast('Select some cards first, then click where they should go', 'warn');
  }
};
pointBtn.addEventListener('click', () => togglePointer([...store.selection]));
// P does the same, for the selection or the pile under the cursor, like the other keys (decision 195);
// pressed again while armed, it switches to face down, like a pack of draft cards, and back (decisions 226, 228).
keyboard.bind('p', () => {
  if (!drag.dragging) togglePointer(hoveredPile());
});
app.onFrame(() => pointBtn.classList.toggle('on', !!app.placing));
hud.addBesideSearch(pointBtn);
// L: search a face-up pile without spreading it; L L: a face-down one, a deck (decision 310), so a
// single press never looks at hidden cards by mistake. A click on a card takes it out as P does.
const deckSearch = new DeckSearch(app, {
  inspect: (uid) => inspect.hover(uid ?? mouse.hovered),
  point: (uids) => togglePointer(uids),
  shuffle: (uids) => commands.shuffle(uids),
});
let lastL = 0;
let lTimer = 0;
keyboard.bind('l', () => {
  if (drag.dragging) return;
  const now = performance.now();
  const twice = now - lastL < DOUBLE_TAP_MS;
  lastL = twice ? 0 : now;
  clearTimeout(lTimer);
  const pile = hoveredPile();
  if (!pile.length) return void toast('Rest the cursor on a pile, or select one, then press L', 'warn');
  const r = app.canvas.getBoundingClientRect();
  const at = { x: r.left + app.pointer.x, y: r.top + app.pointer.y };
  const faceDown = pile.some((u) => !store.cards.get(u)?.faceUp);
  if (twice) {
    // In a room, looking through hidden cards needs Move, as moving them would.
    if (faceDown && app.online && !allowedNow('move')) return;
    deckSearch.start(pile, true, at);
  } else if (!faceDown) deckSearch.start(pile, false, at);
  // A face-down pile waits for the second L, and says so if it doesn't come.
  else lTimer = window.setTimeout(() => toast('Face-down pile: press L twice to search it', 'info', 1800), DOUBLE_TAP_MS);
});
/** A card stand's slope under a screen point, and the spot on it (the slope unrolled), or null (decision 221). */
const slopeUnder = (sx: number, sy: number): { m: Mat; at: { x: number; y: number } } | null => {
  const r = app.rig.rayFrom(sx, sy);
  for (const m of store.mats.values()) {
    if (!isStand(m)) continue;
    const at = raySlope(m, r.origin, r.direction);
    if (at) return { m, at };
  }
  return null;
};
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const place = app.placing;
  if (!place || e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  app.placing = null;
  const r = app.canvas.getBoundingClientRect();
  const slope = slopeUnder(e.clientX - r.left, e.clientY - r.top);
  const at = slope?.at ?? app.rig.screenToPlane(e.clientX - r.left, e.clientY - r.top, 0);
  const cards = place.source.filter((u) => store.cards.has(u));
  if (at && cards.length) commands.stackAt(cards, at, slope?.m ?? null, !!place.faceDown);
}, true);
app.canvas.parentElement!.addEventListener('pointerdown', (e) => {
  const draw = app.drawing;
  if (!draw || e.button !== 0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  app.drawing = null;
  const r = app.canvas.getBoundingClientRect();
  const slope = slopeUnder(e.clientX - r.left, e.clientY - r.top);
  const at = slope?.at ?? app.rig.screenToPlane(e.clientX - r.left, e.clientY - r.top, 0);
  if (at) {
    app.showGesture('draw');
    if (draw.faceDown) commands.dealPiles(draw.source, draw.count, at, slope?.m ?? null);
    else commands.dealHand(draw.source, draw.count, at, slope?.m ?? null);
  }
}, true);
// Spreading (decision 159): a click spreads the cards centred there; a drag draws a box they fit inside.
const spreadBox = h('div', { class: 'marquee' });
spreadBox.hidden = true;
app.overlay.append(spreadBox);
// While the box is dragged, the outlines of where the cards will land (decision 207).
const spreadPreview = new SpreadPreview(app);
let endSpreadGesture: (() => void) | null = null;
/** Redraws the box's preview, while a box is being drawn: X switches it between plain and reverse. */
let refreshSpreadPreview: (() => void) | null = null;
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
    preview();
  };
  // A box begun on a card stand's slope spreads on the slope, inside the part of it the box covers (decision 222).
  const onSlope = slopeUnder(x0, y0)?.m ?? null;
  const layoutFor = (n: number): Placed[] | null => {
    if (onSlope) {
      const box = slopeBox(onSlope, x0, y0, x1, y1);
      return box ? fromSlope(onSlope, fitLayout(n, box)) : null;
    }
    const box = tableBox(x0, y0, x1, y1);
    // The right way up from your side, mirror mode too (decision 267).
    return box ? alignTo(fitLayout(n, box), { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, app.facing) : null;
  };
  const preview = () => {
    const count = spreading.source.filter((u) => store.cards.has(u)).length;
    const spots = count ? layoutFor(count) : null;
    if (spots) spreadPreview.show(spots, !!spreading.reverse, onSlope);
    else spreadPreview.hide();
  };
  refreshSpreadPreview = () => {
    if (boxed) preview();
  };
  const end = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    spreadBox.hidden = true;
    spreadPreview.hide();
    endSpreadGesture = null;
    refreshSpreadPreview = null;
  };
  const up = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    end();
    app.spreading = null;
    if (boxed) {
      const count = spreading.source.filter((u) => store.cards.has(u)).length;
      if (count && layoutFor(count)) commands.spreadTo(spreading.source, (n) => layoutFor(n) ?? [], !!spreading.reverse, onSlope?.uid ?? null);
      return;
    }
    // Clicked on a card stand's slope: spread to fill the slope, square to it (decisions 221, 222).
    if (onSlope) {
      commands.spreadTo(spreading.source, (n) => fromSlope(onSlope, fitLayout(n, slopeArea(onSlope))), !!spreading.reverse, onSlope.uid);
      return;
    }
    const at = app.rig.screenToPlane(x0, y0, 0);
    if (at) commands.spreadTo(spreading.source, (n) => alignTo(gridLayout(n, at), at, app.facing), !!spreading.reverse);
  };
  endSpreadGesture = end;
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
}, true);
/**
 * The part of a card stand's slope inside a box drawn on screen, in the slope's
 * own frame (decision 222): the box's corners where they meet the slope's
 * plane, cut to the slope.
 */
function slopeBox(m: Mat, x0: number, y0: number, x1: number, y1: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const hits = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([sx, sy]) => {
    const r = app.rig.rayFrom(sx, sy);
    return raySlopeLocal(m, r.origin, r.direction);
  });
  if (hits.some((h) => !h)) return null;
  const as = hits.map((h) => h!.a), ss = hits.map((h) => h!.s);
  const all = slopeArea(m);
  return {
    minX: Math.max(all.minX, Math.min(...as)), maxX: Math.min(all.maxX, Math.max(...as)),
    minY: Math.max(all.minY, Math.min(...ss)), maxY: Math.min(all.maxY, Math.max(...ss)),
  };
}

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
// H H fans it the other size: on a stand's slope the usual size, not the slope's width (decision 272);
// on the table one arc as wide as a stand (decision 303).
let lastH = 0;
let hTargets: string[] = [];
keyboard.bind('h', () => {
  if (drag.dragging) return;
  const now = performance.now();
  if (now - lastH < DOUBLE_TAP_MS) {
    lastH = 0;
    commands.fan(hTargets, true);
    return;
  }
  lastH = now;
  const targets = (hTargets = curveTargets());
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
  // Dice under the cursor or selected roll instead (decision 255).
  const rolling = drag.dragging || e.repeat ? [] : dice.targets();
  if (rolling.length) {
    app.showGesture('shuffle');
    dice.roll(rolling);
    return;
  }
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
// Z frames the selection; with no cards selected, the playmat last moved (decision 214).
// Z again, before the camera has moved, swings back to the view from before (decision 276).
// Selected dice are framed as if each were a card (decision 277).
keyboard.bind('z', () => {
  const picked = [...dice.selected].map((u) => store.dice.get(u)).filter((d) => !!d);
  const box = !store.selection.size && !picked.length && mats.selected ? mats.box(mats.selected) : null;
  if (box) app.rig.frame(box.minX, box.minY, box.maxX, box.maxY, box.top);
  else commands.frame(picked);
});
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
    store.setNamed([{ id, name: 'New pile', filter: null, anchor: { x: at.x, y: at.y }, yaw: 0 }]);
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
  // Dice first (decision 255): the selected ones, or the one under the cursor when nothing is selected.
  const doomed = dice.selected.size ? [...dice.selected] : !store.selection.size && dice.hovered ? [dice.hovered] : [];
  if (doomed.length) {
    app.showGesture('remove');
    dice.remove(doomed);
    if (!store.selection.size) return;
  }
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

// The bar's commands (decisions 301, 302): every item of the radial menu, in its groups, so the two
// can't drift apart. A wedge with more than one item is a button for its first and ▴ for all of
// them; each runs its keys, as the radial does, on the selection (never on a pile under the cursor,
// which is the bar). Icon buttons show their key in the corner.
// Split creatures: curves put creatures and non-creatures in separate bands (decision 107), a tick in the Sort menu.
const splitRow = hud.tickRow('🐉', 'Split creatures', 'Curves and the rank view (E) put creatures and non-creatures in separate bands', () => store.updateSettings({ curveSplit: !store.settings.curveSplit }));
/** The bar's buttons that change the table, greyed by rank in a room. */
const hudMoves: HTMLElement[] = [];
/** Rows whose name depends on whether the selection lies on a stand (H H, decision 307). */
const standRows: { row: HTMLButtonElement; item: RadialItem }[] = [];
for (const w of RADIAL_MENU) {
  const actions = w.items.map((item) => ({ ...item, run: () => runKeys(item, { x: app.pointer.x, y: app.pointer.y }, null) }));
  if (actions.length === 1) hudMoves.push(hud.addAction(actions[0]));
  else {
    const g = hud.addGroup(w.label, actions, w.label === 'Sort' ? [splitRow] : [], w.icon);
    hudMoves.push(g.main, ...g.rows);
    w.items.forEach((item, i) => item.onStand && standRows.push({ row: g.rows[i], item }));
  }
}
/** The cards H would fan, without changing the selection: the pile under `hovered` unless it is selected, else the selection. */
const handTargets = (hovered: string | null): string[] => {
  if (hovered && !store.selection.has(hovered)) return store.pileOf(hovered)?.cardUids.slice() ?? [hovered];
  return [...store.selection];
};
const handOnStand = (hovered: string | null): boolean => !!standOf(app, handTargets(hovered));
// The bar acts on the selection, so its H H row says Wide hand or Usual size by where the selection lies.
const syncStandRows = () => {
  const on = handOnStand(null);
  for (const { row, item } of standRows) {
    const say = on && item.onStand ? item.onStand : item;
    row.querySelector('.hud-menu-label')!.textContent = say.label;
    row.title = say.title;
  }
};
store.events.on('selection', syncStandRows);
store.events.on('piles', syncStandRows);
syncStandRows();
const syncSplit = () => {
  splitRow.classList.toggle('on', store.settings.curveSplit);
  splitRow.setAttribute('aria-checked', String(store.settings.curveSplit));
};
store.events.on('settings', syncSplit);
syncSplit();
const exportBtn = hud.addAction({ icon: '📤', key: 'Ctrl E', label: 'Export', title: 'Export the selection as a decklist or CSV (Ctrl + E)', run: () => exportSelection() });
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
const help = new HelpPanel(hints);
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

// --- Rooms: Sync ---
// The room layer (ONLINE.md 11): the session, the store's hook to the outbox, the inbox,
// the crown's judge, streams and presence. The Online panel drives it as its RoomControl.
const roomLayer = new RoomLayer(app, { drag, dice, diceLayer, autosave });
// --- end Rooms: Sync ---

// --- Rooms: Rules & UI ---
// The Online button, avatars and panel, and the room flows (ONLINE.md 12). The room
// layer is reached through RoomControl (the Sync fork's RoomLayer).
// The hidden gate (ONLINE.md 7.3): in a room, cards this browser may not see draw as backs and read as unknown.
const hiddenGate = new HiddenGate(app);
// Rank gating (ONLINE.md 6.4): keys, buttons and the start of drags refuse, with a toast,
// what this player may not do. Offline everything is allowed.
const guard = new Guard(app);
keyboard.guard = guard.key;
keyboard.allowed = guard.keyQuiet;
guard.wrapMouse(mouse);
// The radial menu on Space (decision 298, RADIAL.md): each action is its key, pressed where
// the menu opened, over the card that was under the cursor then.
new RadialMenu(app, {
  canOpen: () => !drag.dragging && !mats.dragging,
  hovered: () => mouse.hovered,
  hasCards: () => store.selection.size > 0 || !!mouse.hovered,
  onStand: handOnStand,
  allowed: (press) => keyboard.allowed(press),
  run: runKeys,
});
/** Do a radial item: its keys, pressed at `at` (canvas pixels) over `hovered`, which are put back after. */
function runKeys(item: RadialItem, at: { x: number; y: number }, hovered: string | null): void {
  const was = { hovered: mouse.hovered, x: app.pointer.x, y: app.pointer.y };
  mouse.hovered = hovered;
  app.pointer.x = at.x;
  app.pointer.y = at.y;
  try {
    for (const press of item.presses) keyboard.press(press);
  } finally {
    mouse.hovered = was.hovered;
    app.pointer.x = was.x;
    app.pointer.y = was.y;
  }
}
// Naming a pile and its filter need Move (6.2).
const openPileEditor = pileEditor.open.bind(pileEditor);
pileEditor.open = (...args: Parameters<typeof openPileEditor>) => {
  if (allowedNow('named')) openPileEditor(...args);
};
// Buttons by what they do: the HUD's commands, the top bar's files, the Spawn panel's spawns.
// Save and export buttons are hidden, not greyed, while Downloads is off (4.3).
const gateByText = (host: Element, rules: [string | RegExp, Action][]) => {
  for (const b of host.querySelectorAll('button')) {
    const text = b.textContent?.trim() ?? '';
    const rule = rules.find(([t]) => (typeof t === 'string' ? text === t : t.test(text)));
    if (rule) guard.gate(b, rule[1], rule[1] === 'download');
  }
};
// The pile badges' export button and Ctrl + E open the Export panel: Downloads (O50).
const openExporter = exporter.open.bind(exporter);
exporter.open = (...args: Parameters<typeof openExporter>) => {
  if (allowedNow('download')) openExporter(...args);
};
for (const b of hudMoves) guard.gate(b, 'move');
guard.gate(exportBtn, 'download', true);
guard.gate(pointBtn, 'move');
gateByText(topBar.actions, [['New', 'replace'], ['Open…', 'replace'], ['Save', 'download'], ['Export', 'download']]);
gateByText(left, [['Spawn', 'addCards'], ['Spawn cube', 'addCards'], ['Spawn basics', 'addTokens'], ['Choose basics…', 'basics'], ['Spawn playmat', 'matAdd']]);
for (const chip of left.querySelectorAll('.basic-chip')) guard.gate(chip as HTMLElement, 'addTokens');
const onlineUi = new OnlineUi(app, topBar, {
  control: roomLayer,
  hidden: hiddenGate,
  guard,
  saveCopy: () => saveFile(),
  ownTable: async () => {
    autosave.paused = false;
    await autosave.restore();
  },
});
// A room link opens the join prompt instead of this browser's table, and skips the welcome table (4.2, 4.4).
// Nothing is autosaved until this browser's own table is back, so the empty page can't overwrite it.
const route = parseHash(location.hash);
if (route?.kind === 'room') autosave.paused = true;
// --- end Rooms: Rules & UI ---

app.start();
if (route?.kind === 'room') {
  onlineUi.needOwnTable = true;
  void onlineUi.join(route);
} else {
  void autosave.restore().then((had) => {
    if (!had) void loadWelcome();
  });
  // Rooms: the owner's admin page over the table (ONLINE.md 12.8).
  if (route?.kind === 'admin') void onlineUi.admin.open();
}

/** A first visit, with no table saved in this browser, opens a table with cards on it to play with (decision 153). */
async function loadWelcome(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}welcome-table.json`);
    if (!res.ok) return;
    const doc: unknown = await res.json();
    // Something may have been spawned while it loaded: leave that alone.
    if (validateDoc(doc) || store.cards.size || store.mats.size) return;
    await loadDoc(app, doc as TableDoc);
    // Rooms: the first-visit welcome note, with Join a table (ONLINE.md 12.6).
    showWelcomeNote(app, onlineUi);
  } catch {
    // No welcome table: start empty.
  }
}

const physics = new Physics(app);
physics
  .init()
  .then(() => (app.physics = physics))
  .catch((err) => console.warn('Physics failed to load; drops land without it', err));

export const ui = { app, mouse, keyboard, topBar, spawnPanel, hud, commands, undo, drag, badges, tray, autosave, pileSync, physics, outlines, pileEditor, inspect, exporter, saveFile, openFile, newTable, hires, markers, onlineUi };

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
