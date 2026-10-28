// Build art/cursors/preview.html: every cursor at real size and enlarged, on
// the table colour and on dark card art, with its emoji badge, and live: hover
// a tile to use it as the cursor. The badge is drawn onto the hand with a
// canvas, the way the app will (decision 118). Dev only.
//
//   node --experimental-transform-types devtools/cursorPreview.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { ARROW_TIP, ARROW_URL } from '../src/ui/cursorArrow.ts';

const hotspots = JSON.parse(readFileSync('art/cursors/cursors.json', 'utf8')) as Record<string, Record<string, [number, number]>>;
const variants = ['32', '32-bold', '48-bold'];
const images: Record<string, string> = {};
for (const hand of Object.keys(hotspots)) {
  for (const v of variants) images[`${hand}-${v}`] = `data:image/png;base64,${readFileSync(`art/cursors/${hand}-${v}.png`).toString('base64')}`;
}

// Every cursor state: the hand, its emoji badge, and what it means.
const states: [string, string, string, string][] = [
  ['arrow', '', 'Empty table', 'Drag to select'],
  ['arrow', '➕', '+ Ctrl', 'Select, adding'],
  ['arrow', '➖', '+ Shift', 'Select, taking away'],
  ['open', '', 'Over a card', 'Pick it up'],
  ['open', '🧲', '+ Shift', 'Sweep cards in'],
  ['open', '🔢', '+ Alt', 'Show counts, keep formation'],
  ['open', '☑️', '+ Ctrl', 'Toggle in selection'],
  ['open', '📚', 'Pile badge', 'Lift whole pile'],
  ['fist', '', 'Holding cards', 'Release to drop'],
  ['fist', '🧲', 'Holding + Shift', 'Sweeping'],
  ['fist', '📐', 'Formation drag', 'Layout kept'],
  ['open', '↔️', 'Space or right-drag', 'Pan'],
  ['fist', '🔄', 'Middle-drag', 'Orbit'],
];

// The empty-table arrow is hand-drawn (decision 123), the same image the app uses.
for (const v of variants) images[`arrow-${v}`] = ARROW_URL;
hotspots.arrow = Object.fromEntries(variants.map((v) => [v, ARROW_TIP]));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glove cursors</title>
<style>
  body { margin: 0; padding: 20px; font: 14px system-ui, sans-serif; background: #f6f5f2; color: #1f1f1f; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 16px; color: #555; }
  .bar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
  .bar button { border: 1px solid #ccc; background: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .bar button.on { border-color: #2563eb; color: #2563eb; background: #eef3fe; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  .tile { background: #fff; border: 1px solid #e3e1dc; border-radius: 10px; padding: 10px; }
  .row { display: flex; gap: 10px; align-items: flex-end; border-radius: 8px; padding: 10px; }
  .table { background: #dcd9d3; } .dark { background: linear-gradient(135deg, #3b1d14, #7a2d1d 50%, #1d2a3b); margin-top: 6px; }
  .label { font-weight: 600; font-size: 13px; margin-top: 8px; } .sub { color: #666; font-size: 12px; }
  .hover { font-size: 11px; color: #888; margin-top: 4px; }
  canvas { display: block; }
</style></head><body>
<h1>Glove cursors</h1>
<p>Each tile shows the cursor at real size and three times larger, on the table colour and on dark card art. Hover a tile to use it as your cursor.</p>
<div class="bar">Version:
  <button data-v="32">32 px</button><button data-v="32-bold" class="on">32 px, bold outline</button><button data-v="48-bold">48 px, bold outline</button>
</div>
<div class="grid" id="grid"></div>
<script>
const IMAGES = ${JSON.stringify(images)};
const HOTSPOTS = ${JSON.stringify(hotspots)};
const STATES = ${JSON.stringify(states)};
let version = '32-bold';
const loaded = {};
const load = (src) => loaded[src] ??= new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });

/** Draw the hand with its emoji badge in the bottom right corner, as the app will. */
async function compose(hand, emoji, size) {
  const img = await load(IMAGES[hand + '-' + version]);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, size, size);
  if (emoji) {
    const e = Math.round(size * 0.46);
    g.font = e + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.fillText(emoji, size, size + Math.round(size * 0.04));
  }
  return c;
}

async function render() {
  const size = parseInt(version, 10);
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (const [hand, emoji, label, sub] of STATES) {
    const real = await compose(hand, emoji, size);
    const tile = document.createElement('div');
    tile.className = 'tile';
    const [hx, hy] = HOTSPOTS[hand][version];
    tile.style.cursor = 'url(' + real.toDataURL() + ') ' + hx + ' ' + hy + ', auto';
    for (const bg of ['table', 'dark']) {
      const row = document.createElement('div');
      row.className = 'row ' + bg;
      const big = await compose(hand, emoji, size);
      big.style.width = big.style.height = size * 3 + 'px';
      const small = await compose(hand, emoji, size);
      row.append(big, small);
      tile.append(row);
    }
    tile.insertAdjacentHTML('beforeend', '<div class="label">' + label + '</div><div class="sub">' + sub + '</div><div class="hover">Hover to try it</div>');
    grid.append(tile);
  }
}
for (const b of document.querySelectorAll('.bar button')) {
  b.addEventListener('click', () => {
    version = b.dataset.v;
    for (const o of document.querySelectorAll('.bar button')) o.classList.toggle('on', o === b);
    render();
  });
}
render();
</script></body></html>
`;
writeFileSync('art/cursors/preview.html', html);
console.log('wrote art/cursors/preview.html');
