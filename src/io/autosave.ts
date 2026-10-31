// Autosave to IndexedDB (spec 14.3): after every settle, debounced to one
// second, written off the frame. Reopening the page restores the last table,
// camera included.

import type { App } from '../app';
import { kvGet, kvSet } from '../scryfall/db';
import type { TableDoc } from '../state/types';
import { loadDoc, toDoc } from './saveFile';

const KEY = 'autosave.v1';
const DEBOUNCE_MS = 1000;

export class Autosave {
  private timer = 0;
  private restoring = false;
  /**
   * Nothing is saved while set (rooms, O72): a page opened on a room link,
   * until its own table is back, and a joiner while in a room, so the room's
   * table never overwrites this browser's own.
   */
  paused = false;
  /** Duration of the last save, for the performance report. */
  lastMs = 0;

  constructor(private readonly app: App) {
    const schedule = () => this.schedule();
    const ev = app.store.events;
    ev.on('settled', schedule);
    ev.on('removed', schedule);
    ev.on('name', schedule);
    ev.on('settings', schedule);
    ev.on('piles', schedule);
    ev.on('reset', schedule);
    ev.on('mats', schedule);
    ev.on('basics', schedule);
    ev.on('life', schedule);
    ev.on('dice', schedule);
    app.onFrame(() => {
      if (app.rig.changed) schedule();
    });
    window.addEventListener('beforeunload', () => {
      if (this.timer) void this.save();
    });
  }

  schedule(): void {
    if (this.restoring || this.paused) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const run = () => void this.save();
      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 500 });
      else run();
    }, DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    if (this.paused) return;
    const t0 = performance.now();
    const doc = toDoc(this.app, false);
    await kvSet(KEY, doc);
    this.lastMs = performance.now() - t0;
  }

  /** Restore the last table. Returns false if there was none. */
  async restore(): Promise<boolean> {
    const stored = await kvGet<TableDoc>(KEY);
    if (!stored?.value?.cards) return false;
    this.restoring = true;
    try {
      await loadDoc(this.app, stored.value);
    } finally {
      this.restoring = false;
    }
    return true;
  }
}
