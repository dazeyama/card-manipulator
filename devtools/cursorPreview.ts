// Build art/cursors/preview.html: every cursor the app can show, grouped by
// what the mouse is doing, each with what causes it and what it means, at real
// size and three times larger, on the table colour and on dark card art. Hover
// a tile to use it as the cursor. Badges are drawn onto the art with a canvas
// exactly as src/ui/cursors.ts does. Keep the lists here in step with that file.
// Dev only.
//
//   node --experimental-transform-types devtools/cursorPreview.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { ARROW_COUNT_URL, ARROW_MINUS_URL, ARROW_PLUS_URL, ARROW_TIP, ARROW_URL } from '../src/ui/cursorArrow.ts';

const png = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const hotspots = JSON.parse(readFileSync('art/cursors/cursors.json', 'utf8')) as Record<string, Record<string, [number, number]>>;

/** Each piece of art: its image and its click point. */
const ART: Record<string, { src: string; hot: [number, number] | 'centre' }> = {
  arrow: { src: ARROW_URL, hot: ARROW_TIP },
  arrowPlus: { src: ARROW_PLUS_URL, hot: ARROW_TIP },
  arrowMinus: { src: ARROW_MINUS_URL, hot: ARROW_TIP },
  arrowCount: { src: ARROW_COUNT_URL, hot: ARROW_TIP },
  open: { src: png('art/cursors/open-48-bold.png'), hot: hotspots.open['48-bold'] },
  fist: { src: png('art/cursors/fist-48-bold.png'), hot: hotspots.fist['48-bold'] },
  point: { src: png('art/cursors/point-48-bold.png'), hot: hotspots.point['48-bold'] },
  holdOne: { src: png('art/cursors/gestures/holdOne-48-bold.png'), hot: 'centre' },
  shuffle: { src: png('art/cursors/gestures/shuffle-72-bold.png'), hot: 'centre' },
  tidy: { src: png('art/cursors/gestures/tidy-48-bold.png'), hot: 'centre' },
  flip: { src: png('art/cursors/gestures/flip-48-bold.png'), hot: 'centre' },
  rotate: { src: png('art/cursors/gestures/rotate-48-bold.png'), hot: 'centre' },
  fan: { src: png('art/cursors/gestures/fan-48-bold.png'), hot: 'centre' },
  draw: { src: png('art/cursors/gestures/draw-48-bold.png'), hot: 'centre' },
  remove: { src: png('art/cursors/gestures/remove-48-bold.png'), hot: 'centre' },
  stack: { src: png('art/cursors/gestures/stack-48-bold.png'), hot: 'centre' },
};

/** [art, emoji badge, what causes it, what it means] */
type Tile = [string, string, string, string];
const SECTIONS: { title: string; note?: string; tiles: Tile[] }[] = [
  {
    title: 'Over empty table',
    tiles: [
      ['arrow', '', 'Nothing held', 'Drag to draw a selection box'],
      ['arrowPlus', '', 'Ctrl held, or a Ctrl selection box', 'The box adds to the selection'],
      ['arrowMinus', '', 'Shift held, or a Shift selection box', 'The box takes away from the selection'],
      ['arrowCount', '', 'Alt held', 'Every pile shows its card count'],
    ],
  },
  {
    title: 'Over a card',
    tiles: [
      ['open', '', 'Hovering a card', 'Drag to pick it up; click selects it'],
      ['open', '\u{1F9F2}', 'Shift held', 'Drag sweeps up the cards you pass over'],
      ['open', '\u{1F522}', 'Alt held (or Ctrl + Shift)', 'Drag moves the selection in formation'],
      ['open', '\u{1F4D0}', 'Ctrl held', 'A drag lands tidy; a click checks the card in or out of the selection'],
      ['open', '☑️', 'Ctrl held, after a Ctrl + click', 'Checking cards in and out, until Ctrl is let go'],
      ['open', '\u{1F4DA}', "Hovering a pile's number badge", 'Drag lifts the whole pile'],
    ],
  },
  {
    title: 'Holding cards',
    tiles: [
      ['holdOne', '', 'Dragging one card', 'Release to drop it'],
      ['holdOne', '\u{1F4D0}', 'Dragging one card, Ctrl held', 'It lands squared at a quarter turn'],
      ['fist', '', 'Dragging several cards', 'Release to drop them'],
      ['fist', '\u{1F4D0}', 'Dragging several, Ctrl held', 'They land squared at a quarter turn'],
      ['fist', '\u{1F9F2}', 'Dragging, Shift held', 'Sweeping up the cards passed over'],
      ['fist', '\u{1F517}', 'Formation drag', 'They move linked, keeping their layout'],
    ],
  },
  {
    title: 'Playmats',
    tiles: [
      ['open', '', 'Over a mat where no card is', 'Drag moves the mat'],
      ['open', '\u{1F522}', 'Over a mat, Alt held', 'Drag carries the cards on it too'],
      ['fist', '', 'Dragging a mat', 'Release to place it'],
      ['fist', '\u{1F517}', 'Dragging a mat with Alt', 'Its cards ride along'],
      ['arrow', '', 'Over a locked mat', 'Acts as empty table'],
    ],
  },
  {
    title: 'Camera',
    tiles: [
      ['open', '↔️', 'Space held, or right-drag', 'Pan'],
      ['fist', '\u{1F504}', 'Middle-drag', 'Orbit'],
    ],
  },
  {
    title: 'Waiting for a click',
    note: 'After a key that needs a place on the table. Esc cancels.',
    tiles: [
      ['point', '1️⃣', '1 to 9 over a pile (each shows its number)', 'Click to deal that many as a hand'],
      ['point', '9️⃣', '9 over a pile', 'Click to deal nine'],
      ['point', '\u{1F522}', '0 over a pile, then a number over 9', 'Click to deal that many'],
      ['point', '\u{1FA9F}', 'X', 'Click to spread there, or drag a box to fit them in'],
    ],
  },
  {
    title: 'Action gestures',
    note: 'Shown for half a second after the action, then the usual cursor returns. Shuffle stays until the cards settle.',
    tiles: [
      ['shuffle', '', 'S S (shuffle)', 'Two hands riffling, until the cards settle'],
      ['tidy', '', 'T', 'Squaring up'],
      ['flip', '', 'F, F F, or a middle-click', 'Flipping over'],
      ['rotate', '', 'R, R R, or R over a mat', 'Turning'],
      ['fan', '', 'H', 'Fanning into a hand'],
      ['draw', '', 'The click that deals a hand', 'Dealing'],
      ['remove', '❌', 'Delete or Backspace', 'Removing'],
    ],
  },
  {
    title: 'Clickable things in the play space',
    tiles: [['point', '', "Buttons on badges and mats (✎, \u{1F4FA}, \u{1F512})", 'Click it']],
  },
  {
    title: 'Not used',
    note: 'Kept in art/cursors/gestures/ but not shown by the app.',
    tiles: [['stack', '', 'S (removed, decision 165)', 'Looked bad next to Shuffle']],
  },
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cursor review</title>
<style>
  body { margin: 0; padding: 20px 24px 40px; font: 14px system-ui, sans-serif; background: #f6f5f2; color: #1f1f1f; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 26px 0 4px; }
  p { margin: 0 0 12px; color: #555; } .note { margin: 0 0 10px; color: #666; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
  .tile { background: #fff; border: 1px solid #e3e1dc; border-radius: 10px; padding: 10px; }
  .row { display: flex; gap: 12px; align-items: center; border-radius: 8px; padding: 10px; min-height: 76px; }
  .table { background: #e7e4df; } .dark { background: linear-gradient(135deg, #3b1d14, #7a2d1d 50%, #1d2a3b); margin-top: 6px; }
  .cause { font-weight: 600; font-size: 13px; margin-top: 8px; } .means { color: #555; font-size: 12px; margin-top: 2px; }
  .hint { font-size: 11px; color: #999; margin-top: 4px; }
  canvas { display: block; image-rendering: pixelated; }
</style></head><body>
<h1>Cursor review</h1>
<p>Every cursor the app can show, what causes it and what it means. Each is shown at real size and three times larger, on the table and on dark card art. Hover a tile to use it as your cursor.</p>
<div id="out"></div>
<script>
const ART = ${JSON.stringify(ART)};
const SECTIONS = ${JSON.stringify(SECTIONS)};
const loaded = {};
const load = (src) => loaded[src] ??= new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });

// The badge, drawn as src/ui/cursors.ts draws it: 48% of the size, 2 px in from the right, on the bottom edge.
function drawEmoji(g, emoji, size) {
  let px = Math.round(size * 0.48);
  const font = (n) => n + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = font(px);
  let m = g.measureText(emoji);
  const box = size * 0.48 + 2;
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (w > box || h > box) { px = Math.floor(px * Math.min(box / w, box / h)); g.font = font(px); m = g.measureText(emoji); }
  g.fillText(emoji, size - 2 - m.actualBoundingBoxRight, size - m.actualBoundingBoxDescent);
}

async function compose(art, emoji) {
  const a = ART[art];
  const img = await load(a.src);
  // Gestures keep their own size (Shuffle is 72 px); the rest are 48 px.
  const size = a.src.startsWith('data:image/svg') ? 48 : img.naturalWidth || 48;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, size, size);
  if (emoji) drawEmoji(g, emoji, 48);
  const [hx, hy] = a.hot === 'centre' ? [size / 2, size / 2] : a.hot;
  return { canvas: c, size, cursor: 'url(' + c.toDataURL() + ') ' + hx + ' ' + hy + ', auto' };
}

function scaled(source, size, k) {
  const c = document.createElement('canvas');
  c.width = c.height = size * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(source, 0, 0, size * k, size * k);
  return c;
}

(async () => {
  const out = document.getElementById('out');
  for (const section of SECTIONS) {
    const h = document.createElement('h2'); h.textContent = section.title; out.append(h);
    if (section.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = section.note; out.append(n); }
    const grid = document.createElement('div'); grid.className = 'grid'; out.append(grid);
    for (const [art, emoji, cause, means] of section.tiles) {
      const { canvas, size, cursor } = await compose(art, emoji);
      const tile = document.createElement('div'); tile.className = 'tile'; tile.style.cursor = cursor;
      for (const cls of ['table', 'dark']) {
        const row = document.createElement('div'); row.className = 'row ' + cls;
        row.append(scaled(canvas, size, 1), scaled(canvas, size, 3));
        tile.append(row);
      }
      const c = document.createElement('div'); c.className = 'cause'; c.textContent = cause;
      const m = document.createElement('div'); m.className = 'means'; m.textContent = means;
      const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Hover to try it';
      tile.append(c, m, hint);
      grid.append(tile);
    }
  }
})();
</script></body></html>`;

writeFileSync('art/cursors/preview.html', html);
console.log('wrote art/cursors/preview.html');
