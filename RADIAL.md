# Radial menu (planned 2026-10-31, built as decision 298)

**Built.** `src/input/radial.ts` (tested in `tests/radial.test.ts`) and `src/ui/radialMenu.ts`; decision 298 lists where the build departs from the notes below.

A ring of the main card actions that opens on **Space** (Space was unbound for it, decision 296). Agreed with the owner in an interactive Q&A. Mockup: `reports/mockups/radial-menu.png` (source `radial-menu.svg`).

## How it works

- **Hold, flick, release.** Hold Space: the menu opens centred on the cursor. Move toward a wedge and let go to do it. Letting go in the dead centre cancels.
- **Tap leaves it open.** A quick tap of Space (let go before leaving the centre) keeps it open: click a wedge to do it. Esc, Space again, or a click outside closes it.
- **Two rings.** The inner ring holds 8 wedges; letting go on one does its main action. Pushing further out past the inner ring shows that wedge's **variants** in an outer ring, centred on it; letting go there does the variant. A small dot on a wedge's outer edge marks one that has variants.
- **Labels.** Each wedge shows the help panel's emoji, its name, and its key underneath (S, C C, Shift C...).
- **Not while holding cards.** It doesn't open mid-drag (agent call).

## What it acts on

Exactly what the key would act on, **as if the key were pressed where the menu was opened**: the selection, or the pile under the cursor there (`hoveredPile()` / `hoveredCard()` in `src/main.ts`). The cursor moves while you flick, so capture `mouse.hovered` and `app.pointer` when the menu opens and use those when the action runs.

Actions that need a second click behave just like their keys: **Spread** arms the spread (X) and **Draw** opens the 0 prompt; the owner then clicks where. (Agent call, to match the keys.)

In a room, route each action through the same key names so `keyboard.guard` applies rank gating; wedges the player's rank can't use are dimmed.

**Empty table, nothing selected:** the menu still opens, but every wedge is dimmed (decision 305: Undo, the one wedge that worked without cards, became Point).

## The wedges

Clockwise from the top. Letting go on the inner wedge does the first item.

| Wedge | Inner (main action) | Outer ring (variants) |
|---|---|---|
| Stack | Stack (S) | Shuffle (S S), Tidy (T) |
| Flip | Flip (F) | Face all up (F F) |
| Turn | Turn 90° (R) | Upright (R R) |
| Spread | Spread (X) | Reverse spread (X X) |
| Hand | Fan as hand (H) | Other size (H H): as wide as a stand on the table, the usual size on a stand (decision 303) |
| Sort | Curve (C) | Colour columns (C C), Curve per colour (Shift C), EDHREC (E), Elo (E E) |
| Draw | 1 card (1) | 7 cards (7), N cards (0): how many, with a Face down tick (decision 300) |
| Point | Point (P): click where the cards go, as a stack | Pass pack (P P): face down, like a draft pack (decision 305) |

Deliberately left off: pile tools (tokens, name, copy, delete, frame), dice, camera, search, save.

## Building notes

- Many variants are double taps inside one key handler (`lastS`, `lastC`... with `DOUBLE_TAP_MS` in `src/main.ts`). Don't fake two key presses. Pull each into a named function the key and the menu both call.
- **Pure module** (`src/input/radial.ts` or similar), tested with vitest:
  - the menu definition;
  - hit-testing from the angle and distance off the centre to a wedge and variant;
  - the tap-versus-flick rule.
- **The overlay** is DOM/SVG in `src/ui/`, styled like the other panels: white wedges, `--line` borders, `--accent-soft` for the hovered wedge, solid `--accent` for the chosen variant. It scales with the cursor size setting and the UI fit.
- **Space:** `keydown` (not a repeat, not typing) opens; `keyup` resolves; `blur` cancels. Call `preventDefault` so Space doesn't press focused buttons or scroll.
- Update the help panel (`src/ui/helpPanel.ts`) and the hint line (`src/ui/hints.ts`).
