// Fitting the interface to the window (decision 157). The bars and panels are
// laid out for a window 1800 px wide. Narrower, they shrink to fit, down to
// 1280 px; narrower still, a warning covers the page until the window is wide
// enough. The play space itself is never scaled, only the panels around it.

/** The width the interface is laid out for, CSS px. */
export const DESIGN_WIDTH = 1800;
/** Below this the interface would be too small to use. */
export const MIN_WIDTH = 1280;

/** Below this the bars' text would be too small to use: the warning shows instead (decision 289). */
export const MIN_SCALE = 0.6;

/**
 * The scale that fits bars whose content is `ratio` times wider than their room
 * at `scale` (decision 289: more buttons than the 1800 px layout had, or a
 * wider system font, such as the Mac's). A ratio of 1 or less: as it is.
 */
export function shrinkToFit(scale: number, ratio: number): number {
  return ratio > 1.001 ? scale / ratio : scale;
}

/** How much to shrink the bars and panels for a window this wide, or null when it is too narrow. */
export function uiScale(width: number): number | null {
  if (width >= DESIGN_WIDTH) return 1;
  if (width < MIN_WIDTH) return null;
  return width / DESIGN_WIDTH;
}

/** Keep the interface fitted to the window from now on. */
export function installFit(): void {
  const cover = document.createElement('div');
  cover.className = 'too-narrow';
  cover.setAttribute('role', 'alert');
  const title = document.createElement('h2');
  title.textContent = 'This window is too narrow';
  const body = document.createElement('p');
  const tip = document.createElement('p');
  tip.className = 'muted';
  tip.textContent = 'Make the window wider, or zoom the browser out with Ctrl and minus. This message goes away by itself once there is room.';
  cover.append(title, body, tip);
  cover.hidden = true;
  document.body.append(cover);

  // While the warning shows, keys don't reach the table behind it.
  window.addEventListener('keydown', (e) => {
    if (!cover.hidden) e.stopImmediatePropagation();
  }, true);

  const apply = (scale: number) => document.documentElement.style.setProperty('--ui-zoom', String(scale));
  // How much wider the top and bottom bars' content is than their room, 1 when it fits.
  const bars = [...document.querySelectorAll<HTMLElement>('.top-host, .bottom-host')];
  const overflow = () => Math.max(1, ...bars.map((b) => (b.clientWidth ? b.scrollWidth / b.clientWidth : 1)));
  const fit = () => {
    const width = window.innerWidth;
    let scale = uiScale(width);
    if (scale !== null) {
      apply(scale);
      // Then shrink further until the bars' buttons fit, measured, not assumed (decision 289).
      for (let i = 0; i < 3; i++) {
        const next = shrinkToFit(scale, overflow());
        if (next === scale) break;
        scale = next;
        apply(scale);
      }
      if (scale < MIN_SCALE) scale = null;
    }
    apply(scale ?? MIN_WIDTH / DESIGN_WIDTH);
    cover.hidden = scale !== null;
    if (scale === null) {
      body.textContent = `Card Manipulator needs a window at least ${MIN_WIDTH.toLocaleString()} px wide to show all its controls. This one is ${Math.round(width).toLocaleString()} px.`;
    }
  };
  window.addEventListener('resize', fit);
  // The bars change (buttons added at boot, avatars when a room fills): fit again, once per burst.
  let queued = 0;
  const refit = () => {
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      fit();
    }, 50);
  };
  const watch = new MutationObserver(refit);
  for (const b of bars) watch.observe(b, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  fit();
}
