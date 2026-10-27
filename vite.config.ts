import { defineConfig } from 'vitest/config';
import { shotPlugin } from './devtools/shotPlugin.ts';

// BASE_PATH lets a later GitHub Pages deploy use '/card-manipulator/' (spec 4.4).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [shotPlugin()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/**/*.test.ts'] },
});
