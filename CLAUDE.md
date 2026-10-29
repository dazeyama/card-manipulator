# 3D Card Manipulator — rules for Claude Code

A browser scratchpad for moving hundreds to thousands of Magic cards around a 3D table, with Scryfall data and RTS-style selection. TypeScript, Vite, Three.js, Rapier. No backend.

## Start of a session

1. Read **design_spec.md** whole before changing anything. It is the single source of truth. Sections 1–17 describe the product, Section 18 the build phases, Appendix A every decision.
2. If **MORNING_REPORT.md** exists, read its summary to see which phases are done and what is marked BROKEN.
3. Check `git log --oneline` to see the last finished phase.

## Running it

```
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test
npm run build
```

`start.bat` runs the dev server and opens the browser. The built-in browser can start it by name: `card-manipulator` in `.claude/launch.json`; `card-manipulator-preview` serves the production build on port 4173 (run `npm run build` first).

Regenerate the test lists (Scryfall, through the app's own client): `node --experimental-transform-types scripts/make-test-data.ts [deck|dfc|bad|stress]`. Refresh the welcome table's embedded card data the same way: `node --experimental-transform-types scripts/refresh-welcome.ts`.

## Rules

- **The spec wins.** If the owner says something that conflicts with it, the owner wins, and the spec is updated in the same change so the conflict doesn't return.
- **Decisions are logged.** Every new decision gets the next number in Appendix A with its date. Decisions made without the owner are marked **(agent)** with the reasoning.
- **The owner is QA.** Hand off with a short "Where to look" checklist. During the autonomous overnight build only, also verify in the built-in browser (spec Section 0.1).
- **Git and deploy** (decision 203). The repo is public on GitHub as `origin`. Commit locally as usual; push to `main` only when the owner asks, since every push to `main` deploys the site to GitHub Pages through `.github/workflows/pages.yml` (it runs typecheck, tests and build first). Commits use the owner's GitHub noreply email, never their personal one.
- **Scryfall courtesy.** Every request goes through the one serialized queue in `src/scryfall/client.ts`: 100 ms between general calls, 550 ms between searches. Reuse the caches.
- **Reference projects are read-only.** `C:\ClaudeProjects\pug-pricing-tool` is reference material for the Scryfall client and conventions. Never edit it.
- **Chrome and Edge only.** Performance target is the owner's RTX 4070 Ti at 1080p.
- **Keep TypeScript simple.** Strict mode, but plain types the owner can read. No type gymnastics.
- **Pure logic is tested.** The query engine, decklist parser, pile detection and layouts live in pure modules with vitest tests.

## Where things are

- `src/main.ts` boots everything and wires the mouse grammar, keys, badges and files; `src/app.ts` owns the store, renderer, camera and frame loop.
- `src/commands.ts` landing cards and the Stack / Spread / Tidy / Rotate / Flip / Frame commands; `src/named.ts` named piles; `src/spawn.ts` creating cards.
- `src/state/` the table model, selection, pile geometry and detection (`piles.ts`, pure), and `pileSync.ts` which runs detection after cards settle.
- `src/scryfall/` the API client, resolution and caches.
- `src/query/` the local Scryfall-subset query engine.
- `src/cube/` CubeCobra cubes: links, the cube JSON and card Elo (one request per cube; not Scryfall, so not through the queue).
- `src/render/` Three.js scene, instanced cards (`cards.ts`, one draw call, shader does corners, rim, foil), the atlas (layers of one array texture), picking, badges, outlines of empty named piles, close-up `normal` images (`hires.ts`), far-zoom selection dots.
- `src/physics/` `world.ts` Rapier for loose cards only, `feel.ts` drags, landings and flicks, `motion.ts` display tweens.
- `src/input/` the mouse and keyboard grammar from spec Section 16.
- `src/ui/` the DOM panels.
- `src/io/` decklist parsing, export (decklist, CSV), save files, autosave.
- `src/dev/` dev-only tooling, never in the production build: `__shot(name)` saves a screenshot to `reports/screenshots/` (through `devtools/shotPlugin.ts`), `__spawnFile('cube.txt', opts)`, `await __regression()` runs every phase's checklist, `__errors` lists page errors since load.
- `test-data/` lists for manual and automated testing; `cube.txt` is the owner's.

## Gotchas

- The Bash tool on this machine chokes on non-ASCII characters (such as `…` or `—`) inside heredocs: write such files with the Write tool.
- If the dev page fails with "does not provide an export named …", Vite served a half-written module: `touch` the file and reload.
- The built-in browser's drag action cannot hold Shift, Ctrl or Alt; test modifier drags with synthetic pointer events that carry the flags, and say so in reports.
- `window.app` is the `#app` element when `main.ts` failed to load; check `__errors` or the console first.
