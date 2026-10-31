// How big the custom cursors are drawn (decision 289). The glove art is made
// at 48 px for the owner's 1080p monitor; on a laptop's smaller screen, and on
// a Mac above all, that reads as huge. Auto picks a size from the screen; the
// ? panel can override it, remembered in this browser.

export type CursorSize = 'small' | 'medium' | 'large';
export type CursorChoice = 'auto' | CursorSize;

/** Each size's cursor, CSS px square. */
export const CURSOR_PX: Record<CursorSize, number> = { small: 28, medium: 36, large: 48 };

export const CURSOR_LABEL: Record<CursorSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** Screens this wide (CSS px) or wider get the full-size cursor. */
const BIG_SCREEN = 1600;

/** The size Auto picks: full size on a big screen, a step down on a laptop, and one more step down on a Mac. */
export function autoCursorSize(screenWidth: number, mac: boolean): CursorSize {
  const big = screenWidth >= BIG_SCREEN;
  if (mac) return big ? 'medium' : 'small';
  return big ? 'large' : 'medium';
}

/** A hotspot moved with its cursor scaled from `from` px to `to` px, kept inside the image. */
export function scaleHotspot(at: number, from: number, to: number): number {
  return Math.min(to - 1, Math.max(0, Math.round((at * to) / from)));
}

const KEY = 'card-manipulator.cursor-size';

/** Fired on window when the choice changes; the cursors redraw themselves. */
export const CURSOR_SIZE_EVENT = 'cursor-size';

export function isMac(): boolean {
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform === 'macOS' || /Mac/i.test(navigator.platform);
}

export function cursorChoice(): CursorChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'small' || v === 'medium' || v === 'large') return v;
  } catch {
    // No storage: Auto.
  }
  return 'auto';
}

export function setCursorChoice(choice: CursorChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not remembered this time.
  }
  window.dispatchEvent(new Event(CURSOR_SIZE_EVENT));
}

/** The size in use: the one chosen, or Auto's pick for this screen. */
export function cursorSizeNow(choice = cursorChoice()): CursorSize {
  return choice === 'auto' ? autoCursorSize(window.screen.width || window.innerWidth, isMac()) : choice;
}
