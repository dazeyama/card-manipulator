# Morning report: overnight build

## Summary

| | |
|---|---|
| **Phases finished** | All eight (1–8), each through the full gate: typecheck, tests, build, browser check, commit |
| **BROKEN items** | None |
| **Live site** | https://dazeyama.github.io/card-manipulator/ (repo github.com/dazeyama/card-manipulator, public; every push to main deploys) |
| **Open items** | None. One-step undo is built (decision 204), committed locally, **not pushed** |
| **Tests** | 164 passing as of 2026-10-28 (97 at the end of the overnight build, 103 after the morning follow-ups) |
| **Final pass** | `await __regression()` in the dev console: 28 of 28 checklist items pass, no page errors |
| **Run it** | `npm install` once, then `npm run dev` and open http://localhost:5173, or double-click `start.bat` |

**What works.** Everything in Sections 1–17 that Phases 1–8 list. You can spawn from a decklist, a single card or a Scryfall query; marquee and refine with the local query engine; gather, formation and whole-stack drags; messy drops through Rapier; spread and restack; named piles with filters and empty bins; inspect; decklist and CSV export; save and load files; autosave. Your 1,008-card cube resolves completely; it took 17 s cold and resolves in 50 ms from the cache. 2,000 cards run at a steady 60 fps on your RTX 4070 Ti, and a 1080p frame costs about 0.6 ms.

**What I could not check myself:** all of these were confirmed in your morning QA (decision 93), except where a fix is noted.
1. **Alt-drag formation on Windows** (decision 29): the browser tool can't hold modifier keys during a drag. Formation, Ctrl whole-stack drags and Shift/Ctrl marquees were checked with synthetic events that carry the modifier flags. I couldn't check whether releasing Alt focuses the browser menu bar. If it does, Ctrl + Shift + drag is already wired as the fallback.
   ✅ Works.
2. **Save and Open dialogs.** I didn't click them overnight, because that would have written files to your Downloads folder. The same document round trip passes in code. ✅ Works.
3. **Feel and taste:** drag spring and tilt, flick sensitivity, foil sheen, the size of the settle hop, and whether the `small` image is readable mid-zoom. Close-ups switch to `normal` images automatically. ✅ Spring, tilt and hop feel right. Flick was too hard, foil too subtle and mid-zoom images too soft: all three fixed (decisions 90–92).
4. **Pasting an exported decklist into Moxfield.** The export parses back through this tool's own parser exactly. ✅ Works.

**Things to know:**
- A spawn at the centre of the view lands on whatever pile is there and joins it, like any drop (decision 78).
- One physics drop simulates at most 80 cards; bigger messy drops land by layout (decision 84).
- A neat stack of the whole 1,008-card cube is a 30 cm tower, as a real one would be.
- During testing I copied a decklist to your clipboard once (the Keep export check).
- Your own Chrome starts with an empty table: the autosave, card cache and image cache live in each browser's own storage, and everything above ran in the built-in browser. The first cube paste in Chrome takes the cold times (about 17 s to resolve, about 24 s for images); after that it is fast.

---

## Morning follow-ups (2026-10-27)

Changes made with you after the overnight build. Each is logged in Appendix A of the spec. Every change passed typecheck, tests (103) and build, and was committed locally. Browser checks were yours.

| Change | Decision | Commit |
|---|---|---|
| **View** button in the top bar and the `V` key cycle four camera angles: Tilted 55°, Top-down 89°, Low 30°, Corner 45°. Position and zoom stay put. | 86 | `a9e5193` |
| A double right-click straightens the angle back to the current preset without moving the camera. Home still does the full reset. | 87 | `c6ff55b` |
| **Ctrl and Shift swapped on every mouse action** (Ctrl + click toggles, Ctrl adds to a marquee, Shift subtracts). **Right and middle buttons swapped** (right-drag pans, middle-click flips, middle-drag orbits). Keyboard shortcuts keep Ctrl. | 88 | `f686e70` |
| **Shift + drag sweeps.** Cards the cursor passes over are pulled into the clump. Lingering over a pile pulls more, then all of it after about 1.6 s. Whole-stack lift is now badge drag only. | 89 | `6e78d89` |
| Morning QA fixes: flicks are easier (Normal 1,600 px/s, was 2,300), the foil sheen is stronger, and close-ups switch to `normal` images at 160 px (was 250). | 90–92 | `f2b2870` |
| Morning QA results: Alt-drag, Save/Open, Moxfield paste, 2,000-card smoothness and drag feel all confirmed. | 93 | `f2b2870` |
| **Messier and more physical by default.** Drops, gathers, Stack (`S`) and restacks make loose stacks; only Tidy (`T`) or Tidy drops square up. Every drop of up to 80 cards falls through physics. A little more lean, turn about the grab point, turn on landing and tumble. | 94 | `0895828` |
| **Letting go mid-motion stops cards where they are**, so a quick drag and release fans a stack out. | 95 | `aca8d75` |
| Messy stacks and gathered clumps are **a little heavier and slower to follow**; tidy stacks stay snappy and move as one. | 96 | `b47e830` |
| **Held cards no longer clip**: the held group leans as one plane with each card stacked along it, and rises over stacks under or ahead of it. | 97 | `e82364a` |
| **Tidy mode** replaces Tidy drops (top bar, `Shift + T`): on, it brings back the pre-messy behaviour and squares everything at quarter turns, held cards and spawns included. | 98 | `8463c05` |
| **Cards rest naturally** on what is under them: a fanned stack lies low and touches the table instead of floating as a staircase. About 2 ms to re-rest a 60-card fan. | 99 | `92925a3` |
| **Cards fall to the lowest place they can**: rigid resting replaces decision 99's droop, which built mid-air towers. Lifting a card lets what lay on it fall at once. | 100 | `7d27937` |
| **Close-ups for every card that shows**: any card with 5% or more of its face visible gets the sharp image, so a whole fan reads, not just its top card. | 101 | `44cb0bc` |
| **R snaps** to the next quarter turn clockwise (and acts on the card under the cursor when nothing is selected); double-tap R stands cards upright. | 102 | `7e790cb` |
| **Keys act on what's under the cursor** when nothing is selected: F and R on the card, S, X and T on its pile. **R while dragging** turns the held stack. | 103 | `a0b0699` |
| **T, X, S and F work on a held stack**: tidy, spread, stack and flip in the hand, then land as held. | 104 | `7f7a7bf` |
| **Double-tap F fronts** a mixed stack: every card faces up, on the table or in the hand. | 105 | `d89e4b9` |
| **Double-tap S shuffles**: the stack's cards land in a random order, on the table or in the hand. | 106 | `cf686c2` |
| **Curve view**: `C` curves a pile out by mana value; `Shift + C` curves everything into a row per colour; **Split creatures** toggle in the HUD. | 107 | `882f9f2` |
| **C toggles**: on a curve it stacks it back up. Cascades are 22 mm apart (was 11). | 108 | `4740d85` |
| **Badges only for named piles**, or for every pile while Alt is held. | 109 | `cd4f93a` |
| **Shift sweeps only while held**, at any moment of any drag. | 110 | `013c41a` |
| **Spawn panel trimmed**: Arrival, Face and Where are gone from it (still in the settings panel). | 111 | `1c31a4a` |
| **Settings panel removed**: Tidy mode, the query cap and the export format each live where they are used. | 112 | `bbc42d1` |
| **Shift + C in two columns**: W U, B R, G colourless, multicolour and lands. | 113 | `9569577` |
| **Tidy-mode cascade snap**: drop a card a little below a pile's top card and it snaps one cascade step down, building curve columns by hand. | 114 | `4bd87c1` |
| **Bigger stack zone in Tidy mode**: a drop stacks unless it is clearly at the cascade point. | 115 | `b69de6c` |
| **Cursors that explain the controls**: arrow, open hand, fist, pan and orbit, with a blue badge for Shift (magnet), Alt (grid), Ctrl (±) and marquee add/take. | 116 | `54d9e84` |
| **Glove cursors**: cartoon white gloves (open, fist) with emoji badges, generated with an image model through OpenRouter, and a hand-drawn pointy arrow with its marquee box, in the same style, for empty table. | 117–123 | this report's commit |

The per-phase sections below describe the build as it was overnight. The QA checklist at the end uses the current controls.

---

## Phase 1: Table and camera ✅

**Built**
- Vite + TypeScript + Three.js scaffold, npm scripts `dev`, `build`, `preview`, `test`, `typecheck`, `start.bat`, local git.
- Pale table with a faint 100 mm / 500 mm grid that fades with distance; hemisphere light plus one shadow-casting sun whose shadow map is fitted to the visible table every time the view changes.
- Camera rig: pitch 25°–89°, yaw ±60° (decision 25); middle-drag or Space + left-drag pan that keeps the grabbed point under the cursor; wheel zoom toward the cursor; right-drag orbit only after 4 px and only when the press was not on a card; Home resets.
- Instanced card renderer: one draw call for every card, rounded corners in the shader, front and back from an atlas array texture, selection rim glow, hover lift, foil sheen. Fifty numbered placeholder cards (one face down, one foil, a stack of ten).
- Contact shadows under table-level cards (decision 46).

**Gate:** typecheck clean · 7 tests passed (camera limits, zoom-to-cursor, pan, Home, save round-trip) · build OK · browser check OK, no console errors.

**Screenshots:** [load](reports/screenshots/phase-1/01-load.png) · [panned](reports/screenshots/phase-1/02-panned.png) · [orbited](reports/screenshots/phase-1/03-orbited.png) · [stack shadow](reports/screenshots/phase-1/04-stack-shadow.png)

**Agent decisions:** 44–50 (Appendix A).

**Commit:** `4fb437f`.

---

## Phase 2: Scryfall and spawn ✅

**Built**
- `src/scryfall/client.ts`: the one serialized queue (100 ms general, 550 ms searches, 429 pauses the queue for Retry-After with a banner, retries on network errors).
- Name catalog (7 days) and set list (1 day) cached in IndexedDB; fuse.js autocomplete.
- Decklist parser for every format in 12.2 (counts, `(SET) 123`, `[SET]`, bare `SET 123`, `*F*`/`(foil)`/`F`, `*E*`, headers, comments, `SB:` prefixes, split and DFC names), duplicates merged across sections.
- `/cards/collection` resolution in batches of 75, unresolved lines in red with a "fix it" field and Retry, and a seven-day local resolve cache (decision 52).
- Card records trimmed to 5.3 and cached in IndexedDB; images through the Cache API, eight at a time; Scryfall's card back in `public/card-back.jpg`.
- Spawn panel: List and Card tabs (autocomplete, set, number, quantity, finish), Arrival (messy or neat stack), Face, Where; dealt-onto-the-table animation.
- Test data: `deck-60.txt`, `dfc.txt` (40 cards, 26 with printed backs), `bad-lines.txt`, `stress-2000.txt`, all generated by `scripts/make-test-data.ts`.

**Gate:** typecheck clean · 36 tests passed (parser, record trimming, name index, identifiers, queue spacing and 429) · build OK · browser check OK, no console errors.

**Measured**
- Cube (1,008 cards): cold resolve about 17 s; warm resolve 50 ms; images from the network 24 s cold, from the Cache API 1.4 s after a refresh (1,032 cached, 0 network).
- 2,016 cards on the table: steady 60 fps while panning (median and p95 frame 16.7 ms; the frame's own CPU work 0.1 ms).
- bad-lines.txt: exactly the five intended lines unresolved; fixing "Counterspel" and pressing Retry resolves it. deck-60 and dfc resolve completely.

**Screenshots:** [unresolved lines](reports/screenshots/phase-2/01-unresolved-lines.png) · [cube stack](reports/screenshots/phase-2/02-cube-1008-stack.png) · [stack close-up](reports/screenshots/phase-2/03-stack-closeup.png) · [2,016 cards](reports/screenshots/phase-2/04-2016-cards.png) · [Card tab, foil](reports/screenshots/phase-2/05-card-tab-foil.png)

**Agent decisions:** 51–56.

**Commit:** `11bcba7`.

---

## Phase 3: Selection and the query engine ✅

**Built**
- Click selects only that card; Shift-click toggles; Ctrl-click does nothing (reserved); click on empty table clears; Ctrl + A; Esc clears (or cancels a marquee).
- Marquee in screen space by card centre; Shift adds, Ctrl subtracts; the selection follows the rectangle live.
- HUD: count with pile wording, W U B R G C pips, mana value histogram, filter box with live "128 → 34 match", inline errors, nineteen quick chips (Shift-click negates), Ctrl + F and `/` focus the box, Esc leaves it with the selection unchanged.
- Local query engine (`src/query/`): lexer, parser and evaluator for every term in 9.4, plus a few free extras (decision 57). Unsupported terms say "Not supported on the table: `term`".
- Table search when nothing is selected; refinements chain.

**Gate:** typecheck clean · 67 tests passed (25 for the query engine covering every term, operator, negation, `or`, parentheses and every error; selection refine/search/summary) · build OK · browser check OK, no console errors.

**Checked in the browser:** real-mouse marquee over a 360-card grid (84 selected), typed `t:creature mv<=2` + Enter (84 → 30), Esc twice, `/` then `c:r` + Enter (186 red cards selected across the table), `t:dragon art:dragon` shows the error, chips Creature → 2 → Shift-G (457 → 127 → 94), click / Shift-click / Ctrl-click / Ctrl + A. The browser tool cannot hold Shift or Ctrl during a drag, so the add and subtract marquees were checked with synthetic pointer events carrying the modifier flags (1,008 → 924 subtract, 84 → 120 add).

**Screenshots:** [marquee](reports/screenshots/phase-3/01-marquee.png) · [refined](reports/screenshots/phase-3/02-refined.png) · [table search c:r](reports/screenshots/phase-3/03-table-search-c-r.png) · [unsupported term](reports/screenshots/phase-3/04-unsupported-term.png)

**Agent decisions:** 57–59.

**Commit:** `548e34b`.

---

## Phase 4: Moving, stacking, spreading ✅

**Built**
- Drag controller (`src/physics/feel.ts`): held cards lift 10 mm, tilt toward their motion and follow through a short spring (lead card about 80 ms of lag). Modes: single, gather (clump with a count label, trailing springs), Alt formation (rigid, Ctrl + Shift as the fallback, decision 29), whole stack (Ctrl + drag, or drag the badge). Esc cancels a drag and the cards fly home.
- Landing (10.4): on empty table a gather becomes a neat stack at the drop point; onto a stack or single card it joins the top squared up; onto a messy pile it lands messily unless Tidy drops is on; formation drops each card on whatever is beneath it. Settle in 190 ms with a 0.8 mm hop.
- Peel versus whole stack: a plain drag on a stack takes the top card; Ctrl + drag or a badge drag takes the stack.
- Double-click spreads a pile beside its spot in rows of ten (top card first) and leaves an anchor badge; double-click any spread card or the anchor badge restacks in the same order; a card dragged out leaves the spread.
- Commands: Stack `S`, Spread `X`, Tidy `T`, Rotate `R`, Frame `Z`, Delete/Backspace to the Removed tray (spawn back one line or all). HUD buttons Stack, Spread, Tidy.
- Pile detection (`detectPiles`, union-find over a spatial hash), stable pile ids, badges with counts and "3 of 40 selected".
- Autosave to IndexedDB one second after any settle (and camera moves), restored on load.

**Gate:** typecheck clean · 77 tests passed (pile detection incl. a 1,000-card tower under 50 ms, layouts, yaw snapping, save-file validation) · build OK · browser check OK, no console errors.

**Checked in the browser:** real-mouse drag of one card onto another (badge 2); marquee 30 then gather-drag (clump with "30" label, lands as a stack of 30); real double-click spread and restack (order kept); Alt formation drag (all five cards moved by the same offset, synthetic events because the tool can't hold Alt); Ctrl + drag whole stack (synthetic); peel the top card (30 → 29); real badge drag of the 29 stack; `R`, `Delete` (29 to the tray), Spawn all back, Ctrl + A then `S` (one stack of 40), `T` on a messy pile of 60 (stack of 60); refresh restores 100 cards, both piles and the camera exactly. Pile detection after a drop: 0.3 ms; autosave 0.5 ms.

**Screenshots:** [badge reads 2](reports/screenshots/phase-4/01-badge-reads-2.png) · [gather clump](reports/screenshots/phase-4/02-gather-clump.png) · [spread](reports/screenshots/phase-4/03-spread.png) · [formation drag](reports/screenshots/phase-4/04-formation-drag.png) · [tidied](reports/screenshots/phase-4/05-tidied-and-stacks.png) · [after refresh](reports/screenshots/phase-4/06-after-refresh.png)

**Agent decisions:** 60–65.

**Commit:** `1130728`.

---

## Phase 5: Physics and feel ✅

**Built**
- Rapier world (`src/physics/world.ts`), metres inside, millimetres outside. Only loose cards have dynamic bodies (2 mm thick); nearby stacks become one static box each, other cards static slabs, the table a static ground. When everything sleeps (or after 420 ms) cards are snapped flat, stacked by the model 0.3 mm apart and handed back. Capped at 180 bodies (spec 17: under 200).
- Messy drops through physics (decision 66), messy spawns of up to 180 cards fall as a handful; larger spawns use the dealt layout.
- Tidy drops toggle in the top bar.
- Flip: right-click (the selection if the card is in it), `F`, HUD Flip, right-click a badge; a physical turn with a cascade.
- Flick: a fast move that reverses sharply tosses the card or clump and turns it over in the air (setting Off / Normal / Sensitive, UI in Phase 7).
- Foil sheen (since Phase 1), now checked at two angles. Card edges re-shaded (decision 70).

**Gate:** typecheck clean · 80 tests passed (adds flick detection) · build OK (Rapier split into its own chunk) · browser check OK, no console errors.

**Measured:** 60-card messy spawn: 60 bodies, settled in 463 ms (dropped from up to 16 cm). 10 cards dropped on a messy pile: settled 125 ms after release. Single card on open table: 167 ms. Tidy drops on: ten cards land squared on one spot. Flick: card tossed about 195 mm and landed face down. Stack of 100: poses identical over one second, every step exactly 0.300 mm, zero bodies.

**Screenshots:** [handful falling](reports/screenshots/phase-5/01-handful-falling.png) · [handful landed](reports/screenshots/phase-5/02-handful-landed.png) · [flip cascade](reports/screenshots/phase-5/03-flip-cascade.png) · [flick mid-air](reports/screenshots/phase-5/04-flick-midair.png) · [stack of 100](reports/screenshots/phase-5/05-stack-of-100.png) · [foil, angle A](reports/screenshots/phase-5/07-foil-a.png) · [foil, angle B](reports/screenshots/phase-5/08-foil-b.png)

**Agent decisions:** 66–71.

**Commit:** `ff2def3`.

---

## Phase 6: Named piles ✅

**Built**
- Promote with `N` (selected pile) or the pencil on any badge; the editor names the pile and sets its filter (validated live with the query engine). Rename, Un-name, and Delete for an empty one.
- Named piles keep their identity as cards join or leave, while spread (the name moves to the anchor badge; `pile:` still matches spread cards), and through save/restore.
- Own filter: cards dropped on a named pile that don't match slide off beside it with a wobble and a toast ("7 cards don't match Keep: `t:creature or t:land`").
- Empty named piles stay as a dashed outline with a "Keep · empty" badge; dropping on the outline fills the bin. `N` on empty table makes a new bin at the cursor.
- Merge rules (11.4): receiving name wins with a toast; a named pile dropped on an ordinary one carries its name over.
- `pile:` query term (engine since Phase 3, now backed by real named piles).

**Gate:** typecheck clean · 90 tests passed (named-pile detection: joins, shrink to one, leaving, merges; NamedPiles promote/validate/sort/outline/un-name) · build OK · browser check OK, no page errors (dev error counter, decision 76).

**Checked in the browser:** made Keep with `t:creature` through a real badge click, `N`, typing and Enter; dragged a Mountain onto it with the real mouse (slid off, toast); emptied Keep with Delete (outline and label stay); filled the bin again (11 creatures accepted, a land rejected; `pile:keep` = 12); merged Deck B into Deck A (toast) and Deck A onto an ordinary stack (name carried over); spread and restacked a named pile; renamed, un-named, made and deleted a bin with real clicks; reload restored Keep, Sell and Trade.

**Fixed along the way:** a drop onto an ordinary stack right after a merge looked the target up by its new id and threw; it now finds the pile by membership.

**Screenshots:** [named pile and bins](reports/screenshots/phase-6/01-named-pile-and-bins.png) · [land rejected](reports/screenshots/phase-6/02-land-rejected.png) · [empty outline](reports/screenshots/phase-6/03-empty-outline.png) · [named spread](reports/screenshots/phase-6/04-named-spread.png) · [merged](reports/screenshots/phase-6/05-merged-named.png)

**Agent decisions:** 72–75.

**Commit:** `4c07bdf`.

---

## Phase 7: Inspect, export, save files, query spawn ✅

**Built**
- Inspect panel on the right: after 150 ms of hover (or with exactly one card selected) the `normal` image, name, mana cost, type line, oracle text for every face, P/T or loyalty, set, number, rarity and finish. Double-faced cards show both faces' images. Click the image to pin; the panel collapses to a strip.
- Export: HUD Export (selection), Ctrl + E, a ⤓ button on every pile badge, and Export in the top bar (whole table). The decklist is copied at once; format `4 Name` or `4 Name (SET) 123` with `*F*` / `*E*` (remembered); Download .txt and Download CSV (14.2 columns).
- Save file (Ctrl + S) with `cardData` embedded, Open… with validation and a confirm, New table with a confirm.
- Spawn panel Query tab: Preview count, cap (500 default, settings allow up to 2,000), `-is:extra` always appended (noted under the box).
- Settings panel (decision 80).

**Gate:** typecheck clean · 97 tests passed (decklist export incl. a round trip through the parser, CSV rows and quoting, the `-is:extra` rule) · build OK · browser check OK, no page errors.

**Checked in the browser:** hovered a modal DFC (both faces shown); named a pile Keep and clicked its ⤓ with the real mouse (decklist copied, 40 lines, parses back to 40 cards; this put a test decklist on the clipboard); typed `set:ltr r:rare`, Preview count said 79, Spawn 79 spawned them; save round trip in code (119 cards, the named pile and the table name came back; 199 KB file); New with Cancel and with confirm; settings panel.

**Screenshots:** [inspect DFC](reports/screenshots/phase-7/01-inspect-dfc.png) · [export Keep](reports/screenshots/phase-7/02-export-keep.png) · [query preview](reports/screenshots/phase-7/03-query-preview.png) · [settings](reports/screenshots/phase-7/04-settings.png)

**Agent decisions:** 77–81.

**Commit:** `81541e9`.

---

## Phase 8: Polish ✅

**Built**
- Close-up quality (8.3, decision 82): `normal` images for the hovered card and the cards nearest the middle once cards are over 250 px tall.
- Selection feedback at a distance (9.7, decision 83): constant-size dots for selected cards when zoomed far out; "3 of 40 selected" badges (since Phase 4) shorten to "3/40".
- Badge decluttering by priority, with the pencil and export buttons on hover.
- Physics tuned for frame time (decision 84); Rapier in its own chunk.
- Error states: Scryfall unreachable or 429 (banner and toasts), invalid save files, query errors from Scryfall, an export with nothing selected, and the inspect panel's empty state (fixed: it started blank).
- CLAUDE.md brought up to date (where things are, dev tooling, gotchas); `card-manipulator-preview` launch entry for the production build.
- `src/dev/regression.ts`: the final pass as a script you can rerun (`await __regression()` in the dev console; it clears the table).

**Gate:** typecheck clean · 97 tests · build OK · production build booted in the browser with no console errors · final pass 28/28.

**Screenshots:** [close-up normal images](reports/screenshots/phase-8/01-closeup-normal-images.png) · [2,000 cards, red selected, far](reports/screenshots/phase-8/02-stress-2000-far-selection.png) · [2,000 cards, badges](reports/screenshots/phase-8/03-stress-2000-badges.png) · [cube sorted by colour](reports/screenshots/phase-8/04-cube-sorted-by-colour.png)

**Agent decisions:** 82–85.

**Commit:** `cb81d06` (this report's final update is the commit after it).

### Performance against Section 17 (stress-2000.txt, measured on your RTX 4070 Ti)

| Measure | Target | Measured |
|---|---|---|
| 2,000 cards on the table | 60 fps, frame under 8 ms at 1080p | 60 fps steady while panning far, panning near and orbiting with all 2,000 selected (median and p95 frame 16.7 ms, i.e. vsync). Full frame with shadows at 1920 × 1080: about 0.6 ms (render plus GPU sync, 40-frame average). Frame-loop CPU work 0.1–0.4 ms. |
| Draw calls | under 20 | 4 in the main pass (table, cards, contact shadows, outlines/points), plus the shadow pass |
| Dynamic bodies | under 200 | Capped at 180 total and 80 per drop; zero at rest |
| Texture memory | under 1 GB | 5 atlas pages for 2,058 images, about 430 MB with mipmaps, plus at most 32 close-up textures (about 40 MB) |
| Spawn a large list | 540 cards visible under 15 s warm | 1,008-card cube: 1.4 s warm (resolve 50 ms, images from cache); 17 s cold resolve. 2,000 distinct cards: 29 s cold |
| Autosave | under 50 ms, off the frame | 0.5 ms (100 cards), 2.3 ms (2,000 cards), on idle time |
| Pile detection after a drop | under 5 ms | Full table of 2,000 cards: about 4.5 ms once warm (6.5 ms the first time); typical tables 0.3 ms |
| Physics frame cost | (not in 17) | 20 cards 1.3 ms a step, 60 cards about 5 ms, 80 the cap |

The measurements ran in the browser pane (about 700 × 740 px) except the 1080p render timing, which resized the drawing buffer to 1920 × 1080.

---

## Owner's QA checklist

### Phase 1
- [ ] Page loads (your last table, restored). The Phase 1 numbered placeholder cards were removed in Phase 2 (decision 56).
- [ ] Right-drag pans; Space + left-drag pans too (decision 88).
- [ ] Wheel zooms toward the cursor.
- [ ] Middle-drag on empty table orbits and stops at the limits (decision 88).
- [ ] Home resets the view. The **View** button (or `V`) cycles four angles; a double right-click straightens back to the current one (decisions 86–87).
- [ ] Shadows under cards; the stack of ten shows thickness.

### Phase 2
- [ ] Paste `test-data/cube.txt` into List, Parse, Spawn: 1,008 cards, images fill in.
- [ ] Paste `test-data/bad-lines.txt`: five lines in red; fix one and Retry.
- [ ] Refresh, paste the cube again: it resolves at once and the images come from cache.
- [ ] Card tab: type a misspelt name, pick from the suggestions, spawn four foils.
- [x] Is the `small` image readable enough? It was not at mid zoom, so close-ups now start at 160 px (decision 92).

### Phase 3
- [ ] Marquee a crowd; Ctrl-marquee adds, Shift-marquee subtracts (decision 88).
- [ ] Type `t:creature mv<=2`: the live count drops as you type; Enter shrinks the selection.
- [ ] Esc, Esc, then `/`, `c:r`, Enter: red cards highlight wherever they are.
- [ ] An unsupported term (`art:x`) shows an error and changes nothing.
- [ ] Chips append and apply; Ctrl-click excludes (decision 88).

### Phase 4
- [ ] Glove cursors (spec 16.1, decisions 116–119): move over table and cards with nothing, Shift, Alt and Ctrl held; drag a card with and without Shift; pan with Space, orbit with the middle button. Each shows its own cursor and badge, sharp and readable on the table and on card art.
- [ ] Unnamed piles show no badge until you hold Alt; named piles always show theirs (decision 109).
- [ ] Drag one card onto another: with Alt held the badge reads 2, and the top card sits a little off and turned (decision 94).
- [ ] Select thirty, drag: they clump behind the cursor and fall into a loose stack on release; `T` squares it up (decision 94).
- [ ] Drag a single card by its corner in a curve: it turns a little about where you hold it.
- [ ] Select a stack, drag it quickly and let go mid-swing: the cards stay strung out where they were, a fan (decision 95).
- [ ] Pick up a messy pile by its badge and drop it: it lands as a compact heap, nothing mid-air. Pull a card from the middle: the cards above drop at once (decision 100).
- [ ] Drag a fast clump of 30 in circles, and over a tall stack: no card passes through another (decision 97).
- [ ] Drag a messy stack by its badge: it feels a little heavy and trails. Press `T`, drag it again: it moves snappily as one (decision 96).
- [x] **Alt-drag keeps formation, and releasing Alt does not focus the browser menu (decision 29).** Confirmed (decision 93).
- [ ] A plain drag peels the top card; dragging a badge lifts the pile.
- [ ] Start a plain drag, then hold Shift partway: cards you pass over are pulled in; let go of Shift and passing over cards does nothing; hold it again and it resumes (decision 110).
- [ ] Double-click spreads; double-click again restacks in the same order.
- [ ] S, X, T, R, Z, Delete; Removed tray spawns back.
- [ ] Hover a card at an odd angle and press R: it squares to the next quarter turn clockwise; R again turns it 90°; R twice quickly stands it upright (decision 102).
- [ ] With nothing selected, hover a pile and press T, X, X, S, F; drag a stack and press R mid-drag: it turns in your hand and lands turned (decision 103).
- [ ] Spawn the cube, press `Shift + C`: colours two to a row (W U, B R, G colourless, multicolour and lands; decision 113), columns by mana value lined up, lands stacked at the start, title bars readable. Hover one colour's pile and press `C`. Toggle **Split creatures** and press `Shift + C` again (decision 107). Press `C` on a curved pile: it stacks back up; cascades show more of each card (decision 108).
- [ ] **Reverse spread** (decisions 215, 216): over a pile press X: the glove with a blue 🪟. Press X again: the glove points the other way, its 🪟 pink and still bottom right; X once more: back to blue. Start dragging a box and press X mid-drag: the preview swaps between blue and magenta at once. Drag a small box: the preview glows magenta and shows the right side of each card. Let go: the top card lies whole at the left, the rest show their mana costs. Plain X still shows names and glows blue. X on the reverse spread restacks it.
- [ ] **Selected playmat** (decision 214): drag a playmat: it keeps a blue rim after you let go. Press Z: the camera frames the whole mat. Click the empty table, select a card, or lock it: the rim goes. R on a mat also selects it. Alt-drag a mat with cards: the rim shows and the cards are no longer selected.
- [ ] **Z frames big groups close** (decisions 212, 213): select a large group (a Curve layout) and press Z: it nearly fills the screen, one wheel notch out from a tight fit, centred, nothing cut off, the hints clear. Z on one card: as close as before. Try another View angle (Low, Corner) too.
- [ ] **Foil on close-ups** (decision 211): spawn a foil card, zoom in until it sharpens: the rainbow foil band still shows and moves as the camera turns, the same as when zoomed out. Nonfoil cards look as before.
- [ ] **Basic lands** (decision 210): Spawn panel, Card tab, Basic lands. Click Island: one Zendikar full-art Island spawns. Hover a chip: its tooltip names the printing. Put 7 under Plains and 8 under Forest, Spawn basics: 15 lands in one pile, numbers back to 0. Choose basics...: click the Plains field, wait a few seconds for the list, type `alpha`, pick one, tick Foil, Save; the Plains chip now spawns that. Type nonsense in a field and Save: the row turns red. Save the table and load it back: the basics stay. New table: back to Zendikar.
- [ ] **X box preview** (decisions 207 to 209): select a pile, press X, drag a box: a light blue hologram (glowing edges, drifting scan lines, a faint flicker) shows the grid the cards will make, changing as the box does. Let go: the cards land on the outlines. Try a tall thin box and a tiny box: where cards overlap, only the edges that will show are drawn, like the cascade they land in (decision 208). Esc mid-drag: outlines go.
- [ ] **F waits for a double, like R** (decision 206): tap F over a card: after a short pause it flips. Tap F F over a face-down pile: it comes face up with no flip first. Same while holding cards. Middle-click still flips at once.
- [ ] **0 draws in packs of 15** (decision 205): hover a big pile, press 0, enter 90, click: six fans of 15, one under the next. Enter 27: a fan of 15 above a fan of 12. 15 or fewer is still one fan.
- [ ] **Ctrl + Z undo** (decision 204, built while you were away; local commit, not pushed): drag a card, Ctrl + Z: it flies back; Ctrl + Z again: it returns (Redone). Try S S, F, Delete (the Removed tray empties on undo), a spawn, a paste and a playmat move. Click empty table between an action and Ctrl + Z: the undo still works. While holding cards Ctrl + Z does nothing. Verified by the agent in the built-in browser at 1920 x 1080 (screenshot `reports/screenshots/undo/undone-toast.png`).
- [ ] **Copy and paste** (decision 202): select some cards (a foil among them), Ctrl + C, move the mouse elsewhere, Ctrl + V: copies land at the cursor as a messy pile, same printings and foils. Paste into a text editor: a decklist. Copy a decklist from a website and Ctrl + V over the table: those cards spawn. Ctrl + C / V in the filter box still copy text.
- [ ] **E rank view** (decision 198): over the welcome table (or a spawned cube), press E: columns by EDHREC rank, least played on the left, 1–100 on the right, cascading 22 mm. Press E E: columns by Elo in steps of 50, like CubeCobra's view. Split creatures on: creatures above non-creatures. E on the sorted view stacks it back up. The HUD's 🏆 (E) button does the same.
- [ ] **P for pointer mode** (decision 195): the finger button reads (P). Hover a pile (or select cards), press P, click the table: they move there as a stack. P again cancels.
- [ ] **No more towers** (decision 194): spawn a cube (or the 450-card cube.txt) messy: it lands as a low, wide messy heap about 13 cm tall, not a leaning tower. Smaller messy piles look as before.
- [ ] **Cube tab with Elo** (decision 192): Spawn panel, Cube tab, paste a CubeCobra link (e.g. https://cubecobra.com/cube/list/classicmoderncube), Spawn cube: the whole mainboard spawns as one pile in its printings and foils. Hover a card: Inspect shows CubeCobra Elo next to the EDHREC rank. Type `elo>=1400` in the filter: the cube's top picks are selected. Save and reload: the Elo is still there.
- [ ] **Colour curve in view** (decision 191): pan away from the cards and press Shift + C: the colour curve lays out centred in the middle of the screen. Plain C still curves a pile out where it lies.
- [ ] **Pointer mode** (decision 189): select some cards, click the finger button beside the search box: it lights up, the cursor is the pointing glove and the hint line says how many will move. Click the table: they fly there as one stack (onto a pile if you click one). Esc, or the button again, cancels.
- [ ] **EDHREC rank** (decision 187): hover a card: the Inspect panel shows EDHREC rank #N under the printing (Sol Ring is #1). Type `edhrec<=100` in the filter box: the most played cards on the table are selected. On an older table, ranks appear a few seconds after loading.
- [ ] **Dealing from a face-down deck** (decision 186): flip a stack face down, pick it up and deal (right-click or Space): cards come off the top, face down. A face-up stack still deals from the bottom.
- [ ] **Dealing glove** (decision 185): holding cards, right-click or tap Space: the dealing glove shows as the card falls; hold to keep dealing and it stays. The hint line says deals one, hold to keep dealing.
- [ ] **R waits for a double** (decision 184): tap R over a turned card: after a short pause it turns a quarter. Tap R R: it stands upright with no quarter turn first. Hold R: it keeps turning. While dragging cards, the same.
- [ ] **Held hotkeys fire once** (decision 183): hold S, F, X, C, H, V, Shift + T, Delete and Ctrl + S in turn: each acts once (S stacks without shuffling, Ctrl + S saves one file). Hold N with nothing selected: one new bin, its name box not filled with n's. Hold R over a card: it keeps turning a quarter every quarter second; R R still stands it upright.
- [ ] **Space deals too** (decision 181): holding a stack, tap Space: one card drops; hold Space: one every half second. With nothing held, Space + drag still pans.
- [ ] **Right-click deals from the hand** (decision 180): pick up a stack (left button) and right-click: the bottom card falls messily under the cursor. Hold the right button and move: a card drops every half second, dealing a trail. With Ctrl held they land squared, stacking onto a pile under the cursor. The last card ends the drag. Right-drag with nothing held still pans.
- [ ] **Middle-click flips the hand** (decision 179): pick up a stack with the left button and, still holding, middle-click: the stack turns over in the hand with the Flip glove, and keeps moving with the mouse. Middle-drag with nothing held still orbits.
- [ ] **Easier sweeps from messy piles** (decision 178): drag a card and hold Shift while passing over a messy pile or a cascade: every card you touch comes at once, and lingering takes the whole pile in well under a second. Over a neat deck it still comes slowly, top card first.
- [ ] **Face up / Face down chips** (decision 176): with nothing selected, click Face down in the chip row: every face-down card on the table is selected; drag one and they all move. With a selection, Face up keeps only the face-up ones; Ctrl-click a chip to exclude instead.
- [ ] **Higher pops** (decisions 174, 175): hover a card near the bottom of a tall messy stack: it pops up clear of every card on it and shows whole. Run the mouse down a curve column: each card pops in turn as soon as the mouse reaches the part of it that was showing. A top card still pops just a little.
- [ ] **Sharp popped cards** (decision 173): zoom in on a messy stack and hover a card partly under others: it pops up, and within a moment shows the sharp image, not the soft small scan.
- [ ] **Thicker mats** (decision 172): tilt the camera low over a playmat: the black edge is twice as thick (5 mm). Cards on it still read as lying on it from the default angle.
- [ ] **Alt chain link** (decision 171): hold Alt over a card, and over a playmat: the open glove shows 🔗. Over empty table Alt still shows the numbers arrow.
- [ ] **Ctrl ruler, then tick** (decision 170): hold Ctrl over a card: 📐. Ctrl + click it: the badge becomes ☑️ and stays over other cards while Ctrl is held. Let go of Ctrl and press it again: 📐.
- [ ] **Alt arrow** (decision 169): hold Alt over empty table: the arrow with a blue 1 2 / 3 4 keycap drawn in, no box, no emoji.
- [ ] **Plus and minus arrows** (decision 168): over empty table the arrow shows its dashed box; hold Ctrl: the arrow with a drawn plus, no box; hold Shift: the arrow with a minus. Same while drawing those marquees. Alt still shows the box arrow with 🔢.
- [ ] **Gesture fixes** (decision 165): S shows no gesture; S S on a big pile keeps the two-handed shuffle until the cards stop moving; middle-click a card or a pile badge: the Flip glove shows.
- [ ] **Gesture cursors** (decision 164): over a pile press S, S S, T, F, R, H and Delete (on a selection): each shows its glove for half a second, then the normal cursor returns. Press 3 and click: the dealing glove shows. Drag one card: the glove holding up a card; drag several: the fist. Ctrl while dragging one card adds 📐. Keys over empty table show nothing.
- [ ] **0 draws any number** (decision 162): hover a big pile and press 0: a dialog asks how many, starting at the whole pile. Type 100, Enter: the cursor shows 🔢; click: five fans of 20 appear, one under the next, face up. Try 7 (one fan), 0 then Esc (nothing), and typing digits in the dialog (no draws start). H on the hand stacks it back.
- [ ] **Guild columns line up** (decision 161): `Shift + C` on the cube. Each guild's multicolour column sits directly above its land column; a guild with only lands (or only spells) leaves a gap in the other row; a guild with neither has no column.
- [ ] **X spreads lie flat** (decision 160): X then drag a small box over 30 or so cards so they overlap heavily. Every card lies flat, rows overlapping like shingles, none tipped or leaning, also from a low camera angle. Drag one card out: it and what it leaves behind rest normally. Reload: the spread is still flat.
- [ ] **X picks a spot** (decision 159): hover a pile (or select cards) and press X: the cursor becomes the pointing glove with 🪟 and the hint line explains. Click the table: they spread in a grid centred on the click. Again with a small box dragged: every card lands inside the box, overlapping evenly, title bars showing; a big box keeps the normal gaps. Double-click a spread pile: it restacks where it came from. X X spreads in place; X over a spread restacks it; Esc cancels. The HUD (X) Spread button does the same for the selection.
- [ ] **Ctrl hover tick** (decision 158): hold Ctrl over a card: the open glove shows ☑️. Ctrl + drag it: the fist shows 📐 and it lands squared. Ctrl over empty table still shows ➕.
- [ ] **Window width** (decision 157): narrow the window from full width. Below 1800 px the top bar, side panels and bottom bar shrink together so no button is cut off; the play space keeps its size and clicks still land on the right cards. Below 1280 px a warning covers the page with the current width; widen the window (or Ctrl and minus) and it goes away by itself.
- [ ] **HUD keys** (decision 156): select cards; the bottom buttons read 📚 (S) Stack, 🪟 (X) Spread, 🧹 (T) Tidy, 🃏 (F) Flip, 🎴 (H) Fan, 📊 (C) Curve, 🎨 (Shift + C) By colour, 📤 (Ctrl + E) Export; the bar still fits on one line.
- [ ] **Locked mat buttons** (decision 155): lock a mat; hovering it shows 🔒 📺 in its bottom left corner. Unlock: they go back to the top right. Turn the mat with R first and check they follow its corners.
- [ ] **Mat lock** (decision 154): hover a mat, click 🔓 left of 📺: it turns into a lit 🔒. Dragging on the mat now draws a marquee; R and Delete do nothing to it; cards on it still move. Click 🔒 to unlock. Save and reload: the lock stays.
- [ ] **Welcome table** (decision 153): open the app in a private (InPrivate / Incognito) window, which has no saved table. The Welcome table loads, with your 449 cards and the Bloodbraid Elf playmat, from your saved camera. Press New: the table clears, and reloading keeps it empty. Your normal window keeps your own autosaved table.
- [ ] **Graphics mode** (decision 152): the top bar shows **Graphics: High** beside the camera angle. Compare High and Low zoomed in on card text, at a low angle across a spread (texture filtering), and on shadows: High should be visibly sharper with no shimmer, and close-ups should kick in sooner. Spawn the cube plus a stress list past 1000 cards: a notice says graphics dropped to Low and the button reads **Low (auto)**; clicking it keeps High. Check frame rate in both modes. Reload: the mode you picked is remembered.
- [ ] **Identity rows indented** (decision 151): with `Shift + C` on the cube, the multicolour and land rows start under the mana value 1 column, with the 0 column left empty above them.
- [ ] **Multicolour by identity** (decision 150): spawn the cube and press `Shift + C`. Under the colour blocks, multicolour cards sit in a row of guild columns (Azorius first, Simic tenth), then 3+ colours, each column cheapest first. The lands row is below it.
- [ ] **Lands in the curve** (decision 149): spawn the cube, press `Shift + C`, then `C` on a pile with lands. Lands sit in their own row underneath, cascading 22 mm, one column per guild in order (Azorius, Orzhov, Dimir, Izzet, Rakdos, Golgari, Gruul, Boros, Selesnya, Simic), then 3+ colour lands, then one-colour and colourless lands together last. C on the land row stacks it back up.
- [ ] **Mat carries whole piles** (decision 147): overlap a card hanging off the mat's edge with a card on the mat, then Alt + drag the mat. Both cards come along, and the Alt badge counts both.
- [ ] **Mat corners and base** (decision 146): a mat has 10 mm rounded corners and a 2.5 mm black edge under the art, best seen with the camera tilted low. Cards on it still show their shadows.
- [ ] **Mat flicker** (decision 145): zoom far out and tilt the camera low over a mat with cards on it, and overlap two mats. No flickering stripes against the table, between mats or under the cards' soft shadows.
- [ ] **Playmats** (decision 144): Spawn panel → Playmat → `Ragavan, Nimble Pilferer (MH2) 138` → Spawn playmat. The mat lies under all cards with the art filling it. Drag it from an empty spot: it moves alone; Alt + drag: its cards come along. R turns it, Delete removes it. Hover it: 📺 in the corner opens a live top-down mirror window with no selection glow. Hold Alt: the mat shows its name and card count. Save and reload: the mat comes back.
- [ ] Hover a face-down deck and press **5**: the cursor becomes the pointing glove with 5️⃣ and the hint line says to click. Click the table: the top 5 cards fly there as a face-up fanned hand. Press a number then Esc: nothing happens (decision 143).
- [ ] Hover a pile and press **H**: it fans like a hand of cards, top card on the right; press H again and it stacks back up. The HUD has 🎴 Fan, and H shows in the hint line and the ? list (decision 141).
- [ ] Hover a pile (or hold it) and tap S twice: it stacks in a new random order; check the top card changed (decision 106).
- [ ] Flip a few cards of a pile face down, then hover the pile (or hold it) and tap F twice: every card faces up, in its own order (decision 105).
- [ ] Drag a messy stack and press T, then F, then X, then S mid-drag: it squares, turns over (bottom card now on top), spreads into a grid, gathers again, and lands as held (decision 104).
- [ ] Refresh restores the table and camera.
- [x] Does the drag spring feel right (lag, tilt)? Yes (decision 93).

### Phase 5
- [ ] Drop a handful (spawn ~60 as a messy pile, or drag a group onto a messy pile): it looks dropped.
- [ ] In Tidy mode, drop a card onto the lower part of another: it snaps 22 mm below it in a cascade; drop onto the middle: it squares on top (decision 114).
- [ ] With Alt held, hover a badge's pencil or export button: the pointing glove shows. Buttons in the panels keep the normal Windows hand (decisions 130, 131).
- [ ] Hold **Ctrl** while dragging and drop: the cards land squared at 90° and the cursor shows 📐; the Tidy mode button lights while Ctrl is down (decision 129).
- [ ] Toggle **Tidy mode** (top bar or `Shift + T`) and drop again: it squares up at 90°; a card held at an angle turns square while you drag it; a spawn arrives as a neat stack (decision 98).
- [ ] Middle-click flips with a turn; select forty and press F for a cascade.
- [ ] **Flick feel:** it was too hard to trigger on Normal; it is now easier (decision 90). Check again.
- [ ] A stack of 100 doesn't jitter.
- [ ] **Foil sheen taste:** it was too subtle; it is now stronger (decision 91). Check it is not a disco effect.

### Phase 6
- [ ] Name a pile Keep with filter `t:creature` (click its badge, press N, or use the pencil).
- [ ] Drop a land on it: it slides off with a toast.
- [ ] Empty the pile: the label and outline stay; drop creatures on the outline to refill it.
- [ ] Press N on empty table to prepare a bin; pencil, Delete removes it.
- [ ] Merge two named piles: the one you drop onto keeps its name.

### Phase 7
- [ ] Hover shows a big readable image; a DFC shows both faces; click to pin.
- [ ] Click or drag on the table: the unpinned panels collapse as you press, and the card you clicked is the one you get (decision 139). Pin one with 📌 (it highlights) and it stays open; reload and the pin is kept (decision 137).
- [ ] The **?** button (or the `?` key) opens the full controls list; Esc or a click away closes it (decision 135).
- [ ] A hint line in the bottom left of the table shows the controls for what's under the cursor, and changes while holding cards, drawing a marquee, panning or orbiting; a held key's hint lights up (decision 134).
- [x] Export Keep (⤓ on its badge) and paste it into Moxfield. Works (decision 93).
- [x] Save a file (Ctrl + S), New table, Open it back. Works (decision 93).
- [ ] Spawn `set:ltr r:rare` from the Query tab: the preview count comes first.
- [ ] No gear in the top bar; the query cap is on the Query tab and the export format in the export panel (decision 112).

### Phase 8
- [x] 2,000 cards (spawn `test-data/stress-2000.txt`) pan and orbit smoothly. Confirmed in Chrome (decision 93).
- [ ] Zoom in: cards near the middle sharpen to the big image once they are about 160 px tall (decision 92), including every card of a fan that shows a strip (decision 101).
- [ ] Zoom far out with a selection: dots mark the selected cards; badges shorten and don't pile up.
- [ ] Every checklist above still passes (or run `await __regression()` in the dev console).
