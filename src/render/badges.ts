// Pile badges (spec 11.2, 9.7): a count pill above every pile of two or more
// cards, facing the camera at a constant size. Click selects the pile, Shift
// toggles it, dragging lifts it, double-click spreads it. Open spreads keep a
// badge at their anchor. One HTML layer, culled to the view.

import type { App } from '../app';

export interface BadgeHandlers {
  press: (pileId: string, e: PointerEvent) => void;
  doubleClick: (pileId: string) => void;
  rightClick?: (pileId: string) => void;
  /** Extra buttons on a badge (pencil, export) are added by later features. */
  decorate?: (pileId: string, el: HTMLElement, isSpread: boolean) => void;
}

interface Badge {
  el: HTMLDivElement;
  text: HTMLSpanElement;
  x: number;
  y: number;
  shown: boolean;
  key: string;
}

export class Badges {
  private readonly layer: HTMLDivElement;
  private readonly badges = new Map<string, Badge>();
  private dirty = true;

  constructor(private readonly app: App, private readonly handlers: BadgeHandlers) {
    this.layer = document.createElement('div');
    this.layer.className = 'badges';
    app.overlay.append(this.layer);
    const mark = () => (this.dirty = true);
    app.store.events.on('piles', mark);
    app.store.events.on('selection', mark);
    app.store.events.on('reset', mark);
    app.store.events.on('removed', mark);
    app.onFrame(() => this.update());
  }

  refresh(): void {
    this.dirty = true;
  }

  /** Rebuild the set of badges and their text; positions update every frame. */
  private rebuild(): void {
    const store = this.app.store;
    const want = new Set<string>();
    for (const p of store.piles.values()) {
      if (p.cardUids.length < 2) continue;
      want.add(p.id);
      const sel = p.cardUids.filter((u) => store.selection.has(u)).length;
      const name = p.name ?? store.named.get(p.id)?.name ?? null;
      const text = sel && sel < p.cardUids.length ? `${sel} of ${p.cardUids.length} selected` : `${p.cardUids.length}`;
      this.ensure(p.id, name ? `${name} · ${text}` : text, sel === p.cardUids.length ? 'all' : sel ? 'some' : '', false);
    }
    for (const sp of store.spreads.values()) {
      const key = `spread:${sp.id}`;
      want.add(key);
      const name = sp.pileId ? store.named.get(sp.pileId)?.name ?? null : null;
      this.ensure(key, `${name ? `${name} · ` : ''}spread ${sp.uids.length}`, '', true);
    }
    for (const [id, b] of this.badges) {
      if (!want.has(id)) {
        b.el.remove();
        this.badges.delete(id);
      }
    }
  }

  private ensure(id: string, text: string, selState: string, spread: boolean): void {
    let b = this.badges.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'badge';
      const t = document.createElement('span');
      t.className = 'badge-text';
      el.append(t);
      const pileId = spread ? id.slice('spread:'.length) : id;
      el.addEventListener('pointerdown', (e) => {
        if (e.button === 0) {
          e.stopPropagation();
          this.handlers.press(spread ? `spread:${pileId}` : pileId, e);
        } else if (e.button === 2) {
          e.stopPropagation();
        }
      });
      el.addEventListener('pointerup', (e) => {
        if (e.button === 2 && !spread) this.handlers.rightClick?.(pileId);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.handlers.doubleClick(spread ? `spread:${pileId}` : pileId);
      });
      this.handlers.decorate?.(pileId, el, spread);
      this.layer.append(el);
      b = { el, text: t, x: NaN, y: NaN, shown: true, key: '' };
      this.badges.set(id, b);
    }
    const key = `${text}|${selState}|${spread}`;
    if (b.key !== key) {
      b.key = key;
      b.text.textContent = text;
      b.el.classList.toggle('sel-all', selState === 'all');
      b.el.classList.toggle('sel-some', selState === 'some');
      b.el.classList.toggle('spread', spread);
    }
  }

  private update(): void {
    if (this.dirty) {
      this.rebuild();
      this.dirty = false;
    }
    const store = this.app.store;
    const rig = this.app.rig;
    const { width, height } = rig.viewport;
    const held = this.app.motion.held;
    for (const [id, b] of this.badges) {
      let x: number, y: number, z: number;
      let hidden = false;
      if (id.startsWith('spread:')) {
        const sp = store.spreads.get(id.slice(7));
        if (!sp) continue;
        x = sp.anchor.x;
        y = sp.anchor.y;
        z = 1;
      } else {
        const p = store.piles.get(id);
        if (!p) continue;
        // Badges sit over the top card, drawn where the cards are drawn.
        let top = 0;
        let sx = 0, sy = 0;
        for (const u of p.cardUids) {
          if (held.has(u)) hidden = true;
          const pose = this.app.layer.pose(u);
          if (!pose) continue;
          top = Math.max(top, pose.z);
          sx += pose.x;
          sy += pose.y;
        }
        x = p.kind === 'stack' ? p.anchor.x : sx / p.cardUids.length;
        y = p.kind === 'stack' ? p.anchor.y : sy / p.cardUids.length;
        z = top + 2;
      }
      const visible = !hidden && rig.inFront(x, y, z);
      let px = -1000, py = -1000;
      if (visible) {
        const s = rig.worldToScreen(x, y, z);
        px = s.x;
        py = s.y;
      }
      const onScreen = visible && px > -60 && py > -30 && px < width + 60 && py < height + 30;
      if (onScreen !== b.shown) {
        b.el.style.display = onScreen ? '' : 'none';
        b.shown = onScreen;
      }
      if (onScreen && !(Math.abs(px - b.x) <= 0.3 && Math.abs(py - b.y) <= 0.3)) {
        b.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%)`;
        b.x = px;
        b.y = py;
      }
    }
  }
}
