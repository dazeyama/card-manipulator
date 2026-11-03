# Sleeves — design and build brief

Designed with the owner on 2026-11-02; not built yet. This file holds everything a fresh session needs to build it. Read CLAUDE.md, design_spec.md (Sections 10.5, 10.9, 12.1, 14, Appendix A) and ONLINE.md (Sections 6, 7, 8, the O log) first, as always. When the build is done, the behavior below moves into the spec (a new Section 10.11 **Sleeves**, plus edits to 10.5, 12.1 and 14.3) and ONLINE.md (7.1, 8.2), the decisions are logged, and this file can be deleted or kept as history.

## 1. Why

In a room every face-down card is hidden (ONLINE.md 7.1, O30). A double-faced card (DFC) flipped over is "face down", so it shows the Magic back to everyone, and a DFC's back face can never be put on the table in a room: no transformed creature, no MDFC played as its land.

The owner's answer is to copy the real table. Unsleeved DFCs show their back side to everyone, which is why real players sleeve their decks. Sleeves hide the back face and keep a deck's order secret. To show a sleeved DFC's back face, you lift it out of the sleeve.

## 2. Behavior

### 2.1 Unsleeved DFCs: the back side is public (owner)

- Offline, nothing changes: flipping an unsleeved DFC shows its back face (decision 12, spec 10.5).
- In a room, the same: a face-down **unsleeved** DFC shows its back face to **everyone**, so its identity is public. That holds everywhere: loose on the table, inside a face-down deck, after a shuffle, on someone's card stand, and on an unowned stand. The owner chose this for card stands too ("like holding an unsleeved DFC in a real hand: the back side faces the table").
- Consequence, intended: an unsleeved deck shows where its DFCs are. Sleeving fixes that.
- Single-faced cards are unchanged: face down shows the Magic back and is hidden in a room.

### 2.2 Sleeve packs (owner: a pack, used up)

- **A pack** is a small object on the table: a box about the size of a card (around 70 × 95 mm, about 15 mm tall) showing its sleeve style on top (the color, or the art). It is dragged like a die or a card, saved with the table, and in a room everyone sees it.
- **Sleeving**: drop a pack on a pile (a card of it under the cursor at release) and **every card in that pile** is sleeved with the pack's style, replacing any sleeves they already wear (owner: "sleeves every card"). The pack is used up and disappears. Play a short ripple across the pile, quick enough not to wait on (under about 300 ms, as landings do).
- **(agent)** If the card it lands on is in the selection, the pack sleeves the **whole selection** instead of the pile.
- **(agent)** A single loose card is a pile of one, so a pack sleeves it.
- **(agent)** Cards on a card stand can be sleeved the same way.
- **(agent)** Dropped on empty table, the pack just lies there. **Delete** with it under the cursor (nothing selected) removes it, as for a mat.
- **Undo** (Ctrl + Z) takes back a sleeving whole: the cards lose the new sleeves (or get their old ones back) and the pack returns.
- **Saving a deck**: every sleeving saves the pile as a deck (Section 2.7).

### 2.3 Getting a pack (owner: Playmat tab + radial)

- **Playmat tab**: a new **Sleeves** section beside **Card stand** (the Playmat tab is the "table objects" tab). It holds:
  - A row of color swatches. Reuse the dice palette, `DIE_COLOURS` and `DARK_COLOURS` in `src/state/dice.ts`, named as in `src/ui/diceColours.ts`.
  - **or** a card line for art (`Ragavan, Nimble Pilferer (MH2) 138`), resolved the way the playmat line is, using Scryfall's art crop.
  - **Spawn pack**, which lays a pack in the middle of the view, as Spawn stand does.
  - A one-line note: "Drop a pack on a deck to sleeve it. Sleeved decks are saved under List."
- **Radial and bottom bar**: an item **Sleeves** (key **Shift + U**, **(agent)**) drops a pack in the **last style used** (default: the first dark color) at the cursor. Put it in the Point wedge's ring, beside the flag item (B), since both put an object down.

### 2.4 How sleeved cards look (owner: color or card art)

- **Face up**: the card's face with a thin rim in the sleeve's color, about 1 to 1.5 mm, drawn over the card's own edge, so on a shared table you can tell whose cards are whose **(agent)**. An art sleeve's rim is near-black (#1d1d1f). Foil still shows through.
- **Face down**: the **sleeve back**, for every sleeved card, DFC or not.
  - A color sleeve is the color with a soft glossy sheen (a diagonal highlight) and a faint inner border.
  - An art sleeve is the art crop, center-cropped to the card's shape, with the same sheen.
- **Raised** (Section 2.5): the DFC's **back face**, inside the sleeve rim, drawn a few millimeters **proud of the sleeve's top edge**, as if pulled half out **(agent)**. If the offset is fiddly in the shader, a raised card may simply show its back face with the rim and a small ⇡ marker in a top corner. Note which you chose in the decision.
- At far zoom the rim may vanish; that's fine.

### 2.5 Raise: Shift + F (owner)

- **Shift + F** on a **sleeved DFC** turns it **face up showing its back face** ("raised" out of the sleeve). It is public, like any face-up card.
- **Shift + F** on a raised card lowers it: face up, front face.
- **F** on a raised card flips it face down (sleeve back). **(agent)** Flipping it back up shows the face it had: the card keeps `raised` while face down. The owner had no preference.
- **Shift + F** on an **unsleeved DFC** does what F does (its back face *is* its face-down side). On a **single-faced card** it does nothing; the notice says "Not double-faced".
- Acts like F: on the selection, else on the card under the cursor, with the flip cascade and the `flip` glove gesture.
- Middle-click and flicks stay plain flips.
- **Radial**: the Flip wedge's ring gets **Raise** (Shift + F, icon ⤴️ or similar, title "Show a sleeved double-faced card's back face, face up").

### 2.6 Unsleeve: U (owner)

- **U** takes the sleeves off the selection, or off the pile under the cursor when nothing is selected. Undo puts them back.
- A raised card that is unsleeved stays face up, showing its back face.
- **(agent)** Unsleeving does not give back a pack.
- **Radial**: the Flip wedge's ring gets **Unsleeve** (U).

### 2.7 Your decks, in the List tab (owner: a snapshot; spawn sleeved, face down, stacked)

- **Saved on every sleeving.** The pile's cards are saved as a deck: a decklist of exact printings and finishes (the `4 Lightning Bolt (M11) 149 *F*` form, from `groupLines`/`decklistText` in `src/io/exportDecklist.ts`), the sleeve style, the card count and the time.
  - It's a **snapshot**: later changes on the table don't touch it.
  - It's kept in **this browser's IndexedDB**, like the save slots (`src/io/saveSlots.ts` is the pattern).
- **Name (agent)**: the pile's name if it is a named pile; else the cube's name if every card came from one cube (`card.cube`); else the next free "Deck 1", "Deck 2"…
  - If a saved deck already has that name, the snapshot **replaces** it without asking, and the notice says "updated".
  - Otherwise it's new, and the notice says "Sleeved 60 cards · saved as Mono Red".
- **In a room (agent)**: the deck is saved only if the sleever can see **every** card in it (`store.canSee`). Otherwise the cards are still sleeved, and the notice says "Sleeved. Not saved to your decks: 12 cards are hidden from you". Saving must never leak hidden identities.
- **List tab**: a **Your decks** section **under** the text box and its buttons, newest first. Each row has:
  - a sleeve swatch (color, or a tiny art thumb),
  - the name,
  - "60 cards · 3 h ago" (`savedAgo` from saveSlots.ts),
  - **Spawn** (primary): resolves the decklist through the normal List path (the card cache, then Scryfall through the queue as usual). The cards land as a **neat face-down stack** in their sleeves at the usual spawn spot, ready to shuffle. If any lines fail to resolve, the rest spawn and the notice says how many failed.
  - **Edit**: puts the decklist in the text box; the normal List tab takes over from there.
  - ✏️ renames, inline or with the small rename dialog used elsewhere.
  - 🗑 deletes, after a confirm ("Delete the deck Mono Red?").
  - With no decks, show one muted line: "Sleeve a deck to keep it here."
- In a room, **Spawn** needs the same rank as spawning a list.

### 2.8 Rooms

- Sleeve styles, packs, rims and raised cards are public.
- A face-down **sleeved** card is hidden (sleeve back), DFC or not.
- **Ranks**:
  - Sleeving, unsleeving and raising need **Move**, like flipping.
  - Spawning a pack needs Move, like `matAdd` in `shared/permissions.ts`.
  - Removing a pack needs Move, like `matRemove`.
  - Spawning a saved deck needs the list-spawn rank.
- Every new key and button goes through `guard.gate` / `allowedNow` (`src/online/guard.ts`) like the others.

### 2.9 Saved tables

- Cards carry their sleeve and raised state.
- The table carries its sleeve styles and packs.
- Old files and old autosaves load with no sleeves and no packs.
- Save slots and autosave come along for free through `toDoc` / `loadDoc`.

## 3. Data model

Keep the types plain (CLAUDE.md). New identifiers use US spelling (`color`).

```ts
// src/state/types.ts (or a new src/state/sleeves.ts)
export interface SleeveStyle {
  uid: string;            // 'v…' via newUid
  color?: string;         // '#rrggbb' for a color sleeve
  art?: string;           // Scryfall art crop URL for an art sleeve
  scryfallId?: string;    // the art's printing, for the hint
  name: string;           // 'Dark blue', or the card name for art
}

export interface SleevePack {
  uid: string;
  style: string;          // SleeveStyle uid
  x: number; y: number; z: number; yaw: number;
  side?: 0 | 1;
}

// Card gains:
sleeve?: string;          // SleeveStyle uid; unset, unsleeved
raised?: true;            // a sleeved DFC showing its back face (kept while face down)
dfc?: true;               // has a back face (record has back_image_small); see 4.1 for why the card carries it
```

- **Card fields**: add `sleeve`, `raised` and `dfc` to `CardSnap` (`src/state/history.ts`), to `CardMove` (`src/state/store.ts`, as `sleeve?: string | null`, `raised?: true | null`), to `toDoc` / `tableOfDoc` / `validateDoc` (`src/io/saveFile.ts`), and to `TableDoc`.
- **Table lists**: `TableState` (`shared/table.ts`) gets `sleeves: SleeveStyle[]` and `packs: SleevePack[]`, defaulting to `[]` in `emptyTable` and for old docs.
- **Styles are kept** while any card or pack uses them. **(agent)** Drop unused styles on save so the list doesn't grow forever.
- **Setting `dfc`**: whenever a card is created (spawn, paste, tray restore, deck spawn, load), from `isDfc(record)` in `src/scryfall/trim.ts`. For old files, set it once the records resolve.

### Saved decks (IndexedDB, via `kvGet` / `kvSet` in `src/scryfall/db.ts`)

```ts
export interface DeckInfo { id: string; name: string; cards: number; savedAt: number; style: SleeveStyle }
// keys
'deck.v1.index'   -> DeckInfo[]          // what the List tab shows
'deck.v1.<id>'    -> { list: string }    // the decklist text, exact printings
```

Put the storage in a pure-ish `src/io/savedDecks.ts`: `listDecks`, `saveDeck(name, list, style, cards)` (replaces by name), `loadDeckList(id)`, `renameDeck`, `deleteDeck`, `nextDeckName(existing)`. Unit-test the name logic.

## 4. Rooms (ONLINE.md changes)

### 4.1 Visibility, `shared/redact.ts`

`canSee` becomes:

```ts
if (card.stand) {
  const m = mats.get(card.stand);
  if (!!m && m.kind === 'stand' && m.owner === player) return true;
  return !!card.dfc && !card.sleeve;          // unsleeved DFCs are public even in a hand (owner)
}
return card.faceUp || (!!card.dfc && !card.sleeve);
```

- **Why `dfc` lives on the card**: the server never sees card records, only `scryfallId`, so it can't tell a DFC by itself. The adder's browser sets `dfc` when a card is created.
- **The crown's judge** (it holds every record) **must check** `dfc` on `add` and `replace` ops against `isDfc(record)` and refuse a mismatch. Otherwise a player could hide a DFC by leaving `dfc` off.
- **`hideCard`** must also strip `dfc` and `raised` (and keep `sleeve`, which is public). Otherwise a hidden sleeved card would leak that it is a DFC.
- **Client side**: `app.online.canSee` and `store.canSee` (`src/online/hidden.ts`) must use the same rule. Import the shared one, don't copy it.

### 4.2 Ops

- **Sleeving, unsleeving and raising are `move` ops**: their `CardMove` entries carry `sleeve` / `raised` (and `faceUp`). That way they get undo, batching, `cardsTouched`, and the server's visibility diff for free. Unsleeving a face-down DFC then makes the server send `reveal` to everyone; sleeving one sends `forget`. Check that `visibilityDiff` really runs on `move` ops (it should) and add tests.
- **New op** `{ t: 'sleeves'; set?: SleeveStyle[]; remove?: string[] }` for styles.
- **New op** `{ t: 'pack'; set?: SleevePack[]; remove?: string[] }` for packs.
  - Model both on `flag` and `cubes` in `shared/ops.ts`, `shared/apply.ts`, the crown's judge and `shared/permissions.ts`.
  - Packs can be held while dragged the way dice are (`grab` has a `dice` list). **(agent)** Either add `packs?: string[]` to `grab` / `release`, or move packs without holds, whichever is simpler and safe. Note the choice in the O log.
- **A sleeving** goes out as one `batch`: a `sleeves` set (if the style is new to the table), a `move` with the cards' new `sleeve`, and a `pack` remove.
- **Bump `PROTOCOL`** in `shared/protocol.ts` (now 3, so 4). The room server needs a redeploy: pushing `shared/**` runs `.github/workflows/worker.yml`.
- **`server/src/room.ts`**: check whether it validates op shapes or keeps per-op lists (rate limits, snapshots of `TableState`), and add the new ops and fields there.

### 4.3 Shuffle

- O66 gives hidden cards fresh uids after a shuffle. Visible unsleeved DFCs in a shuffled deck stay visible, which is intended.
- A sleeved deck behaves exactly as a face-down deck does now.

### 4.4 Search (L L, O112)

No change. A searched pile is revealed to the searcher alone, sleeved or not.

## 5. Rendering

- **`src/render/cardImages.ts` `slotsFor(card)`** picks the slots:
  - **back slot**: the sleeve style's slot when `card.sleeve`; else as now (the DFC back face, or `BACK_KEY`).
  - **front slot**: the DFC's back-face image when `card.raised && card.sleeve && card.faceUp`; else as now.
  - The gate (`app.images.gate`) still applies: a card the player can't see shows the hidden look. A hidden **sleeved** card must show its **sleeve back** on the back side, not the Magic back, so the gate's "refused" case should still use the sleeve slot for the back.
- **Sleeve back slots**: one atlas slot per style, key `sleeve:<uid>`.
  - A color style is drawn to a canvas at the atlas slot size (`IMG_W` × `IMG_H` in `src/render/atlas.ts`), with rounded corners matching the card's alpha, the sheen, and the inner border.
  - An art style fetches the art crop (`cards.scryfall.io`, as playmats do; not through the API queue, the same as playmat art) and draws it center-cropped.
- **Rim and raise**: `src/render/cards.ts` has per-instance attributes `aFront`, `aBack`, `aFlags`, `aGlow`.
  - Add the rim color (rgb plus an on/off) either in a new instanced attribute (`aSleeve`, vec4) or in spare channels if `aFlags` has any.
  - Add raised as a flag, for the offset or the ⇡ marker.
  - The fragment shader draws the rim on the face-up side only.
  - It must stay **one draw call** and keep the 2,000-card performance (spec Section 17).
- **The pack's mesh**: a small box, its top textured with the style's slot and its sides in the color (dark gray for art). Draw it in the dice pass or near it. Picking needs to find it for drags and Delete.
- **Hi-res close-ups** (`src/render/hires.ts`): a raised card's close-up uses the back face's `back_image_normal`.

## 6. Input, radial, help

- **Keys**, in `src/main.ts`, next to `f`: `shift+f` (Raise), `u` (Unsleeve), `shift+u` (Sleeves pack at the cursor). U and G are free; Shift + F and Shift + U are free (checked 2026-11-02).
- **`RADIAL_MENU`** in `src/input/radial.ts` (decision 309):
  - Flip ring: `{ label: 'Raise', key: 'Shift F', presses: ['shift+f'], icon: '⤴️', title: 'Show a sleeved double-faced card's back face, face up' }`.
  - Flip ring: `{ label: 'Unsleeve', key: 'U', presses: ['u'], icon: '…', title: 'Take the sleeves off' }`.
  - Point ring: `{ label: 'Sleeves', key: 'Shift U', presses: ['shift+u'], icon: '🎁' or similar, title: 'Drop a sleeve pack at the cursor; drop it on a deck to sleeve it' }`.
  - The bottom bar follows from that list automatically.
- **Also update**: RADIAL.md's table, `tests/radial.test.ts`, and the `?` panel (`src/ui/helpPanel.ts`): the F line gains "Shift + F raises a sleeved double-faced card's back face · U unsleeves", plus a line for sleeve packs.
- **Dragging a pack**: press on the pack and drag. Mirror the die drag in `src/dice.ts` / the input grammar.
  - While dragging over a pile, glow that pile (or the selection) the way a drop target glows elsewhere, so it's clear what will be sleeved.
  - On release over cards, sleeve; else set it down.
- **Hints**: the hover hint over a pack reads "Sleeve pack · drop on a deck to sleeve it". Over a sleeved face-up DFC, mention Shift + F.
- **Inspect** (spec 13): unchanged. It shows both faces of any card the player can see. **(agent)** Add one line under the set info when the card is sleeved, e.g. "Sleeved · Dark blue".
- **Search** (spec 9.4): **(agent)** add `is:sleeved` and `is:raised` beside the tool's own `is:faceup`, if cheap (`src/query/evaluate.ts`).

## 7. Decisions to log when building

Spec Appendix A continues at **360**; ONLINE.md's O log continues at **O119**. Date them on the day built, owner rows as "Owner (2026-11-02)", the rest **(agent)** with reasons.

**Owner decisions (2026-11-02)**:
1. In rooms, unsleeved DFCs' back sides are public: face down, in decks, and on card stands, the same as offline.
2. Digital sleeves: a **sleeve pack** object, **used up** when dropped on a pile; it sleeves **every** card in the pile, replacing old sleeves.
3. Sleeved face-down cards show the sleeve's back. **Shift + F** raises a sleeved DFC's back face, face up and public.
4. Sleeve looks: a **color** (with a sheen) **or card art**.
5. Every sleeving saves the pile to **Your decks** as a **snapshot**, listed in the **List** tab. **Spawn** brings it back **sleeved, face down, as a neat stack**.
6. Packs come from a **Sleeves section on the Playmat tab** and a **radial / bottom-bar item**.
7. An **Unsleeve** command (U) on the radial and bottom bar.

**Agent decisions to record** (each marked "(agent)" above): the selection rule for packs; packs on empty table; Shift + U and U; the face-up rim; the raise look; raised remembered while face down; Shift + F on unsleeved or single-faced cards; deck naming and replace-by-name; no save of decks with hidden cards in rooms; `dfc` on the card checked by the crown; `hideCard` stripping `dfc` and `raised`; unused styles dropped on save; pack holds; `is:sleeved` / `is:raised`; the Inspect line.

**Spec edits**:
- 10.5 drops "there is no special transform command" and points to Sleeves.
- A new 10.11 Sleeves.
- 12.1 List tab mentions Your decks; the Playmat tab mentions the Sleeves section.
- 14.3 mentions saved decks beside save slots.
- The key table gains Shift + F, U and Shift + U.
- CLAUDE.md "Where things are" gains `src/io/savedDecks.ts` and the sleeves module.

**ONLINE.md edits**: 7.1 (what's hidden), 8.2 (the ops), 8.3 if streams change (they shouldn't), 13 (the test list), and the file tree.

## 8. Tests (vitest)

- **`tests/redact.test.ts`**:
  - An unsleeved face-down DFC is visible to all, on the table and on another player's stand.
  - A sleeved face-down DFC is hidden.
  - `hideCard` strips `dfc` and `raised`.
  - `visibilityDiff` gives `reveal` on unsleeve and `forget` on sleeve.
- **`tests/apply.test.ts`** (or wherever ops are tested): the `sleeves` and `pack` ops; a `move` carrying `sleeve` / `raised`; the sleeving batch.
- **The crown's judge**: refuses an `add` whose `dfc` doesn't match the record.
- **`tests/savedDecks.test.ts`**: `nextDeckName`; replace by name; the decklist round trip through `parseDecklist`.
- **Save files**: `toDoc` / `tableOfDoc` keep `sleeve`, `raised`, `dfc`, `sleeves` and `packs`; old docs load with empty lists.
- **`tests/radial.test.ts`**: the three new items.
- **Selection logic** for a pack drop (pile vs selection), if pure.

## 9. Suggested build order

1. Data model, save files, `dfc` on spawn and load. Tests.
2. Rendering: sleeve back slots, the rim, raised front. Check by hand with a dev-console sleeve of some cards.
3. Raise (Shift + F) and Unsleeve (U) as `move`s with undo. The radial, help panel, RADIAL.md and tests.
4. Packs: the object, its mesh, dragging, the drop that sleeves, the Playmat tab section, Shift + U.
5. Saved decks: the store and the List tab section, plus Spawn sleeved.
6. Rooms: redaction, the new ops, the judge's `dfc` check, permissions, the PROTOCOL bump, the server. Test with `?fakeroom` and `?player=B` (CLAUDE.md gotchas).
7. Spec, ONLINE.md and CLAUDE.md edits; decisions logged; typecheck, tests, build; commit (don't push unless the owner asks).

## 10. Where to look (hand-off list for the owner)

1. Playmat tab → **Sleeves**: pick a color, **Spawn pack**. A pack appears mid-view.
2. Spawn a list with a few DFCs as a face-down stack, then drag the pack onto it. The pack vanishes, the cards show the sleeve back, and the notice says the deck was saved.
3. Flip a sleeved DFC face up (F): its front with a colored rim. **Shift + F**: its back face, raised. F, then F again: still raised.
4. **U** on the pile: the sleeves come off, and face-down DFCs show their back faces again.
5. List tab → **Your decks**: the deck is there with its swatch. **Spawn** brings it back sleeved, face down and stacked. **Edit** fills the text box.
6. **Shift + U** drops a pack of the last style at the cursor. Ctrl + Z after a sleeving brings the pack back.
7. In a room with a second player (`?player=B`):
   - B sees your unsleeved face-down DFCs' back faces, even on your stand.
   - B sees sleeved ones only as sleeve backs, and sees a raised card's back face.
8. Save a slot and load it: sleeves, raised cards and packs come back.
