// Toasts and the rate-limit banner (spec 5.2, 11.3).

let host: HTMLDivElement | null = null;
let banner: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.append(host);
  }
  return host;
}

export type ToastKind = 'info' | 'ok' | 'warn' | 'error';

export function toast(message: string, kind: ToastKind = 'info', ms = 3200): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  // `term` in a message is shown as code.
  message.split('`').forEach((part, i) => {
    if (i % 2) {
      const code = document.createElement('code');
      code.textContent = part;
      el.append(code);
    } else el.append(part);
  });
  ensureHost().append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

/** A persistent banner across the top of the table, or hide it with null. */
export function setBanner(message: string | null): void {
  if (!message) {
    banner?.remove();
    banner = null;
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'banner';
    document.body.append(banner);
  }
  banner.textContent = message;
}
