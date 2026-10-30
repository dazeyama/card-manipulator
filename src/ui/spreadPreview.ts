// While an X box is being dragged (decision 207), the outline of every card
// where it will land: the same layout the spread uses, drawn flat on the
// table on a 2D canvas over the scene, redrawn as the box moves. Where cards
// overlap, only the edges that will show are drawn (decision 208). It looks
// like a hologram projected by a laser (decision 209): light blue glowing
// edges, a faint fill with scan lines drifting across it, a slight flicker.
// A reverse spread (X X, decision 215) is laid right to left and glows magenta.

import type { App } from '../app';
import { layOrder, type Placed } from '../state/piles';
import { slopePoint } from '../state/stand';
import { CARD_H, CARD_T, CARD_W, type Mat } from '../state/types';

/** The laser's colours: a bright core, a softer glow around it, the fill and its scan lines. */
const BLUE = { core: 'rgba(70, 190, 255, 0.9)', glow: 'rgba(120, 215, 255, 0.85)', fill: 'rgba(120, 210, 255, 0.10)', scan: 'rgba(90, 200, 255, 0.16)' };
/** A reverse spread's: a red-ish magenta (decision 215). */
const MAGENTA = { core: 'rgba(235, 50, 160, 0.9)', glow: 'rgba(255, 110, 190, 0.85)', fill: 'rgba(255, 100, 180, 0.10)', scan: 'rgba(240, 70, 160, 0.16)' };
/** Scan lines: one every this many pixels, drifting this many pixels a second. */
const SCAN_GAP = 4;
const SCAN_SPEED = 12;

export class SpreadPreview {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  /** The visible edges, drawn once per layout: the crisp core, and wider ones blurred into the glow. */
  private readonly edges = document.createElement('canvas');
  private readonly glow = document.createElement('canvas');
  /** The whole shape, filled, for the faint fill and the scan lines. */
  private readonly shape = document.createElement('canvas');
  private visible = false;
  private colours = BLUE;

  constructor(private readonly app: App) {
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.canvas.hidden = true;
    app.overlay.append(this.canvas);
    app.onFrame(() => {
      if (this.visible) this.frame();
    });
  }

  /** Outline these spots: on the table, or on a card stand's slope (model spots there, decision 222). */
  show(spots: Placed[], reverse = false, stand: Mat | null = null): void {
    this.colours = reverse ? MAGENTA : BLUE;
    const order = layOrder(spots, reverse);
    const rig = this.app.rig;
    const w = this.app.overlay.clientWidth, h = this.app.overlay.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.edges, this.glow, this.shape]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
    }
    const hw = CARD_W / 2, hh = CARD_H / 2;
    /** Adds one card's outline to the current path. */
    const outline = (ctx: CanvasRenderingContext2D, s: Placed) => {
      const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([dx, dy], i) => {
        const x = s.x + dx * cos - dy * sin, y = s.y + dx * sin + dy * cos;
        const w = stand ? slopePoint(stand, x, y, CARD_T) : { x, y, z: 0 };
        const p = rig.worldToScreen(w.x, w.y, w.z);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    };
    // Later cards land on top (decision 208): each one first wipes out the outlines
    // under it, then draws its own, so only the edges that will show are left.
    const layers = [[this.edges, this.colours.core, 1.25], [this.glow, this.colours.glow, 3.5]] as const;
    for (const [canvas, colour, width] of layers) {
      const e = canvas.getContext('2d')!;
      e.setTransform(dpr, 0, 0, dpr, 0, 0);
      e.clearRect(0, 0, w, h);
      e.strokeStyle = colour;
      e.lineWidth = width;
      e.lineJoin = 'round';
      // Erasing needs an opaque fill.
      e.fillStyle = '#000';
      for (const i of order) {
        e.beginPath();
        outline(e, spots[i]);
        e.globalCompositeOperation = 'destination-out';
        e.fill();
        e.globalCompositeOperation = 'source-over';
        e.stroke();
      }
    }
    const f = this.shape.getContext('2d')!;
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.clearRect(0, 0, w, h);
    f.fillStyle = '#000';
    f.beginPath();
    for (const s of spots) outline(f, s);
    f.fill();
    this.visible = true;
    this.canvas.hidden = false;
    this.frame();
  }

  hide(): void {
    this.visible = false;
    this.canvas.hidden = true;
  }

  /** One frame of the hologram: fill, drifting scan lines, glow, then the crisp edges. */
  private frame(): void {
    const { canvas, ctx } = this;
    const t = performance.now() / 1000;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The shape, tinted: the faint fill.
    ctx.drawImage(this.shape, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = this.colours.fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Scan lines drifting down the shape, only where the shape is.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colours.scan;
    const off = (t * SCAN_SPEED) % SCAN_GAP;
    for (let y = off - SCAN_GAP; y < h; y += SCAN_GAP) ctx.fillRect(0, y, w, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // A slight flicker, like a projector.
    const flicker = 0.88 + 0.08 * Math.sin(t * 23) + 0.04 * Math.sin(t * 7.3);
    // The glow: the edges blurred and tinted, then the crisp core on top.
    ctx.globalAlpha = 0.8 * flicker;
    ctx.filter = `blur(${3 * dpr}px)`;
    ctx.drawImage(this.glow, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = flicker;
    ctx.drawImage(this.edges, 0, 0);
    ctx.globalAlpha = 1;
  }
}
