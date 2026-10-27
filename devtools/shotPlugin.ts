// Dev-only Vite plugin: the page can POST a PNG data URL to /__shot and it is
// written under reports/screenshots/. Used by the overnight phase gate so
// screenshots of the running app land on disk (spec Section 0.1).
import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export function shotPlugin(): Plugin {
  return {
    name: 'card-manipulator-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { name: string; dataUrl: string };
            const safe = normalize(body.name);
            if (safe.includes('..') || !/^[\w\-\/\\.]+\.png$/.test(safe)) throw new Error('bad name');
            const file = join(server.config.root, 'reports', 'screenshots', safe);
            mkdirSync(dirname(file), { recursive: true });
            const b64 = body.dataUrl.replace(/^data:image\/png;base64,/, '');
            writeFileSync(file, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}
