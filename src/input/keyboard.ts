// Keyboard shortcuts (spec Section 16). All keys are inactive while a text
// field has focus.

import type { App } from '../app';
import type { MouseInput } from './mouse';

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
  /** Keys whose press ran a hotkey and are still down, with when it last ran. */
  private readonly down = new Map<string, number>();

  constructor(private readonly app: App, mouse: MouseInput) {
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
        this.bindings.get(name)?.(e);
      }
    }, true);
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !isTyping()) {
        mouse.spaceDown = true;
        e.preventDefault();
      }
      if (e.key === 'Alt') e.preventDefault();
      this.handle(e);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') mouse.spaceDown = false;
      // Releasing Alt would focus the browser menu bar on Windows (decision 29).
      if (e.key === 'Alt') e.preventDefault();
    });
    window.addEventListener('blur', () => (mouse.spaceDown = false));
    this.bind('home', () => this.app.rig.reset());
    this.bind('v', () => this.app.rig.cycle());
  }

  /** Bind a key. A hotkey fires once per press; `repeatMs` keeps it firing that often while held (decision 183). */
  bind(key: string, action: KeyAction, opts: { repeatMs?: number } = {}): void {
    this.bindings.set(key, action);
    if (opts.repeatMs !== undefined) this.repeats.set(key, opts.repeatMs);
  }

  private nameOf(e: KeyboardEvent): string {
    const key = e.key.toLowerCase();
    // Shift counts only with letters, so `?` and the like still match their own key.
    const shift = e.shiftKey && /^[a-z]$/.test(key) ? 'shift+' : '';
    return (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + shift + key;
  }

  private handle(e: KeyboardEvent): void {
    if (e.repeat) return;
    const action = this.bindings.get(this.nameOf(e));
    if (!action) return;
    if (isTyping()) return;
    e.preventDefault();
    this.down.set(e.code, performance.now());
    action(e);
  }
}
