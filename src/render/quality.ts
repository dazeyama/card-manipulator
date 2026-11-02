// Graphics modes (decision 152). Low is the original, conservative budget;
// High turns each rendering dial up to where a 1080p screen stops showing a
// difference. High is the default, and the table drops to Low by itself
// above 1000 cards. Pure data and rules, tested without a browser.

export type GraphicsMode = 'high' | 'low';

export interface GraphicsPreset {
  /** Render resolution as a multiple of the screen's own pixels, at most `maxPixelRatio`. */
  pixelScale: number;
  maxPixelRatio: number;
  /** Sun shadow map, texels a side. */
  shadowMapSize: number;
  /** Texture filtering at a slant (atlas, close-up images, playmats). */
  anisotropy: number;
  /** Close-up images (spec 8.3): shown once a card is this many CSS pixels tall... */
  hiresAbovePx: number;
  /** ...on at most this many cards, keeping this many textures. */
  hiresMax: number;
  hiresPool: number;
  /** Which Scryfall image: `normal` is 488 x 680, `large` 672 x 936. */
  hiresImage: 'normal' | 'large';
  /** Mirror window: redraw interval, ms; longest side, px; smoothing samples. */
  mirrorEveryMs: number;
  mirrorMax: number;
  mirrorSamples: number;
  /** The card stand's wood texture, px square (decision 229): its file, the GPU makes the smaller mip levels. */
  woodPx: 1024 | 512;
  /** Playmat art redrawn at twice the size and sharpened (decision 323). */
  sharpArt: boolean;
}

export const GRAPHICS: Record<GraphicsMode, GraphicsPreset> = {
  low: {
    pixelScale: 1,
    maxPixelRatio: 2,
    shadowMapSize: 4096,
    anisotropy: 8,
    hiresAbovePx: 160,
    hiresMax: 32,
    hiresPool: 64,
    hiresImage: 'normal',
    mirrorEveryMs: 33,
    mirrorMax: 1920,
    mirrorSamples: 4,
    woodPx: 512,
    sharpArt: false,
  },
  high: {
    // Drawn at twice the resolution and scaled down: card text and edges stop shimmering.
    pixelScale: 2,
    maxPixelRatio: 3,
    // Crisper shadows; past 8192 the texels are smaller than a screen pixel.
    shadowMapSize: 8192,
    anisotropy: 16,
    // The atlas image is 204 px tall, so at twice the resolution it runs out at about 100 CSS px.
    hiresAbovePx: 100,
    hiresMax: 160,
    hiresPool: 192,
    hiresImage: 'large',
    mirrorEveryMs: 16,
    mirrorMax: 2560,
    mirrorSamples: 8,
    woodPx: 1024,
    // The art crop is 626 px across a 61 cm mat: up close it is soft without this.
    sharpArt: true,
  },
};

/** Above this many cards High drops to Low by itself. */
export const AUTO_LOW_ABOVE = 1000;

/**
 * The mode in use: the chosen one, except that High drops to Low above
 * AUTO_LOW_ABOVE cards unless the owner asked for High anyway (`forced`).
 */
export function effectiveMode(chosen: GraphicsMode, forced: boolean, cards: number): GraphicsMode {
  if (chosen === 'low') return 'low';
  return cards > AUTO_LOW_ABOVE && !forced ? 'low' : 'high';
}

/** Render resolution for a screen's device pixel ratio. */
export function pixelRatioFor(preset: GraphicsPreset, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio * preset.pixelScale, preset.maxPixelRatio);
}
