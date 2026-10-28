// The empty-table cursor (decision 123): a classic pointy arrow with a dashed
// marquee box, hand-drawn at the gloves' 48 px size and in their style, with a
// heavy black outline, a white body and soft grey shading on its right side.
// Shared by the app's cursors and the dev preview page.

const INK = '#111';
const SHADE = '#d6dae1';
/** The arrow outline: the classic cursor shape, its tip at (5, 5). */
const ARROW = 'M5 5 V35.6 L12.5 28.5 L17.9 40.7 L23 38.3 L17.6 26.4 H27.8 Z';

export const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs><clipPath id="a"><path d="${ARROW}"/></clipPath></defs>
  <rect x="23.5" y="29" width="19" height="14" rx="2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="4.2 3.4"/>
  <rect x="23.5" y="29" width="19" height="14" rx="2" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="4.2 3.4"/>
  <path d="${ARROW}" fill="#fff"/>
  <path d="M5 5 L27.8 26.4 H17.6 L23 38.3" fill="none" stroke="${SHADE}" stroke-width="5.5" stroke-linejoin="round" clip-path="url(#a)"/>
  <path d="${ARROW}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linejoin="miter" stroke-miterlimit="12"/>
</svg>`;

/** The arrow as an image URL. */
export const ARROW_URL = `data:image/svg+xml,${encodeURIComponent(ARROW_SVG)}`;

/** The click point: the very tip, where the mitred outline ends. */
export const ARROW_TIP: [number, number] = [4, 2];
