// Keyboard shortcuts (spec Section 16). All keys are inactive while a text
// field has focus.

import type { App } from '../app';
import type { MouseInput } from './mouse';

export type KeyAction = (e: KeyboardEvent) => void;

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export class KeyboardInput {
  /** Key bindings: a lower-case key name, optionally prefixed with "ctrl+". */
  private readonly bindings = new Map<string, KeyAction>();

  constructor(private readonly app: App, mouse: MouseInput) {
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
  }

  bind(key: string, action: KeyAction): void {
    this.bindings.set(key, action);
  }

  private handle(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    const name = (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + key;
    const action = this.bindings.get(name);
    if (!action) return;
    if (isTyping()) return;
    e.preventDefault();
    action(e);
  }
}
