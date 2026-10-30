// While an X box is being dragged (decision 207), the outline of every card
// where it will land: the same layout the spread uses, drawn flat on the
// table on a 2D canvas over the scene. Just outlines, redrawn as the box moves.

import type { App } from '../app';
import type { Placed } from '../state/piles';
import { CARD_H, CARD_W } from '../state/types';

export class SpreadPreview {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  constructor(private readonly app: App) {
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.canvas.hidden = true;
    app.overlay.append(this.canvas);
  }

  show(spots: Placed[]): void {
    const { canvas, ctx } = this;
    const rig = this.app.rig;
    const w = this.app.overlay.clientWidth, h = this.app.overlay.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    canvas.hidden = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    const hw = CARD_W / 2, hh = CARD_H / 2;
    for (const s of spots) {
      const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([dx, dy], i) => {
        const p = rig.worldToScreen(s.x + dx * cos - dy * sin, s.y + dx * sin + dy * cos, 0);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(37, 99, 235, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  hide(): void {
    this.canvas.hidden = true;
  }
}
