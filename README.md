# 3D Card Manipulator

A table in your browser for moving hundreds or thousands of Magic cards around at once. Sort a cube, triage a collection, build decks from one pool, or play a game with friends online.

**Try it:** https://dazeyama.github.io/card-manipulator/

It runs on desktop Chrome or Edge, in a window at least 1280 px wide. There is nothing to install and no account to make.

## Get cards on the table

Your first visit opens a sample table of 450 cards, so you can play before loading your own. Press **New** to start an empty one.

The spawn panel on the left brings cards in:

- **List**: paste a decklist. Set codes, collector numbers and foil markers are understood, and lines it can't find are shown in red to fix.
- **Cube**: paste a CubeCobra link and the whole cube arrives in its own printings.
- **Card**: search one card by name, with basic lands one click away.
- **Query**: any Scryfall search, such as `set:ltr r:rare`.

Card data and images come from Scryfall and are cached in your browser, so a second load is fast.

## Select and filter

Selection works like an RTS game. Drag a box on the table to grab every card inside it. Hold Ctrl to add to the box, Shift to take away.

Then narrow it down with the filter box (Ctrl + F). It takes Scryfall syntax and runs on your table, with no network calls. Type `t:creature mv<=2`, press Enter, and the selection shrinks to the matches. With nothing selected, the same box searches the whole table and lights up every match wherever it sits.

## Move and sort

Drag a card to move it, or drag one of the selection to move all of it. Cards have weight and land in loose piles. Press Shift + T for **Tidy mode**, where everything lands squared up instead.

A few keys do most of the work. Each acts on the selection, or on the pile under the cursor.

| Key | Does |
|---|---|
| S | Stack. Twice quickly: shuffle |
| X | Spread the pile out so every card shows |
| C | Lay out a mana curve. Twice: a column per colour |
| E | Columns by EDHREC rank. Twice: by CubeCobra Elo |
| F | Flip. Middle-click flips one card |
| H | Fan like a hand |
| N | Name a pile |
| Ctrl + Z | Undo the last action |

Hold **Space** for a radial menu of every action, if you'd rather not learn the keys. Press **?** for the full list of controls.

A **named pile** can carry its own filter, such as `t:creature`. Cards that don't match slide off when dropped on it, which turns it into a sorting bin.

## Save and export

The table saves itself in your browser as you work. Ctrl + S saves it to a file you can load later or send to someone.

Ctrl + E copies the selection as a decklist that pastes into Moxfield, Archidekt and the like. CSV export is there too, one row per printing with a quantity.

## Play a game

The spawn panel's Playmat tab sets up the pieces for a real game:

- **Playmats** with any card's art and a life counter. Click for +1, right-click for -1.
- A **card stand** to hold your hand. It is a small tilted table, and cards on it behave as they do on the table.
- **Dice** (D) and **tokens** (T T over a card finds its tokens).

Number keys draw from a deck: press 7 over it, then click where the hand goes. **L** searches a face-up pile without spreading it, and **L L** searches a face-down one, such as your library. The deck is shuffled when you're done.

There are no rules, turns or automatic life totals. It plays like a real table, and you keep track the way you would at one.

## Play online

Press **Go online** and your table becomes a room with a link. Send the link and up to eight people can join. You pick a nickname and a colour, and everyone sees each other's cursors and moves live.

- The player who opened the room wears the **crown**. They set what everyone else may do, from View only up to Everything.
- Hidden information is real. Cards on your stand and every face-down card are hidden from other players. The server leaves those cards out of what it sends them, so a player can't find them by digging through the page. The crown's browser is the one exception, since it runs the table.
- Rooms can stay unlisted, go in a public table browser, or need a password.
- A room closes when the last person leaves. Your own offline table is untouched, and comes back when you leave someone else's room.

There's a chat box, but no voice. Use Discord alongside it.

## Run it yourself

You need Node 24.

```
npm install
npm run dev
```

That opens the app on http://localhost:5173 with a local room server on port 8787. `npm test` runs the tests and `npm run build` makes the static site.

It is built with TypeScript, Vite, Three.js for the 3D and Rapier for the physics. The room server is a Cloudflare Worker with Durable Objects, on Cloudflare's free plan.

## Credits

Card data and images are from [Scryfall](https://scryfall.com). Cube lists and Elo ratings are from [CubeCobra](https://cubecobra.com). The idea came from Lucky Paper's [MTG Scratchpad](https://luckypaper.co/resources/scratchpad/).

3D Card Manipulator is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
