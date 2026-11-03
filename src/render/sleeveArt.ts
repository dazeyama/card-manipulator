// How a sleeve's back looks (decision 360): its color with a soft glossy
// sheen and a faint inner border, or a card's art cut to the card's shape
// under the same sheen, in a thin black frame. Drawn into the card atlas for
// sleeved cards' backs, and onto the top of a sleeve pack.

import { isDark } from '../state/dice';

/** A sleeve back `w` x `h` pixels: `color` alone, or `art` framed in it. */
export function sleeveCanvas(w: number, h: number, color: string, art?: CanvasImageSource): HTMLCanvasElement {
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
  } else {
    // A faint inner border, lighter on a dark sleeve and darker on a light one.
    g.strokeStyle = isDark(color) ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)';
    g.lineWidth = 2 * u;
    g.strokeRect(9 * u, 9 * u, w - 18 * u, h - 18 * u);
  }
  // The gloss: a soft diagonal band of light across the top left.
  const sheen = g.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
  sheen.addColorStop(0.32, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(0.36, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.44, 'rgba(255,255,255,0.03)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  return c;
}
