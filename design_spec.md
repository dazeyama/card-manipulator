# 3D Card Manipulator — Design Specification

| | |
|---|---|
| **Product** | 3D Card Manipulator (working name: "card-manipulator") |
| **Owner** | Daisy |
| **Spec version** | 0.3 — 2026-10-27 |
| **Status** | Phases 1–8 built in the autonomous overnight run of 2026-10-27 (see `MORNING_REPORT.md`); awaiting the owner's morning QA. |
| **Project folder** | `C:\ClaudeProjects\card-manipulator` |
| **Live URL** | None yet. Deploy is deferred (decision 37). When it happens: `https://dazeyama.github.io/card-manipulator/`. |
| **Inspiration** | Lucky Paper's MTG Scratchpad (`https://luckypaper.co/resources/scratchpad/`), rebuilt as a 3D table with physics and RTS-style selection |
| **Words** | A **card** is one physical object on the table. A **stack** is a tidy pile of cards squared up on top of each other. A **pile** is any group of cards resting together, tidy or messy. A **named pile** is a pile the owner has given a name. A **selection** is the set of cards currently under command. See Section 2. |

---

## 0. How to use this document

This spec is written for an engineer building the app with Claude Code. It is the single source of truth. Where it says **must**, that is a requirement. Where it says **should**, use judgement. If something here conflicts with the owner's later instructions, the owner wins. Update this file so the conflict doesn't come back.

1. **Read the whole document before starting.** Sections 1–17 describe the finished product. Section 18 splits the build into phases.
2. **Build one phase at a time, in order.** Each phase ends at a state the owner can open on `localhost` and check. During the overnight build, a phase is finished when it passes the gate in Section 0.1, not when the owner reports back.
3. **The owner is QA, in the morning.** For the overnight build only, Claude Code also verifies its own work in the built-in browser (Section 0.1). The owner still does the final QA from each phase's "Where to look" checklist.
4. **The PUG Pricing Tool is reference material only** (Section 3). Read `src/lib/scryfall.js`, `cache.js` and `transport.js` for conventions. Never edit that project.
5. **Every owner decision is logged** in Appendix A with its date. Open questions live in Appendix B. When one is answered, move it to Appendix A and update the body.
6. **No secrets.** Scryfall is keyless. There is no backend.

### 0.1 Autonomous build mode (owner, 2026-10-27)

The owner will run Phases 1–8 overnight in one unattended Claude Code session, started from `OVERNIGHT_PROMPT.md`. These rules apply to that run and override anything above that assumes the owner is present.

- **All eight phases, in order, without waiting.** A phase is finished when it passes the **phase gate**:
  1. `npm run typecheck` passes with no errors.
  2. `npm test` passes. Every pure module the phase adds has tests.
  3. `npm run build` succeeds.
  4. The agent starts the dev server, opens it in the built-in browser, walks the phase's "Where to look" checklist itself, saves screenshots into `reports/screenshots/phase-N/`, and confirms the console shows no errors.
  5. A local git commit closes the phase.
- **Ambiguity:** decide, log, keep going. Pick the option most in line with this spec and the owner's decisions, and add a row to Appendix A marked **(agent)** with the reasoning. Never stop the run to ask.
- **Stuck:** after a genuine effort on one item, stub it so later phases still work, mark it **BROKEN** in the morning report with what was tried, and continue.
- **Dependencies:** any package may be added if its reason is logged as an agent decision (decision 35).
- **Git:** local commits only. No remote, no push, no `gh` commands, no GitHub repo (decision 36).
- **Deploy:** none. Nothing is published (decision 37).
- **Network:** Scryfall's API and image CDN only, from the app in the browser, plus the one card back download. Be gentle: reuse the caches and don't reload large lists in loops.
- **Progress:** `MORNING_REPORT.md` is updated at the end of every phase (Section 18.1). It is also how a resumed or compacted session finds where the run stands.

---

## 1. Overview

### 1.1 Purpose

A browser scratchpad for working with hundreds to a couple of thousand Magic cards as simulated physical objects on a 3D table. It assists tasks that involve sorting, grouping, comparing and arranging many cards at once: cube curation, collection triage, splitting one pool into several decks, and reviewing draft picks and pools.

It is not a game client. There are no turns, zones, life totals or rules. It is a table, cards, and tools for commanding them.

### 1.2 Goals

1. **RTS-style selection and filtering is the headline feature.** Grab a crowd of cards with a rectangle, refine the selection with a Scryfall-style query, and move the result as a unit. This is the one thing the tool must do better than the Lucky Paper Scratchpad (owner, 2026-10-27).
2. **Physical feel.** Cards have thickness, cast shadows, slide, settle, stack and flip. Motion feels like cardboard; results are tidy when you want them tidy.
3. **Scale.** Up to about 2,000 cards on one table at a smooth frame rate on the owner's machine: an NVIDIA RTX 4070 Ti at 1920 × 1080 (decision 38).
4. **Scryfall-native.** Cards are specific printings with their real images and data, spawned from decklists, single-card search or a Scryfall query.
5. **Round trip.** Piles leave the tool as decklists and CSV. The whole table saves and reloads, including across a browser refresh.

### 1.3 Non-goals (version one)

These are deliberately out, and listed in Section 19 for later: undo/redo, saved selection groups bound to number keys, multiple tables or tabs, drawn snap zones or lanes, collapsing duplicates into one card with a count, shareable links or any backend, touch and phone support, rules or game simulation, pricing, sound, deployment, a dark theme, and browsers other than Chrome and Edge.

### 1.4 The jobs this tool is for

The owner named four tasks (2026-10-27). Every design decision should be tested against them.

| Job | What a session looks like |
|---|---|
| Cube sorting and curation | Spawn a 540-card list. Select by color and mana value, lay piles in rows, swap cards in and out, export the result. |
| Collection triage | Spawn a few hundred cards from a list. Sort into keep, sell, trade and bulk piles. Export each pile as CSV. |
| Building multiple decks | Spawn one pool. Pull candidates into several deck piles side by side, compare, move cards between them, export each deck. |
| Draft and pick analysis | Spawn a pool or a set. Filter by archetype signals, rank by eye, spread stacks to compare. |

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Table** | The infinite flat surface everything rests on. There is exactly one table in version one. |
| **Card** | One physical object: a specific Scryfall printing plus a finish (foil or nonfoil), a position, a rotation and a face (up or down). Four copies of a card are four card objects. |
| **Face** | The side showing. A face-down normal card shows the Magic card back. A face-down double-faced card shows its back face. The tool treats both identically: flipping is flipping. |
| **Pile** | Any group of cards resting together on the table. Piles are detected automatically from positions (Section 11.1). |
| **Stack** | A tidy pile: cards squared up, one on top of the next, with a count badge. |
| **Messy pile** | An untidy pile: cards overlapping at small random offsets and angles. |
| **Named pile** | A pile the owner has promoted by giving it a name. It keeps its identity, has its own filter and exports as a unit (Section 11.3). |
| **Spread** | A stack temporarily fanned out into a grid so every card is visible. Double-click toggles it. |
| **Selection** | The set of cards currently under command. Highlighted, counted in the HUD, moved together. |
| **Refine** | Narrowing the selection with a query. The selection shrinks to the cards that match. |
| **Table search** | Running a query over every card on the table. Matches become the selection wherever they are. |
| **Spawn** | Creating cards on the table from a decklist, a single card, or a Scryfall query. |
| **Arrival** | How spawned cards land: as a messy pile (default) or as a neat stack. |
| **Inspect panel** | The side panel showing a large image and the text of the card under the cursor. |
| **Gather** | The default group-drag behaviour: selected cards flow toward the cursor as you drag. |
| **Formation** | The alternative group-drag behaviour: selected cards keep their relative positions. |
| **Tidy** | A command that squares up the selection into stacks. Also the name of the toggle that makes every drop land tidy. |
| **Flick** | A fast sideways mouse motion during a drag that tosses the card and flips it. |

---

## 3. Reference projects

### 3.1 What to take from the PUG Pricing Tool (`C:\ClaudeProjects\pug-pricing-tool`)

Read, don't edit. Port the ideas, in TypeScript.

- **One serialized Scryfall queue** (`src/lib/scryfall.js`). Every request waits its turn. General calls are spaced 100 ms apart. Searches are spaced 550 ms apart because Scryfall allows about two searches a second and a 429 locks the app out for a minute. Keep both numbers.
- **Caches with an age** (`src/lib/cache.js`, `storedOrDownload`). The set list is cached for a day and the card-name catalog for seven days, each under a versioned key so a shape change invalidates cleanly.
- **Name terms quoted word by word** (`nameTerms`) so "or", "-" and similar are never Scryfall syntax.
- **The decklist parser's tolerance** (`cm/domain.py` in Collection Manager, `decklist.js` in the pricing tool): accents dropped, sideboard headers recognised, counts optional, duplicates merged per section.
- **Spec conventions**: header table, numbered sections, a decisions log with dates, phases that end in something the owner can check.

### 3.2 What to take from the Lucky Paper Scratchpad

Feature parity to match or beat: paste a list and get cards; drag cards into columns; sort and group by color, type, mana value; hover for a large image; copy a column out as a list. Where the scratchpad is a 2D grid of columns, this tool is a free table, so "columns" become piles you place wherever you like.

---

## 4. Architecture

### 4.1 Summary

A single-page static web app. No server. The browser talks to Scryfall directly for card data and images, keeps a local cache of both in IndexedDB and the Cache API, renders the table with WebGL through Three.js, and runs a physics step for cards that are moving. The table autosaves to IndexedDB and can be saved to and loaded from a JSON file.

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ UI layer (HTML/CSS over the canvas)                             │
 │  Spawn panel · Selection HUD + filter box · Inspect panel ·     │
 │  Top bar (table name, save/load, export, settings)              │
 ├─────────────────────────────────────────────────────────────────┤
 │ Table state (the model)                                         │
 │  cards[] · piles[] · selection · camera · settings               │
 │  pure functions: query evaluator, pile detection, layouts        │
 ├───────────────────────┬─────────────────────────────────────────┤
 │ Renderer (Three.js)   │ Physics (Rapier, only for moving cards) │
 │  instanced card meshes│  kinematic while dragged, dynamic on    │
 │  texture atlas pages  │  release, static once settled           │
 ├───────────────────────┴─────────────────────────────────────────┤
 │ Scryfall client · image loader · IndexedDB/Cache API stores     │
 └─────────────────────────────────────────────────────────────────┘
```

### 4.2 Technology choices

| Concern | Choice | Notes |
|---|---|---|
| Language | **TypeScript** | Owner's choice, confirmed 2026-10-27 (decision 24). Strict mode. Keep types simple so the code stays readable. |
| Build | **Vite** | Dev server and static bundle. |
| 3D | **Three.js** (latest stable) | Instanced meshes, custom shaders where needed. |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | WASM, fast, good sleeping. Only cards in motion have bodies. Committed without a spike (owner, 2026-10-27, decision 26). |
| UI | **Plain DOM, HTML and CSS, no framework** | The UI is a few panels over a canvas. A framework earns nothing here. If the panels grow unwieldy, revisit at Phase 7. |
| State | A single plain TypeScript store with explicit mutation functions and a change event | No Redux or similar. |
| Storage | **IndexedDB** via `idb` (card JSON, autosave) and the **Cache API** (images) | |
| Query parsing | Hand-written parser for the Scryfall subset in Section 9.4 | No dependency. |
| Fuzzy names | `fuse.js` | Single-card autocomplete typo tolerance, as in the pricing tool. |
| Tests | `vitest` | Pure functions only: query engine, decklist parser, pile detection, layouts. |
| Tooling | Node 24, npm 11, Git, GitHub CLI | Installed on the owner's machine (checked 2026-10-27). |

Start from this list. Any further package, runtime or dev, may be added when its reason is logged in Appendix A as an agent decision (decision 35).

**Browsers:** current Chrome and Edge only (decision 41). Firefox and Safari are not tested or supported.

### 4.3 Repository layout

```
card-manipulator/
  design_spec.md
  CLAUDE.md                 (project rules for every session; written 2026-10-27)
  OVERNIGHT_PROMPT.md       (the prompt that starts the overnight build)
  MORNING_REPORT.md         (written by the overnight build, Section 18.1)
  reports/screenshots/      (phase gate screenshots)
  test-data/                (Section 18.2)
  .claude/launch.json       (dev server entry for the built-in browser)
  .claude/settings.local.json (pre-approved build commands)
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  start.bat
  public/
    card-back.jpg           (Scryfall's standard back, downloaded once; Section 5.4)
  src/
    main.ts                 (boot: store, renderer, physics, UI)
    state/
      store.ts              (table state, mutations, change events)
      types.ts              (Card, Pile, TableDoc, Settings)
      selection.ts          (select, add, toggle, refine, table search)
      piles.ts              (pile detection, stack/spread/tidy layouts)
      history.ts            (reserved; empty in v1)
    scryfall/
      client.ts             (serialized queue, spacing, retries)
      resolve.ts            (decklist lines -> printings via /cards/collection)
      search.ts             (Scryfall query -> printings via /cards/search)
      names.ts              (card-name catalog, 7-day cache, fuse index)
      cardData.ts           (the trimmed card record we keep; IndexedDB cache)
    query/
      lexer.ts, parser.ts, evaluate.ts   (local Scryfall-subset query engine)
    render/
      scene.ts              (table, lights, shadows)
      camera.ts             (tilted camera with limited orbit, pan, zoom)
      cards.ts              (instanced meshes, per-card attributes)
      atlas.ts              (texture atlas pages for small images)
      images.ts             (image loader, Cache API, hi-res on demand)
      picking.ts            (raycast -> card, marquee -> cards)
      badges.ts             (stack count badges, pile labels)
    physics/
      world.ts              (Rapier world, step loop)
      bodies.ts             (body lifecycle: static / kinematic / dynamic)
      feel.ts               (gather spring, drop settle, flick detection)
    input/
      mouse.ts              (the full mouse grammar, Section 16)
      keyboard.ts
    ui/
      spawnPanel.ts, hud.ts, inspectPanel.ts, topBar.ts, settings.ts, toasts.ts
    io/
      decklist.ts           (parse formats, Section 12.2)
      exportDecklist.ts, exportCsv.ts
      saveFile.ts, autosave.ts
    styles/
      app.css
  tests/
    query.test.ts, decklist.test.ts, piles.test.ts
```

### 4.4 Git, GitHub and deployment

- `git init` on day one. Default branch `main`. Commit at the end of each phase at least.
- **Local only for now** (decision 36). No remote is added and nothing is pushed.
- **Deploy is deferred** (decision 37). Set Vite `base` from an environment variable defaulting to `/`, so a later GitHub Pages deploy at `/card-manipulator/` is a one-line change. Don't write or run a deploy script.
- Local run: `npm run dev`. A `start.bat` that runs it and opens the browser, matching the owner's other projects.

---

## 5. Data source: Scryfall

### 5.1 Endpoints used

| Need | Endpoint | Notes |
|---|---|---|
| Resolve a decklist | `POST /cards/collection` | Up to 75 identifiers per call. Identifiers: `{name}`, `{name, set}`, `{set, collector_number}`. Unresolved lines come back in `not_found`. |
| Spawn from a query | `GET /cards/search?q=…&unique=cards` | 175 per page; follow `next_page`. The app always appends `-is:extra` so tokens, emblems and art cards never spawn from a query (decision 31). Cap at 500 cards; the owner can raise the cap to 2,000 in settings (decision 32). |
| Single card | `GET /cards/named?fuzzy=…` or exact, with optional `set` | Spawns the default printing unless a set is pinned. |
| Card names for autocomplete | `GET /catalog/card-names` | Cached seven days. |
| Set list | `GET /sets` | Cached one day. Used to validate set codes in decklist lines. |
| Images | `image_uris.small` and `image_uris.normal` (per face for double-faced cards) | From `cards.scryfall.io`, cached in the Cache API. |

### 5.2 Rate limits and queueing

One serialized queue, as in the pricing tool. General calls 100 ms apart; searches 550 ms apart measured from the previous answer. A 429 pauses the queue for the time Scryfall asks for, with a visible banner. Image downloads bypass the queue (they are CDN requests) but run at most eight in parallel.

### 5.3 The card record we keep

Only the fields the tool needs, trimmed from Scryfall's response and stored in IndexedDB keyed by Scryfall `id`:

```
id, oracle_id, name, set, set_name, collector_number, rarity, lang,
layout, mana_cost, cmc, type_line, oracle_text, colors, color_identity,
power, toughness, loyalty, keywords, produced_mana, legalities (subset),
finishes, prices (usd, usd_foil, as of fetch time),
faces: [{ name, mana_cost, type_line, oracle_text, colors, power, toughness, image_small, image_normal }],
image_small, image_normal, back_image_small, back_image_normal (for DFCs),
fetched_at
```

Everything the local query engine (Section 9.4) can filter on must be in this record, because filtering never calls Scryfall.

### 5.4 The card back

Scryfall's standard Magic back, the `card_back_id` of ordinary cards (checked 2026-10-27), downloaded once in Phase 2 into `public/card-back.jpg` and committed (decision 40):

```
https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg
```

It is a 131 KB JPEG. It occupies slot 0 of atlas page 0, scaled to the `small` size.

---

## 6. Data model (table state)

### 6.1 Card

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Unique per card object on this table. |
| `scryfallId` | string | The printing. |
| `finish` | `'nonfoil' \| 'foil' \| 'etched'` | Foils render with a sheen (Section 8.4). |
| `x, y, z` | number | Table position in millimetres. A card is 63 × 88 × 0.3 mm (the physics thickness is larger; Section 15.3). |
| `yaw` | number | Rotation about the vertical axis, radians. Tidy cards are 0 or ±90°. |
| `faceUp` | boolean | |
| `pileId` | string or null | The pile this card is detected in. Recomputed, not authored, except for named piles. |
| `spreadOf` | string or null | If the card is currently part of a spread, the stack it came from. |

### 6.2 Pile

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string or null | Non-null means a named pile. |
| `kind` | `'stack' \| 'messy'` | Detected from positions. |
| `anchor` | `{x, y}` | Centre of the pile footprint. |
| `cardUids` | string[] | Bottom to top for stacks. |
| `filter` | string or null | A named pile's own query (Section 11.3). |

Emergent piles are recomputed whenever cards settle. Named piles persist: their `id`, `name` and `filter` survive even if every card leaves (Section 11.3).

### 6.3 Table document (save format v1)

```json
{
  "format": "card-manipulator-table",
  "version": 1,
  "name": "Vintage cube pass 3",
  "savedAt": "2026-10-27T18:00:00Z",
  "settings": { "tidyDrops": false, "arrival": "messy" },
  "camera": { "target": [0,0,0], "distance": 900, "pitch": 55, "yaw": 0 },
  "piles": [ { "id": "p1", "name": "Keep", "filter": null } ],
  "cards": [
    { "uid": "c1", "scryfallId": "…", "finish": "nonfoil", "x": 0, "y": 0, "z": 0, "yaw": 0, "faceUp": true, "pileId": "p1" }
  ],
  "cardData": { "<scryfallId>": { "…trimmed card record…" } }
}
```

`cardData` is included so a save file reopens without Scryfall. On load, any missing records are fetched through `/cards/collection` and the cards show as grey placeholders until they arrive.

---

## 7. The table and camera

### 7.1 Table

- An infinite flat plane in a pale warm grey, with a faint grid that fades with distance to give scale and a sense of motion (decision 39). The origin is the centre of the initial view.
- Nothing is pinned to table coordinates in version one: no lanes, no zones (owner, 2026-10-27: blank infinite table only). Named piles provide the only structure.

### 7.1a Look of the interface

Owner's decision (2026-10-27): **light UI on a pale table** (decision 39).

- Panels are white or near-white with soft shadows, dark grey text, and one accent colour for selection: a saturated blue that reads clearly against both card art and the pale table.
- The selection rim glow uses the accent colour. Badges are white pills with dark text.
- Fonts: the system UI stack. No web fonts.
- Colours are defined once as CSS custom properties so a dark theme can be added later.
- Cards must stand out from the table: the table stays low-contrast and desaturated, and card shadows do the separating.

### 7.2 Camera

- A perspective camera tilted toward the table. Default pitch 55° from horizontal, looking at the origin.
- **Limited orbit** (owner, 2026-10-27): pitch between 25° and 89°, yaw ±60° from the default (decision 25). The camera can lean in to see the side of a pile but never goes below the table or around behind it.
- **Pan**: right-drag, or hold Space and left-drag (decision 88). Pan is in table coordinates so the ground stays under the cursor.
- **Zoom**: mouse wheel, toward the cursor, between a whole-table view (about 3,000 mm wide) and a single-card view (about 150 mm wide).
- **Orbit**: middle-drag on empty table (decision 88). Middle-click without dragging on a card flips it (Section 10.5), so orbit begins only after the cursor has moved more than 4 px with the button down, and only if the press was not on a card.
- **View presets** (owner, 2026-10-27, decision 86): a **View** button in the top bar, and the `V` key, cycle the camera through four angles: Tilted (55°), Top-down (89°), Low (30°) and Corner (45°, turned 35° to the front-left). Cycling keeps where the camera looks and how far out it is; only the angle swings, smoothly, in about half a second. The current preset is remembered in the browser.
- **Double right-click** straightens the view: the angle swings back to the current preset, and where the camera looks and how far out it is stay put (decision 87).
- **Home** key resets the camera: back to the table's centre at the default zoom, looking from the current preset's angle (decision 86). **Frame selection** (`Z`) moves the camera to fit the selection.

---

## 8. Cards: rendering

### 8.1 Geometry

Each card is a thin box, 63 × 88 mm, with rounded corners baked into the texture's alpha rather than the mesh. Face up shows the front image; face down shows the Magic back, or the back face of a double-faced card.

### 8.2 Instancing and atlas pages

- All cards share one geometry. Rendering uses `InstancedMesh`, one per atlas page, with per-instance transform, atlas rectangle for the front, atlas rectangle for the back, a selection flag, a foil flag and a hover flag.
- Atlas pages are 4096 × 4096 textures of Scryfall `small` images (146 × 204). Each page holds about 560 images; 2,000 cards with many duplicates typically fit in two or three pages. More pages are fine on the target GPU; above eight the app warns in the console and keeps going.
- The Magic back image occupies slot 0 of page 0. Double-faced backs take their own slots.
- Until an image arrives, the slot shows a neutral grey card with the name rendered in the badge layer.

### 8.3 Close-up quality

The `small` image is sharp enough for the table view (decision 33). Any card with at least 5% of its face showing counts, not just the top card of a pile, so every card of a fan sharpens (decision 101). When the camera zooms close enough that a card exceeds about 160 px on screen (decision 92), the renderer swaps the hovered card and the nearest cards for `normal` images through a small pool of individual textures. The inspect panel always uses `normal`.

### 8.4 Selection, hover and foil

- Selected cards get an emissive outline in the instanced shader (a rim glow, not a post-process) so 2,000 highlighted cards cost nothing extra.
- The hovered card lifts 2 mm and brightens slightly.
- Foil cards get an animated sheen based on view angle, strong enough to spot at a glance (decision 91). It should read as "that one's a foil", not as a disco effect.

### 8.5 Shadows and light

One directional light with a shadow map covering the visible table, plus soft ambient. Stacks cast a visible thickness shadow. Shadow map resolution adapts to zoom so close-ups stay crisp.

---

## 9. Selection: the headline feature

### 9.1 Basic selection

| Action | Result |
|---|---|
| Left-click a card | Selects only that card. |
| Ctrl + left-click a card | Toggles it: adds it if it is out, removes it if it is in. |
| Left-drag on empty table | Rectangle marquee in screen space; selects every card whose centre is inside. Ctrl adds the marquee's cards; Shift subtracts them. |
| Left-click a stack's top card | Selects just the top card. |
| Click a stack's count badge | Selects the whole stack. Ctrl toggles it. |
| Ctrl + A | Selects every card on the table. |
| Esc | Clears the selection (or cancels a drag in progress). |
| Click empty table | Clears the selection. |

Shift has no click meaning on a card. It is reserved for the sweep drag (Section 10.3, decision 89), so a press never has to guess between "toggle" and "drag" (owner, 2026-10-27; Ctrl and Shift swapped by decision 88).

### 9.2 Selection HUD

A bar along the bottom of the screen, always visible:

- Count: "128 cards selected" and, when all come from one pile, the pile's name.
- A colour pip summary (W U B R G C counts) and a tiny mana-value histogram, as a glance at what's in hand.
- The **filter box** (Section 9.3).
- Quick chips (Section 9.5).
- Buttons: Stack, Spread, Tidy, Flip, Export.

### 9.3 Refine: the filter box

The RTS "refine my squad" control. Type a query and press Enter. The selection shrinks to the cards that match (owner, 2026-10-27). Non-matching cards are deselected; nothing moves.

- Ctrl + F or `/` focuses the box.
- The box shows a live count as you type: "128 → 34 match". Enter commits. Esc returns focus to the table with the selection unchanged.
- With nothing selected, the box runs a **table search** instead (Section 9.6). The placeholder says which mode it is in.
- Refinements chain: refine, then refine again, until the squad is what you want.

### 9.4 The local query language

A subset of Scryfall syntax, evaluated locally over the card records already on the table. The engine must never call Scryfall. Unsupported terms produce an inline error, not a silent empty match.

Supported in version one:

| Term | Examples | Notes |
|---|---|---|
| Bare words | `bolt`, `"lightning bolt"` | Match card name, case and accent insensitive. |
| `name:`, `n:` | `n:dragon` | |
| `o:`, `oracle:` | `o:"draw a card"`, `o:flying` | Oracle text, all faces. |
| `t:`, `type:` | `t:creature`, `t:legendary` | Type line, all faces. |
| `c:`, `color:` | `c:r`, `c:rg`, `c>=uw`, `c:colorless`, `c:multicolor` | Colour with `:`, `=`, `>=`, `<=`, `>`, `<`, `!=`. |
| `id:`, `ci:`, `identity:` | `id<=bg` | Colour identity, same operators. |
| `mv:`, `cmc:`, `manavalue:` | `mv<=2`, `mv=3`, `mv>6` | |
| `pow:`, `tou:`, `loy:` | `pow>=4` | `*` is treated as 0. |
| `r:`, `rarity:` | `r:mythic`, `r>=rare` | |
| `s:`, `set:`, `e:` | `s:m11` | |
| `cn:`, `number:` | `cn:149` | |
| `kw:`, `keyword:` | `kw:flying` | |
| `is:` | `is:foil`, `is:nonfoil`, `is:dfc`, `is:permanent`, `is:spell`, `is:faceup`, `is:facedown`, `is:selected` | The last three are this tool's own. |
| `f:`, `format:` | `f:modern`, `f:commander` | Legal in the format. |
| `pile:` | `pile:keep`, `pile:"deck a"` | This tool's own: cards in the named pile. |
| `-term` | `-t:land` | Negation. |
| `or`, parentheses | `(c:r or c:g) mv<=2` | Implicit `and` between terms. |

Not supported in version one: `art:`, `flavor:`, `a:` artist, `year:`, `usd:`, `prefer:`, `order:`, `unique:`, regular-expression values. The parser must reject these with the message "Not supported on the table: `term`".

### 9.5 Quick chips

Beside the filter box, one-click refinements for the most common narrowings: W U B R G C M (multicolour), Creature, Instant/Sorcery, Artifact, Enchantment, Planeswalker, Land, and mana value 0–1, 2, 3, 4, 5, 6+. Clicking a chip appends its term to the filter box and applies it. Ctrl-click a chip to negate it.

### 9.6 Table search

With nothing selected, the filter box searches the whole table. Matching cards become the selection, highlighted in place, wherever they are (owner, 2026-10-27). They do not move. The HUD then reads "34 cards selected across 5 piles". From there the owner can drag them as a group, press Stack to gather them, or refine again.

### 9.7 Selection feedback at a distance

When zoomed out, a highlighted card is a few pixels. Selected cards therefore also get a small marker in the badge layer when the camera is far, and pile badges show "3 of 40 selected" when a pile is partly selected.

---

## 10. Moving, stacking, flipping

### 10.1 Single card drag

Left-press on a card and move. The card lifts about 10 mm, leans into its motion, and follows the cursor with a short spring so it feels like it has mass. Held by a point off its centre, it also turns a little about that point, the way a real card pulled by its corner swings round (decision 94). Held cards never visibly pass through each other or through the piles under them (decision 97): a held group leans as one, every card parallel to one tilted plane and stacked along it in its own order, and the group rises over any stack under or just ahead of it. Releasing drops it through physics. Wherever it lands it stays a little off and turned; only **Tidy drops** or the Tidy command square it up (decision 94).

Dragging a card that is in the selection drags the whole selection. Dragging a card that is not in the selection first selects only that card.

### 10.2 Stack grab: top card or whole stack

Owner's decision (2026-10-27): **a plain drag on a stack peels the top card; dragging its badge moves the whole stack** (a modifier did this until decision 89).

- Left-drag on a stack's top card: that one card comes off.
- Dragging a stack's count badge lifts the whole stack (decision 89; before that, Shift + drag on a card did too).

### 10.3 Group drag: gather by default, modifier keeps formation

Owner's decision (2026-10-27): **gather by default; a modifier keeps the formation.**

- **Gather**: as the drag begins, every selected card flows toward the cursor along a spring and trails behind it in a loose clump. On release the clump falls into one loose stack at the drop point (Section 10.4).
- **Sweep** (hold **Shift** at any moment while dragging, decisions 89 and 110): while Shift is held, every card the cursor passes over is pulled into what you are holding and selected; let go of Shift and it stops, press it again and it picks up again. A single card that sweeps up another becomes a clump. A quick pass over a pile takes only its top card; lingering over it pulls more, slowly at first and then faster, until after about 1.6 s the whole pile comes. Shift held from the start of a drag counts the pile you started on as reached. Ctrl + Shift stays the formation fallback and does not sweep. On release the cards land like any gather.
- **Formation** (hold **Alt** while dragging): cards keep their relative positions and move as a rigid group. On release they drop in place, each landing on whatever is beneath it. On Windows, releasing Alt can focus the browser's menu bar; the app swallows Alt's `keyup` with `preventDefault`. If that still misfires in testing, the fallback is Ctrl + Shift + drag (decision 29).
- Cards in the clump are drawn with a small per-card offset so the clump reads as "many cards", with the count in a label beside the cursor.

### 10.4 Release and landing

- **Messy by default** (owner, 2026-10-27, decision 94): cards land as a **loose stack**, each a few millimetres to about a centimetre off centre and turned up to about 8°. It is still clearly one pile. Only the Tidy command (`T`) or the **Tidy drops** toggle make a neat, squared stack.
- A gathered group released on empty table becomes a loose stack at the drop point (decision 5: stacks by default; decision 94: loose).
- Released over an existing stack or a single card, the group joins the top of it as a loose stack.
- Released over a messy pile, the group joins the pile messily. In **Tidy mode** every one of these lands squared up at a quarter turn instead (decision 98).
- **Letting go mid-motion stops the cards where they are** (owner, 2026-10-27, decision 95). If the held cards are still moving when you release, each drops where it is drawn, sliding on only a few centimetres, instead of finishing the planned landing. A quick drag of a gathered stack, or of a stack by its badge, strings it out behind the cursor, so a flick of the wrist and a release fans the stack out. Releasing at rest lands as described here. With **Tidy drops** on, every release lands squared up as before.
- Every drop of up to 80 cards falls through physics: each card is tossed in a low arc toward its spot in the layout, with a little tumble and twist, and rests where it really lands. Formation and badge (whole-pile) drags keep their shape and land by layout, as do bigger drops.
- Landing plays a short settle: a few millimetres of drop, a soft bounce, and shadows pooling. It must finish within about 300 ms so fast work never waits on animation.

### 10.5 Flip

Owner's decision (2026-10-27): **middle-click flips (right-click until decision 88), no context menu; a flick during a drag also flips; the `F` key flips the selection** (decision 28, added after decision 17).

- Middle-click a card: it flips over with a physical turn, rising, rotating about its long axis and landing. If the card is in the selection, every selected card flips in a quick cascade.
- `F`: every selected card flips, the same cascade, without aiming the mouse at one of them.
- A face-down normal card shows the Magic back. A face-down double-faced card shows its back face. The tool does not distinguish; there is no special "transform" command.
- **Flick**: if the cursor's speed during a drag exceeds a threshold and reverses sharply, the dragged card (or clump) is tossed a short distance in the flick direction and flips in the air. The threshold is tuned in Phase 5 and exposed in settings as Off / Normal / Sensitive.

### 10.6 Spread and restack

Owner's decision (2026-10-27): **double-click toggles spread.**

- Double-click a stack: its cards fan out into a grid beside the stack's position, rows of up to ten, top card first, with the stack's badge staying at the original spot as an anchor.
- Double-click any card of a spread, or its anchor badge: the spread restacks in the same order.
- A card dragged out of a spread leaves it. The spread closes around the gap on restack.
- Spreads are still real cards on the table: they can be selected, refined and flipped.

### 10.7 Tidy, Stack, Spread commands

Available as HUD buttons and keys, acting on the selection:

| Command | Key | Effect |
|---|---|---|
| Stack | `S` | Gather the selection into one loose stack at its centroid (neat in Tidy mode, decisions 94, 98). |
| Spread | `X` | Spread the selection in a grid at its centroid. |
| Tidy | `T` | Square up each pile the selection touches without merging piles. |
| Flip | `F`, middle-click | See 10.5. |
| Rotate | `R` | Turn the selection, or the card under the cursor when nothing is selected, to the next quarter turn clockwise: a card at an odd angle squares up to the quarter turn just past it, a square card turns a full 90°. Press twice quickly: upright (decision 102). Piles stay piles. |
| Curve | `C`, `Shift + C` | Curve view (decision 107): `C` lays the selection, or the pile under the cursor, out by mana value (pressed on cards that are already curved out, it stacks that curve back up instead, as `S` would), one column per mana value (7+ together) with the cards cascading down it so every title bar shows, lands in a neat stack at the start. `Shift + C` does the same for everything on the table (or the selection), sorted by colour into blocks, two to a row: white and blue, then black and red, then green and colourless, then multicolour and lands (decision 113). The **Split creatures** toggle in the HUD puts creatures and non-creatures in separate bands. |

### 10.8 Remove

`Delete` removes the selected cards from the table into a **Removed** tray in the spawn panel. They can be spawned back from there in the same session. The tray empties when the page is closed. This stands in for undo in version one.

---

## 11. Piles

### 11.1 Detection

Piles are detected, not authored. After cards settle, the model groups cards whose footprints overlap, transitively. A group whose cards all share the same centre within 2 mm and the same yaw is a **stack**; anything else is a **messy pile**. Detection runs on a settle event, not every frame, and only for the cards that moved and their neighbours.

### 11.2 Badges

Every pile with two or more cards has a floating badge above it: the count, and the name if it has one. Named piles always show theirs; the others show only while **Alt** is held (owner, 2026-10-27, decision 109). Badges face the camera, keep a constant screen size, and avoid overlapping each other when zoomed out. Clicking a badge selects the pile. Dragging a badge lifts the pile.

### 11.3 Named piles

Owner's decision (2026-10-27): **piles are emergent by default and can be promoted to named containers.**

- Promote: with a pile selected, press `N` or click the pencil on its badge, type a name, Enter. The badge now shows the name.
- A named pile keeps its identity when cards join or leave, and when it is spread.
- **Own filter**: a named pile can carry a query (Section 9.4). Cards dropped onto it that do not match are rejected: they slide off to the side with a short shake and a toast ("3 cards don't match Keep: `t:creature`"). This turns a named pile into a sorting bin.
- **Empty named piles** remain on the table as a labelled outline footprint, so a set of bins can be prepared before sorting (decision 27). Delete the outline through the badge's pencil → Delete.
- Export per pile: the badge's export button copies the pile as a decklist (Section 14.1).
- Rename or un-name through the same pencil. Un-naming reverts it to an emergent pile.

### 11.4 Merging and splitting

Dropping a stack onto a stack merges them, and a named stack keeps its name (if both are named, the receiving pile's name wins and a toast says so). Peeling cards off never renames anything. Spreading a named pile keeps the name on the anchor.

---

## 12. Spawning cards

### 12.1 Spawn panel

A collapsible panel on the left with three tabs:

1. **List**: a textarea for a decklist, a Parse button, a preview of resolved and unresolved lines, and Spawn.
2. **Card**: a search box with autocomplete from the name catalog (fuse.js for typos), an optional set code and collector number, a quantity, a finish, and Spawn.
3. **Query**: a Scryfall query, a Preview count (runs the search and reports the total before spawning), a cap field (default 500, settings allow up to 2,000) and Spawn. Extras are always excluded (Section 5.1); a small note under the box says so.

Spawn settings, kept at their defaults since decision 112 (no controls for them); the spawn panel shows only the Removed tray below its tabs:

- **Arrival**: Messy pile (default) or Neat stack. Owner's decision (2026-10-27): "dumped in a messy pile, with a toggle somewhere to drop as a neat stack/deck."
- **Face**: up (default) or down.
- **Where**: at the cursor's last table position, or the centre of the view. Spawned cards appear in a short "dealt onto the table" animation.
- The **Removed** tray (Section 10.8).

### 12.2 Decklist formats

Owner's decision (2026-10-27): plain decklists, lines with set and number, and Scryfall search as a source. CSV import is out of version one.

Each line is parsed with the tolerance of the owner's other tools:

| Line | Reading |
|---|---|
| `4 Lightning Bolt` | Four copies, default printing. |
| `4x Lightning Bolt`, `Lightning Bolt x4`, `Lightning Bolt` | Same; a missing count is 1. |
| `1 Lightning Bolt (M11) 149` | Arena/Moxfield style: set code and collector number pin the printing. |
| `1 Lightning Bolt (M11)` | Set only: the first printing in that set by collector number. |
| `1 Lightning Bolt [M11]`, `1 Lightning Bolt M11 149` | Also accepted. |
| `1 Lightning Bolt *F*`, `… (foil)`, `… F` at the end | Foil finish. |
| `Sideboard`, `SB:`, `Commander`, `Maybeboard`, blank lines, `//` comments | Recognised as headers and comments and skipped. Every section's cards spawn together as one pile (decision 30). A card listed in two sections spawns the sum of both counts. |
| `Lightning Bolt // Something` | Double-faced and split names resolve by either face or the full name. |

Resolution goes through `/cards/collection` in batches of 75. Unresolved lines are listed in red in the preview with a "fix it" field that reruns just that line. Spawn proceeds with the resolved lines; the unresolved stay in the panel until fixed or cleared.

### 12.3 Duplicates

Every copy is its own card object. There is no collapsing in version one. A 60-card deck with 20 basics spawns 60 cards.

---

## 13. Inspect panel

The one extra the owner kept in version one (2026-10-27).

- A panel on the right. When the cursor rests on a card for about 150 ms it shows that card's `normal` image, name, mana cost, type line, oracle text (every face), power/toughness or loyalty, set name, collector number, rarity and finish.
- Double-faced cards show both faces stacked vertically in the panel regardless of which face is up on the table.
- When exactly one card is selected and nothing is hovered, the panel shows the selected card.
- Click the panel image to pin it; the panel then ignores hover until unpinned.
- The panel collapses to a thin strip with a toggle for small screens.

---

## 14. Export and save

### 14.1 Decklist per pile

From a pile's badge or the HUD's Export button (for the selection). Copies to the clipboard and offers a `.txt` download. Format option, remembered: `4 Lightning Bolt` or `4 Lightning Bolt (M11) 149`, with `*F*` after foils. Exporting several piles at once produces one file with a header line per pile.

### 14.2 CSV

The whole table or the selection. One row per distinct (pile, printing, finish) with a quantity column, so it round-trips into the owner's CSV tools:

```
pile,quantity,name,set,collector_number,finish,scryfall_id
Keep,4,Lightning Bolt,m11,149,nonfoil,…
```

### 14.3 Save and load

- **Autosave** to IndexedDB after every settle, debounced to one second. Reopening the page restores the last table, camera included.
- **Save as file**: the Table document (Section 6.3) as `.json`, with `cardData` embedded. **Load file** replaces the table after a confirm.
- **New table** clears everything after a confirm.
- The table name sits in the top bar and is editable.

---

## 15. Physics and feel

### 15.1 Model

Only cards that are moving have physics bodies. The three states:

| State | Body | When |
|---|---|---|
| Settled | none (or static) | Resting on the table or in a pile. Position is authored by the model. |
| Held | kinematic | Being dragged. Follows the cursor through a spring and damper so it lags and tilts. |
| Loose | dynamic | Just released, flicked, or shoved. Simulated until it sleeps, then snapped and returned to Settled. |

Cards become Loose only briefly. A table of 2,000 settled cards has zero dynamic bodies.

### 15.2 Collisions

A Held card or clump passes over settled cards without disturbing them; shoving a thousand cards around by accident is worse than a little unreality. On release the Loose cards collide with the table and with the cards of the pile they land on, so messy drops look like a dropped handful.

### 15.3 Thickness

Real cards are 0.3 mm thick, which makes stacks of thin boxes jitter in any engine. The physics body is 2 mm thick while the rendered card stays thin, and stacks are authored by the model rather than simulated: a stack of 40 is one static collider the height of 40 cards, not 40 bodies. A loose pile of 12 or more cards is one box too, shaped like its top card (decision 94).

**Resting** (owner, 2026-10-27, decisions 99 and 100): a card in a messy pile is drawn resting on what is really under it, as low as a rigid card can go: supported under its centre, tilted where it lies across an edge, never hovering. Physics carries cards while they fly and tumble; resting lays them down. When a card is lifted out of a pile, what rested on it falls at once. The model keeps flat heights for ordering and pile detection; the resting pose is worked out after piles are detected, from the moved card up, and the cards tip into it. A neat stack lies flat. Taking a card out lets the cards that rested on it settle again. Picking, the physics colliders and the no-clipping drag all use the tilted pose.

### 15.4 Messy versus tidy

Owner's decision (2026-10-27): hybrid with a toggle. The global **Tidy mode** (top bar button, `Shift + T`, or the settings panel; default off; called Tidy drops until decision 98) decides whether the table behaves messy or tidy.

**Tidy mode on** (decision 98) puts back everything from before the messy changes and squares everything at quarter turns:

- Drops, gathers, Stack (`S`), restacks and named bins land as neat stacks, squared at 0°, 90°, 180° or 270°. Dropping onto a pile snaps either squared on its top or one cascade step (22 mm) down from its top card, as in a curve column, so curve columns can be built by hand (decision 114). The stack zone is the bigger one: from 22 mm above the top card's centre (and beyond) to about 16 mm below it; only a drop at the cascade point or further down cascades (decision 115).
- Drags feel as before decisions 94–96: the earlier lean, no turning about the grab point, a clump trailing at the earlier rates, and a whole pile moving as one.
- A card held at an angle turns to the nearest quarter turn while it is still being dragged.
- Drops land by layout, not physics, and letting go mid-motion still lands on the planned spot. A flick still tosses, but the cards come to rest at quarter turns.
- New cards arrive as a squared stack whatever the spawn Arrival says.
- What stays in both modes: held cards never clip (decision 97), the Shift sweep, flicks, and the controls.

**Tidy mode off**: everything above is messy and physical as described in Sections 10.1–10.4. With it off, everything lands messy, even onto a neat stack, and Stack (`S`) and restacking a spread make loose stacks too (decision 94). The `Tidy` command (Section 10.7) squares up on demand. Spawn's Arrival control is the same idea for new cards.

### 15.5 Feel targets

Personality: **snappy and light** (decision 42). Quick follow, short settles, very little bounce. Speed of sorting beats realism whenever they conflict.

- Pick-up to first movement under one frame.
- Gather clump follows the cursor with visible but short lag, about 80 ms; messy stacks and clumps are a little heavier, with more lag toward the bottom, while a tidy stack moves as one (decision 96).
- Settle under 300 ms.
- Flip animation about 350 ms for one card; a cascade over a selection adds 10 ms per card, capped at 600 ms total.
- No animation ever blocks input.

---

## 16. Mouse and keyboard reference

| Input | On a card | On a stack badge | On empty table |
|---|---|---|---|
| Left-click | Select only it | Select the pile | Clear selection |
| Ctrl + left-click | Toggle in or out of selection | Toggle pile | — |
| Shift + left-click | Nothing (reserved) | — | — |
| Left-drag | Move it (or the selection if it is selected); on a stack, peels the top card | Move the whole pile | Marquee select |
| Ctrl + left-drag | Move it; Ctrl has no drag meaning on cards | Move the whole pile | Marquee, adding |
| Shift + left-drag | Drag it; while Shift is held, sweep up every card the cursor passes over (Section 10.3) | Move the whole pile; Shift sweeps | Marquee, subtracting |
| Alt + left-drag | Move the selection in formation | — | — |
| Middle-click | Flip it (and the selection if it is selected) | Flip the pile | — |
| Middle-drag | — | — | Orbit camera |
| Right-drag, Space + left-drag | Pan | Pan | Pan |
| Double right-click | Straighten the view to the current preset angle, staying put | Straighten view | Straighten view |
| Wheel | Zoom toward cursor | Zoom | Zoom |
| Double-click | Toggle spread of its stack | Toggle spread | — |
| Fast flick during a drag | Toss and flip | — | — |

| Key | Action |
|---|---|
| Esc | Clear selection, cancel drag, close panel field |
| Ctrl + A | Select all |
| Ctrl + F, `/` | Focus the filter box |
| Enter (in filter box) | Apply refine or table search |
| S | Stack the selection, or the pile under the cursor when nothing is selected. While dragging: gather the held cards into a stack in the hand. S twice quickly: shuffle, the stack's cards in a random order |
| X | Spread the selection; with nothing selected, spread or restack the pile under the cursor (like a double-click). While dragging: spread the held cards in a grid around the cursor |
| T | Tidy the selection, or the pile under the cursor. While dragging: square the held cards into a neat stack in the hand |
| F | Flip the selection, or the card under the cursor. While dragging: turn the held cards over in the hand. F twice quickly: every card faces up, so a mixed stack is fronted |
| R | Turn the selection (or the card under the cursor) to the next quarter turn clockwise; R twice quickly: upright. While dragging, R turns the held cards |
| C | Curve the selection, or the pile under the cursor, out by mana value; on a curve, stack it back up |
| Shift + C | Curve everything (or the selection) out by colour, two colours to a row |
| N | Name the selected pile |
| Z | Frame the selection |
| V | Next camera view preset |
| Home | Reset camera to the current view preset |
| Delete | Remove selection to the tray |
| Ctrl + S | Save file |
| Ctrl + E | Export selection as decklist |

All keys are inactive while a text field has focus.

### 16.1 Cursors

The cursor shows what the mouse will do, and what a held key changes (owner, 2026-10-27, decisions 116 and 118–123). Everything is 48 px in one style, the 1930s rubber-hose look: over empty table a pointy arrow with a dashed marquee box, hand-drawn with the gloves' heavy outline and soft shading; over cards cartoon white gloves. An emoji in the corner marks a held key's effect.

| Cursor | When | Means |
|---|---|---|
| Arrow with a dashed box | Over empty table | Drag draws a marquee |
| ... with ➕ | Ctrl held over empty table, or a Ctrl marquee | The marquee adds to the selection |
| ... with ➖ | Shift held over empty table, or a Shift marquee | The marquee takes from the selection |
| Open glove | Over a card | Drag picks it up (or the selection) |
| ... with 🧲 | Shift held over a card | A drag will sweep up cards it passes |
| ... with 🔢 | Alt (or Ctrl + Shift) held over a card | Every pile shows its count; a drag keeps the formation |
| ... with ☑️ | Ctrl held over a card | Click toggles it in or out of the selection |
| ... with 📚 | Over a pile's badge | Drag lifts the whole pile |
| Gloved fist | Holding cards | Release drops them |
| ... with 🧲 | Holding cards with Shift held | Sweeping up the cards passed over |
| ... with 📐 | Holding cards in formation | They keep their layout |
| Open glove with ↔️ | Space held, or a right-drag | Pan |
| Gloved fist with 🔄 | Middle-drag | Orbit |

---

## 17. Performance budget

| Measure | Target |
|---|---|
| Cards on table | 2,000 at 60 fps on the owner's RTX 4070 Ti at 1920 × 1080, with headroom: frame time under 8 ms there |
| Draw calls per frame | Under 20 (one per atlas page, plus table, shadows, badges) |
| Dynamic physics bodies | Under 200 at any moment |
| Texture memory | Under 1 GB |
| Spawn 540 cards from a list | Resolved and visible in under 15 s on a warm cache, image fill-in continuing after |
| Autosave | Under 50 ms, off the frame |
| Pile detection after a drop | Under 5 ms for the touched region |

Techniques assumed: instancing, atlas pages, per-instance attributes updated in bulk, shadow map sized to view, no per-card DOM, badges drawn in one sprite batch or one HTML layer with culling, query evaluation in a worker if it ever exceeds 16 ms.

---

## 18. Build phases

Each phase ends with something the owner can open at `localhost` and check. During the overnight build each phase must pass the gate in Section 0.1, then commit, then move on.

### 18.1 The morning report

`MORNING_REPORT.md` at the project root, updated at the end of every phase. It must contain:

1. A one-screen summary at the top: phases finished, phases with **BROKEN** items, and how to run the app.
2. Per phase: what was built, the gate results (typecheck, tests with counts, build, browser check), links to its screenshots, its commit hash, agent decisions made, and anything **BROKEN** with what was tried.
3. The owner's QA checklist for the morning: each phase's "Where to look" list, plus everything the agent could not judge itself, such as Alt-drag on Windows, flick feel, foil sheen taste, and readability of small images.
4. Measured performance against Section 17 with the 2,000-card stress table.

### 18.2 Test data

- `test-data/cube.txt` is the owner's real cube list (decision 43). If it holds no card lines when the run starts, the agent builds a 540-card stand-in from a Scryfall query and says so in the report.
- The agent also writes, from Scryfall data: `deck-60.txt` (a 60-card deck using set codes, collector numbers and foil markers), `dfc.txt` (about 40 double-faced and split cards), `bad-lines.txt` (typos and unknown cards for the unresolved-line path), and `stress-2000.txt` (2,000 cards for Section 17).

### Phase 1: Table and camera
Vite + TypeScript + Three.js scaffold. Table plane, lighting, shadows. Camera with pan, zoom, limited orbit, Home. Fifty placeholder cards (grey, numbered) rendered through the instanced path. `start.bat`. npm scripts: `dev`, `build`, `preview`, `test`, `typecheck`.
**Where to look:** page loads; drag with middle button pans; wheel zooms toward cursor; right-drag orbits within limits; Home resets; shadows under cards.

### Phase 2: Scryfall and spawn
Scryfall client with the serialized queue. Name catalog and set list caches. Decklist parser with the formats in 12.2 and its unit tests. `/cards/collection` resolution. Atlas pages and image loading with Cache API. Download the card back (Section 5.4). Spawn panel (List and Card tabs) with arrival as a neat stack only for now.
**Where to look:** paste a 540-card cube list; unresolved lines show in red; cards appear as a stack and images fill in; refresh and the images come from cache; 2,000 cards still pan smoothly.

### Phase 3: Selection and the query engine
Click, Shift toggle, Ctrl-subtract marquee, marquee. HUD with count and pips. Query lexer, parser and evaluator with unit tests covering every term in 9.4. Refine, table search, quick chips, live count.
**Where to look:** marquee a crowd; type `t:creature mv<=2` and watch the count drop; Enter shrinks the selection; clear and search the table for `c:r`; an unsupported term shows an error.

### Phase 4: Moving, stacking, spreading
Single drag, gather drag, Alt formation drag, release into stacks, peel versus Ctrl whole stack, badge drag, double-click spread and restack, Stack/Spread/Tidy/Rotate commands, Delete tray. Pile detection and badges. Autosave.
**Where to look:** drag one card onto another and get a badge reading 2; select thirty and drag them into a clump that stacks on release; Alt-drag keeps formation; double-click spreads; refresh restores the table.

### Phase 5: Physics and feel
Rapier integration with the three-state body model. Spring follow on held cards, settle on release, messy drops, Tidy drops toggle, right-click flip, `F` flip, flick flip, foil sheen.
**Where to look:** drop a handful and it looks dropped; toggle Tidy drops and it squares up; right-click flips with a turn; select forty and press F for a cascade; a flick tosses and flips; nothing jitters in a stack of 100.

### Phase 6: Named piles
Promote, rename, un-name, pile filter with rejection, empty-pile outlines, merge rules, `pile:` query term.
**Where to look:** name a pile Keep with filter `t:creature`; drop a land on it and it slides off with a toast; empty the pile and the label stays.

### Phase 7: Inspect, export, save files, query spawn
Inspect panel with pin. Decklist and CSV export. Save and load file. Spawn Query tab with preview and cap. Settings panel.
**Where to look:** hover shows a big readable image with both faces of a DFC; export Keep and paste it into Moxfield; save a file, New table, load it back; spawn `set:ltr r:rare` and get the preview count first.

### Phase 8: Polish
Performance pass against Section 17 with `stress-2000.txt`. Badge decluttering. Distance selection markers. Toasts and error states. Bring CLAUDE.md up to date. A final pass of every earlier checklist. No deploy (decision 37).
**Where to look:** 2,000 cards at a smooth frame rate; every checklist above still passes; the morning report is complete.

---

## 19. Later (explicitly deferred)

- Undo/redo (`history.ts` is reserved).
- Saved selection groups on Ctrl + 1–9, RTS style.
- Multiple tables or tabs in one session.
- Drawn snap zones and lanes.
- Collapsing duplicates into one card with a count.
- CSV import from the owner's other tools.
- Shareable saved tables (URL or hosted).
- Touch, tablet and phone.
- Deploying to GitHub Pages, and a GitHub remote.
- Sound effects.
- A dark theme.
- Firefox and Safari support.
- A context menu, if middle-click flip proves too easy to trigger by accident.
- Spawning decklist sections (Sideboard, Commander) as separate piles.
- Prices on cards; sorting a pile by price.
- Auto-layout commands ("sort this pile into columns by mana value") beyond the simple grid spread.

---

## Appendix A: Decisions log

All dated 2026-10-27, from the brainstorming session.

| # | Decision |
|---|---|
| 1 | The tool is for cube sorting and curation, collection triage, building multiple decks from one pool, and draft or pick analysis. |
| 2 | Performance target is about 2,000 cards. |
| 3 | Camera is tilted with limited orbit, not fixed top-down and not free orbit. |
| 4 | Physics is a hybrid: messy possible, tidy possible, with a toggle. |
| 5 | A dragged group released on the table becomes a neat stack by default. |
| 6 | Piles are both emergent and promotable to named containers. |
| 7 | Selection refinement uses Scryfall syntax plus quick chips. |
| 8 | Each card is a specific printing (set and collector number) and carries a finish. Quantity collapsing and price/condition fields are out of v1. |
| 9 | Import formats for day one: plain decklists, lines with set and number, and a Scryfall search as a source. CSV import is later. |
| 10 | Outputs: a decklist per pile, CSV export, and a saved table layout. Screenshots are later. |
| 11 | The table is blank and infinite with no built-in zones. |
| 12 | Any card can be flipped physically. A normal card shows the Magic back; a double-faced card shows its back face. No difference in treatment. |
| 13 | Rendering is Three.js, in TypeScript with Vite, hosted as a static site with local saves. |
| 14 | The one thing this beats the Lucky Paper Scratchpad at is RTS-style selection and filtering. |
| 15 | Refining a selection shrinks it to the matches. |
| 16 | Group drag gathers under the cursor by default; a modifier keeps the formation. |
| 17 | Flip is right-click with no context menu, and a flick gesture during a drag. No flip key in v1. |
| 18 | Of the proposed extras, only the hover inspect panel is in v1. Undo/redo, control groups and multiple tables are later. |
| 19 | Dragging a stack peels the top card; a modifier takes the whole stack. |
| 20 | Double-click toggles spreading a stack. |
| 21 | Spawned cards arrive as a messy pile by default, with a toggle for a neat stack. |
| 22 | A table-wide search selects the matches wherever they are without moving them. |
| 23 | Whole-stack grab is Ctrl + drag, not Shift, so no modifier overlaps between click and drag. Consequence: Shift-click is the single add-or-remove toggle, and Ctrl has no click meaning on a card. |
| 24 | TypeScript is accepted, despite the pricing tool's choice of plain JavaScript. |
| 25 | Orbit limits are pitch 25°–89° and yaw ±60° from the default view. |
| 26 | Rapier is the physics engine, committed without a comparison spike. |
| 27 | An emptied named pile stays on the table as a labelled outline until deleted explicitly. |
| 28 | The `F` key flips the selection, in addition to right-click and the flick gesture. Supersedes the "no flip key" part of decision 17. |
| 29 | Formation drag uses Alt, with its `keyup` swallowed on Windows. Fallback if it misfires in testing: Ctrl + Shift + drag. |
| 30 | A pasted decklist always spawns as one pile. Section headers such as Sideboard and Commander are recognised and skipped, never split. |
| 31 | Query spawns always exclude extras (tokens, emblems, art cards) by appending `-is:extra`. |
| 32 | A query spawn is capped at 500 cards by default, with a settings override up to 2,000. |
| 33 | Table textures use Scryfall's `small` image; `normal` is used close up and in the inspect panel. |
| 34 | The build runs overnight, unattended, through all eight phases. Each phase must pass a self-verification gate that includes a browser check by the agent; the owner does QA in the morning. On ambiguity the agent decides, logs an agent decision, and continues. |
| 35 | Any package may be added, runtime or dev, when its reason is logged. |
| 36 | Git is local commits only. No remote, no push. |
| 37 | Deploy is skipped entirely for now. Nothing is published. |
| 38 | The performance target is the owner's machine (RTX 4070 Ti, 1080p), not integrated GPUs. |
| 39 | Light UI on a pale table. |
| 40 | The card back is Scryfall's standard back, downloaded once into `public/card-back.jpg`. |
| 41 | Chrome and Edge only. |
| 42 | Physics personality is snappy and light. No sound in v1. |
| 43 | The owner supplies a real cube list as `test-data/cube.txt`; the agent generates the other test lists. Results arrive as `MORNING_REPORT.md`. Formation drag stays on Alt with the Windows fix, and the owner tests it in the morning. |
| 44 | **(agent, 2026-10-27)** The atlas pages are layers of one 2D array texture instead of one texture per page, so every card is drawn in a single instanced draw call and a card's front and back may sit on different pages. Images are copied into their cell on the GPU, never by re-uploading a whole page. Pages stay 4096 × 4096; a 2 px gutter per cell (513 cells per page instead of about 560) limits mipmap bleeding. |
| 45 | **(agent, 2026-10-27)** A card without its image yet shows a grey card with its name drawn into its own atlas cell, not in the badge layer. It costs nothing per frame and scales to 2,000 cards with no DOM. |
| 46 | **(agent, 2026-10-27)** Cards resting on the table also get a soft contact shadow, because a flat 0.3 mm card casts almost no shadow-map shadow and the spec wants shadows to separate cards from the table (7.1a). The shadow map still does stacks and lifted cards. |
| 47 | **(agent, 2026-10-27)** Packages added: `html-to-image` and `@types/node` (dev only) so the phase gate can save screenshots through a dev-server endpoint; TypeScript is pinned to 5.9 rather than the new 7.0 line for tooling stability. |
| 48 | **(agent, 2026-10-27)** The renderer uses the model's axes directly: z is up in three.js too (`camera.up = z`), x right, y away from the default camera. |
| 49 | **(agent, 2026-10-27)** Zoom runs from 150 mm to 3,600 mm of visible table width, a little past the spec's "about 3,000 mm" to leave room around a 2,000-card table. The table grid is 100 mm minor and 500 mm major lines, the minor lines fading out when zoomed far. |
| 50 | **(agent, 2026-10-27)** Section 9.1's selection table was split by a paragraph, hiding three rows; the paragraph now follows the table. No behaviour changed. |
| 51 | **(agent, 2026-10-27)** Decklist names go through the cached name catalog before `/cards/collection`: case and accents are fixed to the catalog's spelling, and a line naming only a back face ("Insectile Aberration") is sent as its front face. Typos are not auto-corrected; they come back unresolved so the owner sees them in red. |
| 52 | **(agent, 2026-10-27)** A resolved line is remembered for seven days (identifier → printing id, records in IndexedDB), so a list spawns again without Scryfall: the owner's 1,008-card cube resolves in about 50 ms warm against about 17 s cold. |
| 53 | **(agent, 2026-10-27)** A line with a set code but no number takes the printing `/cards/collection` returns for `{name, set}`, rather than computing "first by collector number" with an extra search per line. |
| 54 | **(agent, 2026-10-27)** Messy arrival shipped with Phase 2 because its layout is a pure function; the default stays Messy (decision 21). The parser also reads `*E*` and `(etched)` as the etched finish. |
| 55 | **(agent, 2026-10-27)** The test lists are written by `scripts/make-test-data.ts`, which runs the app's own Scryfall client in Node. The owner's `cube.txt` holds 1,008 cards, so it doubles as a bigger-than-540 test. |
| 56 | **(agent, 2026-10-27)** Phase 1's numbered placeholder cards are gone from Phase 2 on; the table starts empty until autosave restores it (Phase 4). |
| 57 | **(agent, 2026-10-27)** With `:`, `c:` means "at least these colours" and `id:` means "within this identity", as on Scryfall. Both take letters, colour names, guilds, shards and wedges. A few free extras are supported beside the spec's list: `!"exact name"`, `is:` `mdfc`, `transform`, `split`, `multicolor`, `colorless`, `legendary`, `historic`, `etched`, and `~` in `o:` for the card's own name. |
| 58 | **(agent, 2026-10-27)** The filter box keeps its text after Enter, so quick chips append to it and Enter re-applies the whole chain (AND chains are idempotent). It clears whenever the selection changes any other way. Errors show inline under the live count and never change the selection. |
| 59 | **(agent, 2026-10-27)** The HUD's mana value histogram leaves lands out, and the C pip counts cards with no colour. The selection updates live while a marquee is dragged, so the count follows the rectangle. |
| 60 | **(agent, 2026-10-27)** `X` on a selection that is exactly one whole stack behaves like double-click (spread beside the stack, anchor badge left behind, restackable). Any other selection spreads in a grid at its centroid with no anchor. |
| 61 | **(agent, 2026-10-27)** Open spreads are saved in the table document as an optional `spreads` list and a `spreadOf` per card, so a refresh keeps them restackable. Files without them load as before. |
| 62 | **(agent, 2026-10-27)** Ctrl + drag on a stack, and dragging a badge, also select the lifted pile, the same way a plain drag selects the card it lifts. |
| 63 | **(agent, 2026-10-27)** Backspace removes like Delete. The Removed tray groups cards by printing and finish and spawns back one line or everything, using the spawn panel's Arrival, Face and Where settings. |
| 64 | **(agent, 2026-10-27)** `R` turns cards clockwise. Until physics lands (Phase 5), messy landings use the same random layout as messy spawns. |
| 65 | **(agent, 2026-10-27)** A pile badge sits over the pile's top card (a stack's anchor, a messy pile's centre) and hides while its cards are held. A partly selected pile's badge reads "3 of 40 selected" (9.7) from Phase 4 on. |
| 66 | **(agent, 2026-10-27)** Physics runs only for messy landings: a single card dropped on open table, any group dropped on a messy pile with Tidy drops off, flicks, and messy spawns of up to 180 cards. Tidy landings (onto a stack or single card, Tidy drops on, a gather on open table, formation) stay model-authored tweens. A physics drop is cut off at 420 ms and snapped flat, so a drag settles in about 125–170 ms plus a 90 ms snap. |
| 67 | **(agent, 2026-10-27)** Held cards get no kinematic bodies: they pass over everything (15.2) and nothing needs to collide with them, so only loose cards ever have bodies. This simplifies the 15.1 table without changing any behaviour. |
| 68 | **(agent, 2026-10-27)** Flick thresholds: Normal 2,300 px/s, Sensitive 1,400 px/s, Off never; the reversal must turn more than about 105°. A flicked card is tossed about 0.65 m/s along the flick with a spin about its long axis, so it lands turned over. |
| 69 | **(agent, 2026-10-27)** A flip rises 24 mm and turns about the long axis in 350 ms; a cascade goes top card first, 10 ms apart, capped at 600 ms. Right-clicking a badge flips its pile. |
| 70 | **(agent, 2026-10-27)** Card edges are shaded by hand rather than through the shadow map, with a little slack on the corner outline, so the side of a stack reads as clean layers instead of speckle. |
| 71 | **(agent, 2026-10-27)** Rapier, whose WASM is inlined (4.3 MB), loads as its own chunk after the table appears; until it has loaded, drops land with tweens. |
| 72 | **(agent, 2026-10-27)** Named-pile membership is the card's `pileId`. Detection gives named ids priority, and in a merge the pile whose cards stayed put is the receiving one. A whole named pile dropped on an ordinary pile gives the merged pile its name; dropped on another named pile it merges into the receiver and its own name goes, with a toast. Cards peeled off a named pile just leave it. |
| 73 | **(agent, 2026-10-27)** A named pile shrunk to a single card is still a pile ("Keep · 1"). Pile names are unique, ignoring case. |
| 74 | **(agent, 2026-10-27)** `N` with nothing selected creates a new empty named pile (a bin) at the cursor and opens its editor; cancelling removes it again. `N` on a selection that is not one pile shows a hint instead of guessing. |
| 75 | **(agent, 2026-10-27)** Rejected cards land beside the pile, a card's width plus 28 mm to its right, as a small messy pile, then wobble. Dropping cards on an empty named pile's outline lands them as a neat stack in it, filter applied. |
| 76 | **(agent, 2026-10-27)** In development the page counts its own errors (`window.__errors`) so the phase gate's "no console errors" check covers only the page as it is now, not messages kept from earlier reloads. Not part of the production build. |
| 77 | **(agent, 2026-10-27)** Export opens a small panel and copies the decklist straight away (14.1). Several piles get `// Name` header lines, which this tool's parser and Moxfield both read as comments; unnamed piles are "Pile 1, 2…", loose cards "Loose cards". The CSV pile column holds the named pile's name, or is blank. |
| 78 | **(agent, 2026-10-27)** Query spawns take results in name order, one card each, nonfoil. Like any drop, a spawn at the centre of view onto an existing pile joins it. |
| 79 | **(agent, 2026-10-27)** The inspect panel draws mana symbols as small coloured pills instead of fetching Scryfall's symbol SVGs, keeping network use to the API and the image CDN. |
| 80 | **(agent, 2026-10-27)** The settings panel (gear in the top bar) holds Tidy drops, spawn arrival, face and place, flick sensitivity, the query cap (1–2,000) and the export format. Settings travel with the table document and the autosave. |
| 81 | **(agent, 2026-10-27)** New, Open, Save and Export (whole table) sit in the top bar; Ctrl + S saves, Ctrl + E exports the selection. The overnight gate checked Save and Open by running the same document round trip in code, so nothing was written to the owner's Downloads folder. |
| 82 | **(agent, 2026-10-27)** Close-up images (8.3): when a card is over 250 px tall on screen, up to 12 cards get their `normal` image, the hovered card first and then the cards nearest the centre whose face is on top, from a pool of 32 textures. The image plane is inset 2 mm so the card's border, rounded corners and selection rim still show. |
| 83 | **(agent, 2026-10-27)** Far-zoom feedback (9.7): once the view is wider than 1.5 m, selected cards get a constant-size dot (one points draw call) and badges switch to short text ("3/20"). Badges declutter by priority (named, then partly selected, then bigger piles); the pencil and export buttons show on hover. |
| 84 | **(agent, 2026-10-27)** One physics drop simulates at most 80 cards (`MAX_DROP`), continuous collision detection is on only for flicks, and physics takes at most two steps a frame. Measured on the target machine: 20 cards step in about 1.3 ms, 60 in about 5 ms, a 150-card tower in about 9 ms with 40 ms spikes. Bigger messy drops and spawns land by layout. |
| 85 | **(agent, 2026-10-27)** Files beyond the 4.3 layout: `src/app.ts` (app context and frame loop), `src/commands.ts`, `src/named.ts`, `src/spawn.ts`, `src/state/pileSync.ts`, `src/render/{hires,markers,outlines}.ts`, `src/ui/{dom,pileEditor,exportPanel,queryTab,tray}.ts`, `src/io/download.ts`, `src/dev/*` (dev only), `devtools/shotPlugin.ts`, `scripts/make-test-data.ts`. `history.ts` is not created yet; undo is deferred (19). |
| 86 | Owner (2026-10-27): a View button cycles four camera presets (Tilted 55°, Top-down 89°, Low 30°, Corner 45° turned 35° front-left), keeping position and zoom; Home and double middle-click reset to the table's centre at the current preset's angle. **(agent)** additions: the `V` key also cycles; cycles and resets swing over 450 ms and any manual pan, zoom or orbit interrupts the swing; the preset is kept in `localStorage` (a per-browser convenience, not part of the save file); a double middle-click is two presses within 350 ms and 8 px. |
| 87 | Owner (2026-10-27): a double middle-click only straightens the angle back to the current preset; it no longer moves or zooms the camera, so the view can be fixed at any time while looking at something. Home still does the full reset to the table's centre. Replaces that part of decision 86. |
| 88 | Owner (2026-10-27): **Ctrl and Shift swap on every mouse action**: Ctrl + click toggles a card or pile, Ctrl + marquee adds, Shift + marquee subtracts, Shift + drag lifts a whole stack, Ctrl-click negates a quick chip; Ctrl + Shift stays the formation fallback. **Right and middle buttons swap**: right-drag pans anywhere, double right-click straightens the view, middle-click flips, middle-drag on empty table orbits. Supersedes the button and modifier parts of decisions 17, 23, 28, 69 and 87. **(agent)** Keyboard shortcuts (Ctrl + A, Ctrl + F, Ctrl + S, Ctrl + E, Ctrl + Enter in the list box) keep Ctrl: they are the standard browser shortcuts, and Shift + a letter would clash with the plain letter keys. The Phase 1, 3, 5 and 6 "Where to look" lists in Section 18 keep their original wording as history. |
| 89 | Owner (2026-10-27): **Shift + drag on a card sweeps**: the selection (or the pressed card) gathers to the cursor and cards the cursor passes over join the clump, like a magnet. A quick pass takes a pile's top card; lingering takes more, then all of it, so a big pile feels heavy. Whole-stack lift moves to badge drag only. Shift + drag on a selected card starts from the whole selection. **(agent)** timing: the second card comes after 350 ms over a pile, the rest arrive on an accelerating curve (`sweepCount`, exponent 2.2) and the whole pile after 1.6 s; slipping off a pile for under 150 ms keeps its dwell time; the pile the drag started on counts as reached; a swept card springs up from where it lay at the clump's slow tail rate; swept cards join the selection, and Esc sends them all home. |
| 90 | Owner (2026-10-27, morning QA): flicks were too hard to trigger. **(agent)** Normal drops from 2,300 to 1,600 px/s and Sensitive from 1,400 to 1,000 px/s; the reversal now needs to turn more than about 95° instead of 105°. Supersedes the numbers in decision 68. |
| 91 | Owner (2026-10-27, morning QA): the foil sheen was too subtle. **(agent)** The rainbow band is wider (smoothstep from 0.35 instead of 0.55) and about twice as bright (0.30 instead of 0.16), with a faint 0.05 rainbow wash over the whole face so a foil reads between bands. |
| 92 | Owner (2026-10-27, morning QA): switch to the `normal` image sooner. **(agent)** Close-ups start once a card is over 160 px tall on screen (was 250), with up to 24 overlays (was 12) and a pool of 48 textures (was 32, about 60 MB). Supersedes those numbers in decision 82. |
| 93 | Owner (2026-10-27, morning QA): Alt-drag works on Windows (releasing Alt does not focus the menu bar), Save and Open work, an exported decklist pastes into Moxfield, 2,000 cards run smoothly in Chrome, and the drag spring, tilt and settle hop feel right. These close the open hand checks from the overnight build. |
| 94 | Owner (2026-10-27): **messier and more physical by default.** Drops, gathers, Stack (`S`) and restacks make a **loose stack** (a few mm to about 1 cm off centre, turned up to about 8°); only Tidy (`T`) and the Tidy drops toggle square up. Every drop falls through physics up to the 80-card limit. A little more of each: lean while dragging, a single card turning about its grab point, turn on landing, and tumble in physics. Supersedes the "neat stack" parts of decisions 5 and 66. **(agent)** numbers: loose stack offset up to 9 mm (weighted toward the middle) and turn up to 0.14 rad; drag lean 0.2 rad maximum (was 0.14) at 0.0012 rad per mm/s (was 0.0009); grab-point turn at most 0.35 rad (20°), and only when grabbed more than 8 mm from the centre; tossed cards arc up at 250 mm/s with up to 1.2 rad/s of tumble and 1.5 rad/s of twist, their bodies spaced 2.4 mm apart as spawns are; a loose pile of 12 or more cards collides as one box shaped like its top card, so a loose cube stays cheap; formation and badge drags keep their shape and land by layout; spawning as a "Neat stack" stays neat because it is an explicit choice. |
| 95 | Owner (2026-10-27): **letting go mid-motion stops the cards where they are** instead of finishing the planned motion, so a quick drag and release fans a stack out. **(agent)** A release counts as mid-motion when any held card moves faster than 150 mm/s. Each card then lands where it is drawn, slid on by 0.03 s of its speed, keeping its turn, in a 150 ms settle by layout rather than physics (2 mm physics bodies starting 0.3 mm apart would pop apart and spoil the fan). It applies to every drag mode; a messy stack dragged by its badge now trails a little by height like a gathered clump (top card leading), so it keeps its shape at rest but fans when swung; a tidy stack stays rigid (decision 96). It skips the drop target, so a fast release over a named pile does not join or check its filter; the cards that land on it join by overlap. Tidy drops on keeps squared landings. |
| 96 | Owner (2026-10-27): cards in a **messy stack** or a gathered clump are a little **heavier and slower to follow** when dragged; a **tidy stack** stays snappy and moves as one. Consequence: only messy stacks fan out when swung and let go (decision 95); a tidy stack lands as the stack it was, wherever it is when let go. **(agent)** spring rates: a messy stack's or clump's top card 22 rad/s (was 28) and its bottom card 10 rad/s (was 13); a tidy stack dragged whole, a single card and formation stay at 28 rad/s. A stack counts as tidy when it is one detected `stack` pile and the whole of it is being dragged. Swept-up cards follow at the 10 rad/s tail rate. |
| 97 | Owner (2026-10-27): **held cards must not visibly clip** through each other or the table's cards, even at some performance cost. **(agent)** Held cards each used to lean about their own centre at only 0.3 mm apart, so overlapping cards crossed, and the group flew at a fixed 10 mm over the table, through any tall stack. Now the whole held group leans as one plane (slope from the group's average velocity, same lean as before); each card lies parallel to it at its own height along it, which keeps every pair apart everywhere they overlap. The plane rises over the top of whatever lies under each held card or 0.12 s ahead of it, keeping 10 mm of lift and at least 1.5 mm under a tilted card's lowest corner; it rises at 30/s, settles at 8/s, and is never allowed below that clearance. Picked-up cards close onto the plane at 18/s. A group wider than 300 mm leans proportionally less so a wide formation doesn't seesaw. Cost: one pass over the table's drawn cards a frame plus overlap tests against the few near the group. Not covered: a card lifted from inside a stack rises through the cards above it, and landing tweens are not collision-checked. |
| 98 | Owner (2026-10-27): the **Tidy drops** button becomes **Tidy mode**. On, it puts back everything decisions 94–96 made messy, and everything is aligned to exact quarter turns, always. Owner's picks of the suggested extras: spawns arrive as a squared stack, a card held at an angle turns to a quarter turn while dragged, and `Shift + T` toggles the mode. Not chosen: squaring the whole table when the mode is switched on. **(agent)** The setting keeps its stored name `tidyDrops` so saved tables and autosaves still load. Held cards turn to the quarter turn at a rate of 14/s. Flicked cards still fly through physics but rest at quarter turns. A formation drag in Tidy mode lands each card at a quarter turn where it is. Badge-dragged piles in Tidy mode land squared at a quarter turn; with the mode off, a badge-dragged loose pile now keeps its loose shape at rest (it used to be squared up, which contradicted decision 94). Keyboard bindings can now name Shift with a letter (`shift+t`), so Shift + a letter no longer triggers the plain letter's command. The no-clipping drag (decision 97) applies in both modes. |
| 99 | Owner (2026-10-27): **cards in a fan or messy pile rest naturally**, tilted onto what is under them and touching the table, instead of floating as a flat staircase. **(agent)** Done by geometry when piles change, not physics: the model keeps flat heights (ordering, pile detection and save files are unchanged) and `src/state/rest.ts` works out each card's drawn rest from the corners of its overlaps with the cards beneath (a plane is highest at a corner, so this is exact). A rigid card rests on the hull edge under its centre; a thin card also droops toward a lower side when that takes a slope of 0.2 or less, which is what makes a ribbon spread lie low. Slopes are capped at 0.8. A card rests on at most 20 of the cards beneath it, nearest first. Neat stacks stay flat. Rests are not saved; they are worked out again on load. Measured: about 0.02 ms per card, so a 60-card fan re-rests in about 2 ms and a 1,000-card ribbon from scratch in about 21 ms; a 60-card fan 5 mm apart lies about 2 mm high instead of 18 mm. Picking hits tilted faces; physics slabs tilt to match, and a big loose pile's box reaches its highest drawn point. |
| 100 | Owner (2026-10-27): decision 99 didn't work: a picked-up and dropped messy stack came to rest mid-air in a tall, unrealistic shape; cards should fall to the lowest place they can, like in real life. **(agent)** Cause: decision 99's droop rule let a card tilt toward its lower side, which lifts its other end into the air; the next card lands on that raised end and it compounds (a 60-card heap stood 70-130 mm tall). Fix: cards rest as rigid cards, as low as their centre can go, with no droop; a 60-card heap is now no taller than its cards stacked flat (18 mm), plus a mm or two where cards cross at angles. Lifting a card (any drag) lets what rested on it fall at once. Tried and dropped: physics bodies as thin as real cards. Rapier lets resting bodies sink 0.2-1 mm into each other at any tolerance, stiffness or iteration count, so 0.3 mm cards passed straight through each other; physics keeps its 2 mm bodies for the motion and resting lays the cards down. Known limit: a rigid card whose centre is supported lies flat, so a tight fan is a low staircase (one card thickness per step); lying a fan flatter needs cards that bend, or a whole-pile settle. |
| 101 | Owner (2026-10-27): close-up `normal` images went only to the top card of each pile; any card with even 5-10% of its face showing should get one. **(agent)** A card qualifies when at least 5% of its face is not covered by the cards above it in its pile, judged from above on a 7 x 9 grid across the face (`visibleShare` in `piles.ts`). Cards under the top of a neat stack count as hidden without checking. Up to 32 close-ups (was 24) from a pool of 64 textures (was 48, about 80 MB), nearest the middle of the view first. Each close-up is its own draw, so a full set goes past the 20-draw target in Section 17; the owner put image sharpness first. |
| 102 | Owner (2026-10-27): R didn't seem to work: it acted only on the selection, so with nothing selected it did nothing. R should snap a card to the next 90° clockwise, not turn it 90° from where it is, so it can be used to align cards; double-tapping R stands cards upright. **(agent)** With nothing selected, R acts on the card under the cursor. "Next quarter turn clockwise" is the first multiple of 90° clockwise of the card's angle (a card within 0.06° of a quarter turn counts as on it, so a square card turns a full 90°). A double tap is two presses within 350 ms; upright is 0° by the shortest turn. |
| 103 | Owner (2026-10-27): F, S, X and T act on what is under the cursor when nothing is selected, like R; and R while dragging a stack must turn the held cards (it did nothing). **(agent)** F and R act on the hovered card; S and T on the whole pile it is in (stacking or tidying one card means nothing); X toggles the hovered pile's spread exactly as a double-click does, so a second X on a spread card restacks it. With cards selected every key acts on the selection, as before. While dragging, R turns each held card to its next quarter turn clockwise (double tap: upright) and turns the group about the cursor with the top card, swinging there at the Tidy-mode turn rate; the cards land keeping that turn, a gathered group included. |
| 104 | Owner (2026-10-27): T, X, S and F should work on a stack while it is being held, as R does. **(agent)** While dragging they act on the held cards and the cards land as held. F turns them over in the hand (about 0.1 s); a held stack turns over as a whole, so its order reverses and the bottom card comes out on top. T squares them into a neat stack under the top card at a quarter turn and they then move as one. S gathers them into a clump under the cursor that lands as one stack (loose, or neat in Tidy mode). X spreads them in a grid around the cursor, top card first, and each lands where it is held, as in a formation drag. Esc after F in the hand returns the cards home still flipped. |
| 105 | Owner (2026-10-27): double-tapping F makes cards face front, so a mixed stack can be fronted. **(agent)** Two presses within 350 ms, the same window as R. On the table: the cards the first F turned face down turn back the short way, and the rest stay up, so every card ends face up in its own place. In the hand: the first F turned the whole stack over, so its order is put back and every card faces up. A plain F always turns the same way round, now aimed at the new side's exact angle so a flip begun mid-turn ends without a snap. |
| 106 | Owner (2026-10-27): double-tapping S not only stacks the cards but shuffles them into a random order. **(agent)** Two presses within 350 ms, like R and F. On the table the cards (the selection, or the hovered pile) land as one stack at their centre in a uniformly random order (Fisher-Yates), with a small arc and stagger so the reordering shows; loose in messy mode, neat in Tidy mode. In the hand the held cards gather in a random order and land that way. There is no undo yet. |
| 107 | Owner (2026-10-27): **curve view**, as on Cube Cobra's curve display. `C` curves the selected pile, or the one under the cursor, out by mana value; `Shift + C` sorts everything by colour and curves out each colour, like sorting a cube. Owner's choices: columns cascade with title bars showing; splitting creatures from non-creatures is a separate toggle (a HUD button, **Split creatures**, remembered in settings); lands go in a neat stack at the start; colour groups are rows top to bottom. **(agent)** Columns 0 to 7+ by mana value, only those in use, lined up across all rows; cards in a column in name order, 11 mm apart; colour groups by the card's colours (front face for double-faced cards): one colour, multicolour, colourless, with lands first in their own row; with Split on, lands sit in the creature band. The layout is centred where the cards were. `Shift + C` acts on the selection when there is one, otherwise on every card. Cards land by layout (no physics), and a cascade is a messy pile, so it keeps its shape. `curveLayout` in `src/state/curve.ts` is pure and tested. |
| 108 | Owner (2026-10-27): `C` pressed again on a pile that is already curved out stacks it back up, as `S` would; curve cascades get more room, 22 mm between cards instead of 11. **(agent)** The app remembers each curve it lays out (with `Shift + C`, one per colour row) and where it put each card. `C` on any card of a curve (hovered or selected) stacks that curve's cards that are still where it put them, if at least two are; otherwise it curves out as usual. Cards moved off their spot drop out of their curve. The memory is not saved with the table. `Shift + C` always lays out afresh. Supersedes the 11 mm of decision 107. |
| 109 | Owner (2026-10-27): pile count badges show only while **Alt** is held, or always for named piles; unnamed piles hide theirs normally. **(agent)** A named pile's spread anchor and its empty outline count as named. Hidden badges take no space when decluttering. Consequence: an unnamed pile's badge is not there to click or drag unless Alt is held, so lifting a whole unnamed pile is Alt + drag on its badge (the keys S, X, T, F, R and C still act on the pile under the cursor). Alt is read from key and pointer events and cleared when the window loses focus. |
| 110 | Owner (2026-10-27): the sweep worked differently from intended: Shift at the press made the whole drag a sweep, even after Shift was let go. Intended: while dragging, holding Shift at any time gathers the cards passed over; releasing Shift stops it. **(agent)** Any drag (a card, a selection, a pile by its badge, a formation) sweeps exactly while Shift is held without Ctrl, read from pointer and key events, so pressing Shift mid-drag starts it without moving. A press no longer changes mode because of Shift. A single-card drag that sweeps up a card becomes a gather. Pressing Shift again over the same pile resumes its count from then, so a pile is not swallowed at once. Supersedes the press-time part of decision 89. |
| 111 | Owner (2026-10-27): the spawn panel's Arrival, Face and Where controls are not needed; Tidy mode handles the only important one. **(agent)** They are gone from the spawn panel; the settings panel (gear) still has them, and spawns follow those settings as before (Tidy mode forces a neat stack, decision 98). |
| 112 | Owner (2026-10-27): hide the settings panel too; nothing in it is needed that can't be done elsewhere, and it looks bad. **(agent)** The gear button and the panel are gone. Where each setting went: Tidy mode is the top bar button and `Shift + T`; the query spawn cap is the box on the Query tab; the decklist export format is chosen (and remembered) in the export panel; spawn arrival, face and where, and flick sensitivity, stay at their defaults (messy, face up, centre of view, Normal), with Tidy mode forcing a neat stack. Saved settings still load. The confirm dialog moved to `src/ui/confirm.ts`. Supersedes decision 80's settings panel. |
| 113 | Owner (2026-10-27): `Shift + C` lays the colours out two to a row, using more width: white and blue, then black and red, then green and colourless, then multicolour. **(agent)** Lands share the last row with multicolour, as one neat stack. Every colour block uses the same mana value columns so they line up down each side; blocks sit 60 mm apart, rows 30 mm. A colour with no cards leaves its place empty rather than shifting the others; a row with neither colour is skipped. Supersedes the row-per-colour layout of decision 107. |
| 114 | Owner (2026-10-27): in Tidy mode, besides snapping squarely onto a pile, a second snap point 22 mm below the top card, where a card lies in curve view, so curve-style cascades can be built by hand. **(agent)** Measured from the pile's top card, "down" along its own long side at its quarter turn. The drop snaps to whichever point is nearer the dropped card's centre (a single card) or the cursor (a group). A group dropped at the cascade point continues the cascade, each card one step further down. Messy mode is unchanged. |
| 115 | Owner (2026-10-27): drops up to 22 mm above the card should also stack, an extra zone for snapping onto tidy stacks, so it doesn't so often cascade. **(agent)** Instead of whichever point is nearer, the drop's distance below the top card's centre, along its long side, decides: under three quarters of a cascade step (16.5 mm), including anywhere above the card, it stacks; from there down it cascades. The stack zone is now 22 mm-plus above to 16.5 mm below the centre; the cascade zone starts 5.5 mm before the cascade point. |
| 116 | Owner (2026-10-27): the controls are hard to learn and say nothing about what they do; custom cursors, with different hand gestures, should show holding Alt or Shift and what they do. **(agent)** Section 16.1: an arrow with a marquee box over empty table, an open hand over a card, a closed fist while holding cards, four arrows to pan, a circling arrow to orbit, each with a small blue corner badge for a held key's effect (magnet for Shift's sweep, grid for formation, + and − for marquee add and subtract, ± for Ctrl's toggle, a stack for a badge's whole pile). Drawn as inline SVG data URLs with the browser's own cursors as fallbacks, chosen every frame from the gesture in progress, the drag mode, the card under the mouse and the keys held (`src/ui/cursors.ts`). |
| 117 | Owner (2026-10-27): generate app art (the cartoon glove cursors) with an image model on OpenRouter, where the owner has credit. **(agent)** `devtools/genImage.ts` (dev only, never in the build) posts a prompt to OpenRouter's image API (`/api/v1/images`) and saves the PNGs; default model `openai/gpt-image-1` because it can return a transparent background. The key comes from `OPENROUTER_API_KEY` or a git-ignored `.env.local`, and is never printed. A second allowed network destination besides Scryfall, for development only; the app itself still talks only to Scryfall. |
| 118 | Owner (2026-10-27): the cursors become cartoon white gloves in a 1930s rubber-hose style (like Cuphead or early Disney), generated with an image model, with emoji badges instead of the blue ones; the open hand and fist redrawn to match the chosen pointing glove. **(agent)** Generated with `openai/gpt-image-2` on OpenRouter on flat green (it won't do transparent backgrounds there), the open hand and fist with the pointer as a style reference; the chosen source art is in `art/cursors/raw/`. `devtools/makeCursors.ts` keys out the green, trims, optionally thickens the outline so it survives shrinking, scales by area averaging to 32 and 48 px, and finds the click points (the pointing fingertip, the middle of the others) into `art/cursors/cursors.json`. `devtools/cursorPreview.ts` builds `art/cursors/preview.html` with each state live. Emoji badges are drawn onto the hand with a canvas at runtime, so they use the system's emoji font. New dev dependency: `pngjs` (pure JavaScript PNG reading and writing, no native parts). Not wired into the app yet. |
| 119 | Owner (2026-10-27): use the 48 px bold glove cursors in the app. **(agent)** `src/ui/cursors.ts` loads the three gloves (`art/cursors/*-48-bold.png`, which Vite inlines) and draws each state's emoji onto a copy with a canvas at start-up, using the system emoji font at about 22 px in the bottom right corner; click points come from `art/cursors/cursors.json`. Until the art has loaded, the browser's own cursors stand in. The SVG cursors of decision 116 are gone; the choice of cursor is unchanged. |
| 120 | Owner (2026-10-27): the open glove showed the palm, which felt odd; show the back of the hand instead. **(agent)** Regenerated with the pointer as the style reference; of two drawings, the one with four fingers and a thumb was chosen so it matches the pointer and fist (the other had the classic three-fingered glove). It shows the three stitch lines of the back of a cartoon glove. Cost about $0.44; the cursor art has cost about $1.97 in all. |
| 121 | Owner (2026-10-27): the gloves are great, but empty table and its Ctrl and Shift versions should go back to the arrow cursor with its dashed marquee box, sized correctly, instead of the pointing glove. **(agent)** The arrow and box from decision 116, drawn at 1.1 times its 32-unit grid in the 48 px cursor image, so the arrow is about 23 px tall like an ordinary cursor; its tip is the click point. Its badges stay emoji (➕, ➖) like the rest of the set. The pointing glove art is kept but unused. |
| 122 | Owner (2026-10-27): decision 121 brought back the old drawn arrow, which doesn't match the gloves' quality and size; generate a new default cursor with its marquee box in the gloves' style. **(agent)** Generated with gpt-image-2 using the pointing glove as style reference: a chunky white cartoon arrow with the same outline and shading, a dashed box behind its tail. Of two drawings, the one with fatter dashes was chosen so the box survives shrinking. It goes through the same pipeline as the gloves (48 px bold; click point at the arrow tip). Cost about $0.44; the cursor art has cost about $2.41 in all. |
| 123 | Owner (2026-10-27): the generated arrow wasn't right either. Stop using the image generator; hand-draw a normal pointer as the first cursors were, but at the gloves' 48 px size and style, keeping it pointy. **(agent)** `src/ui/cursorArrow.ts`: the classic arrow shape in SVG, about 36 px tall in the 48 px image, with a 2.8 px black outline mitred to a sharp tip, a white body with soft grey shading along its right side, and a bold dashed marquee box behind its tail (a white halo under the dashes so they show on dark card art). The click point is the tip. The generated arrow (decision 122) is removed. |

## Appendix B: Open items

None as of 2026-10-27. Every question raised while drafting has been answered and logged in Appendix A (decisions 23–43). During the overnight build the agent does not add items here: it decides and logs an agent decision in Appendix A instead (Section 0.1).
