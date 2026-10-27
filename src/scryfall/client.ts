// The one serialized Scryfall queue (spec 5.2), ported from the PUG Pricing
// Tool's transport: one request at a time, general calls 100 ms apart,
// searches 550 ms after the previous search's answer. A 429 pauses the whole
// queue for as long as Scryfall asks and raises a visible banner.

export const API = 'https://api.scryfall.com';
const GENERAL_GAP_MS = 100;
const SEARCH_GAP_MS = 550;
const ANSWER_MS = 10_000;
const TRIES = 5;

export type RequestKind = 'general' | 'search';

export class UnavailableError extends Error {
  constructor(url: string, readonly limited = false) {
    super(limited ? 'Scryfall is asking for fewer requests' : `No response from ${new URL(url).host}`);
    this.name = 'UnavailableError';
  }
}

export interface ClientStatus {
  /** Epoch ms until which the queue is paused after a 429, or 0. */
  pausedUntil: number;
  /** Requests waiting or running. */
  pending: number;
}

interface Job {
  url: string;
  kind: RequestKind;
  init?: RequestInit;
  signal?: AbortSignal;
  resolve: (res: Response) => void;
  reject: (err: unknown) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ScryfallClient {
  private readonly queue: Job[] = [];
  private running = false;
  private lastStart = 0;
  private lastSearchDone = 0;
  private pausedUntil = 0;
  private readonly listeners = new Set<(s: ClientStatus) => void>();

  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  onStatus(fn: (s: ClientStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s: ClientStatus = { pausedUntil: this.pausedUntil, pending: this.queue.length + (this.running ? 1 : 0) };
    for (const fn of this.listeners) fn(s);
  }

  /** Queue a request; resolves with the Response for any status except 429/503. */
  request(url: string, opts: { kind?: RequestKind; init?: RequestInit; signal?: AbortSignal } = {}): Promise<Response> {
    if (opts.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      this.queue.push({ url, kind: opts.kind ?? 'general', init: opts.init, signal: opts.signal, resolve, reject });
      this.emit();
      void this.pump();
    });
  }

  /** GET JSON. `null` for 404 and 400 (Scryfall's "nothing matches"). */
  async getJson<T>(path: string, opts: { kind?: RequestKind; signal?: AbortSignal } = {}): Promise<T | null> {
    const res = await this.request(toUrl(path), opts);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
    return (await res.json()) as T;
  }

  /** POST JSON (used for /cards/collection). */
  async postJson<T>(path: string, body: unknown, opts: { signal?: AbortSignal } = {}): Promise<T> {
    const res = await this.request(toUrl(path), {
      init: { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
    return (await res.json()) as T;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.signal?.aborted) {
          job.reject(new DOMException('Aborted', 'AbortError'));
          continue;
        }
        try {
          job.resolve(await this.run(job));
        } catch (err) {
          job.reject(err);
        }
        this.emit();
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async run(job: Job): Promise<Response> {
    let limited = false;
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const now = Date.now();
      let at = Math.max(this.lastStart + GENERAL_GAP_MS, this.pausedUntil);
      if (job.kind === 'search') at = Math.max(at, this.lastSearchDone + SEARCH_GAP_MS);
      if (at > now) await sleep(at - now);
      if (job.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      this.lastStart = Date.now();

      const ctrl = new AbortController();
      const giveUp = () => ctrl.abort();
      job.signal?.addEventListener('abort', giveUp, { once: true });
      const clock = setTimeout(giveUp, ANSWER_MS);
      let res: Response;
      try {
        const headers = { Accept: 'application/json', ...this.extraHeaders, ...(job.init?.headers as Record<string, string> | undefined) };
        res = await this.fetchFn(job.url, { ...job.init, headers, signal: ctrl.signal });
      } catch {
        if (job.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        await sleep(400 * (attempt + 1));
        continue;
      } finally {
        clearTimeout(clock);
        job.signal?.removeEventListener('abort', giveUp);
        if (job.kind === 'search') this.lastSearchDone = Date.now();
      }
      if (res.status === 429 || res.status === 503) {
        limited = limited || res.status === 429;
        const retryAfter = parseFloat(res.headers.get('Retry-After') ?? '');
        const waitMs = (Number.isNaN(retryAfter) ? (res.status === 429 ? 60 : 1 + attempt) : retryAfter) * 1000 + 250;
        this.pausedUntil = Date.now() + waitMs;
        this.emit();
        continue;
      }
      return res;
    }
    throw new UnavailableError(job.url, limited);
  }
}

function toUrl(path: string): string {
  return path.startsWith('http') ? path : `${API}${path}`;
}

/** The app's one client. */
export const scryfall = new ScryfallClient();
