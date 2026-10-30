// Dice numbers (decision 265): a die's number floats just above it while the
// mouse is over it, and above every die when they are so small on screen that
// the pips are hard to read. Bold white figures with a thick black outline;
// only a readout, clicks pass through.

import type { App } from '../app';
import type { Dice } from '../dice';
import type { DiceLayer } from '../render/dice';
import { DIE_SIZE } from '../state/dice';

/** Below this size on screen, px, every die shows its number. */
const SMALL_PX = 26;
/** The figures' size, px: a share of the die's size on screen, within limits. */
const FONT_MIN = 13;
const FONT_MAX = 30;

export class DiceNumbers {
  private readonly labels = new Map<string, HTMLDivElement>();

  constructor(private readonly app: App, private readonly dice: Dice, private readonly layer: DiceLayer) {
    app.onFrame(() => this.frame());
  }

  private frame(): void {
    const store = this.app.store;
    const rig = this.app.rig;
    for (const [uid, el] of this.labels) {
      if (!store.dice.has(uid)) {
        el.remove();
        this.labels.delete(uid);
      }
    }
    for (const d of store.dice.values()) {
      let el = this.labels.get(d.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'die-number';
        this.app.overlay.append(el);
        this.labels.set(d.uid, el);
      }
      // Where it is drawn now: mid-drag or mid-roll too.
      const at = this.layer.drawnAt(d.uid)?.position ?? d;
      const top = at.z + DIE_SIZE * 0.75;
      if (!rig.inFront(at.x, at.y, top)) {
        el.hidden = true;
        continue;
      }
      const p = rig.worldToScreen(at.x, at.y, top);
      // The die's size on screen.
      const c = rig.worldToScreen(at.x, at.y, at.z), q = rig.worldToScreen(at.x + DIE_SIZE, at.y, at.z);
      const size = Math.hypot(q.x - c.x, q.y - c.y);
      const show = this.dice.hovered === d.uid || size < SMALL_PX;
      el.hidden = !show;
      if (!show) continue;
      el.textContent = String(d.value);
      el.style.fontSize = `${Math.max(FONT_MIN, Math.min(FONT_MAX, size * 0.8)).toFixed(0)}px`;
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
