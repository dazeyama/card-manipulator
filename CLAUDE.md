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

`start.bat` runs the dev server and opens the browser. The built-in browser can start it by name: `card-manipulator` in `.claude/launch.json`.

## Rules

- **The spec wins.** If the owner says something that conflicts with it, the owner wins, and the spec is updated in the same change so the conflict doesn't return.
- **Decisions are logged.** Every new decision gets the next number in Appendix A with its date. Decisions made without the owner are marked **(agent)** with the reasoning.
- **The owner is QA.** Hand off with a short "Where to look" checklist. During the autonomous overnight build only, also verify in the built-in browser (spec Section 0.1).
- **Git is local only.** Commit locally. Never add a remote, push, or run `gh`. Nothing is deployed (decisions 36 and 37).
- **Scryfall courtesy.** Every request goes through the one serialized queue in `src/scryfall/client.ts`: 100 ms between general calls, 550 ms between searches. Reuse the caches.
- **Reference projects are read-only.** `C:\ClaudeProjects\pug-pricing-tool` is reference material for the Scryfall client and conventions. Never edit it.
- **Chrome and Edge only.** Performance target is the owner's RTX 4070 Ti at 1080p.
- **Keep TypeScript simple.** Strict mode, but plain types the owner can read. No type gymnastics.
- **Pure logic is tested.** The query engine, decklist parser, pile detection and layouts live in pure modules with vitest tests.

## Where things are

- `src/state/` the table model, selection and piles.
- `src/scryfall/` the API client, resolution and caches.
- `src/query/` the local Scryfall-subset query engine.
- `src/render/` Three.js scene, instanced cards, atlas, picking, badges.
- `src/physics/` Rapier world and the feel code.
- `src/input/` the mouse and keyboard grammar from spec Section 16.
- `src/ui/` the DOM panels.
- `src/io/` decklist parsing, export, save files.
- `test-data/` lists for manual and automated testing; `cube.txt` is the owner's.
