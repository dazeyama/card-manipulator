// Card image loading (spec 5.2, 8.2): CDN requests outside the API queue, at
// most eight at a time, cached in the Cache API so a refresh loads from disk.

const CACHE_NAME = 'card-images-v1';
const CONCURRENCY = 8;

type Job = { url: string; resolve: (b: ImageBitmap) => void; reject: (e: unknown) => void; priority: number; cover?: boolean };

export class ImageLoader {
  private readonly queue: Job[] = [];
  private active = 0;
  private cache: Promise<Cache | null>;
  /** Count of images served from the Cache API vs the network, for the report. */
  readonly stats = { cached: 0, network: 0, failed: 0 };

  constructor(private readonly width: number, private readonly height: number) {
    this.cache = 'caches' in window ? caches.open(CACHE_NAME).catch(() => null) : Promise.resolve(null);
  }

  get pending(): number {
    return this.queue.length + this.active;
  }

  /** Load an image, resized to the loader's size. Higher priority goes first. */
  load(url: string, priority = 0): Promise<ImageBitmap> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, resolve, reject, priority });
      this.pump();
    });
  }

  /** Load an image cut to the loader's shape from its middle, not stretched (an art sleeve's art crop, decision 360). */
  loadCover(url: string): Promise<ImageBitmap> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, resolve, reject, priority: 1, cover: true });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority > this.queue[best].priority) best = i;
      const job = this.queue.splice(best, 1)[0];
      this.active++;
      this.fetchBitmap(job.url, job.cover)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async fetchBitmap(url: string, cover = false): Promise<ImageBitmap> {
    const cache = await this.cache;
    let blob: Blob | null = null;
    if (cache) {
      const hit = await cache.match(url);
      if (hit) {
        blob = await hit.blob();
        this.stats.cached++;
      }
    }
    if (!blob) {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (r.ok) res = r;
          else if (r.status === 404) break;
          else await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
        } catch {
          await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1)));
        }
      }
      if (!res) {
        this.stats.failed++;
        throw new Error(`Image failed: ${url}`);
      }
      if (cache) await cache.put(url, res.clone()).catch(() => {});
      blob = await res.blob();
      this.stats.network++;
    }
    if (cover) {
      const whole = await createImageBitmap(blob);
      const k = Math.min(whole.width / this.width, whole.height / this.height);
      const sw = this.width * k, sh = this.height * k;
      const out = await createImageBitmap(whole, (whole.width - sw) / 2, (whole.height - sh) / 2, sw, sh, { resizeWidth: this.width, resizeHeight: this.height, resizeQuality: 'high' });
      whole.close();
      return out;
    }
    return createImageBitmap(blob, { resizeWidth: this.width, resizeHeight: this.height, resizeQuality: 'high' });
  }
}
