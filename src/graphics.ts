// Graphics mode (decision 152): High or Low, chosen on the top bar and
// remembered in this browser. High is the default; above 1000 cards it drops
// to Low by itself, and comes back once the table is under 1000 again.
// Choosing High while it is lowered keeps High until then.

import type { App } from './app';
import type { Mats } from './mats';
import { setDiceAnisotropy } from './render/dice';
import { setWoodQuality } from './render/standMesh';
import type { HiRes } from './render/hires';
import { AUTO_LOW_ABOVE, effectiveMode, GRAPHICS, pixelRatioFor, type GraphicsMode } from './render/quality';

const MODE_KEY = 'card-manipulator.graphics';

export class Graphics {
  /** What the owner picked. */
  private chosen: GraphicsMode = 'high';
  /** High was asked for while over the card limit. */
  private forced = false;
  /** The mode in use, or null before the first apply. */
  mode: GraphicsMode | null = null;
  /** Called after the mode in use changes. */
  onChange: () => void = () => {};

  constructor(private readonly app: App, private readonly hires: HiRes, private readonly mats: Mats) {
    try {
      if (localStorage.getItem(MODE_KEY) === 'low') this.chosen = 'low';
    } catch {
      // No storage: High.
    }
    const recount = () => {
      if (app.store.cards.size <= AUTO_LOW_ABOVE) this.forced = false;
      this.update();
    };
    app.store.events.on('added', recount);
    app.store.events.on('removed', recount);
    app.store.events.on('reset', recount);
    this.update();
  }

  /** True while High is wanted but the card count holds it at Low. */
  get lowered(): boolean {
    return this.chosen === 'high' && this.mode === 'low';
  }

  /** The top bar button: switch to the other mode. */
  toggle(): void {
    if (this.mode === 'high') {
      this.chosen = 'low';
      this.forced = false;
    } else {
      this.chosen = 'high';
      this.forced = this.app.store.cards.size > AUTO_LOW_ABOVE;
    }
    try {
      localStorage.setItem(MODE_KEY, this.chosen);
    } catch {
      // Not remembered this time.
    }
    this.update();
  }

  private update(): void {
    const next = effectiveMode(this.chosen, this.forced, this.app.store.cards.size);
    if (next === this.mode) return;
    const first = this.mode === null;
    this.mode = next;
    this.apply(next);
    if (!first && this.lowered) {
      this.app.store.events.emit('notice', `Over ${AUTO_LOW_ABOVE.toLocaleString()} cards: graphics set to Low. Click Graphics to keep High.`);
    }
    this.onChange();
  }

  private apply(mode: GraphicsMode): void {
    const p = GRAPHICS[mode];
    const view = this.app.view;
    const renderer = view.renderer;
    const dpr = window.devicePixelRatio || 1;
    const ratio = pixelRatioFor(p, dpr);
    renderer.setPixelRatio(ratio);
    this.app.resize();
    // Lines drawn a set number of pixels wide keep their width on screen.
    const extra = Math.max(1, ratio / Math.min(dpr, GRAPHICS.low.maxPixelRatio));
    view.setSupersample(extra);
    this.app.layer.setSupersample(extra);
    // A new shadow map size takes effect when the old map is dropped.
    const size = Math.min(p.shadowMapSize, renderer.capabilities.maxTextureSize);
    const shadow = view.sun.shadow;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
    }
    const anisotropy = Math.min(p.anisotropy, renderer.capabilities.getMaxAnisotropy());
    this.app.atlas.setAnisotropy(anisotropy);
    this.hires.setQuality({ abovePx: p.hiresAbovePx, max: p.hiresMax, pool: p.hiresPool, image: p.hiresImage, anisotropy });
    this.mats.setQuality({ mirrorEveryMs: p.mirrorEveryMs, mirrorMax: p.mirrorMax, mirrorSamples: p.mirrorSamples, anisotropy, sharpArt: p.sharpArt });
    setWoodQuality(p.woodPx, anisotropy);
    setDiceAnisotropy(anisotropy);
  }
}
