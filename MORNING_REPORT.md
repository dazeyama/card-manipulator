# Morning report

## Rooms run (2026-10-30)

The unattended build of `ONLINE.md` (decision 288): one hub session and three area forks (Server, Sync, Rules & UI) sharing this folder on `main`, as `ONLINE_PROMPT.md` sets out. Nothing is pushed; the Worker is deployed after each gate (O80).

### Summary

| | |
|---|---|
| **Phases gated** | O1 (tag `online-1`), O2 (tag `online-2`) |
| **BROKEN items** | none |
| **Tests** | 409 passing in 45 files at gate O1 (239 at the seed) |
| **Run it** | `npm run dev` (vite 5173 + a local room server on 8787), or `start.bat`. Tab A: Go online. Tab B: the room link with `?player=B` before the `#` (dev only, O90), so one browser is two players. |
| **Room server** | **deployed** after gate O1: `https://card-manipulator-rooms.daisyamanita.workers.dev` (free plan, Durable Objects on SQLite, checked live: create, hello, welcome, ping, close). `.env.production` points the site at it. The admin key is a Worker secret and sits in `server/.admin-key` (git-ignored) for `#/admin`. |
| **For you to do** | before your first push with server code: the GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (ONLINE.md 3.5), or `worker.yml` fails (the site deploy is separate and unaffected, O92); edit the word list in `shared/words.ts` (O79) |
| **Ports in the run** | hub 5177 + 8787 (O95: your own `start.bat` server holds 5173), Server 5174 + 8788, Sync 5175 + 8789, Rules & UI 5176 + 8790 |

### Seed (hub)

- `wrangler`, `concurrently`, `@cloudflare/workers-types` (O71, O94); scripts `dev`, `dev:web`, `dev:server`, one pair per session (O91, O95); `typecheck` runs the server's tsconfig too; `.env.*` per mode; `.claude/launch.json` entries `rooms-hub`, `rooms-server`, `rooms-sync`, `rooms-ui`.
- `server/`: `wrangler.toml` (10.6), `tsconfig.json`, `src/worker.ts` answering `GET /api/version` with CORS, empty `Room` and `Lobby` objects, `.dev.vars` with a dev admin key.
- Contracts: `shared/table.ts` (`TableState`, `HIDDEN`), `shared/ops.ts` (`Op` with `batch`, `cardsTouched`), `shared/protocol.ts` (every message, limits, colours, snapshot parts, `playerIdOf`), `shared/permissions.ts` (ranks, `needs`, `allowed`); `src/online/room.ts` (`RoomState`), `session.ts` (`Session`, `FakeSession`), `identity.ts` (with `?player=`), `index.ts` (`Online`, `app.online`). `CardMove` carries the links a landing sets; `Mat.owner`. Decisions O93 to O95.
- `tests/protocol.test.ts` (9 tests).

### Phase O1: rooms by link ✅

**Built.** *Server:* the Worker's routes, the Room object (hello, welcome, mirror and op log in SQLite, proposals to the crown, confirms stamped with seq, streams, chat, crown election, the maker's reclaim, close on empty), a minimal Lobby, `worker.yml`. *Sync:* the store as the one choke point with `shared/apply.ts` as its proven twin, the WebSocket session (version check, reconnect, ping), outbox with rollback, inbox in seq order, the crown's authority in the socket handler, 10 Hz streams, presence (cursors, held and flying cards and dice, selection colours). *Rules & UI:* the Online button and avatars, the Online panel (short form, Room, Settings, Players, Chat), joining by link with the join prompt, the whole-page states, the first-visit welcome note with Join a table.

**Gate results** (2026-10-30, all three forks frozen; the folder had moved on into O2 to O4 pieces, which the checks included):
- `npm run typecheck`: clean (client and server). `npm test`: **409 passed** in 45 files. `npm run build`: OK.
- **Two-tab check** on `rooms-hub` (vite 5177, wrangler 8787), at 1920 x 1080: every item of ONLINE.md 16's O1 list passed: tab A went online (room code, panel, 👑 avatar); tab B opened the link with `?player=B`: the join prompt named the room and its host with A's red greyed, and Join brought in all 450 cards and the playmat at the default camera; A's held drag showed in B lifted 12.9 mm in A's red glow where A held it, and both tabs agreed on the landing to 0.01 mm; a flick in A streamed its flight to B at 10 Hz (rising to 56 mm, turning over) and one `move` landed it face up in both; the grab race (B pressing a card A held before hearing of the hold) was refused with "That card is in Ann's hand"; B's press on the held card picked up the card under it instead; A's cursor and name tag showed on B's felt; B's ten selected cards glowed orange in A while A's own selection stayed blue; chat both ways with grey join lines; closing A made B crown at once ("Bea is the crown now"), and reopening the link in A's browser gave it back ("Ann took the crown back", Bea kept Move); Go offline gave B "The room has closed." with Save a copy and left A's 450 cards where they were; a reload of both tabs at once closed the room (O61), and the link then said "This room has closed", Back to my table restoring A's table with the room's changes.
- Consoles clean in both tabs; `__errors` empty throughout.
- **How it was driven:** the built-in browser shows one tab at a time, so drags, the flick and the cursor were driven with synthetic pointer events in one tab and checked in the other by reading its presence buffers and drawn poses, then by screenshot. A background tab's 10 Hz stream timer is throttled by the browser to about once a second; nothing about that is the app's.
- **Screenshots:** `reports/screenshots/online-1/` (10).
- **Fixed in the gate (hub):** remote cursors vanished after 4 s of a resting mouse, since the stream only sends what changed (`f60211b`).
- **Commit and tag:** `d562346` "Phase O1 gate", tag `online-1`. Worker deployed after it (`3e7a7bd0`), `.env.production` committed.
- **Agent decisions in O1:** O93 to O97, O100.
- **BROKEN:** none. **Small things noticed:** the maker's own chat line reads "Ann joined as Move" although Ann is the crown (passed to Server); the "You are the crown now" toast had faded before it could be read (the chat line was there); the dev `__shot` helper stalls while the browser pane is hidden (dev only).

### Phase O2: permissions and hidden information ✅

**Built.** *Server:* `shared/redact.ts` (each player is sent only the identities they may know, with `reveal` and `forget` as cards turn up or go hidden), crown-only settings, rank, kick, ban and pass, the password hash on hello, the grey lines. *Sync:* the crown's judge by rank, Lock table, stand ownership, one full stand, Tokens-removes-tokens, the cap and holds; reveal and forget into the store; shuffles of hidden cards re-keyed (as a remove and an add, O103); undo with its precondition; spill. *Rules & UI:* permissions tested row by row, the guard on keys, buttons and drag starts with the 12.4 toasts, rank pickers and the crown's ⋯ menu, the Settings section, stand ownership on the plate (Claim, Release, Give to…, Spill), the hidden gate in every module of 7.3, hidden cards in Save a copy and exports.

**Gate results** (2026-10-30, forks still frozen; same code as gate O1, so typecheck, **409 tests** and the build stand as there):
- **Two-tab check** (A crown, B joining as Move, then a third player C for undo), every item of ONLINE.md 16's O2 list: B's spawn buttons greyed with "Cards or higher needed" (a click toasts "Tokens or higher needed" on basics); A set B to Cards in B's row and B's decklist of 3 arrived in A with names; B's stand read "Bea" and was B's; B's five cards on it were backs in A on both faces, Inspect "Hidden card", and A's press on one was refused "Only Bea can touch that stand"; B moved two to the table face down and **B's own browser forgot them too** (O30); B's S S over that pile gave the two hidden cards fresh uids in both tabs (old uids gone, the 15 face-up cards kept theirs); B turned one face up and got its identity in a `reveal` (Torch Fiend), A saw the face; Lock table: 🔒 in B's bar and B's drag "The table is locked", unlocked: B's rank back; B left with cards on the stand ("Leave the room? Your stand waits for you until the room closes.") and A saw it wait, its cards hidden; A's Spill ("Spill Bea's stand? Its cards drop face down in front of it.") dropped them face down in front and removed the stand; B's Save a copy wrote A's stand cards as `scryfallId: 'hidden'`, `hidden: true`, with nothing in `cardData` (9 hidden cards, a valid file); Downloads off: B's Save, Export, HUD Export and Save a copy went and Ctrl + E said "Downloads are off in this room", the crown kept them; Kick: "You were kicked from the room", B rejoined with its seat and Cards rank; Ban (confirmed): "You were banned from this room." and B's Join after a reload was refused; C's own Ctrl + Z undid C's turn for everyone; C's undo after A had turned the same card was refused.
- Consoles clean in all tabs.
- **How it was driven:** partly through the real mouse path (synthetic pointer events for drags and presses), partly by calling the same functions the buttons call (rank picker, Leave, Lock, Downloads, Kick, Ban, spawn stand, deal, flip, shuffle, Spill through `mats.spill`, Save a copy through `toDoc`; no file was downloaded). Midway the browser pane went hidden and Chromium stopped animation frames in every tab, so a test-only frame pump (timers standing in for `requestAnimationFrame`) kept the pages drawing; with frames stopped, pile detection waits, which is why a joiner briefly had no piles. In a real visible tab this does not arise.
- **Not opened in the browser:** a hidden copy loaded offline (the loader skips `hidden` ids and the atlas draws backs; `tests/hidden.test.ts` round-trips one), and the Cast window online (a popup).
- **Screenshots:** `reports/screenshots/online-2/` (3: A's view of B's stand as backs, B's own view, the kicked page).
- **Commit and tag:** `ba26b7d` "Phase O2 gate", tag `online-2`. No server change since the O1 deploy, so no redeploy.
- **Agent decisions in O2:** O98, O102, O103.
- **BROKEN:** none. **Found, sent back after the gate:** (1) the Card stand button is not shown disabled while you own a full stand (its click is refused correctly); (2) a spill writes no "Ann spilled Bea's stand" grey line (the UI sends a plain mat remove, not `mat {spill}`); (3) an undo refused because someone else moved those cards says "Nothing to undo" instead of "Someone else has moved those since" (12.4).

### Phase O3: the public browser

(written at the gate)

### Phase O4: polish

(written at the gate)

### Done entries by area

Each fork writes its own here, newest first: "- <Fork>, <date>: **<piece>**: what; where to look (tab A does X, tab B sees Y); untested; decisions O<n>; BROKEN: ...".

#### Server

- Server, 2026-10-30: **Gate O3 fix: quiet rooms fell out of the lists** (`server/src/lobby.ts`, `room.ts`). The Lobby kept its rows in memory (O97), but an idle Lobby is evicted within seconds, long before the next minute's heartbeat, so a public room with no changes for a few seconds vanished from the Tables list and the admin page while it stayed open. The rows now live in SQLite, written when they change and otherwise at most every 90 s; a new room heartbeats when created, so the admin list knows it at once; the Room's alarm sets the next alarm before heartbeating. **Where to look**: set a room Public, leave it alone for five minutes, and it is still in the Tables list and on `#/admin`. **Checked**: a public room listed in all 12 checks over 4 quiet minutes while the Room hibernated and woke at each alarm; the O1, O2 and O3 scripts again. Decisions O105. BROKEN: none.
- Server, 2026-10-30: **After gate O2: the crown's join line, and spills in a batch** (`server/src/meta.ts`, `room.ts`). The maker's own grey line now reads "Ann opened the room", not "Ann joined as Move"; a newcomer who walks into a room with no crown reads "Sam joined and is the crown now". Rechecked the spill the UI now sends, one `batch` of the cards' move (face down, off the stand) then `mat {spill}`: "Ann spilled Cal's stand" is written from the stand's owner before the op, and the owner gets `forget` for every card. **Where to look**: tab A goes online and its chat's first line is "Ann opened the room"; spill B's stand from A and the chat says "Ann spilled Bea's stand". **Checked** with the O1 and O2 scripts against `wrangler dev`. BROKEN: none.
- Server, 2026-10-30: **Phase O4, quota, the wake path and the limits** (`server/src/quota.ts`, `worker.ts`, `room.ts`, `storage.ts`, `meta.ts`). When the free plan refuses for the day, every route answers 429 `{ error: 'quota' }` and a socket gets `bye quota` (the client shows "Rooms are back after midnight UTC"); a room whose storage writes are refused keeps going from memory. After hibernating, a room asks the crown for a fresh table only if it had to replay ops from its log. Caps of 32 seats and 200 bans keep long-lived public rooms from growing without bound. The limits were reviewed against Section 15 and kept (figures in O101). **Where to look**: nothing to see in a normal session; if the quota is ever spent, a join shows the Quota page instead of an error. **Checked**: an idle room against `wrangler dev` (it hibernated, woke at seq 3 with 3 logged ops replayed and asked the crown; after the crown's answer a second wake replayed none and did not ask), plus the O1, O2 and O3 scripts again. **Untested**: a real quota refusal (only the matcher, unit-tested on Cloudflare's wording) and hibernation in the cloud. Tests: `quota` (6). Decisions O101. BROKEN: none.
- Server, 2026-10-30: **Phase O3, the public list, reports, admin, limits and the name filter** (`server/src/lobby.ts`, `lobbyBook.ts`, `worker.ts`, `room.ts`, `meta.ts`; `shared/words.ts`; `server/wrangler.toml`). `GET /api/rooms` lists public and password rooms (lock, players, crown, tag, cards, since), most players first; a room set Unlisted leaves the list at once. `POST /api/rooms/:code/report`: three distinct reporters delist a room. Admin routes with the `x-admin-key` header: the list of every room with its reports, Delist, Relist (clears reports) and Close (ends the room for everyone). Rate limits: 5 new rooms an hour per ip and per identity (429), 30 joins an hour per ip (bye rate), 3 reports an hour per identity; **off in local development** (`server/.dev.vars` has `RATE_LIMITS=off`, git-ignored). The name filter (42 entries, the owner's to edit) turns a blocked room name into "Table CODE" and a blocked nickname into "Player N". The password checks are from O2. **Where to look**: set A's room to Public + password with tag Play and the Tables list in a third tab shows its row with the lock; set Unlisted and it disappears; name a room "sh1t cube" and it lists as "Table CODE"; `#/admin` with the key lists the room and Close ends it. **Checked** with a 29-step script against `wrangler dev` (list, visibility, the filter on names and renames, reports to delisting, the 4th report refused, admin key, list, relist, delist, close) and the O1 and O2 scripts again. **Untested**: the creation and join limits through the Worker (local dev turns them off; they're covered by unit tests). The production admin key is set at the first deploy by the hub. Tests: `words` (5), `lobby` (9), `election` (+1). Decisions O99. BROKEN: none.
- Server, 2026-10-30: **Phase O2, redaction and the crown's controls** (`shared/redact.ts`, `server/src/room.ts`, `server/src/meta.ts`). Every player is sent the table and each confirmed op with the identities they may not know taken out (face-down cards, other players' stands, unowned stands), then `reveal` for cards that became visible to them and `forget` for cards that became hidden; the crown gets everything whole. Crown-only `settings` (visibility, password stored as a hash, tag, newcomers, Lock table, Downloads, name), `rank`, `kick` (seat kept, may rejoin), `ban` (blocked for the room's life), `pass` (the old crown keeps Everything and gets the table redacted). Password checked on hello for newcomers, a wrong one answered after a second, 10 wrong tries per 10 minutes per ip. Grey lines for kicked, banned, locked and unlocked, settings changed, and "Ann spilled Bea's stand". **Where to look** (two tabs): B deals cards onto its stand and A sees backs (the server never sent A their names); B flips a card face up on the table and A sees its face at once (the reveal); Lock table in A and B sees the lock; Kick B gives the kicked screen and B can rejoin; Ban B and B cannot; Pass crown to B and A keeps Everything. **Checked** with a 41-step WebSocket script against `wrangler dev` (redacted snapshots and adds, reveal on a flip, forget onto a stand, owner change, spill, the settings, password right and wrong, rank, kick, ban, pass) and the O1 script again. **Untested**: in a real two-tab game (needs Sync's judge and Rules & UI's panel). Tests: `redact` (20), `election` (+2). Decisions O98. BROKEN: none.
- Server, 2026-10-30: **Phase O1, the room server** (`server/src/worker.ts`, `room.ts`, `meta.ts`, `storage.ts`, `lobby.ts`, `limits.ts`; `shared/roomCode.ts`, `shared/rateLimit.ts`; `.github/workflows/worker.yml`). Routes `GET /api/version`, `POST /api/rooms` (six-character code, retried on a collision), `GET /api/rooms/:code` (name, players, password, tag, open, crown, taken colours) and the socket upgrade, with CORS for the site and localhost. The Room: hello (version, bans, 8 connected, seat restored by player id, a free colour, nickname "Player N" when empty), welcome, snapshot parts from the mirror with `seq` on part 0, proposals to the crown as `propose`, `confirm` stamped with `seq` and applied to the mirror with `applyOp`, `refuse`, streams fanned out with `from` and `side`, chat (100 lines, 5 per 5 s, "Slow down" to the sender only), colour swaps, `needSnapshot`, pings answered without waking it, crown election (highest rank, longest present), the maker taking the crown back, Go offline (`close`), close on empty, an alarm that closes socketless rooms and heartbeats the minimal Lobby. Storage: meta in KV, snapshot parts and a batched op log in SQLite; the mirror is rebuilt from them after a restart. No redaction yet. **Where to look** (two tabs): tab A goes online and gets a code; tab B opens the link and gets the table; a drag in A shows in B (the op relay); close A and B becomes crown with the whole table; reopen A and the crown comes back to A ("Ann took the crown back"); Go offline in A gives B the closed screen; close every tab and the link says the room has closed. **Checked** with a 51-step WebSocket script against `wrangler dev` (create, join, relay, refuse, mirror, streams, chat rate, colours, size limit, election, reclaim with the unanswered proposal re-sent, socket replacement, close, close on empty, version), and a restart mid-room (mirror back at seq 3 from snapshot + op log). **Untested**: hibernation in the cloud (local only), the deploy workflow (nothing pushed), the `noCrown` refusal (it needs a moment with players but no crown). Tests: `roomCode`, `rateLimit`, `election` (20). Decisions O97. BROKEN: none.

#### Sync

- Sync, 2026-10-30: **Gate O3's finding: big ops in parts** (`src/online/outbox.ts`): an add, remove or move of more than 1,000 cards goes out as several ops of at most 1,000 (each judged and confirmed on its own, each with its own part of the inverse and of an undo's precondition), and a turn whose batch would pass about 900 KB goes out change by change, so a cube spawned or a layout of the whole table no longer comes near the server's 1 MiB and never costs the crown its socket (O104). 6 tests in tests/outbox.test.ts. Streams keep the 64 KB limit: one stream carries at most 400 poses (flights first, then the top of the hand; past that, held cards lift and land for others without travelling) and 1,000 selected uids, and a last guard drops the selection, then the poses, from a stream that would still be too big; a 2,000-card hold with a 5,000-card selection is tested to fit (tests/presence.test.ts). **Where to look:** spawn a 540-card cube in a room as the crown, then Shift + C over a 2,000-card table: the room stays open and everyone's table follows. **Untested:** in a browser. **BROKEN:** none.

- Sync, 2026-10-30: **Phases O3 and O4 sync, and gate O2's findings** (`src/online/authority.ts`, `outbox.ts`, `inbox.ts`, `presence.ts`, `session.ts`, `src/state/store.ts`, `src/undo.ts`, `src/mats.ts`'s Spill (one call), `src/main.ts`'s Ctrl + Z toast, `src/dev/regression.ts`): **spills** go to the room as [move, mat {spill}] through the new `store.spillMat`, so the server writes "Ann spilled Bea's stand" (5.5); the Spill button calls `spillStands` (agreed with Rules & UI). **Snapshots** for the mirror every 30 s only when something changed. **Undo** overtaken by someone else's change now says "Someone else has moved those since" (12.4) instead of "Nothing to undo", and changes from the room never become part of what Ctrl + Z takes back (O41). **O3:** the invite key travels in the hello the join prompt builds; a gap in seq asks for a fresh snapshot (both in since O1). **O4:** `__latency(ms)` delays everything the page sends; `__bots(n)` adds n players streaming moving cursors and selections and now and then carrying a card. **Performance pass** (2,000-card stress table, Graphics Low (auto), canvas 1479 x 996, 2026-10-30): the pane was hidden, so frames were timed by hand around the app's own frame (every frame hook, the card layer, the render, then `gl.finish()`): offline 0.2 ms median, 0.5 ms p95; online with `__bots(7)` (7 remote cursors, 70 to 140 cards held in others' hands drawn from their streams, 350 cards glowing in others' selections) 0.2 to 0.35 ms per frame, presence's own frame 0.05 ms, the render 0.2 to 0.35 ms. Some 30-frame windows measured 4 to 7 ms in all; per-part timings in the same state never passed 0.4 ms, so those were the machine (four dev servers and three other sessions running), and they are still inside spec 17's 8 ms. **Interpolation:** 100 ms buffer and a 120 ms landing ease kept as designed; the maths is tested (tests/presence.test.ts). **Where to look:** `__latency(300)` in tab A and drag a card: your own drag is instant, B sees it about 400 ms behind and smooth; `__bots(7)` on the stress table: seven cursors circle, cards float in their colours, frames stay smooth. **Untested:** the feel of the buffer and the ease under `__latency(300)` (no visible pane, so no frames to watch); the frame budget measured by the frame loop itself. **Decisions:** none new. **BROKEN:** none.

- Sync, 2026-10-30: **Phase O2 sync** (`src/online/authority.ts`, `inbox.ts`, `outbox.ts`, `connect.ts`, `src/state/store.ts`, `src/undo.ts`, `feel.ts` and `commands.ts`'s shuffle mark): **the crown judges by rank** (6.2) through `shared/permissions.ts`'s `refusal`, with Lock table as "The table is locked", Downloads untouched; **stand ownership** (only the owner moves cards on or off, grabs from, moves, renames or removes a stand; Claim at Move with no full stand, Everything regardless; Release; Give to and taking another's need Everything; Spill and removing another's stand need Everything; one full stand each, small unlimited); **Tokens removes only tokens** (and basics), the crown fetching card data first when it lacks it; the cap; holds. **Spill**: the UI's laid-out batch passes (a batch that removes a stand may move its cards off); a bare `mat spill` is laid out by the crown (`spillStands` in outbox.ts does either). **Shuffles of hidden cards** (S S, a shuffled hand landed by layout) are re-keyed by the crown as a remove and an add in a random order, which the server redacts. **Reveal and forget** set identities through `store.setIdentities` (the hidden gate redraws them), and every card that comes from the room has its card data fetched (cache, then Scryfall through the queue): this also fixes Phase O1, where a joiner's cards never got their data. **Undo** online goes out with the seq last seen of everything it touches; the crown refuses it ("Someone else has moved those since") if anything moved since. tests/authority.test.ts: 18 tests over ranks, Lock, holds, stands, one stand, spills, the cap, undo and re-keying. **Where to look:** B at Move: dragging works, the Spawn panel's adds are refused by the crown even if forced; Lock in A: B's drag is refused "The table is locked"; B's stand: A cannot take its cards ("Only Sam can touch that stand"); B flips a card face up: A gets it (reveal); B puts a face-down pile through S S: nobody can follow a card by uid; Spill in A: B's stand's cards drop face down in front; B moves a card, A moves it again, B presses Ctrl + Z: "Someone else has moved those since". **Untested:** all of it in two browsers (the gate's check): the judge is tested in vitest against a real store and room state; the other forks' edits kept the dev page reloading or failing to load during this session. **Decisions:** O103. **BROKEN:** none.

- Sync, 2026-10-30: **Phase O1 sync** (`shared/apply.ts`; `src/online/session.ts`, `outbox.ts`, `inbox.ts`, `authority.ts`, `streams.ts`, `presence.ts`, `connect.ts`; `src/state/store.ts`, `history.ts`, `remoteHeld.ts`; `feel.ts`, `dice.ts`, `world.ts`, `picking.ts`, `pileSync.ts`, `standSnap.ts`, the glow attribute in `render/cards.ts` and `render/dice.ts`; `undo.ts`, `saveFile.ts`'s replace; `__room()`, `__roomState()`; main.ts's Sync block): **the store is the choke point** (11.1): every mutation tells `onLocalChange` its op and inverse while `origin` is local, with `setNamed`, `setSpreads`, `renameCards`, `setMatOwner`, `table()` and `replaceTable`; every direct write of cards, named piles and spreads (land's stand and side, spreads, promote, joins and rejections, the pick-up turn, undo's restore, loadDoc) goes through it; **`applyOp`** is its pure twin, proven equal on every op kind, and every inverse undoes its op (tests/apply.test.ts, 43 tests). **WsSession**: the version check, hello (with the side you are on now), reconnect at 1, 2, 4, 8 then 10 s, a 25 s ping, close codes 4000/4001 final. **Outbox**: one op per action (a `batch` for several writes), pending until confirmed, a refusal rolls back all but what someone else touched since, a confirmed op of mine overtaken by someone else's is applied again (tests/outbox.test.ts, 10 tests). **Inbox**: seq order, a gap asks for a snapshot, the snapshot's seq (part 0), remote changes drawn as landings (a held card eases in over 120 ms), reuid'd cards redrawn. **Authority** (the crown, in the socket handler): holds (first grab wins, additive), the 5,000-card cap, undo's precondition, snapshots on needSnapshot, every 30 s and every 50 ops, a departed holder's cards dropped where last seen after 3 s, the crown's own ops confirmed on the spot. **Streams** at 10 Hz (cursor, side, selection at 2 Hz, held and flying poses); **presence**: remote cursors with name tags on the felt (clamped to the edge), other players' held and tossed cards and dice drawn 100 ms behind their stream, their selections and holds glowing in their colour (a per-instance glow colour on cards, a tinted outline on dice), remote-held uids skipped by picking, the marquee and pile detection. Holds asked for when a drag or a dice carry begins (feel.ts, dice.ts), released on Esc; a refused hold drops them back with "That card is in Sam's hand". The physics reports what it has in flight. A joiner's autosave stays paused and its own table comes back on Leave. **Where to look:** tab A: Go online; tab B (`?player=B`): join: the table appears; drag a card in A: B sees it float in A's colour and land; toss one: B sees the flight; both grab one card: the second gets "That card is in …'s hand"; move the mouse in A: B sees A's arrow and tag; select ten in B: they glow in B's colour in A; close tab A: B is crown and plays on; reopen A's link: the crown comes back; Leave in B: B's own table returns. **Tested live** (two tabs, local server, 2026-10-30 21:20): Go online, the server asking for and taking the maker's table, a joiner receiving it, the maker's reclaim with the table intact, and (a raw second session against the full crown client) a proposed move judged, applied and echoed, a remote cursor appearing, a grab marking the card held by the other player and the holder's landing freeing it at its new spot. **Untested:** the drawn side of remote holds and flights, glow colours, the feel of the 100 ms buffer and the 120 ms ease, refusal rollback and grab refusal in the browser, a gap and needSnapshot, the 3 s drop of a departed holder's cards: the other forks' edits reloaded both tabs every 10 to 30 s and, at the end, a half-written main.ts (another area's) kept the page from loading. **Decisions:** O100. **BROKEN:** none.

#### Rules & UI

- Rules & UI, 2026-10-30: **Phase O4 polish** (`src/ui/helpPanel.ts`, `standTab.ts`, `onlinePanel.ts`, `tableBrowser.ts`, `joinPrompt.ts`, `src/online/link.ts`): the help panel's **Online** group (🌐 Go online, 👑 Crown, 🪪 Ranks, 🂠 Hidden, M) per 13; **gate O2's finding fixed**: Spawn stand now greys with "You already have a hand stand" the moment you own a hand stand (it only updated from the frame loop, which the browser pauses in a hidden or background tab; it now follows every mats change and checks once a second); the **Quota page** ("The room server is over its free daily limit. Rooms are back after midnight UTC.") for a 429 `{error:'quota'}` from any call (Go online, Tables, Report, joining) and for `bye quota`, any 429 from `/api/version` counting as the spent day; **"This room is open in another tab"** with Use it here and Back to my table when the socket closes with no goodbye (close code 4001, the same identity in another tab); switching visibility away from Public + password **removes the password**; the join prompt and the Go online form refuse a **blocked name** inline ("That name is not allowed", the Server fork's `isBlocked`); the panel no longer rebuilds under a field you are typing in. The design_spec.md / CLAUDE.md text went to the hub as text. **Where to look:** own a hand stand: Spawn stand is greyed with the reason; open the room link in a second tab as the same player: the first shows "This room is open in another tab"; Public + password then Public: the lock goes from the Tables row; a blocked word as nickname: the prompt says so. **Untested:** the Quota page against a real spent day (built to the Server fork's 429 shape); the other-tab page live. **Spill's chat line:** in, by the Sync fork's d3c6c34 (agreed by message): `Mats.spill` keeps its guard check and confirm, then calls `spillStands`, which lays the cards out face down in front and sends `mat {spill}`, so the server writes "Ann spilled Bea's stand". **Decisions:** none new. **BROKEN:** none.
- Rules & UI, 2026-10-30: **Phase O3 browser and admin** (`src/ui/tableBrowser.ts` + `tests/tableBrowser.test.ts`, `src/ui/adminPage.ts`, `src/online/link.ts`, `onlinePanel.ts`, main.ts's boot): **the public browser**: Public and Public + password rooms from `GET /api/rooms`, refreshed every 10 s while open and by Refresh, All · Cube · Play chips; each row: name, 🔒, "hosted by", card count, "up 2 h", the tag, 3/8 or Full, Join (the join prompt asks the password), ⋯ Report (confirmed; "Reported. Thank you."); empty: "No public tables right now…"; a box for an unlisted room's link or code. Opened by 🗂 Tables in the Online panel (offline too, beside Go online) and by the welcome note's Join a table. **Settings** (O2) already send visibility and the password; Copy invite link carries the password the crown typed, or the one a joiner came with. **`#/admin`** asks for the admin key once per session, lists every room (code, name, crown, cards, tag, locked, players, visibility, reports, delisted, age) with Delist / Relist and Close (confirmed), Forget key, Back to the table. The server's 429 now tells its rate limits from the spent day (O101). **Where to look:** A: Online panel, Visibility Public, Tag Play: a third tab's 🗂 Tables shows the row (Play, 1/8, hosted by A, the card count, "up just now"); Public + password with a password: the row shows 🔒 and Join asks for it (a wrong one says "Wrong password"); 🔑 Copy invite link in A, pasted in a fresh tab, joins without asking; Unlisted: the row goes within a minute; `#/admin` with the key (`dev-admin-key` locally) lists the room; Close ends it for everyone. **Tested live** (one tab, local server): going online, setting Public, the row appearing in the browser with its host, cards, tag and players; the admin page reading the room list with the key. **Untested:** the password join, the invite link and Report in a second tab (other forks' saves kept reloading the pages); a blocklisted room name in the list (the Server fork's filter). **Decisions:** none new. **BROKEN:** none.
- Rules & UI, 2026-10-30: **Phase O2 rules and hiding** (`shared/permissions.ts` + `tests/permissions.test.ts`; `src/online/guard.ts`, `hidden.ts` + `tests/hidden.test.ts`; `playerRows.ts`, `onlinePanel.ts` Settings; `mats.ts` ownership, `standTab.ts`; the hidden gate in `cardImages.ts`, `hires.ts`, `inspectPanel.ts`, `hud.ts`, `selection.ts`, `exportPanel.ts`, `tray.ts`, `tokenMenu.ts`, `clipboard.ts`, `commands.ts` C / C C / E, `saveFile.ts`; small hooks in `store.ts` (`canSee`, `recordOf`), `keyboard.ts` (`guard`), `spawn.ts`, `lifeCounter.ts`, `stand.ts` (`isFullStand`, `ownerOf`, `fullStandsOf` + tests)): **permissions** tested row by row against 6.2, with Lock table, Downloads, the crown and `refusal()` giving the 12.4 wording; tokens and basic lands are Tokens rank to add and remove (`addAction`/`removeAction`, shared with the judge). **The guard**: keys that change the table, the start of card, pile, die and mat drags (a click still selects), middle-click flips, double-click turns, the die wheel, life totals, naming piles, every spawn (and the 5,000 cap) refuse with a toast: "Move or higher needed", "Cards or higher needed", "The table is locked", "Only Sam can touch that stand", "You already have a hand stand", "Reconnecting… the table is read-only for now"; the HUD's commands, New/Open and the Spawn panel's spawns are greyed with the reason as their title; Downloads off hides Save, Save a copy and Export. **The crown's controls**: Settings (visibility with the password field, tag, newcomers, Lock table, Downloads; read-only for others), a rank picker on each player's row, and ⋯ Pass crown (confirm), Kick, Ban (confirm), Give stand to…; Copy invite link; "The table is locked / unlocked" toasts. **Stands**: owned by their spawner, the plate their nickname by default; only the owner moves, turns, locks, renames or removes one; a 👤 on the lip offers Claim, Release, Give to…, Spill (face down, in front; Delete on another's stand spills too); one full stand each, offline too (O32); going online the crown takes the nearest full stand and every small one (O65); stands from a file are unowned. **Hiding**: cards another player's stand holds, unowned stands' cards and every face-down card off your stand draw as backs on both faces with no foil (close-ups and Cast too), Inspect says "Hidden card", searches skip them ("n hidden cards not searched"), exports, Ctrl + C and T T skip them ("n hidden cards not exported"), the tray lists "Hidden card", C / C C / E put them face down in a row after the sorted cards; a non-crown Save a copy writes them as `hidden` and loading one keeps them backs. **Where to look:** A crown, B joins as Move: B's Spawn buttons are greyed with "Cards or higher needed", Delete and D toast; A picks Cards in B's row: B spawns; B spawns a stand (plate reads B), deals five onto it: A sees five backs from any angle and Inspect says "Hidden card"; A can't drag them ("Only B can touch that stand"); B's Spawn stand is disabled ("You already have a hand stand"); B flips a card face down: a back for everyone; Lock table in A: B's drag says "The table is locked"; B leaves: A's 👤 on B's stand has Spill; Save a copy from B lists A's stand cards as `hidden`; Downloads off: B's Save and Export go; Kick and Ban from A's ⋯. **Untested:** the two-tab walk: the other forks' saves reloaded both tabs every few seconds (vite reloads every page on any change), which also ends a room of one (O61); everything was checked by typecheck and the unit tests (388), and O1's flows on FakeSession. Spill's chat line "Sam spilled Pat's stand" is not built (a system line needs the server). **Decisions:** O102. **BROKEN:** none.
- Rules & UI, 2026-10-30: **Phase O1 UI** (`src/ui/onlinePanel.ts`, `joinPrompt.ts`, `chatStrip.ts`, `playerRows.ts`, `roomStates.ts`, `desktopOnly.ts`, `src/online/link.ts`, `topBar.ts`, `app.css`, main.ts's Rules & UI block): the top bar's 🌐 Go online / Online button (disabled with "No room server" when `VITE_ROOM_SERVER` is unset or `/api/version` fails), the avatar row (👑 on the crown, greyed when away, yours outlined, 🔒 while locked, "Reconnecting…" in amber); the floating Online panel (380 px, docked right, dragged by its header, ✕ or Esc) with its offline short form (room name, your nickname and colour, Tag, Go online) and online sections Room (name · code, Copy link, Save a copy when allowed, Go offline for the crown with its confirm, Leave for others), Players (swatch, your swatch's free-colour popover, side arrow, rank label, 👑, away) and Chat (last 100 lines, names in colour, system lines grey, Enter sends, 300 characters); joining by link (`#/room/CODE?key=`): the desktop-only page, the version check, closed / full / unreachable pages, the join prompt with taken colours greyed by initial and the password when needed, a wrong password reopening it; the closed (with Save a copy), kicked, banned, reload-to-update and quota pages from `bye`; join, leave, back and crown toasts (one per message per 2 s); the "Joining: n of m cards" line under the top bar; the table name read-only online for everyone but the crown (whose renames also rename the room); the first-visit welcome note with Join a table (paste a link or code). The room layer is reached through `RoomControl` (`connect`/`disconnect`), a FakeSession stand-in until the Sync fork's `connectRoom` lands. **Where to look:** tab A: 🌐 Go online, fill your nickname, Go online: the panel shows the code, Copy link, Go offline; the avatar has a 👑; tab B (`?player=B` before the `#`, the copied link): the join prompt names the room and its host, A's colour greyed with its initial; Join; chat both ways; Go offline in A: B sees "The room has closed." with Save a copy and Back to my table; a link to a dead room: "This room has closed". **Untested:** everything against the real server and session (built and checked on FakeSession with `?fakeroom`: go online, chat, the join prompt on reload, Not now restoring the own table, the closed page and Back); the phone page on a real phone. **Decisions:** O96. **BROKEN:** none.

### Your QA checklist

Run `npm run dev` (or `start.bat`). Tab A at `http://localhost:5173/`; tab B at `http://localhost:5173/?player=B#/room/CODE` (the `?player=B` keeps the two tabs two players in one browser, dev only). Two windows side by side show both at once, which the built-in browser could not.

**Phase O1, rooms by link**
- [ ] Tab A: a table with cards, 🌐 **Go online**: the panel shows a code and **Copy link**; the top bar shows your avatar with 👑.
- [ ] Tab B: open the link: the join prompt, pick a colour, Join: the same cards appear, the camera at the default view; A's avatar row shows two players.
- [ ] Drag a card in A: B sees it float in A's colour and land where A put it. Toss one: B sees the flight. Both drag the same card at once: the second gets "That card is in …'s hand".
- [ ] Move the mouse in A: B sees A's arrow and name tag on the felt where A points, following the camera; it stays when A's mouse rests.
- [ ] Select ten cards in B: A sees them glow in B's colour; A's own selection stays blue.
- [ ] Chat both ways; a grey line for the join.
- [ ] Close tab A: B gets "You are the crown now" within a second and can keep playing. Reopen the link in a new tab from A's browser: the crown comes back to A ("… took the crown back"); B keeps its rank.
- [ ] Press **Go offline** in A: B sees the Room closed screen with Save a copy; A's table is unchanged offline.
- [ ] Close every tab: the link now shows "This room has closed".
- [ ] **Only you can judge:** how live drags and tosses *feel* from the other side (the 100 ms buffer, the 120 ms landing ease), real latency between two machines, and the cursor and glow colours on the felt.

**Phase O2, permissions and hidden information**
- [ ] A is crown, B joins as Move (the default): B can drag cards but the Spawn panel's buttons are greyed with "Cards or higher needed"; A sets B to Cards in the row: B spawns a decklist and A sees it arrive.
- [ ] B spawns a stand: the plate reads B's nickname; B deals five cards onto it: A sees five backs on B's stand from any camera angle (try M), with the count badge; A's hover shows nothing on them; A cannot pick them off ("Only … can touch that stand"). B's second Card stand is refused ("You already have a hand stand").
- [ ] B flips one of those cards face down on the table: everyone sees a back, B included; B shuffles the face-down pile (S S): nobody can tell which is which afterwards.
- [ ] B puts a card face up on the table: A sees the face at once.
- [ ] Lock table in A: B's drag gets "The table is locked"; unlock: B's rank is back.
- [ ] B leaves with cards on the stand: A sees the stand wait, backs showing; the 👤 on its lip has **Spill**: the cards drop face down in front and the stand goes.
- [ ] Save a copy from B (Downloads on): the file lists A's stand cards as `hidden`; open it offline: backs that never resolve.
- [ ] Downloads off in A: B's Save a copy and Export panel vanish.
- [ ] Kick B: B sees the kicked screen and can rejoin; Ban B: B cannot.
- [ ] The 📺 Cast window in a room draws backs for what that browser may not see (not opened in the gate: it is a popup).

### Performance

(the `__bots(7)` pass against spec Section 17, Phase O4)

---

# Overnight build (2026-10-27)

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
- [ ] **Rooms run ready** (ONLINE_PROMPT.md, decisions O77 to O92): your pre-run checklist is at its top (Cloudflare account, `npx wrangler@latest login`, Opus 5.5, keep awake); the hub prompt is below the line; the three fork briefs are its Section 7.
- [ ] **ONLINE.md** (decision 288): the rooms design, 1 to 8 players on one table. Read it through; Appendix A holds today's 64 answers as O1 to O64 and the agent's fill-ins O65 to O76. Nothing is built yet.
- [ ] **Ctrl + click mixes cards and dice** (decision 286): click a card, Ctrl + click a die, Ctrl + click another card: all three selected; drag one: they move together. A plain click on a card drops the dice.
- [ ] **Sharp plates and dice in High** (decision 287): High graphics, look at a stand's plate and dice at a low angle: as crisp as the cards.
- [ ] **Scry plate** (decision 285): Small stand: its plate reads Scry, even with a name typed in the field. Its pencil: a short-word box that stops at 10 letters; type Surveil: the plate says Surveil.
- [ ] **Ctrl off a stand turns face down** (decision 284): deal 3 onto a stand, then drag one off holding Ctrl: as it leaves the slope it turns face down in your hand. Without Ctrl it stays face up.
- [ ] **Small stand** (decisions 282, 283): Playmat tab, Card stand: Small stand. It is a quarter as wide with a shorter plate. Drop cards on it, H, H H, X, deal 1-9 onto it, put it over a stack: all as on the big one, sized to it.
- [ ] **d20 numbers from closer** (decision 280): a d6 and a d20 side by side; zoom out slowly: the d20's number appears about 2-3 notches before the d6's (decision 281).
- [ ] **d20 upright, bigger, any number** (decision 279): D D: the d20 is bigger than a six-sided die and reads the right way up. Roll it: it lands, then turns upright. Over it press 0, type 1234: the top face shows 1,234. Wheel up from 20: 21. Roll it: back to 1-20. In mirror mode, move a d20: it reads upright from that side.
- [ ] **d20 and dice colours** (decision 278): D D: a dark d20 showing 20 replaces the die. R rolls it; it tumbles and lands on a number. Over it: 1-9 set the number, 0 opens a box (type 17), the wheel steps it (Shift for 5). C over any die: a colour menu; pick one. A dark die's pips are white. Shift + wheel on a life badge counts 5 at a time.
- [ ] **Z on dice** (decision 277): click a die and press Z: it zooms in as close as on one card. Select two dice far apart: Z fits both.
- [ ] **Z again goes back** (decision 276): from a wide view, select a card and press Z: it frames the card; Z again: the camera swings back to the wide view. Z, then scroll a little, then Z: it frames again instead.
- [ ] **Turning to face you, animated** (decision 275): in mirror mode, pick up a card laid from the near side: it swings round clockwise in the hand instead of snapping. Alt-drag a few such cards: they keep their angles and don't turn. Drag two dice from the other side: they swing round too.
- [ ] **Dice and cards together** (decision 274): box-select a few cards and two dice. Drag a card: the cards gather and the dice ride beside them; let go: the dice land once the cards have. Drag a die instead: the same, the dice under the cursor. Put a die on a card, select both, Alt-drag: the die stays on the card and lands on it.
- [ ] **Life totals back to back** (decision 273): two playmats, the far one turned (spawned in mirror mode, or turned half round with R): both life totals on the same side, each beside its own mat by the gap. Hover the turned mat's top corners: ❤️ is by its total, 📺 on the other side.
- [ ] **Small hand on a stand, H H** (decision 272): put 7 cards on a stand's slope and press H: one arc the slope's width; press H H: a normal-size hand in the middle of the slope. Try 15 cards: still on the slope, a slightly flatter arch.
- [ ] **Face-down draws** (decision 271): hover a pile, press Shift + 3, click the table: three cards land face down in a messy pile. Shift + 0: the dialog opens with Face down? ticked.
- [ ] **Stacks dropped in mirror mode** (decision 269): in mirror mode, select several cards, drag them onto the table and onto a stand you spawned from that side: the stack lands the right way up both times.
- [ ] **Upright in mirror mode** (decision 268): in mirror mode, R R on a turned card stands it upright facing you; double-click a tapped card: it untaps facing you.
- [ ] **Mirror mode** (decision 267): press M: the camera swings round to the far side, the top bar's Mirror (M) lights. Pick up a card that was laid out from the near side: it turns to face you; drop it. Press C on a pile: the curve reads right from this side. Spawn cards, a die, a playmat, a stand: all face you. Press M again: back; pick that card up: it turns back. 📺's tooltip now says Cast.
- [ ] **Dice numbers** (decisions 265, 266): hover a die: its number floats above it. Zoom far out (one notch further than at first): every die shows its number. Roll: the new number shows once it lands.
- [ ] **A card's tokens, T T** (decision 264): hover a token maker (Krenko, Smothering Tithe) and press T T: a menu lists its tokens; click one a few times: they spawn beside the card. A card that makes none says so. Esc closes it.
- [ ] **Tokens** (decision 263): Card tab, Tokens: type `treasure`: a list of Treasure printings with thumbnails; set 3, click one: three spawn. Type `goblin 1/1`: only 1/1 Goblins. List tab: `3 Treasure` and `2 Goblin Token` spawn tokens. Query tab: `t:token c:w` finds white tokens.
- [ ] **Tidy dice** (decision 262): drag a die holding Ctrl: it rides perfectly level and square; let go: it lands square to the table. Turn on Tidy mode and roll: they land squared.
- [ ] **Loose dice in the hand** (decision 261): drag a die around: it leans into the motion, lifts a bit when fast, and bobs and wobbles slightly; held still it settles level.
- [ ] **Dice cursors** (decision 260): hover a die: the open hand; drag it (or several): the fist.
- [ ] **Livelier rolls** (decision 259): R on a die: it goes higher, tumbles and bounces longer, and skitters a bit before settling.
- [ ] **Bigger pips** (decision 258): dice pips are bigger and easy to read zoomed out, none touching the rounded edges.
- [ ] **Shake to roll** (decision 257): pick up a die (or several) and flick, as you would to toss cards: they fly the way you flicked, tumble and land on random faces.
- [ ] **Dice gather** (decision 256): select scattered dice, drag one: they all glide in under the cursor into a tight block and land together. With Alt: they keep their spread.
- [ ] **Dice** (decision 255): press D: a white cartoon die drops at the cursor showing 1 (on a card if you're over one). Hover it, press R: it flicks up and tumbles, landing on a random face. Press D a few times, marquee them (blue outlines), R: they tumble together, bumping. Hover one, press 4: it shows 4. Drag one onto a stack: it sits on top. Delete: gone. Ctrl + Z: back. Save and reload: dice stay.
- [ ] **Hover before selection** (decision 254): select a few cards, hover a different, unselected stack, press S (or X, T, H, F, R, C, E, P): it acts on the hovered stack and the selection clears. Hover a selected card and press S: it acts on the selection. Delete still only removes the selection.
- [ ] **Cards in hand** (decisions 250 to 253): hover a stand: close in the slope's top-left corner (outside it when a card lies in that corner), a red number with a thick black outline (no bubble) counts its cards, "in hand" under the number; deal a card onto it: the count goes up; move off the stand: it goes.
- [ ] **Dealing onto a slope makes a hand** (decision 249): put a stack on a stand, pick up some cards, hover the slope and right-click (or Space) a few times: each dealt card re-fans everything on the slope into one hand, the new card on the right. Same with 1-9 clicked on the slope, whatever is there.
- [ ] **Number keys draw from the hovered stack** (decision 247): select some cards, hover a different, unselected stack, press 3: the selection clears and 3 come from the hovered stack. Hover a selected card and press 3: they come from the selection.
- [ ] **Double-click taps and untaps** (decisions 245, 246, 248): double-click a lone card: a quarter turn; again: back to 0 degrees. Double-click a stack: every card in it taps, and untaps next time. Select several cards, double-click one of them: they all tap, and stay selected. Double-click no longer spreads (X does). Double-click a pile: it still spreads.
- [ ] **Middle-click 20 to 40** (decision 244): middle-click a life badge showing 20: 40; again: 20.
- [ ] **Corner buttons fade in** (decision 243): hover a mat's middle: no buttons. Move toward a corner: its button fades in and grows, fully there close up; move away: it fades.
- [ ] **❤️ life toggle** (decision 241): hover a playmat: ❤️ in its top-left corner; click: the life badge hides and it shows 🤍; click again: the badge is back with the same life. Save and reload: stays as set.
- [ ] **Life counter** (decisions 239, 240): every playmat shows a white cartoon 20 badge just off its top-left corner, never over the mat's cards (orbit, tilt and turn the mat to check; the +n bubble stays on the far side). Click: 21, a green pop and a +1 bubble; click quickly a few times: the bubble adds up, then fades. Right-click and the wheel go down (red); Shift: by 5; hold a button: it keeps counting. Down to 5: the number stays red; 0: a skull. Ctrl + click: type 40. Middle-click: back to 20. Zoom out and in: it scales with the mat; drag or turn the mat: it follows. Save, reload: the life stays.
- [ ] **Mat buttons in corners** (decisions 238, 242): hover a playmat: the buttons sit close in their corners (15 mm in); 📺 top right, 🔄 bottom right, 🔒 bottom left; lock it: nothing moves. Turn the mat with R: they follow its corners. A stand: 🔒 left and ✏️ right on its lip.
- [ ] **Untap** (decision 237): tap a few cards on a playmat (R), hover the mat, click 🔄: they all turn back upright. Works on a locked mat too; a stand has no 🔄.
- [ ] **0 face down** (decision 236): over a big pile press 0, enter 45, tick Face down?, Draw, click the table: three face-down messy piles of 15 side by side, close together. Press 0 again: the box is still ticked. Untick: a face-up hand as before.
- [ ] **Stand in the Playmat tab** (decision 235): the Spawn panel's tabs all fit (no Stand tab); the Playmat tab ends with a Card stand section that spawns one.
- [ ] **Hide control hints** (decision 234): open ?, tick Hide control hints: the hint line along the bottom goes; reload: still hidden; untick: back.
- [ ] **Double-click selects a mat's cards** (decision 233): double-click a stand where no card is: all its cards are selected. Same on a playmat (its cards and their whole piles), and on a locked one.
- [ ] **Stand outline** (decisions 230 to 232): the line also runs round its foot, where it meets the table (and over a playmat); a stand's edges (lip, slope foot, ridge, back, ends) show a bold 5 px black cartoon line, the same width zoomed in or out, steady as you orbit; High and Low graphics alike.
- [ ] **New stand wood** (decision 229): spawn a stand: dark, realistic cherry grain running across it, no seams, no stretching on the sides or the back. Zoom far out: no shimmer. Switch Graphics to Low and back: it stays wood (Low uses the smaller texture).
- [ ] **X onto a slope, face up** (decision 227): take a face-down pile, press X, click a stand's slope (or drag a box there): every card lands face up. X on the table keeps faces as they are.
- [ ] **P switches modes, like X** (decisions 226, 228): select some face-up cards, press P: the plain glove. P again: the glove shows 📦; P again: plain. With 📦 showing, click the table: they land as one face-down stack. The 👆 (P) button does the same. Esc cancels.
- [ ] **C and E off a stand** (decision 225): select the cards on a stand and press C, then C C, then E, then E E: each time the layout sits on the table directly below the stand, centred, nothing behind or under it.
- [ ] **Drawing into a slope's hand** (decision 224): over a pile press 1, click an empty slope: one card in the middle. Press 1 and click the slope again, a few times: each draw joins the hand, which re-fans across the slope's width with the new card on the right. Press 3 and click: three join at once. Move one card of the hand, then draw again: the new cards make their own hand.
- [ ] **Hover pop on a stand** (decision 223): fan 7 cards on a stand (H), hover each one: every card, the middle one too, pops up clear of the cards over it.
- [ ] **Stand refinements** (decision 222): put 3, 7 and 15 cards on a stand and press H: each time one arc exactly the slope's width. Press 7 over a pile, click the slope: the same. X then click the slope: the cards fill the slope; X then drag a box on the slope: a magenta or blue preview on the slope, and they land inside it. Alt + drag a big curve onto the slope: it lands on the table in front of the stand, centred. Drag a stand onto a stack: the stack comes up on top of the slope. Nothing should ever be hidden under a stand.
- [ ] **Stand as a tilted table** (decision 221): drag a card over a stand: it swings to the slope and slides along it under the cursor; let go: it snaps flat onto it. Drag it off: it swings flat again. Drop several and press S, H, T, or X then click the slope: they lay out on the slope, nothing clipping. Drop a card at the very edge: it is pulled fully onto the slope. Drag or R the stand: its cards come along. Delete the stand: its cards drop to the table. C on stand cards: the curve goes to the middle of the view.
- [ ] **Card stand** (decision 220): Spawn panel, Playmat tab, Card stand section, type a name, Spawn stand: a cherry wedge appears mid-view. Drop a card on its slope: it lies at 25 degrees facing you. Fan a hand (H) and drag it on: it stays a fan, tilted. Orbit round to the back (or V for another angle): the black-and-gold plate shows the name, right way up. Hover the stand: 🔓 and ✏️ on its front lip; ✏️ changes the name. Drag the stand away: its cards drop to the table; Alt + drag: they ride along. R turns it, Delete removes it, Ctrl + Z undoes a move, Save and load keep it. A messy drop onto it lands on the slope.
- [ ] **No snap-back mid-fall** (decision 219): spawn or paste a messy pile and press C at once, while the cards are still falling: they curve out and stay. Same with S, X and E right after a spawn, and grabbing a card while it falls.
- [ ] **Moved curves keep their order** (decision 218): curve a cube (C), select it all, Alt + drag it and let go while still moving, several times: the last card of each column stays on top, nothing pokes through.
- [ ] **Color view, C C** (decision 217): over a cube pile press C C: columns W, U, B, R, G, colourless, multicolour, lands, cheapest at the top of each. C on it: it stacks back up. Select some cards and click 🎨 (C C) Color: the same. Turn 🐉 Split on: creatures in a band above. Shift + C still makes the colour-row curve.
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
