// How a sleeve's back looks: a matte finish (decision 366), a generated gray
// texture with a soft diagonal gradient and a fine frosted grain
// (public/sleeves/matte.webp, made by devtools/makeSleeve.py), laid over the
// sleeve's color so one image serves every color, with a faint inner border;
// or a card's art in a thin black frame under the same finish. Drawn into the
// card atlas for sleeved cards' backs, and onto the top of a sleeve pack.

import { isDark } from '../state/dice';

let matte: HTMLImageElement | null = null;
let loading = false;
const waiting = new Set<() => void>();

/** Load the matte texture once, on first use; everything drawn before it arrives is drawn again after. */
function loadMatte(): void {
  if (loading || typeof Image === 'undefined') return;
  loading = true;
  const img = new Image();
  img.onload = () => {
    matte = img;
    for (const fn of waiting) fn();
    waiting.clear();
  };
  img.onerror = () => console.warn('Sleeve texture failed to load; using the plain gradient');
  img.src = `${import.meta.env.BASE_URL}sleeves/matte.webp`;
}

/** Call `fn` once the matte texture has arrived (at once if it has). */
export function whenSleeveTexture(fn: () => void): void {
  loadMatte();
  if (matte) fn();
  else waiting.add(fn);
}

/** True once the matte texture is in. */
export function sleeveTextureReady(): boolean {
  loadMatte();
  return !!matte;
}

/** A sleeve back `w` x `h` pixels: `color` alone, or `art` framed in it. */
export function sleeveCanvas(w: number, h: number, color: string, art?: CanvasImageSource): HTMLCanvasElement {
  loadMatte();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  const u = w / 146;
  if (art) {
    // A thin frame, as art sleeves have.
    const f = 5 * u;
    g.drawImage(art, f, f, w - 2 * f, h - 2 * f);
  }
  if (matte) {
    // The matte finish: mid gray leaves the color, lighter and darker shade it. Softer over art.
    g.globalAlpha = art ? 0.45 : 1;
    g.globalCompositeOperation = 'overlay';
    g.drawImage(matte, 0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  } else {
    // Until it loads: a plain soft gradient, lighter top left.
    const shade = g.createLinearGradient(0, 0, w, h);
    shade.addColorStop(0, 'rgba(255,255,255,0.10)');
    shade.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
  }
  if (!art) {
    // A faint inner border, lighter on a dark sleeve and darker on a light one.
    g.strokeStyle = isDark(color) ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)';
    g.lineWidth = 2 * u;
    g.strokeRect(9 * u, 9 * u, w - 18 * u, h - 18 * u);
  }
  return c;
}
