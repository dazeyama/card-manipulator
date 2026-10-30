// While an X box is being dragged (decision 207), the outline of every card
// where it will land: the same layout the spread uses, drawn flat on the
// table on a 2D canvas over the scene, redrawn as the box moves. Where cards
// overlap, only the edges that will show are drawn (decision 208). It looks
// like a hologram projected by a laser (decision 209): light blue glowing
// edges, a faint fill with scan lines drifting across it, a slight flicker.

import type { App } from '../app';
import type { Placed } from '../state/piles';
import { CARD_H, CARD_W } from '../state/types';

/** The laser's colours: a bright core and a softer glow around it. */
const CORE = 'rgba(70, 190, 255, 0.9)';
const GLOW = 'rgba(120, 215, 255, 0.85)';
const FILL = 'rgba(120, 210, 255, 0.10)';
const SCAN = 'rgba(90, 200, 255, 0.16)';
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

  constructor(private readonly app: App) {
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.canvas.hidden = true;
    app.overlay.append(this.canvas);
    app.onFrame(() => {
      if (this.visible) this.frame();
    });
  }

  show(spots: Placed[]): void {
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
        const p = rig.worldToScreen(s.x + dx * cos - dy * sin, s.y + dx * sin + dy * cos, 0);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    };
    // Later cards land on top (decision 208): each one first wipes out the outlines
    // under it, then draws its own, so only the edges that will show are left.
    const layers = [[this.edges, CORE, 1.25], [this.glow, GLOW, 3.5]] as const;
    for (const [canvas, colour, width] of layers) {
      const e = canvas.getContext('2d')!;
      e.setTransform(dpr, 0, 0, dpr, 0, 0);
      e.clearRect(0, 0, w, h);
      e.strokeStyle = colour;
      e.lineWidth = width;
      e.lineJoin = 'round';
      // Erasing needs an opaque fill.
      e.fillStyle = '#000';
      for (const s of spots) {
        e.beginPath();
        outline(e, s);
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
    ctx.fillStyle = FILL;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Scan lines drifting down the shape, only where the shape is.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SCAN;
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
