// Dev-only: capture the page (WebGL canvas plus the DOM panels) and save it
// under reports/screenshots/ through the dev server (devtools/shotPlugin.ts).
// Used by the overnight phase gate: window.__shot('phase-1/01-load.png').

import type { App } from '../app';

export function installShot(app: App): void {
  (window as unknown as { __shot: (name: string) => Promise<string> }).__shot = async (name: string) => {
    const { toCanvas } = await import('html-to-image');
    const w = window.innerWidth;
    const h = window.innerHeight;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d')!;
    // The drawing buffer is only valid right after a render, so render and copy in one go.
    app.view.render(app.rig.camera);
    const r = app.canvas.getBoundingClientRect();
    g.drawImage(app.canvas, r.left, r.top, r.width, r.height);
    const dom = await toCanvas(document.body, {
      width: w,
      height: h,
      pixelRatio: 1,
      style: { background: 'transparent' },
      filter: (node) => !(node instanceof HTMLCanvasElement && node.classList.contains('table-canvas')),
    });
    g.drawImage(dom, 0, 0);
    const res = await fetch('/__shot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, dataUrl: out.toDataURL('image/png') }),
    });
    return res.ok ? `saved ${name}` : `failed: ${await res.text()}`;
  };
}
