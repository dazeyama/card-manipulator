// Texture atlas pages for the table's small card images (spec 8.2).
//
// The pages are layers of one 2D array texture, so every card draws from the
// same sampler and a card's front and back may live on different pages. Each
// layer is 4096 x 4096 and holds 513 cells of 150 x 208: Scryfall's 146 x 204
// `small` image plus a 2 px gutter filled with edge colour to limit mipmap
// bleeding. Slot 0 of layer 0 is the Magic card back.

import * as THREE from 'three';

export const PAGE_SIZE = 4096;
export const IMG_W = 146;
export const IMG_H = 204;
const CELL_W = 150;
const CELL_H = 208;
const GUTTER = 2;
const COLS = Math.floor(PAGE_SIZE / CELL_W);
const ROWS = Math.floor(PAGE_SIZE / CELL_H);
export const SLOTS_PER_PAGE = COLS * ROWS;
const WARN_PAGES = 8;

export interface Slot {
  index: number;
  layer: number;
  /** Top-left of the image (not the cell) in texture coordinates. */
  u: number;
  v: number;
}

/** Size of one image in texture coordinates, for the shader. */
export const SLOT_UV = new THREE.Vector2(IMG_W / PAGE_SIZE, IMG_H / PAGE_SIZE);

export const BACK_KEY = 'back';

export class Atlas {
  texture: THREE.DataArrayTexture;
  private readonly slots = new Map<string, Slot>();
  private nextIndex = 0;
  private depth: number;
  private mipDirty = false;
  private lastMip = 0;
  /** Texture filtering at a slant (decision 152). */
  private anisotropy = 8;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  /** Called when the texture object is replaced after growing. */
  onTextureChanged: (tex: THREE.DataArrayTexture) => void = () => {};

  constructor(private readonly renderer: THREE.WebGLRenderer, initialPages = 1) {
    this.depth = initialPages;
    this.texture = this.makeTexture(initialPages);
    this.scratch = document.createElement('canvas');
    this.scratch.width = CELL_W;
    this.scratch.height = CELL_H;
    this.scratchCtx = this.scratch.getContext('2d', { willReadFrequently: false })!;
    // Reserve slot 0 for the back and draw a stand-in until the real image loads.
    const back = this.allocate(BACK_KEY);
    this.draw(back, drawStandInBack());
  }

  get pageCount(): number {
    return this.depth;
  }

  get used(): number {
    return this.nextIndex;
  }

  get(key: string): Slot | undefined {
    return this.slots.get(key);
  }

  has(key: string): boolean {
    return this.slots.has(key);
  }

  /** The slot for this key, allocating one if needed. */
  allocate(key: string): Slot {
    const existing = this.slots.get(key);
    if (existing) return existing;
    const index = this.nextIndex++;
    const layer = Math.floor(index / SLOTS_PER_PAGE);
    if (layer >= this.depth) this.grow(layer + 1);
    const inPage = index % SLOTS_PER_PAGE;
    const col = inPage % COLS;
    const row = Math.floor(inPage / COLS);
    const slot: Slot = {
      index,
      layer,
      u: (col * CELL_W + GUTTER) / PAGE_SIZE,
      v: (row * CELL_H + GUTTER) / PAGE_SIZE,
    };
    this.slots.set(key, slot);
    return slot;
  }

  /** Draw an image (any size, scaled to 146 x 204) into a slot. */
  draw(slot: Slot, source: CanvasImageSource): void {
    const ctx = this.scratchCtx;
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    // Stretch once to fill the gutter with edge colour, then draw the real image.
    ctx.drawImage(source, 0, 0, CELL_W, CELL_H);
    ctx.drawImage(source, GUTTER, GUTTER, IMG_W, IMG_H);
    const src = new THREE.Texture(this.scratch);
    const inPage = slot.index % SLOTS_PER_PAGE;
    const x = (inPage % COLS) * CELL_W;
    const y = Math.floor(inPage / COLS) * CELL_H;
    this.renderer.copyTextureToTexture(src, this.texture, null, new THREE.Vector3(x, y, slot.layer));
    this.mipDirty = true;
  }

  /** Regenerate mipmaps after uploads, at most a few times a second. */
  flush(now: number): void {
    if (!this.mipDirty || now - this.lastMip < 200) return;
    this.regenerateMips();
    this.lastMip = now;
  }

  /**
   * Texture filtering at a slant, set by the graphics mode (decision 152).
   * Set on the GL texture directly, since re-uploading the atlas would clear it.
   */
  setAnisotropy(n: number): void {
    this.anisotropy = n;
    const value = Math.min(n, this.renderer.capabilities.getMaxAnisotropy());
    this.texture.anisotropy = value;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = this.renderer.extensions.get('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
    if (!ext) return;
    const props = this.renderer.properties.get(this.texture) as { __webglTexture: WebGLTexture; __currentAnisotropy?: number };
    this.renderer.state.activeTexture(gl.TEXTURE0);
    this.renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, value);
    props.__currentAnisotropy = value;
  }

  private regenerateMips(): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const glTex = (this.renderer.properties.get(this.texture) as { __webglTexture: WebGLTexture }).__webglTexture;
    this.renderer.state.activeTexture(gl.TEXTURE0);
    this.renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.mipDirty = false;
  }

  private makeTexture(depth: number): THREE.DataArrayTexture {
    const tex = new THREE.DataArrayTexture(null, PAGE_SIZE, PAGE_SIZE, depth);
    tex.source.dataReady = false;
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(this.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.unpackAlignment = 4;
    tex.needsUpdate = true;
    this.renderer.initTexture(tex);
    return tex;
  }

  private grow(depth: number): void {
    const old = this.texture;
    const next = this.makeTexture(depth);
    for (let l = 0; l < this.depth; l++) {
      const region = new THREE.Box3(new THREE.Vector3(0, 0, l), new THREE.Vector3(PAGE_SIZE, PAGE_SIZE, l + 1));
      this.renderer.copyTextureToTexture(old, next, region, new THREE.Vector3(0, 0, l));
    }
    old.dispose();
    this.texture = next;
    this.depth = depth;
    this.mipDirty = true;
    if (depth > WARN_PAGES) console.warn(`Card atlas has ${depth} pages; above ${WARN_PAGES} texture memory grows large.`);
    this.onTextureChanged(next);
  }
}

/** A plain grey card with text, used until a card's image arrives (spec 8.2). */
export function drawPlaceholder(text: string, sub = ''): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = IMG_W;
  c.height = IMG_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, IMG_W, IMG_H);
  g.fillStyle = '#c9c9c6';
  g.fillRect(7, 7, IMG_W - 14, IMG_H - 14);
  g.fillStyle = '#3a3a3a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const big = text.length <= 4;
  g.font = big ? 'bold 44px system-ui, sans-serif' : 'bold 15px system-ui, sans-serif';
  const lines = big ? [text] : wrap(g, text, IMG_W - 26);
  const lh = big ? 44 : 18;
  const top = IMG_H / 2 - ((lines.length - 1) * lh) / 2 - (sub ? 10 : 0);
  lines.slice(0, 6).forEach((l, i) => g.fillText(l, IMG_W / 2, top + i * lh));
  if (sub) {
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = '#5a5a5a';
    g.fillText(sub, IMG_W / 2, IMG_H - 22);
  }
  return c;
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > width && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawStandInBack(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = IMG_W;
  c.height = IMG_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1712';
  g.fillRect(0, 0, IMG_W, IMG_H);
  g.fillStyle = '#6b4a2b';
  g.fillRect(8, 8, IMG_W - 16, IMG_H - 16);
  g.fillStyle = '#c4904d';
  g.beginPath();
  g.ellipse(IMG_W / 2, IMG_H / 2, 46, 70, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}
