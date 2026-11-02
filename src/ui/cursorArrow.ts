// The empty-table cursors (decisions 123, 168): a classic pointy arrow,
// hand-drawn at the gloves' 48 px size and in their style, with a heavy black
// outline, a white body and soft gray shading on its right side. The plain one
// carries a dashed marquee box; the ones for adding to and taking from the
// selection carry a bold plus or minus sign, drawn the same way, instead, and
// the one for Alt a numbers keycap (decision 169).
// Shared by the app's cursors and the dev preview page.

const INK = '#111';
const SHADE = '#d6dae1';
/** The arrow outline: the classic cursor shape, its tip at (5, 5). */
const ARROW = 'M5 5 V35.6 L12.5 28.5 L17.9 40.7 L23 38.3 L17.6 26.4 H27.8 Z';

const MARQUEE = `<rect x="23.5" y="29" width="19" height="14" rx="2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="4.2 3.4"/>
  <rect x="23.5" y="29" width="19" height="14" rx="2" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="4.2 3.4"/>`;

/** A sign in the bottom right corner, centered on (37, 37): a white shape with the arrow's outline. */
const C = 37, ARM = 8, HALF = 3.2;
const PLUS = `M${C - HALF} ${C - ARM} H${C + HALF} V${C - HALF} H${C + ARM} V${C + HALF} H${C + HALF} V${C + ARM} H${C - HALF} V${C + HALF} H${C - ARM} V${C - HALF} H${C - HALF} Z`;
const MINUS = `M${C - ARM} ${C - HALF} H${C + ARM} V${C + HALF} H${C - ARM} Z`;
const sign = (d: string) => `<path d="${d}" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`;
/** A numbers keycap like the 🔢 emoji, blue with 1 2 / 3 4 in white, outlined like the arrow (decision 169). */
const NUMBERS = `<rect x="27" y="27" width="19" height="19" rx="3.5" fill="#3b82f6" stroke="${INK}" stroke-width="2.4"/>
  <g fill="#fff" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="8.6" text-anchor="middle">
    <text x="32.6" y="35.6">1</text><text x="40.4" y="35.6">2</text><text x="32.6" y="43.6">3</text><text x="40.4" y="43.6">4</text>
  </g>`;

function arrowSvg(extra: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs><clipPath id="a"><path d="${ARROW}"/></clipPath></defs>
  ${extra}
  <path d="${ARROW}" fill="#fff"/>
  <path d="M5 5 L27.8 26.4 H17.6 L23 38.3" fill="none" stroke="${SHADE}" stroke-width="5.5" stroke-linejoin="round" clip-path="url(#a)"/>
  <path d="${ARROW}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linejoin="miter" stroke-miterlimit="12"/>
</svg>`;
}

export const ARROW_SVG = arrowSvg(MARQUEE);
/** Ctrl over empty table: the marquee adds to the selection (decision 168). */
export const ARROW_PLUS_SVG = arrowSvg(sign(PLUS));
/** Shift over empty table: the marquee takes away from the selection (decision 168). */
export const ARROW_MINUS_SVG = arrowSvg(sign(MINUS));

/** Alt over empty table: every pile shows its count (decision 169). */
export const ARROW_COUNT_SVG = arrowSvg(NUMBERS);

/** The arrows as image URLs. */
export const ARROW_URL = `data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}`;
export const ARROW_PLUS_URL = `data:image/svg+xml,${encodeURIComponent(ARROW_PLUS_SVG)}`;
export const ARROW_MINUS_URL = `data:image/svg+xml,${encodeURIComponent(ARROW_MINUS_SVG)}`;
export const ARROW_COUNT_URL = `data:image/svg+xml,${encodeURIComponent(ARROW_COUNT_SVG)}`;

/** The click point: the very tip, where the mitred outline ends. */
export const ARROW_TIP: [number, number] = [4, 2];
