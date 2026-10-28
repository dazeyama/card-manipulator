// Generate an image through OpenRouter's image API (decision 117), for app art
// such as the cursor gloves. Dev only: never part of the app or its build.
// gpt-image-1 is listed but retired upstream; gpt-image-2 does transparent backgrounds.
//
// The key is read from the OPENROUTER_API_KEY environment variable, or from a
// `.env.local` file in the project root (git ignores it). It is never printed.
//
//   node --experimental-transform-types devtools/genImage.ts --out art/cursors/raw/point.png "a cartoon glove pointing up"
//   node --experimental-transform-types devtools/genImage.ts --list
//
// Options: --model (default openai/gpt-image-2), --aspect (1:1), --size (if the model takes it),
// --background (transparent), --quality (high), --n (1), --out (required).

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';

const API = 'https://openrouter.ai/api/v1';

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = /^\s*OPENROUTER_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  console.error('No OpenRouter key: set OPENROUTER_API_KEY, or add OPENROUTER_API_KEY=... to .env.local.');
  process.exit(1);
}

function parseArgs(argv: string[]): { opts: Record<string, string>; prompt: string; list: boolean } {
  const opts: Record<string, string> = {};
  const words: string[] = [];
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') list = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else words.push(a);
  }
  return { opts, prompt: words.join(' '), list };
}

async function main(): Promise<void> {
  const { opts, prompt, list } = parseArgs(process.argv.slice(2));
  const headers = { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' };

  if (list) {
    const res = await fetch(`${API}/images/models`, { headers });
    const body = (await res.json()) as { data?: { id: string; supported_parameters?: unknown }[] };
    for (const m of body.data ?? []) {
      const p = m.supported_parameters;
      console.log(`${m.id}  ${Array.isArray(p) ? p.join(', ') : p && typeof p === 'object' ? Object.keys(p).join(', ') : ''}`);
    }
    return;
  }

  if (!prompt || !opts.out) {
    console.error('Usage: genImage.ts --out <file.png> [--model id] [--aspect 1:1] [--background transparent] [--quality high] [--n 1] "prompt"');
    process.exit(1);
  }
  const request = {
    model: opts.model ?? 'openai/gpt-image-2',
    prompt,
    aspect_ratio: opts.aspect ?? '1:1',
    ...(opts.size ? { size: opts.size } : {}),
    background: opts.background ?? 'transparent',
    quality: opts.quality ?? 'high',
    n: Number(opts.n ?? 1),
    output_format: 'png',
  };
  const res = await fetch(`${API}/images`, { method: 'POST', headers, body: JSON.stringify(request) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`OpenRouter ${res.status}: ${text.slice(0, 800)}`);
    process.exit(1);
  }
  const body = JSON.parse(text) as { data?: { b64_json?: string }[]; usage?: { cost?: number } };
  const images = (body.data ?? []).filter((d) => d.b64_json);
  if (!images.length) {
    console.error(`No image in the response: ${text.slice(0, 800)}`);
    process.exit(1);
  }
  mkdirSync(dirname(opts.out), { recursive: true });
  const ext = extname(opts.out);
  images.forEach((img, i) => {
    const file = images.length === 1 ? opts.out : opts.out.replace(ext, `-${i + 1}${ext}`);
    writeFileSync(file, Buffer.from(img.b64_json!, 'base64'));
    console.log(`saved ${file}`);
  });
  if (body.usage?.cost !== undefined) console.log(`cost $${body.usage.cost.toFixed(4)}`);
}

void main();
