// The cursor gloves as pictures (decision 293): every glove the custom
// cursors use, loaded once, tinted a player's color in a room, and scaled to
// the Cursor size. cursors.ts draws your own cursor from these; presence.ts
// draws other players' cursors on the table from the same art, by the glove
// name their stream carries (`cs`), without any emoji badge.

import { ARROW_COUNT_URL, ARROW_MINUS_URL, ARROW_PLUS_URL, ARROW_TIP, ARROW_URL } from './cursorArrow';
import pointUrl from '../../art/cursors/point-48-bold.png';
import openUrl from '../../art/cursors/open-48-bold.png';
import fistUrl from '../../art/cursors/fist-48-bold.png';
import holdOneUrl from '../../art/cursors/gestures/holdOne-48-bold.png';
import shuffleUrl from '../../art/cursors/gestures/shuffle-72-bold.png';
import tidyUrl from '../../art/cursors/gestures/tidy-48-bold.png';
import flipUrl from '../../art/cursors/gestures/flip-48-bold.png';
import rotateUrl from '../../art/cursors/gestures/rotate-48-bold.png';
import drawUrl from '../../art/cursors/gestures/draw-48-bold.png';
import removeUrl from '../../art/cursors/gestures/remove-48-bold.png';
import fanUrl from '../../art/cursors/gestures/fan-48-bold.png';
import hotspots from '../../art/cursors/cursors.json';
import { scaleHotspot } from './cursorSize';

/** The size the art is drawn at (the shuffle gesture is bigger: 72). */
export const ART_SIZE = 48;
const VERSION = '48-bold';

/** Every glove a cursor can show; the name a room's stream carries. `pointReverse` is the pointing glove mirrored (the reverse spread). */
export const GLOVES = ['arrow', 'arrowPlus', 'arrowMinus', 'arrowCount', 'open', 'fist', 'holdOne', 'point', 'pointReverse', 'shuffle', 'tidy', 'flip', 'rotate', 'draw', 'remove', 'fan'] as const;
export type Glove = (typeof GLOVES)[number];

const URLS: Record<Glove, string> = {
  arrow: ARROW_URL, arrowPlus: ARROW_PLUS_URL, arrowMinus: ARROW_MINUS_URL, arrowCount: ARROW_COUNT_URL,
  open: openUrl, fist: fistUrl, holdOne: holdOneUrl, point: pointUrl, pointReverse: pointUrl,
  shuffle: shuffleUrl, tidy: tidyUrl, flip: flipUrl, rotate: rotateUrl, draw: drawUrl, remove: removeUrl, fan: fanUrl,
};

export function isGlove(s: unknown): s is Glove {
  return typeof s === 'string' && (GLOVES as readonly string[]).includes(s);
}

const loaded = new Map<string, Promise<HTMLImageElement>>();

/** A glove's art, loaded once. */
export function loadGlove(g: Glove): Promise<HTMLImageElement> {
  const url = URLS[g];
  let p = loaded.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    loaded.set(url, p);
  }
  return p;
}

/** Where a glove clicks, in its own art's pixels (`side` px square). */
export function hotspotOf(g: Glove, side: number): [number, number] {
  switch (g) {
    case 'open':
    case 'fist':
      return hotspots[g][VERSION] as [number, number];
    case 'point':
      return hotspots.point[VERSION] as [number, number];
    case 'pointReverse': {
      const [px, py] = hotspots.point[VERSION] as [number, number];
      return [ART_SIZE - 1 - px, py];
    }
    case 'arrow':
    case 'arrowPlus':
    case 'arrowMinus':
    case 'arrowCount':
      return ARROW_TIP;
    default:
      // holdOne and the gesture gloves hold their click point in the middle.
      return [side / 2, side / 2];
  }
}

/** The glove drawn on its own canvas at its art size (mirrored for the reverse spread). */
export function gloveCanvas(g: Glove, img: HTMLImageElement): HTMLCanvasElement {
  const side = g === 'shuffle' ? img.naturalWidth || ART_SIZE : ART_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const ctx = c.getContext('2d')!;
  if (g === 'pointReverse') {
    ctx.translate(side, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(img, 0, 0, side, side);
  return c;
}

/**
 * Color a glove (decision 293): its white takes the color, its black outline
 * and shading stay, so it is still the same cartoon glove. Only what is drawn
 * so far is tinted: draw any emoji after.
 */
export function tint(c: HTMLCanvasElement, colour: string): void {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d')!.drawImage(c, 0, 0);
  const g = c.getContext('2d')!;
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(copy, 0, 0);
  g.restore();
}

/** A finished cursor picture scaled from the art's size to `px` (a bigger gesture by the same share), its click point with it. */
export function scaleCursor(c: HTMLCanvasElement, hx: number, hy: number, px: number): { canvas: HTMLCanvasElement; hx: number; hy: number } {
  if (px === ART_SIZE) return { canvas: c, hx, hy };
  const side = Math.max(1, Math.round((c.width * px) / ART_SIZE));
  const out = document.createElement('canvas');
  out.width = out.height = side;
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, side, side);
  return { canvas: out, hx: scaleHotspot(hx, c.width, side), hy: scaleHotspot(hy, c.width, side) };
}

/** Another player's cursor as a picture: the glove alone (no emoji), in their color, at `px`. */
export interface GlovePicture {
  url: string;
  /** Its click point, px from its top left. */
  hx: number;
  hy: number;
  side: number;
}

const pictures = new Map<string, Promise<GlovePicture>>();

/** A glove in a color at a size, made once and kept. */
export function glovePicture(g: Glove, colour: string, px: number): Promise<GlovePicture> {
  const key = `${g}|${colour}|${px}`;
  let p = pictures.get(key);
  if (!p) {
    p = loadGlove(g).then((img) => {
      const c = gloveCanvas(g, img);
      tint(c, colour);
      const [hx, hy] = hotspotOf(g, c.width);
      const s = scaleCursor(c, hx, hy, px);
      return { url: s.canvas.toDataURL(), hx: s.hx, hy: s.hy, side: s.canvas.width };
    });
    pictures.set(key, p);
  }
  return p;
}
