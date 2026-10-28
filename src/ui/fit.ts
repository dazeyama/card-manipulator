// Fitting the interface to the window (decision 157). The bars and panels are
// laid out for a window 1800 px wide. Narrower, they shrink to fit, down to
// 1280 px; narrower still, a warning covers the page until the window is wide
// enough. The play space itself is never scaled, only the panels around it.

/** The width the interface is laid out for, CSS px. */
export const DESIGN_WIDTH = 1800;
/** Below this the interface would be too small to use. */
export const MIN_WIDTH = 1280;

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

  const fit = () => {
    const width = window.innerWidth;
    const scale = uiScale(width);
    document.documentElement.style.setProperty('--ui-zoom', String(scale ?? MIN_WIDTH / DESIGN_WIDTH));
    cover.hidden = scale !== null;
    if (scale === null) {
      body.textContent = `Card Manipulator needs a window at least ${MIN_WIDTH.toLocaleString()} px wide to show all its controls. This one is ${Math.round(width).toLocaleString()} px.`;
    }
  };
  window.addEventListener('resize', fit);
  fit();
}
