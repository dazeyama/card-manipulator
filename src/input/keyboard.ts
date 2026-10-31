// Keyboard shortcuts (spec Section 16). All keys are inactive while a text
// field has focus.

import type { App } from '../app';

export type KeyAction = (e: KeyboardEvent) => void;

/**
 * Should a held key's repeat run its action now (decision 183)? Holding a key
 * makes the browser repeat it about 30 times a second; a hotkey fires once per
 * press unless it was bound with a repeat pace, and then at most that often.
 */
export function repeatDue(repeatMs: number | undefined, lastRun: number, now: number): boolean {
  return repeatMs !== undefined && now - lastRun >= repeatMs;
}

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class KeyboardInput {
  /** Key bindings: a lower-case key name, optionally prefixed with "ctrl+". */
  private readonly bindings = new Map<string, KeyAction>();
  /** Bindings that keep firing while held, and how often (decision 183). */
  private readonly repeats = new Map<string, number>();
  /** Called just before a hotkey runs, so undo can keep the table as it was (decision 204). */
  beforeKey: (e: KeyboardEvent) => void = () => {};
  /** In a room, may this key's command run (ONLINE.md 6.4)? The guard says why not itself. */
  guard: (name: string) => boolean = () => true;
  /** The same question without the toast, for greying out the radial menu's wedges. */
  allowed: (name: string) => boolean = () => true;
  /** Keys whose press ran a hotkey and are still down, with when it last ran. */
  private readonly down = new Map<string, number>();

  constructor(private readonly app: App) {
    // A held hotkey's repeats are taken first, before anything else sees them, so they
    // neither run it again nor type into a box the hotkey just opened (decision 183).
    window.addEventListener('keydown', (e) => {
      if (!e.repeat || !this.down.has(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const name = this.nameOf(e);
      const now = performance.now();
      if (!isTyping() && repeatDue(this.repeats.get(name), this.down.get(e.code)!, now)) {
        this.down.set(e.code, now);
        if (this.guard(name)) this.bindings.get(name)?.(e);
      }
    }, true);
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') e.preventDefault();
      this.handle(e);
    });
    window.addEventListener('keyup', (e) => {
      // Releasing Alt would focus the browser menu bar on Windows (decision 29).
      if (e.key === 'Alt') e.preventDefault();
    });
    this.bind('home', () => this.app.rig.reset());
    this.bind('v', () => this.app.rig.cycle());
  }

  /** Bind a key. A hotkey fires once per press; `repeatMs` keeps it firing that often while held (decision 183). */
  bind(key: string, action: KeyAction, opts: { repeatMs?: number } = {}): void {
    this.bindings.set(key, action);
    if (opts.repeatMs !== undefined) this.repeats.set(key, opts.repeatMs);
  }

  /**
   * Run a key's command as if it were pressed (the radial menu, decision 298):
   * the room's guard and undo see it as that key, and two presses in a row are
   * the key's double tap (S S shuffles).
   */
  press(name: string): void {
    const action = this.bindings.get(name);
    if (!action || !this.guard(name)) return;
    const key = name.slice(name.lastIndexOf('+') + 1);
    const e = new KeyboardEvent('keydown', { key, ctrlKey: name.startsWith('ctrl+'), shiftKey: name.includes('shift+') });
    this.beforeKey(e);
    action(e);
  }

  private nameOf(e: KeyboardEvent): string {
    // A digit with Shift is its digit, not the symbol above it (Shift + 1-9, 0, decision 271).
    const digit = e.shiftKey ? /^Digit(\d)$/.exec(e.code) : null;
    const key = digit ? digit[1] : e.key.toLowerCase();
    // Shift counts only with letters and digits, so `?` and the like still match their own key.
    const shift = e.shiftKey && /^[a-z0-9]$/.test(key) ? 'shift+' : '';
    return (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + shift + key;
  }

  private handle(e: KeyboardEvent): void {
    if (e.repeat) return;
    const action = this.bindings.get(this.nameOf(e));
    if (!action) return;
    if (isTyping()) return;
    e.preventDefault();
    if (!this.guard(this.nameOf(e))) return;
    this.down.set(e.code, performance.now());
    this.beforeKey(e);
    action(e);
  }
}
