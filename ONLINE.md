# Rooms: the 3D Card Manipulator online

**Design document for the online refactor.** Up to eight players share one table in a *room*, the way MIRO shares a board: for working on a cube together, and for simulated live play. A table is offline by default and goes online in one click. Rooms are shared by link; there is also a public table browser with public and password-protected rooms. A rank ladder says what each player may do, and the room's owner wears a crown that can be passed.

This document is self-contained: a builder with `design_spec.md` and this file can add the feature without asking. Everything the owner decided on 2026-10-30 is in Appendix A as decisions **O1** onward; the rest is marked **(agent)** with its reasoning.

---

## 0. How to use this document

- **`design_spec.md` still wins** for everything that is not about rooms. This document changes nothing about how cards move, stack, flip or look. Where it adds to a spec section, it says which one.
- **Decisions.** Rooms decisions are numbered **O1, O2, ...** in Appendix A of this file. `design_spec.md` Appendix A has one pointer row, decision 288. New rooms decisions during the build get the next O number, dated, and are marked **(agent)** when made without the owner.
- **Build mode.** The four phases (Section 16) are built in autonomous overnight mode under spec Section 0.1, with these changes: the room server may be run locally (`wrangler dev`) and talked to from the browser; the phase gate's browser check uses **two tabs** in the built-in browser, one hosting and one joining; the run deploys the Worker after each gate with the owner's `wrangler login` (O80) but never pushes (decision 203: the owner pushes). The run is one hub session and three area forks sharing this folder: **`ONLINE_PROMPT.md`** (decisions O82 to O92).
- **Rules that carry over.** Scryfall only through the queue in `src/scryfall/client.ts` (every browser resolves its own cards, O42). Keep TypeScript simple. Pure logic gets vitest tests. Commits use the owner's email. Chrome and Edge, desktop, only (O53).
- **Vocabulary.** "The crown" is the room's owner (a player). "The server" is the Cloudflare Worker and its Durable Objects. "A browser" is one connected player's page. "The table" is the shared state: cards, piles, spreads, mats, stands, dice, basics, name.

---

## 1. Overview

### 1.1 Purpose

Two jobs, one room type:

1. **Cube work together.** A few people sort, cut and argue over a cube on one table, each with their own cursor, like a shared whiteboard. Everyone sees every card.
2. **Simulated live play.** Two to eight players play Magic on the table with the pieces the app already has: playmats with life totals, card stands as hands, dice, tokens. It must feel like a real table (decision in memory: physical, no automation): no rules engine, no turn structure, no automatic anything. Hidden information is real: the cards on your stand and every face-down card are hidden from everyone who should not see them.

### 1.2 Goals

- One click from an offline table to a room with a link; one click back.
- 1 to 8 players. A room of one is fine (a stream, a solo session with the link ready).
- Every player sees the same table within a fraction of a second; drags, tosses and dice rolls are watched live, not teleported.
- A rank ladder, set by the crown, from View only to Everything; the crown above it.
- Hidden information that holds for honest clients, and cannot be read by anyone but the crown even with a tampered page (Section 7).
- Free to run (O1, O4): Cloudflare's free plan, one account, no card on file.
- The offline app is unchanged in feel and in code paths; a room adds a layer, it does not rewrite the store.

### 1.3 Non-goals (this refactor)

- Accounts, sign-in, profiles, friends lists (O17: a nickname remembered per browser).
- Voice. Players use Discord. Text chat is small (O35).
- Spectators beyond eight, phones and tablets (O16, O53), follow-camera or summon (O34), a ping gesture.
- Cheat-proofing against the crown: the crown's browser holds the whole table (O2, O28).
- A rules engine, turn tracker, counters, automatic life: nothing the owner's "physical, no automation" rule excludes.
- WebRTC. Everything travels over one WebSocket per player (O45); the stream layer is written so it could move later (Section 8.3).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Room** | One shared table and the players in it, addressed by a six-character code. Exists only while someone is in it (O61). |
| **Maker** | The browser that created the room by going online. The maker always gets the crown back on return (O6). |
| **Crown** | The player whose browser is the authority for the table (O2) and who owns the room: ranks, kicks, settings, closing. Exactly one at a time. |
| **Rank** | One of View, Move, Tokens, Cards, Everything (O21), per player, set by the crown. The crown has no rank; it may do anything. |
| **Player** | A connected browser with a nickname, a colour and a rank. Up to eight. |
| **Identity** | A random secret token stored in the browser, with the nickname and colour; its hash is the player id the room knows (O17). |
| **Side** | Near or far, as mirror mode has them (decision 267). Online, M crosses the table (O36). |
| **Op** | One change to the table, in the shape of Section 8.2, proposed by a player and confirmed by the crown. |
| **Stream** | Ten-times-a-second position data that is not table state: cursors, cards and dice in hands, flying objects. Relayed, never stored. |
| **Snapshot** | The whole table in one message (in parts), for a joiner, a reconnect or a crown handover. |
| **Mirror** | The server's own copy of the full table, kept from the crown's confirmed ops and snapshots, so joiners and handovers do not depend on the crown's browser. |
| **Redaction** | Stripping a card's identity from a message to a player who may not know it (Section 7). |
| **Hold** | A grab the crown has granted: the cards or dice are in that player's hand until they land. |
| **Lobby** | The server object that keeps the public room list for the table browser. |

---

## 3. Architecture

### 3.1 Summary

```
  browser A (crown)       browser B            browser C ...  (up to 8)
  ┌────────────────┐     ┌────────────────┐    ┌────────────────┐
  │ store (truth)  │     │ store (copy)   │    │ store (copy)   │
  │ authority.ts   │     │ optimistic ops │    │ optimistic ops │
  │ online/*       │     │ online/*       │    │ online/*       │
  └───────┬────────┘     └───────┬────────┘    └───────┬────────┘
          │ WebSocket            │ WebSocket           │
          └──────────────┬───────┴─────────────────────┘
                         ▼
          ┌─────────────────────────────────────────┐
          │ Room Durable Object  (one per room)     │
          │  room meta: players, ranks, crown, bans,│
          │   visibility, password hash, tag, lock  │
          │  mirror of the full table + op log      │
          │  relays ops → crown, confirms → all     │
          │  redacts per player, fans out streams   │
          └───────────────┬─────────────────────────┘
                          │ heartbeat (name, players, tag, lock)
          ┌───────────────▼─────────────────────────┐
          │ Lobby Durable Object (one)              │
          │  public list, reports, rate limits      │
          └─────────────────────────────────────────┘
          Worker: HTTP routes (/api/...), WebSocket upgrades, admin key
```

- **The crown's browser is the authority for the table** (O2). Every change any player makes is an *op* sent to the crown, who checks it (rank, lock, holds, stand ownership) and confirms or refuses it. Confirmed ops are stamped with a sequence number by the server and sent to everyone.
- **The server mirrors the full table** (O28) by applying confirmed ops and taking a full snapshot from the crown every 30 seconds, so a joiner gets the table from the server, and when the crown drops the new crown gets a complete table. The server also redacts: each player receives only the card identities they may know (Section 7).
- **The server owns the room**, not the table: who is in it, their ranks, who is crown, bans, visibility, password, tag, Lock table, Downloads, the chat log. These survive any crown handover without the crown's help.
- **Streams bypass the crown.** Cursors, held cards and flying objects go player → server → everyone else, ten times a second, batched (O45). They carry uids and poses, never identities.
- **Physics is the acting player's** (O3): the browser that tosses a card or rolls a die runs Rapier for it and streams the poses; the landing pose and the die's value are what it reports in the op that follows. Everyone else animates.

### 3.2 Technology

| Concern | Choice | Notes |
|---|---|---|
| Server runtime | **Cloudflare Workers + Durable Objects** (SQLite-backed), free plan (O1, O4) | One Durable Object class `Room`, one `Lobby`. WebSocket Hibernation API so idle rooms cost nothing. |
| Tooling | **wrangler** (dev dependency) | `wrangler dev` locally, `wrangler deploy` from GitHub Actions. Added under decision 35. |
| Dev runner | **concurrently** (dev dependency) | `npm run dev` runs Vite and `wrangler dev` together (O47). |
| Transport | **WebSocket**, JSON text frames | One per player. Streams batched to 10 Hz. Messages under 64 KB; snapshots in parts of 1,000 cards. |
| Shared code | `shared/` TypeScript, imported by both `src/` and `server/` | Protocol, ops, the pure table-apply, redaction, permissions, room codes, the word filter. No DOM, no Three, no Workers types. |
| Identity | 128-bit random token in `localStorage`, `sha256` → player id (first 16 characters of base64url) | Web Crypto in both places. |
| Password | `sha256(code + ':' + password)` stored in the room; compared on `hello` | Not a login system; a door code. |
| Tests | **vitest** for `shared/` and the client's pure modules | The server is exercised through `wrangler dev` in the phase gate; `@cloudflare/vitest-pool-workers` may be added later (agent decision when the time comes). |

Cloudflare free plan figures this design is sized against (as of 2026-10; check the dashboard before changing numbers): **100,000 requests a day**, WebSocket messages counted at **20 to 1**, **13,000 GB-seconds** of Durable Object time a day, 5 GB storage, SQLite rows read 5 million and written 100,000 a day. Section 15 does the arithmetic.

### 3.3 Why the crown's browser and not the server

The owner chose the crown's browser as the truth (O2) and the server as the keeper of a full mirror that redacts (O28). What that buys:

- The server needs no understanding of permissions, holds, stands, piles or layouts. It applies ops to a plain table with the same `shared/apply.ts` the clients use, and runs one visibility function (Section 7.2). The rules live in the browser, where they already are.
- A room is the owner's table, which goes online and comes back offline as the same thing (O7, O8). The crown's autosave is the room's state.
- A handover loses nothing, because the server's mirror is complete (O5).

What it costs: every op makes a round trip through the crown's browser (sender → server → crown → server → everyone), about 100 to 300 ms between players in one country. Optimistic application (O63) hides it for your own actions.

**The crown's tab in the background.** Chrome throttles timers in background tabs to once a second and stops `requestAnimationFrame`. The authority therefore does all its work in WebSocket `message` handlers, never in the frame loop: `authority.ts` applies and confirms an op the moment it arrives. The crown's own render catches up when the tab is visible again. Autosave already runs off the frame.

### 3.4 Repository layout (additions)

```
card-manipulator/
├── server/                      the Worker and its Durable Objects
│   ├── wrangler.toml            bindings, migrations (new_sqlite_classes), vars
│   ├── src/
│   │   ├── worker.ts            routes: /api/rooms, /api/rooms/:code, ws upgrade, /api/admin, /api/version
│   │   ├── room.ts              class Room extends DurableObject: meta, mirror, relay, redaction, handover
│   │   ├── lobby.ts             class Lobby: public list, heartbeats, reports, creation rate limits
│   │   ├── storage.ts           the Room's SQLite tables and KV keys (Section 10.2)
│   │   └── limits.ts            constants: 8 players, 5,000 cards, sizes, rates
│   └── tsconfig.json            extends the root config with Workers types
├── shared/                      pure TypeScript both sides import
│   ├── protocol.ts              PROTOCOL version, every message type (Section 9)
│   ├── ops.ts                   Op and ConfirmedOp types (Section 8.2)
│   ├── table.ts                 TableState: the plain table (cards, named, spreads, mats, dice, basics, name)
│   ├── apply.ts                 applyOp(table, op): the one place an op changes a TableState
│   ├── redact.ts                canSee(card, mats, playerId), redactOp, redactSnapshot, visibility diffs
│   ├── permissions.ts           Rank, RANKS, needs(action): Rank, allowed(rank, action)
│   ├── roomCode.ts              newCode(), isCode(s)
│   ├── words.ts                 the name filter (a short list the owner edits) and clean(name)
│   └── rateLimit.ts             a pure sliding-window counter
├── src/online/                  the client's room layer
│   ├── identity.ts              the token, nickname and colour in localStorage
│   ├── session.ts               the WebSocket, hello, reconnect, version check, message dispatch
│   ├── room.ts                  RoomState: meta, players, me, crown, rank, locked, downloads; events
│   ├── outbox.ts                store changes → ops, optimistic apply, pending inverses, refusal rollback
│   ├── inbox.ts                 confirmed ops, reveals, forgets and snapshots → the store
│   ├── authority.ts             the crown's judge: checks and confirms or refuses; handover in and out
│   ├── streams.ts               10 Hz batching out; interpolation buffers in
│   ├── presence.ts              remote cursors (DOM), remote holds and flights (layer poses), colours
│   ├── hidden.ts                app.online.canSee(card) and the HIDDEN sentinel for the client
│   ├── link.ts                  #/room/CODE?key= parsing, Copy link, Copy invite link
│   └── guard.ts                 rank gating for keys, buttons and mouse grammar; refusal toasts
├── src/ui/
│   ├── onlinePanel.ts           the floating Online panel (Section 12.2)
│   ├── joinPrompt.ts            nickname, colour, password (Section 12.3)
│   ├── chatStrip.ts             the chat in the panel
│   ├── tableBrowser.ts          the public list (Section 12.5)
│   ├── playerRows.ts            the player list with rank pickers and the crown's menu
│   └── desktopOnly.ts           the phone page (O53)
├── public/
│   └── welcome: a Join a table link (Section 12.6)
├── tests/
│   ├── permissions.test.ts, redact.test.ts, apply.test.ts, protocol.test.ts, roomCode.test.ts,
│   ├── words.test.ts, rateLimit.test.ts, election.test.ts, outbox.test.ts, link.test.ts, snapshot.test.ts
└── .github/workflows/pages.yml  gains a worker job (Section 3.5)
```

`tsconfig.json` adds `shared/**` to the client build; `server/tsconfig.json` includes `shared/**` and `server/src/**` with `@cloudflare/workers-types`. Vite's `envDir` stays the root: `VITE_ROOM_SERVER` names the server (Section 3.5).

### 3.5 Deployment

- **Static site:** unchanged, GitHub Pages on every push to `main` (decision 203).
- **Server:** its own workflow, `.github/workflows/worker.yml`, on every push to `main` that touches `server/**` or `shared/**`: `npm ci`, `npm run typecheck`, `npm test`, `npx wrangler deploy --config server/wrangler.toml`, using repository secrets `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token) and `CLOUDFLARE_ACCOUNT_ID`. **(agent, O92)** A separate workflow, not a job Pages waits on: a missing secret or a failed deploy never blocks the site, and the protocol version check (O48) covers the minutes the two may differ. The run itself deploys the Worker after each phase gate with the owner's `wrangler login` (O80), so the live server is usually ahead of the site.
- **Server URL:** `.env.production` (committed, not secret) holds `VITE_ROOM_SERVER=https://card-manipulator-rooms.<account>.workers.dev`; `.env.development` holds `http://localhost:8787`. The client turns `https` into `wss` for the socket.
- **Secrets on the Worker:** `ADMIN_KEY` (O15), set once with `wrangler secret put ADMIN_KEY`. Nothing else.
- **One-time owner setup:** make a free Cloudflare account, choose the `workers.dev` subdomain, `npx wrangler@latest login` on this machine (before the run, O77), create the API token and add the two repository secrets before the first push with server code. The run writes `.env.production` from `wrangler deploy`'s printed URL and sets `ADMIN_KEY` itself, saving the key to the git-ignored `server/.admin-key`; `ONLINE_PROMPT.md` has the steps.
- **Protocol version** (O48): `PROTOCOL` in `shared/protocol.ts` is bumped whenever a message changes shape. The server accepts only its own version; a stale tab is told `bye {reason: 'version'}` and shows **Reload to update** (Section 12.7). A mismatch happens only to tabs left open across a deploy, or in the minutes between the Worker's workflow and the site's.

### 3.6 Local development (O47)

```
npm run dev        # concurrently: vite (5173) + wrangler dev --config server/wrangler.toml --port 8787
npm run dev:web    # vite alone, as before (rooms show "No room server" and Go online is disabled)
npm run dev:server # wrangler dev alone
npm run typecheck  # tsc for the client, then tsc -p server
npm test           # vitest: shared/, src pure modules, server pure modules
npm run build      # vite build (the server is not part of dist)
```

`wrangler dev` runs the Durable Objects locally with persistent state under `.wrangler/` (git-ignored). Two tabs on `localhost:5173` can host and join (the second with `?player=B`, O90); the built-in browser does this in the phase gate. `start.bat` keeps starting `npm run dev`. During the rooms run each session has its own vite and wrangler ports (`dev:hub`, `dev:server-fork`, `dev:sync-fork`, `dev:ui-fork`; O91, `ONLINE_PROMPT.md` Section 2).

---

## 4. Rooms

### 4.1 Lifecycle

```
 offline table ──Go online (O7)──▶ room (crown = maker) ──Go offline (O8)──▶ offline table, unchanged
                                      │        ▲
                        players join  │        │ maker returns: crown back (O6)
                                      ▼        │
                              crown drops ──▶ crown passes at once (O5, O62)
                                      │
                              last player leaves ──▶ room closes at once (O61); the link is dead
```

- **Go online** (O7) takes the table as it stands: the crown's browser sends a full snapshot to the new Room object, which becomes the room's mirror. The crown's autosave carries on being the table. The room's name is the table's name.
- **Go offline** (O8) is the crown's, any time. Everyone else gets the **Room closed** screen (Section 12.7) with **Save a copy**; the crown's table stays exactly as it stands, offline.
- **Closing on empty** (O61). When the last socket closes, the Room deletes its storage and tells the Lobby. A reload by the last player ends the room: the Online panel says so under the link ("The room lives while someone is in it"). Appendix B keeps a note on adding a short grace period if this proves annoying.
- **Joining** (Section 4.4) never changes the joiner's own table (O9): their `autosave.v1` stays untouched; the room's table lives in the store while connected and their own comes back on leaving. **Save a copy** downloads the room's table as a table file (Section 7.5 says what a non-crown copy holds).
- **Leaving:** the **Leave** button, closing the tab, or losing the connection for good. A player who leaves keeps their seat in the player list, greyed, until the room closes (O19): rank, colour, stand and crown claim all wait for the same browser.

### 4.2 Codes and links (O11, O12)

- A room code is six characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I, L), 31⁶ ≈ 887 million codes, made on the server, retried on the rare collision. **(agent, O11)** The owner left the choice between a code and three words open; the code is shorter to type from a phone screen and fits the browser row.
- **Link:** `https://dazeyama.github.io/card-manipulator/#/room/7KQ2MX`. The fragment never reaches any server.
- **Invite link** (O12): `#/room/7KQ2MX?key=<password>` for password rooms; it opens straight in. The public browser never shows it. **Copy link** and **Copy invite link** are two buttons in the Online panel (the second only when a password is set).
- Opening a link: if the page has no identity yet, the join prompt asks for a nickname and colour (Section 12.3). The welcome table is skipped for a visitor arriving by link; their own (empty) table is what they come back to on leaving.
- A link to a closed room shows **This room has closed** with **Back to my table**.

### 4.3 Visibility, password, tag (O10, O13)

| Setting | Values | Default | Who | Where it shows |
|---|---|---|---|---|
| Visibility | Unlisted · Public · Public + password | Unlisted | crown | the Lobby lists Public and Public + password rooms; a lock icon for the latter |
| Password | text, 1 to 32 characters | none | crown | asked on join unless the invite link carries it |
| Tag | Cube · Play | Play if the table has a playmat or stand, else Cube **(agent)** | crown | the browser row; the browser filters by it |
| Newcomers start as | View · Move · Tokens · Cards · Everything | Move (O22) | crown | the join toast says the rank |
| Lock table | on/off (O51) | off | crown | a lock in everyone's top bar; every table op from non-crown players is refused with "The table is locked" |
| Downloads | on/off (O50) | on | crown | off hides Save as file, Save a copy and the Export panel for everyone but the crown |

Changing the name (the table name in the top bar), visibility, password, tag or newcomer rank is the crown's alone (O23). Other players see the values greyed. Lock table keeps ranks: unlocking restores everyone as they were.

### 4.4 Joining

1. The page parses `#/room/CODE` and `?key=`. A phone or tablet (a coarse pointer and a viewport under 1,280 px, the spec's width rule) gets the **desktop only** page naming the room (O53), fetched from `GET /api/rooms/CODE`.
2. `GET /api/version`: if `PROTOCOL` differs, **Reload to update**.
3. `GET /api/rooms/CODE` → `{name, players, max: 8, password: boolean, tag, open}`. Closed → the closed screen. Full → "The room is full (8 of 8)" with a Retry.
4. The join prompt (Section 12.3): nickname (prefilled from the identity), a free colour, the password if needed and not in the link. Nickname and colour are remembered for next time (O17, O18).
5. The socket opens; `hello`; the server answers `welcome` (room meta, players, chat log, your rank, crown) then the `snapshot` parts, redacted for you. The table appears as parts arrive; a thin progress line under the top bar reads "Joining: 2,000 of 4,300 cards".
6. The camera starts at the default offline view (O37) on the near side. **M** crosses to the far side (O36); nothing is seated automatically (O38). The Playmat tab is where you spawn your mat and your stand.
7. The room says so in chat: a grey line "Dazey joined as Move".

### 4.5 The crown

- **One at a time.** The crown's browser runs `authority.ts`. The crown has no rank; everything is allowed.
- **Passing by hand** (O20): in the player row's menu, **Pass crown**, then a confirm: "Pass the crown to Sam? You keep Everything." The old crown is set to Everything.
- **Passing by itself** (O5, O62): when the crown's socket closes, the server names the new crown at once: the highest rank present, longest present among equals (join order), View included if that is all there is. It sends `youAreCrown` with the full, unredacted table from the mirror and any ops it was holding; the new crown's browser replaces its store with that table (its own redacted copy may lack identities) and starts judging. Everyone sees a grey chat line and a toast: "Sam is the crown now".
- **The maker returns** (O6): the server remembers the maker's player id. When that identity reconnects, the crown passes back to them at once; the interim crown goes back to the rank they had before (kept in meta). This is the one automatic pass that can take the crown from a connected player.
- **The crown alone in the room** keeps the crown while connected. If the crown is the last player and leaves, the room closes (O61).
- **Handover details.** Ops that arrive at the server while no crown is connected are queued for up to five seconds and forwarded to the new crown; after that they are refused with `reason: 'noCrown'` and the senders roll back. Streams keep flowing. Holds by the departed crown are released (Section 8.4).

### 4.6 Kick and ban (O49)

- **Kick** drops the player (`bye {reason: 'kicked'}`); their seat stays greyed; they may rejoin by the link.
- **Ban** (a confirm) drops them and blocks their identity for the room's life. Their stand stays for the crown to spill (Section 6.3). A banned identity trying to join gets `bye {reason: 'banned'}`: "You were banned from this room."
- Both are the crown's (O23). The crown cannot be kicked or banned; pass the crown first.

### 4.7 Reconnection (O19)

- The client reconnects with backoff (1, 2, 4, 8 s, then every 10 s) and the same `hello`. The server recognises the player id, restores the seat, and sends a fresh `snapshot` (simpler than replaying ops; Section 8.6).
- While disconnected, the top bar shows "Reconnecting…", the table is read-only, and the player's held cards drop where they were (the crown releases a holder's holds 3 seconds after its socket closes, issuing a `move` on their behalf to the last streamed poses).
- A player kept in the list but absent for the room's life is harmless; the list shows them greyed with "away".

---

## 5. Players

### 5.1 Identity (O17)

`localStorage['online.identity.v1'] = { token, nickname, colour }`. The token is 16 random bytes as base64url, made on first use. The player id is `base64url(sha256(token)).slice(0, 16)`; the client sends the token only in `hello`, over TLS, and the server stores the id, never the token. Clearing site data makes a new person; the owner accepted this (no accounts).

**Two tabs in one browser (agent, O90):** every tab of an origin shares `localStorage`, so two tabs would be one player. A dev-only query `?player=<name>` namespaces the key (`online.identity.v1:<name>`); `__room()` and the phase gate's second tab use it. The production UI never adds it.

### 5.2 Colours (O18)

A fixed set of eight, chosen to stay apart on the felt and in the cursor tags:

| | | | | | | | |
|---|---|---|---|---|---|---|---|
| `#e63946` red | `#f4a261` orange | `#e9c46a` yellow | `#2a9d8f` teal | `#4895ef` blue | `#7b2cbf` violet | `#ff6fb5` pink | `#f1f5f9` white |

The join prompt shows the free ones; the taken ones are greyed with the holder's initial. Your own swatch in the player panel swaps to another free colour. A player's colour tints their cursor tag, their selection glow on cards and dice (Section 5.4), the lift glow of what they hold, and their name in chat.

### 5.3 Sides (O36)

Two sides, as mirror mode has them. Everyone arrives on the near side and presses **M** to cross, as in real life you would walk round the table. There is no cap per side (the owner: "anyone can move between sides freely"); the player row shows an arrow for the side each player is on, from their stream. A stand you spawn faces your side (decision 267 already does this), and the cards you move turn to face you (decision 267's `side` field, unchanged).

### 5.4 Presence (O18, O33)

- **Cursors: always shown, never hideable** (O18). A remote cursor is a small arrow in the player's colour with a name tag, a DOM element positioned every frame by projecting the player's table point (x, y, 0) through your camera, so it sits on the felt where their mouse is. Off-screen cursors are clamped to the edge with the tag pointing in.
- **Held cards and dice float live.** While a player holds something, their stream carries each held uid's pose; your browser interpolates them 100 ms behind the stream and draws them lifted with a glow in that player's colour. They are not selectable or grabbable by you ("That card is in Sam's hand").
- **Selections in colour.** A player's selection is sent at most twice a second as a uid list; those cards and dice glow in their colour rather than the accent blue. Your own stays blue. This needs a per-instance glow colour in `render/cards.ts` (an extra instanced attribute of three floats; the shader multiplies the glow by it) and in `render/dice.ts`.
- **Tossed cards and rolled dice animate for everyone.** The thrower's stream carries flight poses until Rapier settles them; then the `move` or `dice` op lands them for good (Section 8.5).
- **No camera footprints, no follow, no summon** (O33, O34).

### 5.5 Chat (O35)

A strip in the Online panel: the last 100 lines, name in the player's colour, plain text up to 300 characters, Enter sends, nothing saved past the room's life. System lines in grey: joined (with rank), left, back, kicked, banned, crown passed, table locked and unlocked, room settings changed, "Sam spilled Pat's stand". The server keeps the 100 lines for joiners. Five messages per five seconds per player; more are dropped with a "Slow down" line only you see. **(agent)** Chat is not run through the name filter: it is private to the room and the crown can kick.

---

## 6. Permissions

### 6.1 The ladder (O21)

One rank per player, each including the ones below. The crown stands above the ladder and may do anything; it has no rank of its own.

| Rank | Adds | Meant for |
|---|---|---|
| **View** | Looking: camera, hover previews, inspect, table search and refine, selecting (a selection changes nothing and shows others what you mean), chat, Save a copy and exports when Downloads is on. | Watching a draft, a friend looking over a cube. |
| **Move** | Touching anything that is not owned: drag, flip, turn, tap, stack, shuffle, spread, tidy, curve, rank and colour views, fan, hand, deal, draw, P move, X spreads, name a pile (N), named-pile filters; dice: move, roll, set number, colour; life totals; playmats: move, turn, lock, unlock; your own hand stand and small stands: spawn, move, rename the plate, remove; one-step undo of your own last action; Ctrl + C copy. | Playing a game. **The default for newcomers** (O22). |
| **Tokens** | Spawning token cards (T T menu, the Tokens search), dice (D, D D), and the Card tab's basic land chips (O60); removing dice and token cards. | A player who may add game pieces but not the cube's cards. |
| **Cards** | The Spawn panel: decklists, single cards, queries, the Cube tab, Ctrl + V paste; Delete and the Removed tray (restore, empty); removing any card. | Someone working on the cube with you. |
| **Everything** | Playmats: spawn, remove; stands: remove or **Spill** anyone's; claim an unowned stand regardless; the basics setting (which printings the chips spawn); nothing about the room or other players (O24). | A co-worker on the table. |
| **Crown** | Ranks, kick, ban, pass the crown, New table, Load file, the table's name, visibility, password, tag, newcomer rank, Lock table, Downloads, Go offline (O23). | The host. |

Removing follows adding (O25): what a rank may spawn it may remove. **(agent)** A Tokens player may remove cards whose record layout is `token`, `emblem` or `double_faced_token`, so "adding and taking away are one power" holds for tokens too; the crown's judge checks every uid in a `remove` from a Tokens player is such a card.

### 6.2 Every action and its rank

The table below is the contract `shared/permissions.ts` encodes as `needs(action): Rank`. `guard.ts` uses it to disable buttons and refuse keys in the browser with a toast; `authority.ts` uses it to judge ops. The action names are the ones the ops carry (Section 8.2).

| Action (op or UI) | Rank |
|---|---|
| camera, hover, inspect, search, refine, select, chat | View |
| Save a copy, Save as file, Export decklist / CSV, Ctrl + E | View, while Downloads is on (crown always) |
| `move` of cards not on a stand, not held by another | Move |
| `move` that puts cards on, or takes cards off, a stand | Move, **and** the stand's owner only (Section 6.3) |
| `grab` (hold) | Move; refused while another holds any of them |
| `named` set/remove, `spread` set/remove | Move |
| `dice` set (move, roll result, number, colour) | Move |
| `dice` set that adds a die, `dice` remove | Tokens |
| `mat` set: life, lifeHidden, move, yaw, locked, name of a playmat | Move |
| `mat` set: a stand of yours (spawn, move, name, owner release) | Move, one full stand per player (O27) |
| `mat` remove: your own stand | Move |
| `add` of token cards (layout token/emblem), basics chips | Tokens |
| `remove` of token cards only | Tokens |
| `add` of any card (Spawn panel, paste, tray restore) | Cards |
| `remove` of any card | Cards |
| `mat` set that adds a playmat; `mat` remove of a playmat | Everything |
| `mat` set: `owner` of a stand that is not yours (claim), Spill (remove with cards dropped) | Everything |
| `basics` | Everything |
| `table` (name), `replace` (New table, Load file), `reuid` | Crown |
| room: `rank`, `kick`, `ban`, `pass`, `settings`, `close` | Crown |

Lock table (O51) puts every player below the crown at View for table ops while it is on; chat, camera and exports are unaffected.

### 6.3 Ownership

- **Nothing is owned except stands** (O27, O52). Playmats, life totals, dice, cards on the table: anyone at Move may touch them, like a real table.
- **A stand is its owner's.** The player who spawns a stand owns it; the plate reads their nickname by default (the Playmat tab's name field is prefilled with it and can be changed). Only the owner may take cards off it, put cards on it, move it, turn it, rename it or remove it. Everyone else sees its cards as backs from any angle (O29) and the count badge.
- **One full-size stand per player at a time** (O27). The Card stand button is disabled with "You already have a hand stand" while you own one. **Small stands are unlimited** (Scry and the like), each owned by its spawner the same way.
- **Unowned stands.** A stand loaded with a table file, or on the table when it went online beyond the crown's one, has no owner. **(agent)** Its cards are hidden from everyone, as a face-down pile would be; a **Claim** button on its plate (Move, if you have no full stand yet; Everything regardless) makes it yours; Everything may Spill it.
- **Going online** (agent): the crown's browser stamps `owner = crown` on the full stand nearest its side and on every small stand without an owner; other full stands stay unowned.
- **A player who left** (O31): their stand stays, backs shown, waiting for the same browser. **Spill** (Everything, and the crown) drops its cards face down in a messy pile in front of it and removes the stand; a grey chat line says who spilled whose.
- **Release:** the owner's plate menu has **Release**, making the stand unowned (to hand it over). The crown's **Give to…** sets the owner directly.
- **Offline** (O32): the whole offline table is one player. One full stand at a time offline too (the Card stand button disables), small stands unlimited, and no hiding: both views of a solo table see the stand's cards. The `owner` field is ignored offline.

### 6.4 Enforcement

Three layers, from soft to hard:

1. **The browser gates itself** (`guard.ts`): buttons disabled with a title saying the rank needed; keys that would change the table show a toast "Move or higher needed" (or "The table is locked") and do nothing; the mouse grammar refuses to begin a drag of what you may not move. Honest clients never send an op they lack the rank for.
2. **The crown judges** (`authority.ts`): every op is checked against the sender's rank, Lock table, holds, stand ownership, the one-stand rule and the size cap before it is applied and confirmed. A refusal goes back to the sender only.
3. **The server enforces the room**: `rank`, `kick`, `ban`, `pass`, `settings`, `close` and `reuid`/`confirm`/`refuse` are accepted only from the crown's socket; `hello` checks the password and the ban list; the player cap, the message sizes and the rates are the server's.

Downloads off (O50) is layer 1 only: the data is in the browser already. The owner knows.

---

## 7. Hidden information

### 7.1 Who may know a card

A card's **identity** is its `scryfallId` and `finish`. A player may know a card's identity when:

- it is **face up and not on a stand**, wherever it is (a stack, a spread, a hand of cards laid on the table, in someone's drag), or
- it is **on a stand they own**, face up or down.

Everything else is hidden: cards on other players' stands (O29), cards on unowned stands, and every face-down card not on your stand, yours included (O30: no private peek; take it to your stand to look). Flipping a card face up on the table shows it to everyone. The crown's browser holds every identity (it is the authority) and its UI hides exactly what any other player's would; a crown who edits the page can read every hand, which the owner accepted (O28).

### 7.2 Redaction on the server

`shared/redact.ts`:

```ts
export function canSee(card: CardSnap, mats: Map<string, Mat>, player: string): boolean {
  if (card.stand) return mats.get(card.stand)?.owner === player;
  return card.faceUp;
}
```

- **Snapshots** to a player replace hidden cards' `scryfallId` with `HIDDEN` (`'hidden'`) and `finish` with `'nonfoil'`.
- **Confirmed ops** are redacted per recipient before relay: `add` strips identities the recipient may not know; `move` is sent as is (poses are public), but the server compares `canSee` before and after on its mirror for every card the op touches and for every recipient, and appends `reveal {cards: [{uid, scryfallId, finish}]}` for cards that became visible and `forget {uids}` for cards that became hidden. A `mat` op that changes a stand's owner, or removes a stand, does the same for every card on it.
- **Streams** carry uids and poses only; nothing to redact.
- **The crown** receives nothing redacted: `confirm` echoes and `youAreCrown` carry full identities. The crown's browser never forgets.
- **Honest browsers forget** on `forget`: the card's record link is dropped, it is drawn as a back (Section 7.3). Like a real table, you may remember what you saw; the app does not remember for you.

**Shuffles re-key hidden cards (agent).** Uids are stable, so a browser that saw a card before it was turned down could follow it through a shuffle by uid. Therefore, when the crown applies an `S S` shuffle (or any op flagged `shuffle: true`) in which some cards are hidden from anyone, it issues a `reuid` op giving those cards fresh uids; `apply.ts` renames them in cards, spreads, holds and the `stand` link, and every browser's selection drops them. Visible cards keep their uids. This is the one place uids change.

### 7.3 Hiding in the browser (`src/online/hidden.ts`)

The client has one gate, `app.online.canSee(card)`: true offline and for the crown's own view of what the crown may see; for others, true when the card's `scryfallId !== HIDDEN`. Every place that reads a card's identity goes through it or through a record lookup that returns `undefined` for `HIDDEN`:

| Module | Behaviour for a hidden card |
|---|---|
| `render/atlas.ts`, `app.slotsFor` | both faces draw the card back; no foil |
| `render/hires.ts` (close-up `normal` images) | the back |
| `ui/inspectPanel.ts` | "Hidden card" and nothing else |
| `ui/hud.ts` (selection names), `ui/handCount.ts` | counts include it; names read "hidden" |
| `query/*` via refine, table search, named-pile filters | never matches (no record); the HUD says "n hidden cards not searched" when any are selected |
| `ui/exportPanel.ts`, `io/exportDecklist.ts`, `io/exportCsv.ts` | skipped, with a line "n hidden cards not exported" |
| `ui/tokenMenu.ts` (T T) | nothing |
| `ui/tray.ts` (Removed) | "Hidden card" rows |
| `ui/cubeTab.ts` | hidden cards are not matched to the cube |
| `commands.ts` layouts that sort by identity (curve C, colour, E ranks) | hidden cards go to the end in a face-down row, unsorted |
| `state/piles.ts` detection | unaffected, positions only |
| the Cast window (📺) | draws backs for hidden cards, like the main view (O39); otherwise unchanged online and offline |

On the crown's browser the gate is `canSee(card, mats, me)` from `shared/redact.ts`; on others it is the sentinel. The same gate decides the glow and hover: a hidden card still hovers (it is a physical object) but shows no preview.

### 7.4 Stands and the camera (O29)

Backs whatever the camera does. The stand's slope renders its cards with the hidden gate like any other card; a far-side player orbiting behind a near-side stand sees backs. The count badge, the plate and the stand itself are public.

### 7.5 Save a copy and exports from a non-crown browser

`toDoc` writes hidden cards as `{ uid, scryfallId: 'hidden', hidden: true, finish: 'nonfoil', ... }`. `validateDoc` accepts them; `loadDoc` skips `'hidden'` when fetching records and the atlas draws backs forever: an unknowable card. The table format stays version 1 with an optional field, as earlier additions did. Decklist and CSV exports skip them and say so. The crown's copy is complete (O50 note).

### 7.6 Offline

No hiding offline (O32): a solo table and the mirror-mode camera see every card, the stand's included, as today. `canSee` is true whenever `app.online.room` is null.

---

## 8. Synchronisation

### 8.1 The model

- **State** is the table: `TableState` in `shared/table.ts`, the plain shape behind `Store` (cards, named piles, spreads, mats, dice, basics, name). Piles (detected) and the selection are not state: every browser recomputes piles from positions (`pileSync.redetect`), as today, and gets the same answer because positions are the same.
- **Ops** change state (Section 8.2). A player's browser applies its own op to its store at once (O63) and sends it; the crown judges; the server stamps the confirmed op with `seq` and sends it to everyone; the sender recognises its own `id` and drops the pending record; everyone else applies it.
- **Refusal** goes to the sender only: it applies the inverse it kept (Section 8.6) and shows the reason as a toast.
- **Streams** (Section 8.3) carry transient poses.
- **Snapshots** replace the whole store on join, reconnect and handover.

### 8.2 Ops (`shared/ops.ts`)

```ts
import type { CardSnap } from '../src/state/history';   // uid, scryfallId, finish, x, y, z, yaw, faceUp, pileId, spreadOf, laidAt, stand, side
import type { CardMove } from '../src/state/store';     // uid plus any of the pose and face fields
import type { Mat, NamedPile } from '../src/state/types';
import type { Die } from '../src/state/dice';
import type { Spread } from '../src/state/store';
import type { Basics } from '../src/state/basics';

export type Op =
  | { t: 'add'; cards: CardSnap[] }                       // spawn, paste, tray restore
  | { t: 'remove'; uids: string[] }                       // Delete, Removed tray
  | { t: 'move'; moves: CardMove[]; shuffle?: boolean }   // landings, flips, turns, layouts, deals; clears holds on those uids
  | { t: 'grab'; uids: string[]; dice?: string[] }        // a hold request; confirmed = in your hand
  | { t: 'release'; uids: string[]; dice?: string[] }     // hand emptied without landing (Esc, cancel)
  | { t: 'reuid'; pairs: [string, string][] }             // crown only, after a shuffle of hidden cards (7.2)
  | { t: 'named'; set?: NamedPile[]; remove?: string[] }
  | { t: 'spread'; set?: Spread[]; remove?: string[] }
  | { t: 'mat'; set?: Mat[]; remove?: string[]; spill?: string[] }  // spawn, move, lock, life, name, owner; spill = remove with cards dropped
  | { t: 'dice'; set?: Die[]; remove?: string[] }         // spawn, move, roll result, number, colour
  | { t: 'basics'; basics: Basics }
  | { t: 'table'; name: string }                          // crown only
  | { t: 'replace'; table: TableState };                  // crown only: New table, Load file

export interface ConfirmedOp { seq: number; by: string; id?: string; op: Op }
```

- `move` is the workhorse: `land()` and every layout command end in `store.moveCards`, which is where the outbox makes the op (Section 11.1). A `move` on a card held by another player is refused (`held`).
- `grab` is new: the DragController and the Dice controller ask for a hold when a drag begins. It is applied optimistically (you pick it up at once); a refusal (someone was first, O40) drops the cards back with "That card is in Sam's hand". The crown records `heldBy` per uid in its authority state (not in the table: holds are not saved) and refuses `grab` and `move` on held uids from anyone else. A `move` or `remove` by the holder clears the hold; so does `release`, a disconnect (Section 4.7) or the holder's own `grab` of something else.
- `mat.spill` removes stands and lands their cards face down in a messy pile at the stand's foot, laid out by the crown's browser (it knows the identities) in one confirmed op `move` + `mat remove`, so every browser gets the same result.
- `replace` carries a whole `TableState`; it is also how **New table** and **Load file** work online, and it is followed by a server-side mirror replacement and a fresh `snapshot` to every other player (redacted). Only the crown may send it.

### 8.3 Streams (`shared/protocol.ts`, `src/online/streams.ts`)

Ten times a second, each browser sends one `stream` message if anything changed:

```ts
interface StreamOut {
  t: 'stream';
  cur?: [x: number, y: number];            // table point under the cursor, mm; absent when the pointer is outside
  side: 0 | 1;                             // mirror mode (M)
  sel?: string[];                          // the selection, cards and dice, at most twice a second, only when it changed
  hold?: { [uid: string]: Pose6 };          // what I hold: cards and dice, their drawn poses
  fly?: { [uid: string]: Pose6 };           // my physics: tossed cards, rolling dice, until they settle
}
type Pose6 = [x, y, z, yaw, roll, tilt];   // rounded to 0.1 mm and 0.01 rad
```

The server fans each out to the other players as `{t: 'stream', from: playerId, ...}` without storing or reading it. Receivers keep a 100 ms interpolation buffer per uid and drive `layer.pose` for remote holds and flights every frame (`presence.ts`); when the op that lands them arrives, the pose eases to the landing in 120 ms. Cursors update the DOM tags. Nothing in a stream changes the store.

The stream layer is one module with `send(batch)` and `onStream(fn)`: moving it to WebRTC later (not in this refactor) changes `streams.ts` only.

### 8.4 Holds

- A hold is exclusive. First grab wins (O40) by the crown's order of arrival.
- A held card is drawn lifted with its holder's glow, is skipped by picking for everyone else, and is left out of pile detection on every browser while held (today, dragged cards are already not "settled"; remote holds get the same treatment: `redetect` skips uids in `presence.held`).
- Holds end with the holder's `move`, `remove`, `release`, or their disconnect (the crown issues a `move` to the last streamed poses three seconds after their socket closes, so cards never hang in the air).
- Grabs by the crown itself are confirmed locally with no round trip.

### 8.5 Physics and dice (O3)

- A toss, a flick, a dealt card's flight and a dice roll run in the acting browser's Rapier as today. During the flight the browser streams `fly` poses for those uids; everyone else animates. When Rapier settles, the acting browser sends the `move` (cards) or `dice set` (dice, with the rolled `value` or face) that lands them; it is confirmed like any other op. No other browser runs physics for them, and there is no determinism requirement: everyone ends where the roller says.
- Trust: a die's value is what the roller reports. The owner accepted this (like IRL). A tampered page could report any value; nothing stops a player doing that today with the dev console either.
- Drops of up to 80 cards simulate (decision 84); bigger drops land by layout, and so stream nothing: the `move` carries the layout.

### 8.6 Ordering, optimism and undo

- The server stamps `seq`. Every browser applies confirmed ops in `seq` order; a gap (never expected over one socket) triggers a fresh `snapshot` request.
- **Pending ops** (`outbox.ts`): each local op is applied at once and recorded with an inverse built from the store before applying (for `move`: the before-poses of those uids; `add`: remove those uids; `remove`: the removed cards; `grab`: nothing to undo but the lift; `mat`/`dice`/`named`/`spread`: the before-records). On `refused`, the inverse is applied, except for uids a later confirmed op from someone else has touched (they keep the newer state). On its own confirmation (matching `id`) the record is dropped. Confirmed ops from others are applied as they come; the crown's order is final.
- **Undo** (O41): Ctrl + Z stays one step and personal. `undo.ts` keeps its snapshot machinery; online, the swap is sent as a `move`/`add`/`remove` set of ops flagged `undo: true` with a precondition: for every uid touched, the `seq` of the last confirmed op that touched it as the local browser saw it. The crown keeps `touchedSeq` per uid and refuses the undo (`reason: 'touched'`, toast "Someone else has moved those since") if any differs. Redo works the same way.
- **The crown's own ops** are confirmed on the spot: applied, stamped by the server on relay, never pending. The crown's undo has the same precondition and is judged the same way, against ops by others.

### 8.7 Joining, snapshots and size

- The snapshot comes from the server's mirror in parts: `{t: 'snapshot', part, parts, name, basics, named, spreads, mats, dice}` first, then `{t: 'snapshot', part, parts, cards: CardSnap[]}` of 1,000 cards each. The store is replaced (`store.clear()` then adds) as parts arrive; `settled` fires once at the end so pile detection runs once.
- **Cap: 5,000 cards** (O43), plus mats, dice and stands. The crown's judge refuses an `add` that would pass it ("The table is full: 5,000 cards"). The Spawn panel shows the remaining room when online. A table taken online over the cap goes online anyway with a warning ("5,230 cards: no more can be spawned until some are removed").
- Snapshot size: a card is about 110 bytes of JSON; 5,000 cards ≈ 550 KB in six parts; mats, dice and named piles are small. Each part is well under the 1 MiB WebSocket message limit.
- The server's mirror does not carry `cardData`; every browser resolves identities through its own Scryfall queue (O42), 75 ids per `/cards/collection` call as today, from the local IndexedDB cache first. A joiner to a 5,000-card room with a cold cache waits a couple of minutes for names and images, with grey placeholders meanwhile, as a loaded file does.

### 8.8 Chat, meta and the lobby

Chat and room meta are the server's state, not the table's; they never pass through the crown. The Room sends the Lobby a heartbeat on any change to name, player count, tag, visibility or lock, and every 60 seconds; the Lobby drops rows silent for three minutes.

---

## 9. Protocol (`shared/protocol.ts`)

`export const PROTOCOL = 1;` JSON text frames; every message has `t`. Sizes: a single message at most 64 KB except snapshot parts (at most 256 KB); the server closes a socket that sends more with `bye {reason: 'size'}`.

### 9.1 Client → server

```ts
type ClientMsg =
  | { t: 'hello'; v: number; token: string; nickname: string; colour: string; key?: string; side: 0 | 1 }
  | { t: 'op'; id: string; op: Op }                        // a proposal, for the crown
  | { t: 'confirm'; id?: string; by: string; op: Op }      // crown only: a judged op (its own, or another's with their id)
  | { t: 'refuse'; id: string; to: string; reason: RefuseReason }   // crown only
  | { t: 'snapshot'; part: number; parts: number; ... }    // crown only: the full table for the mirror (same shape as 8.7)
  | { t: 'stream'; ... StreamOut }
  | { t: 'chat'; text: string }
  | { t: 'settings'; set: Partial<RoomSettings> }           // crown only
  | { t: 'rank'; player: string; rank: Rank }               // crown only
  | { t: 'kick'; player: string } | { t: 'ban'; player: string } | { t: 'pass'; player: string } | { t: 'close' }  // crown only
  | { t: 'colour'; colour: string }                         // my own swatch
  | { t: 'needSnapshot' }                                   // after a gap
  | { t: 'ping' };

type RefuseReason = 'rank' | 'locked' | 'held' | 'stand' | 'oneStand' | 'cap' | 'crownOnly' | 'touched' | 'noCrown' | 'unknown';

interface RoomSettings { name: string; visibility: 'unlisted' | 'public' | 'password'; password?: string; tag: 'cube' | 'play'; newcomers: Rank; locked: boolean; downloads: boolean }
```

### 9.2 Server → client

```ts
type ServerMsg =
  | { t: 'welcome'; me: string; crown: string; maker: string; rank: Rank; settings: Omit<RoomSettings, 'password'> & { password: boolean }; code: string; players: Player[]; chat: ChatLine[]; seq: number }
  | { t: 'snapshot'; part: number; parts: number; ... }    // redacted for you
  | { t: 'op'; seq: number; by: string; id?: string; op: Op }   // confirmed, redacted for you
  | { t: 'reveal'; cards: { uid: string; scryfallId: string; finish: Finish }[] }
  | { t: 'forget'; uids: string[] }
  | { t: 'refused'; id: string; reason: RefuseReason }
  | { t: 'stream'; from: string; ... StreamOut }
  | { t: 'players'; players: Player[] }                     // on any join, leave, rank, colour, side or crown change
  | { t: 'chat'; line: ChatLine }
  | { t: 'crown'; player: string }                          // who is crown now
  | { t: 'youAreCrown'; parts: number }                     // followed by unredacted snapshot parts and queued { t: 'op'... } proposals
  | { t: 'settings'; settings: ... }
  | { t: 'bye'; reason: 'kicked' | 'banned' | 'closed' | 'version' | 'full' | 'password' | 'size' | 'rate' | 'quota' }
  | { t: 'pong' };

interface Player { id: string; nickname: string; colour: string; rank: Rank; side: 0 | 1; connected: boolean; joinedAt: number; isCrown: boolean; isMaker: boolean }
interface ChatLine { at: number; from?: string; text: string }   // from absent = a system line
```

### 9.3 HTTP (`server/src/worker.ts`)

| Route | Purpose |
|---|---|
| `GET /api/version` | `{ protocol: 1 }` |
| `POST /api/rooms` body `{ token, nickname, name, tag }` | creates a room: returns `{ code }`; rate limited per ip and token (Section 10.4) |
| `GET /api/rooms` | the public list: `{ rooms: LobbyRow[] }` |
| `GET /api/rooms/:code` | `{ name, players, max, password, tag, open }` for the join prompt and the phone page |
| `GET /api/rooms/:code/ws` (Upgrade) | the room socket |
| `POST /api/rooms/:code/report` body `{ token }` | a report; three distinct identities delist the room until the admin looks |
| `GET /api/admin/rooms` header `x-admin-key` | every room, with reports |
| `POST /api/admin/rooms/:code/delist` · `/close` | admin actions |

`LobbyRow { code, name, players, max, password, tag, crown, cards, since }` (O13). The Lobby keeps `cards` from the Room's heartbeat.

---

## 10. The server

### 10.1 Worker (`worker.ts`)

Routes above; CORS for the Pages origin and `localhost:5173`; `Upgrade: websocket` requests are forwarded to the Room stub by `idFromName(code)`; everything under `/api/admin` checks `x-admin-key` against the `ADMIN_KEY` secret with a constant-time compare. Unknown routes 404. No static files (Pages serves the site).

### 10.2 Room Durable Object (`room.ts`, `storage.ts`)

**In memory while awake:** `meta` (settings, crown, maker, players with ranks and colours, bans, chat), `mirror: TableState`, `seq`, `queued: ClientMsg[]` (ops waiting for a crown), per-socket attachments (player id) through `serializeAttachment` so hibernation keeps them.

**Persisted (SQLite):**

| Table / key | Rows | Written when |
|---|---|---|
| KV `meta` | one JSON, under 128 KB | any change |
| `snapshot(part INTEGER PRIMARY KEY, json TEXT)` | 6 rows for 5,000 cards (100 KB each) | every 30 s or 50 confirmed ops, whichever first, from the crown's `snapshot`; the server also rebuilds parts from its own mirror if the crown is slow |
| `oplog(seq INTEGER PRIMARY KEY, json TEXT)` | one per confirmed op since the last snapshot | every confirmed op; trimmed at each snapshot |

On waking without memory (after hibernation) the Room rebuilds `mirror` from `snapshot` + `oplog`; if the crown is connected it also asks it for a fresh `snapshot`. This keeps SQLite writes to a few hundred rows an hour, far below the free day's 100,000.

**Message handling (`webSocketMessage`):**

- `hello`: version check → `bye version`; ban list → `bye banned`; 8 connected players and a new id → `bye full`; password → `bye password` after a 1-second delay, counted for the rate limit; name through `clean()` (Section 10.4); colour taken → the first free one. Known id: restore the seat (rank, colour). New id: rank = `settings.newcomers`. Then `welcome`, the redacted `snapshot` parts, `players` to everyone, a system chat line. If this id is the maker and someone else is crown, pass the crown back (O6).
- `op`: forward to the crown's socket (with `from`); no crown connected → queue up to 5 s then `refused noCrown`.
- `confirm` (crown only): `seq++`, apply to `mirror` with `applyOp`, write `oplog`, compute visibility diffs per recipient (Section 7.2), send each player their redacted `{t:'op'}` plus `reveal`/`forget`, the crown an unredacted echo. Size cap enforced here too as a backstop (refuse with `cap` if the mirror would exceed 5,000 cards).
- `refuse` (crown only): forward to `to`.
- `snapshot` (crown only): replace `snapshot` rows and the mirror, clear `oplog`.
- `stream`: fan out to every other socket, attaching `from` and the sender's `side`; update the player's `side` in memory and send `players` when it changed.
- `chat`: rate limit 5 per 5 s; append (cap 100); broadcast.
- `settings`, `rank`, `kick`, `ban`, `pass`, `close` (crown only): update meta, broadcast `settings`/`players`/`crown`, system chat lines; `kick`/`ban` close that socket with the reason; `close` sends `bye closed` to all and deletes the room; heartbeat the Lobby.
- `colour`: free → set, broadcast `players`.
- `needSnapshot`: resend the parts.
- `ping` → `pong`.

**Close (`webSocketClose`/`webSocketError`):** mark the player disconnected; broadcast `players` and a chat line; if they were crown, elect (Section 4.5): the connected player with the highest rank, earliest `joinedAt` among equals; send `youAreCrown` + unredacted parts + queued proposals; broadcast `crown`. If no socket remains: `storage.deleteAll()`, tell the Lobby, done (O61).

**Alarm:** every 60 s while anyone is connected, heartbeat the Lobby and prune expired rate-limit windows.

### 10.3 Lobby Durable Object (`lobby.ts`)

One instance (`idFromName('lobby')`). Keeps `rooms: Map<code, LobbyRow & { visibility, reports: Set<playerId>, lastSeen, delisted }>` in SQLite. `GET /api/rooms` returns public rows not delisted, sorted by players then age. Heartbeats upsert; rows silent for 3 minutes are dropped. Creation rate limits live here (one place): per ip and per token. Reports: three distinct identities set `delisted`; the admin list shows reports and can clear them.

### 10.4 Abuse controls (O15)

| Control | Numbers |
|---|---|
| Room creation | 5 per hour per ip, 5 per hour per identity |
| Joins | 30 per hour per ip |
| Wrong passwords | 10 per 10 minutes per ip, then `bye rate` for 10 minutes |
| Chat | 5 per 5 s per player |
| Reports | 3 per hour per identity; 3 distinct reporters delist a room |
| Names (room and player) | `shared/words.ts`: a short blocklist the owner edits, matched after lower-casing, stripping spaces and punctuation and mapping 0→o, 1→i, 3→e, 4→a, 5→s, 7→t; a hit replaces the name with `Table 7KQ2MX` or `Player 3` |
| Admin key | `x-admin-key` header; the admin page is `#/admin` in the app, which asks for the key once per session and shows every room with Delist and Close |

Chat text is not filtered (Section 5.5).

### 10.5 Limits (`limits.ts`)

8 players per room; 5,000 cards; 64 KB messages, 256 KB snapshot parts; 10 Hz streams (the server drops a player's extra stream messages beyond 15 a second); 100 chat lines; nickname 1 to 20 characters, room name 1 to 60, password 1 to 32; 1,000 public rooms listed at most.

### 10.6 `wrangler.toml`

```toml
name = "card-manipulator-rooms"
main = "src/worker.ts"
compatibility_date = "2026-10-01"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "Room"

[[durable_objects.bindings]]
name = "LOBBY"
class_name = "Lobby"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Room", "Lobby"]

[vars]
SITE_ORIGIN = "https://dazeyama.github.io"
```

`ADMIN_KEY` is a secret, not a var.

---

## 11. Client changes, module by module

### 11.1 The store is the choke point

Spec 4.2 says everything that changes the table goes through `Store`. Online relies on it: `outbox.ts` wraps the store's mutation methods so that a change made by the local user becomes an op, and a change applied from the network does not.

- `Store` gets `origin: 'local' | 'remote'` (default `'local'`) and a hook `onLocalChange?: (op: Op, inverse: Op) => void`. Each mutation method (`addCards`, `removeCards`, `moveCards`, `addMat`, `moveMat`, `setMatLife`, `setMatLifeHidden`, `setMatName`, `setMatLocked`, `removeMat`, `setDice`, `removeDice`, `replaceDice`, `setBasics`, `setName`, `clear`) calls the hook when `origin === 'local'`. `inbox.ts` sets `origin = 'remote'` around applying a confirmed op.
- **Writes that bypass the store today must be routed through it** (the build's first task, phase O1): `store.named.set/delete` in `named.ts` and `saveFile.ts`; `store.spreads.set/delete` in `commands.ts` and `saveFile.ts`; direct `card.x = ...` assignments anywhere outside the store (grep `\.cards\.get\(.*\)\.(x|y|z|yaw|faceUp|stand|side) =` and `store\.(named|spreads)\.(set|delete)`). Add `setNamed(set, remove)` and `setSpreads(set, remove)` to the store; they emit `piles` as the direct writes relied on.
- `shared/apply.ts` is the pure twin: `applyOp(table: TableState, op: Op): TableState` with no events, used by the server for its mirror and by the client's `inbox.ts` to compute the inverse before applying remote ops when needed. `tests/apply.test.ts` proves that applying an op to a `TableState` built from a `Store` and applying the same op through the store give the same `TableState`.

### 11.2 New: `src/online/*`

| File | Does |
|---|---|
| `identity.ts` | `getIdentity()`, `setNickname`, `setColour`; makes the token on first use |
| `session.ts` | `connect(code, key?)`, `disconnect()`, reconnect with backoff, `send(msg)`, dispatch by `t`; the version check; `bye` handling to the screens of 12.7 |
| `room.ts` | `RoomState { code, me, crown, maker, players, settings, rank, locked, downloads, connected }` with an `Emitter` (`players`, `settings`, `crown`, `me`, `connection`); `isCrown`, `canDo(action)` |
| `outbox.ts` | the store hook; pending `{id, op, inverse, uids}`; `refused` rollback with the touched check; the undo precondition |
| `inbox.ts` | applies `op`, `reveal`, `forget`, `snapshot`; `replace` handling; `reuid` |
| `authority.ts` | crown only: `judge(op, from)` → confirm or refuse; `heldBy`, `touchedSeq`, the one-stand check, the stand owner check, the cap; `reuid` after shuffles; `spill`; the periodic `snapshot` to the server; `becomeCrown(parts, queued)` and `resign()` |
| `streams.ts` | `OutBatcher` (10 Hz, cursor, side, selection ≤ 2 Hz, holds, flights) and `InBuffers` (per uid 100 ms interpolation) |
| `presence.ts` | remote cursors as DOM (`.remote-cursor` with a tag), remote holds and flights into `layer.pose`, remote selections into the per-instance glow colour, `held: Set<uid>` for picking and detection |
| `hidden.ts` | `HIDDEN`, `canSee(card)`, the record lookup wrapper |
| `link.ts` | `parseHash()`, `roomLink(code)`, `inviteLink(code, key)`, `copy()` |
| `guard.ts` | `allowed(action)` with toasts; `disable(button, action)`; wraps the key map and the mouse grammar's drag start |

### 11.3 Changes to existing modules

| Module | Change |
|---|---|
| `state/types.ts` | `Mat.owner?: string`; `TableDoc.cards[].hidden?: true`; `Card.heldBy` is **not** added (holds live in `authority`/`presence`) |
| `state/store.ts` | `origin`, `onLocalChange`, `setNamed`, `setSpreads`, `renameCards(pairs)` (for `reuid`) |
| `state/history.ts` | `CardSnap` is reused by `shared/`; `TableSnap` gains `mats`, `dice`, `basics`, `name` so it is a `TableState` |
| `state/stand.ts` | `ownerOf(m)`, `isOwnedBy(m, player)`, `fullStandsOf(store, player)` |
| `app.ts` | `online: Online | null` (the room layer), `slotsFor` draws backs for `HIDDEN` |
| `main.ts` | boot: parse `#/room/...` before restoring autosave; the Online button; key map wrapped by `guard`; `M` sends `side` in the next stream; the stand button's one-stand rule; the Cast window renders through the hidden gate |
| `physics/feel.ts` | `begin()` asks `authority`/`outbox` for a `grab` first (optimistic); streams held poses through `streams.ts`; `land()` unchanged (store.moveCards makes the op); refuses to begin on remote-held uids |
| `dice.ts` | the same for dice: `grab`, held streams, roll results in `dice set` |
| `physics/world.ts` | marks bodies launched locally; `Physics.step` feeds `fly` poses to the batcher; remote flights do not get bodies |
| `physics/restSync.ts`, `state/pileSync.ts` | skip `presence.held` uids |
| `render/cards.ts`, `render/dice.ts` | per-instance glow colour attribute; a `tint` map from `presence` |
| `render/picking.ts` | skips remote-held uids |
| `render/hires.ts`, `ui/inspectPanel.ts`, `ui/hud.ts`, `ui/handCount.ts`, `ui/exportPanel.ts`, `io/exportDecklist.ts`, `io/exportCsv.ts`, `ui/tokenMenu.ts`, `ui/tray.ts`, `ui/cubeTab.ts`, `commands.ts` (C, E, colour layouts) | the hidden gate (Section 7.3) |
| `query/evaluate.ts` callers | hidden cards never match; the HUD line |
| `io/saveFile.ts` | `hidden` cards out and in; `loadDoc` online = a `replace` op from the crown; `toDoc` for Save a copy |
| `io/autosave.ts` | pauses while a non-crown player is in a room (their own table stays saved); the crown's autosave is unchanged |
| `undo.ts` | online: builds ops with the `touchedSeq` precondition instead of swapping the store directly |
| `mats.ts` | stand ownership: plate shows the owner's nickname by default; the owner-only grammar (`press` refuses others with a toast); **Claim**, **Release**, **Give to…**, **Spill** on the plate's menu by rank; the one-full-stand rule in `spawnStand` (offline too, O32) |
| `ui/standTab.ts`, `ui/playmatTab.ts` | name field prefilled with the nickname online; buttons disabled by rank and the one-stand rule with titles |
| `ui/topBar.ts` | the **Online** button and the avatar row; the lock icon; "Reconnecting…" |
| `ui/helpPanel.ts` | an **Online** group (Section 13) |
| `ui/cursors.ts` | unchanged for your own cursor; remote cursors are `presence.ts` DOM |
| `styles/app.css` | `.online-panel`, `.player-row`, `.chat-strip`, `.remote-cursor`, `.table-browser`, `.join-prompt`, `.room-closed` |
| `index.html` | nothing: `#/room/...` is a hash route handled in `main.ts` |
| `public/welcome-table.json` | unchanged; the welcome *screen* gains a **Join a table** link |
| `dev/regression.ts` | `__room()` opens a second tab joined to the current room for the gate; `__bots(n)` adds n fake players streaming cursors for the performance pass (dev only) |

---

## 12. UI

### 12.1 Top bar

- Offline: a **Go online** button (🌐) at the right of the table name. Disabled with "No room server" when `VITE_ROOM_SERVER` is unset or `/api/version` fails.
- Online: the button reads **Online** and is lit; beside it a row of up to eight **avatars**, coloured discs with the nickname's first letter, the crown's with 👑, greyed when away, yours outlined. A 🔒 after them while Lock table is on. Clicking the button or an avatar opens the Online panel. While reconnecting, the row shows "Reconnecting…" in amber.
- The table name stays editable for the crown only online; others see it as text.

### 12.2 The Online panel (O58)

Floating, 380 px wide, docked to the right under the top bar, draggable by its header, closes with its ✕ or Esc. Sections, top to bottom:

1. **Room.** Name and code: "Vintage cube pass 3 · 7KQ2MX". Buttons: **Copy link**, **Copy invite link** (only with a password), **Save a copy** (when Downloads is on), **Tables** (opens the browser, Section 12.5), and **Go offline** (crown; confirm: "Close the room for everyone? Your table stays as it is.") or **Leave** (others; confirm when you hold cards or own a stand with cards: "Leave the room? Your stand waits for you until the room closes."). Under the link, one grey line: "The room lives while someone is in it."
2. **Settings** (crown edits; others read): Visibility radio **Unlisted · Public · Public + password**, the password field; **Tag** Cube / Play; **Newcomers start as** picker; **Lock table** switch; **Downloads for everyone** switch.
3. **Players.** One row per player: swatch (yours clickable: a popover of free colours), nickname, side arrow (↑ near, ↓ far), rank picker (crown; a label for others), 👑 on the crown, "away" when disconnected, and for the crown a ⋯ menu: **Pass crown**, **Kick**, **Ban**, **Give stand to…** when they own none and an unowned stand exists.
4. **Chat.** The strip (Section 5.5) and its field "Say something…".

Before going online (offline), clicking **Go online** opens the same panel in a short form: the room name (the table's), the Tag, Visibility and password, and a **Go online** button; then it fills in.

### 12.3 The join prompt (O64)

A modal over the empty table: title "Join *Vintage cube pass 3*", "3 of 8 players · hosted by Dazey". Fields: **Nickname** (prefilled), the eight **colour** swatches with taken ones greyed, **Password** when needed and not in the link. Buttons **Join** and **Not now** (goes to your own table). Errors inline: "Wrong password", "The room is full", "That name is not allowed" (the filter), and the states of 12.7.

### 12.4 Toasts and refusals

Joins and leaves: "Sam joined as Move", "Sam left", "Sam is back". Crown: "You are the crown now", "Sam is the crown now", "Dazey took the crown back". Permissions: "Move or higher needed", "Cards or higher needed", "Only the crown can do that", "The table is locked", "The table is unlocked". Holds and stands: "That card is in Sam's hand", "Only Sam can touch that stand", "You already have a hand stand", "Someone else has moved those since" (undo). Cap: "The table is full: 5,000 cards". Each is one toast of 2 seconds, no stacking of duplicates.

### 12.5 The table browser (O13, O14)

Opened by **Tables** in the Online panel or **Join a table** on the welcome screen. A list, refreshed every 10 seconds while open and by a **Refresh** button, filter chips **All · Cube · Play**. Each row: name, `3/8`, 🔒 for a password, the crown's name, the tag, the card count, and how long it has been up ("2 h"). **Join** on the row (asks the password in the join prompt). A row's ⋯ has **Report**. Empty: "No public tables right now. Go online and set yours to Public to be the first."

### 12.6 The welcome screen

The first-visit welcome (decision 153) gains one line under its heading: "Playing with friends? **Join a table** or press Go online once your table is ready."

### 12.7 Whole-page states

- **Room closed:** "The room has closed." **Save a copy** (when it was allowed) and **Back to my table**.
- **Kicked / Banned:** "You were kicked from the room" / "You were banned from this room", **Back to my table**.
- **Reload to update:** "This page is older than the room server. Reload to update." **Reload**.
- **Desktop only** (O53): "Card Manipulator rooms need Chrome or Edge on a desktop. Room: *Vintage cube pass 3*."
- **Quota:** "The room server is over its free daily limit. Rooms are back after midnight UTC." (Section 15.)

### 12.8 The admin page (O15)

`#/admin`: asks for the key once per session (kept in `sessionStorage`), lists every room with code, name, players, visibility, reports, since, and **Delist** / **Close** buttons. Plain, for the owner.

---

## 13. Keys and the help panel

No new keys. **M** keeps its meaning and is how you cross the table online. Enter in the chat field sends; keys stay inactive while it has focus (spec 16). The help panel gains an **Online** group:

| Icon | Keys | What |
|---|---|---|
| 🌐 | Go online | share your table by link; the panel has the link, settings, players and chat |
| 👑 | Crown | the host: ranks, kicks, settings, Lock table; passed in the player row |
| 🪪 | Ranks | View · Move · Tokens · Cards · Everything; the crown sets them |
| 🂠 | Hidden | your stand's cards and face-down cards show their backs to others |
| M | M | cross to the far side of the table |

---

## 14. Tests

Pure modules, vitest, all added in the phase that introduces them:

| Test | Covers |
|---|---|
| `permissions.test.ts` | every row of 6.2: `needs(action)`, `allowed(rank, action)`, Lock table, the Tokens-may-remove-tokens rule |
| `redact.test.ts` | `canSee` for stands, owners, face-down; `redactSnapshot`; visibility diffs produce the right `reveal`/`forget` for flips, stand on/off, owner change, spill |
| `apply.test.ts` | every op on a `TableState`; store-vs-pure equivalence; `reuid` renames everywhere; `spill` output |
| `protocol.test.ts` | `PROTOCOL`, message guards (`isClientMsg`), size limits, snapshot part splitting and joining |
| `roomCode.test.ts` | alphabet, length, `isCode` |
| `words.test.ts` | the filter's normalisation and replacements |
| `rateLimit.test.ts` | sliding windows |
| `election.test.ts` | highest rank, earliest join among equals, maker reclaim, nobody left |
| `outbox.test.ts` | inverses for each op kind; rollback skips uids touched since; undo preconditions |
| `link.test.ts` | `#/room/CODE`, `?key=`, invite links round-trip |
| `stand.test.ts` (extended) | one full stand per player, unlimited small, `ownerOf`, offline one-stand rule |

The server itself is tested in the phase gate with `wrangler dev` and two tabs; `tests/server/` with `@cloudflare/vitest-pool-workers` is an agent decision for a later phase if the gate keeps finding server bugs.

---

## 15. Performance and the free tier

**Client budget** (spec Section 17 still applies): remote presence costs one DOM element per cursor (7), one `layer.pose` write per held or flying uid per frame (tens), the glow attribute upload only when a selection or hold changes, and one projection per cursor per frame. Target: no measurable change to the 2,000-card stress table's frame time with 7 bots streaming (`__bots(7)`).

**Server budget on the free plan** (figures of 3.2):

| Item | Per hour of a full 8-player room | Notes |
|---|---|---|
| Stream messages | 8 × 10 Hz × 3,600 = 288,000 messages = **14,400 requests** at 20:1 | the dominant cost; the 100,000-a-day allowance is about **7 hours a day of a full room**, 28 of a two-player room |
| Ops and chat | a few thousand messages = a few hundred requests | |
| HTTP (browser list, joins) | the list polls every 10 s only while open | |
| Duration | 0.125 GB × 3,600 s = **450 GB-s** | 13,000 a day ≈ 29 room-hours a day; idle rooms hibernate and cost nothing |
| SQLite writes | a few hundred rows | 100,000 a day allowed |
| Storage | under 1 MB per room, deleted on close | |

When Cloudflare refuses for the day (HTTP 429 or a 1027 error page), the client shows the **Quota** state (12.7) and the Online panel says "Rooms are back after midnight UTC". The $5-a-month Workers Paid plan removes the request cap (O4: the owner starts free and decides later). The design keeps streams at 10 Hz and batched so the free hours stay useful; a future `streams.ts` over WebRTC would take them off the server entirely (Section 1.3).

---

## 16. Build phases (O54, O57)

**How the run is organised** (one hub, three area forks sharing this folder, freezes at the gates, ports, git rules, the fork briefs): `ONLINE_PROMPT.md`, decisions O82 to O92.

Each phase ends with the phase gate of spec Section 0.1 (typecheck, tests, build, a two-tab browser check with screenshots under `reports/screenshots/online-N/`, a local commit) and a morning report section: what was built, gate results, screenshots, commit, agent decisions (O-numbered), BROKEN items, and the owner's **Where to look** list. The built-in browser cannot hold modifier keys during drags (CLAUDE.md gotcha); where a check needs them, the report says the check was done with synthetic events.

### Phase O1: rooms by link

**Build:** `shared/` (protocol, ops, table, apply, roomCode); `server/` (worker, Room with meta, mirror, op log, relay, streams, chat, handover, maker reclaim, close on empty; a minimal Lobby that only tracks heartbeats); the store choke point (11.1); `src/online/` identity, session, room, outbox, inbox, authority, streams, presence (cursors, holds, flights, selection colour), link; the Online button, panel (Room, Players without rank pickers, Chat), join prompt, the whole-page states, the welcome link; version check; phones page; reconnection; `concurrently` dev script; the workflow's worker job (not run: nothing is pushed). Everyone is Everything in this phase; no hiding yet.

**Where to look:**
- Tab A: a table with 200 cards, press **Go online**: the panel shows a code and **Copy link**; the top bar shows your avatar with a crown.
- Tab B: open the link: the join prompt, pick a colour, Join: the same 200 cards appear, the camera at the default view; A's avatar row shows two players.
- Drag a card in A: B sees it float in A's colour and land where A put it. Toss one: B sees the flight. Both drag the same card at once: the second gets "That card is in …'s hand".
- Move the mouse in A: B sees A's arrow and name tag on the felt where A points, following the camera.
- Select ten cards in B: A sees them glow in B's colour; A's own selection stays blue.
- Chat both ways; a grey line for the join.
- Close tab A: B gets "You are the crown now" within a second and can keep playing. Reopen the link in a new tab from A's browser: the crown comes back to A ("Dazey took the crown back"); B keeps its rank.
- Press **Go offline** in A: B sees the Room closed screen with Save a copy; A's table is unchanged offline.
- Close every tab: the link now shows "This room has closed".

### Phase O2: permissions and hidden information

**Build:** ranks and `shared/permissions.ts`, the newcomer rank, rank pickers, kick and ban, Lock table, Downloads, `guard.ts` across keys, buttons and the mouse grammar; stand ownership (owner, nickname plates, one full stand, unlimited small, Claim, Release, Give to…, Spill), offline one-stand rule; `shared/redact.ts` on the server with reveal and forget, `reuid` after shuffles, the hidden gate through every module of 7.3, hidden cards in Save a copy and exports; Cast hidden online; the undo precondition.

**Where to look:**
- A is crown, B joins as Move (the default): B can drag cards but the Spawn panel's buttons are disabled with "Cards or higher needed"; A sets B to Cards in the row: B spawns a decklist and A sees it arrive.
- B spawns a stand: the plate reads B's nickname; B deals five cards onto it: A sees five backs on B's stand from any camera angle, with the count badge; A's hover shows nothing on them; A cannot pick them off ("Only Sam can touch that stand"). B's second Card stand button is disabled.
- B flips one of those cards face down on the table: everyone sees a back; B shuffles the face-down pile (S S); nobody can tell which is which afterwards.
- B puts a card face up on the table: A sees the face at once (the reveal).
- Lock table in A: B's drag gets "The table is locked"; unlock: B's rank is back.
- B leaves with cards on the stand: A sees the stand wait, backs showing; A's plate menu has **Spill**: the cards drop face down in front and the stand goes.
- Save a copy from B (Downloads on): the file lists A's stand cards as `hidden`; open it offline: backs that never resolve.
- Downloads off in A: B's Save a copy and Export panel vanish.
- Kick B: B sees the kicked screen and can rejoin; Ban B: B cannot.

### Phase O3: the public browser

**Build:** visibility, password (hash, invite link), tag, the Lobby's public list and heartbeats, `tableBrowser.ts`, the welcome link to it, rate limits, `shared/words.ts`, reports, the admin page and key.

**Where to look:**
- Set the room to Public + password in A, Tag Play: the **Tables** list in a third tab shows the row with 🔒, players, crown, card count and age; Join asks for the password; the wrong one says so; the right one joins; Copy invite link from A pasted in a fresh tab joins without asking.
- Unlisted: the row disappears within a minute.
- A blocklisted room name shows as "Table 7KQ2MX" in the list.
- `#/admin` with the key lists the room; Close ends it for everyone.

### Phase O4: polish and the open items

**Build:** the quota state and notice; interpolation tuning (the 100 ms buffer, the 120 ms landing ease) against two tabs with throttled network (Chrome's devtools "Slow 3G" via the built-in browser if available, else `__latency(ms)` in dev to delay sends); `__bots(n)` and a performance pass with 7 bots on the 2,000-card table; the help panel group; the spec and CLAUDE.md updates for anything that moved; Appendix B items that fit.

**Where to look:** the 2,000-card table with `__bots(7)` running stays at the Section 17 frame budget; a 300 ms artificial latency still feels right for your own drags (instant) and shows others 100 to 400 ms behind without jitter.

---

## 17. Deferred (explicitly)

- WebRTC for streams (keeps rooms free of the request cap).
- A short grace period for an empty room so a reload by the last player keeps the link (O61 chose closing at once; revisit if it annoys).
- Voice, a ping gesture, follow and summon, camera footprints.
- Spectators past eight; phones and tablets.
- Accounts, moving an identity between browsers (the 4-digit PIN idea).
- Per-player Download exceptions (O50 chose room-wide).
- A second seat in one browser (the Cast window as a player).
- Cheat-proofing against the crown (needs a server that knows the rules).
- Server tests with `@cloudflare/vitest-pool-workers`.
- Persisting rooms past their last player (hosted tables).

---

## Appendix A: Decisions (rooms)

Owner answers of 2026-10-30 are recorded as such; **(agent)** marks a choice made here with its reasoning.

| # | Decision |
|---|---|
| O1 | Owner (2026-10-30): the room server runs on **Cloudflare Workers + Durable Objects**, free plan, one free account. The static site stays on GitHub Pages. |
| O2 | Owner: **the crown's browser is the truth** for the table: it orders and applies every player's actions; the server relays. |
| O3 | Owner: **physics is simulated by the player doing it** (toss, flick, dice roll), streamed to the rest; the landing pose and die value are what they report. Trusts players, like IRL. |
| O4 | Owner: **free tier**, no card on file; if a limit is hit the app says so. The $5 plan is the escape hatch. |
| O5 | Owner: when the crown's tab closes or drops, **the crown passes at once**; an empty room closes. |
| O6 | Owner: the **maker always gets the crown back** automatically on return. |
| O7 | Owner: **Go online publishes the table you have**; the link appears; the autosave is the room's state. |
| O8 | Owner: the crown can **Go offline any time**, closing the room for everyone; others get Save a copy; the crown's table stays as it stands. |
| O9 | Owner: a joiner's own table is **kept aside and restored when they leave**; Save a copy downloads the room's table. |
| O10 | Owner: visibility is **Unlisted, Public, or Public + password**; new rooms are Unlisted. |
| O11 | Owner left the address open between a six-character code and three words. **(agent)** A **six-character code** from a 31-letter alphabet without look-alikes: shorter to type from a phone screen and fits the browser row. |
| O12 | Owner: **Copy invite link** carries the password in the fragment; **Copy link** does not. The browser never shows it. |
| O13 | Owner: each browser row shows **name, players (3/8), lock, the crown's name, the tag (Cube or Play), the card count and how long the room has been up**. |
| O14 | Owner: the browser lives **in the Online panel, with a Join a table link on the welcome screen**. |
| O15 | Owner: abuse controls: **rate limits per browser and ip, a word filter on room and player names, an admin key for the owner, and a Report button** (three reports delist until the owner looks). |
| O16 | Owner: **eight connections per room, no spectators** beyond them; a full room's row reads Full. |
| O17 | Owner: identity is **a nickname remembered per browser** with a secret token; no accounts. |
| O18 | Owner: **cursors are always shown and can never be hidden**; each player's colour is picked **on join from the untaken colours of a fixed set of eight**, and can be swapped to another free one from their own row later. (Replaces the earlier auto-assignment answer.) |
| O19 | Owner: a dropped player's **seat, rank, colour, stand and crown claim are kept until the room closes**; the same browser gets them back. Held cards drop. |
| O20 | Owner: the crown is passed by **clicking a player and confirming**; the old crown keeps Everything. |
| O21 | Owner: ranks are **a ladder: View, Move, Tokens, Cards, Everything**, one per player. |
| O22 | Owner: the newcomer rank is **a room setting, Move by default**. |
| O23 | Owner: **the crown alone** changes ranks, kicks and bans, starts a New table or loads a file, changes room settings, passes the crown and closes the room. "Admin only" is the crown. |
| O24 | Owner: **Everything is full table access and nothing more**: it includes spawning and removing playmats and removing or spilling others' stands; nothing about the room or players. |
| O25 | Owner: **removing cards needs Cards**, the same rank as spawning them. |
| O26 | Owner: **moving, turning, locking and unlocking playmats and stands is Move** ("all of it at Move"). |
| O27 | Owner: **stands are owned by whoever spawns them, with their nickname on the plate by default, and each player may own one full-size stand at a time**; others may not take cards off it or move it. Small stands are **unlimited**. |
| O28 | Owner: hidden information is **redacted by the server when relaying**, the crown's browser staying the authority (chosen over trust-based hiding, and over the crown's browser redacting, since the server must hold a full copy for handovers anyway). The crown's browser holds everything. |
| O29 | Owner: other players see the cards on your stand as **backs, whatever the camera does**; the count badge stays. |
| O30 | Owner: **no private peek** at face-down cards: flipping is public; take a card to your stand to look. |
| O31 | Owner: a departed player's stand **stays, backs shown, waiting for them; the crown can Spill it** (cards face down in front, stand removed). |
| O32 | Owner: the stand rules apply **offline too**, where **the whole offline table is one player**: one full stand at a time offline, small stands unlimited, no hiding offline. |
| O33 | Owner: you see other players' **held cards and dice floating live, their selections outlined in their colour, and their tosses and rolls animated**; no camera footprints. |
| O34 | Owner: **no follow, no summon.** |
| O35 | Owner: **a small text chat**, a strip in the Online panel, last 100 lines, nothing saved. |
| O36 | Owner: **two sides**; everyone starts on the near side and **presses M to cross**, like walking round a real table; players move between sides freely (no per-side cap). |
| O37 | Owner: a joiner's camera starts at **the default offline view**. |
| O38 | Owner: **no automatic playmat or stand** on join; players spawn their own, like IRL. |
| O39 | Owner: the **Cast window (📺) keeps working online, hiding what the viewer may not see**: it draws backs for hidden cards like the main view. (The first answer, "offline only", was to a mis-described question and was reversed the same day.) |
| O40 | Owner: **first grab holds**; nobody else can take a card or die until it lands. |
| O41 | Owner: Ctrl + Z online **undoes your own last action, refused if anyone has touched those things since**. |
| O42 | Owner: **each browser fetches its own card data from Scryfall** through its queue; rooms carry only Scryfall ids. |
| O43 | Owner: a room's table holds at most **5,000 cards**, plus mats, dice and stands. |
| O44 | Owner: the Settings panel is **all personal**; the table is what is shared. |
| O45 | Owner: **everything travels over the room server's WebSocket**, streams batched to 10 Hz; the free plan allows roughly seven hours a day of a full eight-player room. |
| O46 | Owner: the server lives in **`server/` in this repository, deployed by the same GitHub Actions** with a Cloudflare API token as a repository secret. |
| O47 | Owner: **`npm run dev` starts Vite and a local room server together**; two tabs can host and join. |
| O48 | Owner: on a protocol mismatch **the browser shows Reload to update**; the server speaks one version. |
| O49 | Owner: **Kick and Ban are separate**; Ban blocks the browser for the room's life. |
| O50 | Owner: **Download is a room-wide permission**, on or off for everyone but the crown; a copy keeps hidden cards as backs. |
| O51 | Owner: **Lock table**, one switch for the crown, makes everyone View until released; ranks come back on unlock. |
| O52 | Owner: **life totals and dice are anyone's at Move**; only stands are owned. |
| O53 | Owner: **desktop Chrome and Edge only**; phones see a desktop-only page naming the room. |
| O54 | Owner: build order: **rooms by link, then permissions and hiding, then the public browser, then polish**. |
| O55 | Owner: **this file keeps its own decision log (O1, O2, ...)**; `design_spec.md` Appendix A has one pointer, decision 288. |
| O56 | Owner: the document goes **all the way down**: protocol messages as TypeScript, server layout, module-by-module client changes, UI text, tests, deploy steps. |
| O57 | Owner: the phases are built in **autonomous overnight mode with morning reports** and Where to look lists; the gate's browser check uses two tabs. |
| O58 | Owner: the online UI is **an Online button in the top bar opening a floating panel**: link buttons, settings, player rows, chat; avatars in the top bar. |
| O59 | Owner: **your own hand stand and small stands spawn at Move**; playmats and removing others' stands need Everything. |
| O60 | Owner: the Card tab's **basic land chips are Tokens** rank. |
| O61 | Owner: an **empty room closes at once**; a new link every time the last tab closes. |
| O62 | Owner: an automatic crown pass goes to **the highest rank present, longest-present among equals**; the maker reclaims on return. |
| O63 | Owner: your own actions are **applied at once and rolled back if the crown refuses**, with a short message. |
| O64 | Owner: the join prompt asks for **nickname, a free colour, and the password when needed**; everyone arrives on the near side. |
| O65 | **(agent)** Unowned stands (loaded from a file, or beyond the crown's one when going online) hide their cards from everyone, as a face-down pile would; **Claim** on the plate (Move, if you own no full stand; Everything regardless) takes one; Everything may Spill it. Going online, the crown's browser claims the full stand nearest its side and every small stand without an owner. Reason: every stand needs an owner for O27 and O29 to mean anything, and claiming is the least automatic way to give one. |
| O66 | **(agent)** A **shuffle of hidden cards gives them fresh uids** (`reuid`, crown only), and an honest browser **forgets** a card's identity when it becomes hidden. Reason: uids are stable, so without re-keying a browser could follow a card it once saw through a shuffle; forgetting on hide matches O30 (no peek) and costs nothing. |
| O67 | **(agent)** A **Tokens player may remove token cards** (record layout `token`, `emblem`, `double_faced_token`) and dice, mirroring O25's "adding and taking away are one power". |
| O68 | **(agent)** **Chat is not filtered** by the word list; names are. Reason: the owner chose the filter for room and player names, chat is private to the room, and the crown can kick. |
| O69 | **(agent)** Rate-limit numbers of Section 10.4 (5 rooms an hour, 30 joins an hour, 10 wrong passwords in 10 minutes, 5 chat lines in 5 seconds, 3 reports delist). Reason: generous for friends, tight for a script; all in `limits.ts` to tune. |
| O70 | **(agent)** The server stamps `seq` (not the crown), keeps an **op log between 30-second snapshots**, and rebuilds its mirror from them after hibernation, asking the crown for a fresh snapshot. Reason: handovers continue the sequence without the crown; the log keeps SQLite writes to hundreds of rows an hour. |
| O71 | **(agent)** New dev dependencies **`wrangler`** and **`concurrently`** (decision 35): the first is Cloudflare's tool, the second runs it beside Vite for O47. |
| O72 | **(agent)** A **joiner's autosave pauses** while in a room; the room's table is never written to their IndexedDB. Reason: O9 keeps their own table untouched, and a reload rejoins by the link anyway. |
| O73 | **(agent)** The **default Tag** when going online is Play if the table has a playmat or stand, else Cube; the crown can change it. Reason: one less thing to set for the common case, and it is only a label. |
| O74 | **(agent)** A **departed holder's cards drop three seconds after their socket closes**, by a `move` the crown issues to the last streamed poses. Reason: cards must never hang in the air; three seconds survives a blip. |
| O75 | **(agent)** **Hidden cards in a saved copy** are written as `scryfallId: 'hidden'` with `hidden: true` in table format version 1 (optional field, as earlier additions), drawn as backs forever. Reason: no new format version for a field every old file simply lacks. |
| O76 | **(agent)** The **colour set** of Section 5.2 (red, orange, yellow, teal, blue, violet, pink, white). Reason: far apart on green felt and in small tags; the accent blue stays the local selection's. Kept by the owner on review (2026-10-30). |
| O77 | Owner (2026-10-30, preparing the run): the **Cloudflare account is made before the run**, walked through step by step; the run learns the `workers.dev` URL from `wrangler deploy`'s output and writes `.env.production` itself. |
| O78 | Owner: **removing dice is Tokens**, as written (not Move). |
| O79 | Owner: the **word filter list is the agent's short standard list** (about 40 entries) in `shared/words.ts`, the owner's to edit later. |
| O80 | Owner: **the run may deploy the Worker** after each phase gate, using `npx wrangler@latest login` done by the owner beforehand; never a token in chat. The site is still pushed only by the owner. |
| O81 | Owner: the **phase gate's two-tab browser check runs at every gate**, screenshots and clean consoles included. |
| O82 | Owner: **Opus 5.5** runs the hub and the forks. |
| O83 | Owner: **three forks plus the hub**, split by layer: Server / Sync / Rules & UI (`ONLINE_PROMPT.md` Section 3), the hub seeding the contracts first. |
| O84 | Owner: the forks **share this folder on `main`** under the PUG Pricing Tool's rules (stage by path, never `-A`, stash, reset or amend; numbers from disk; small Edits to shared docs; `git status` before another area's file). |
| O85 | Owner: **fully unattended**: the hub decides every question as an (agent) decision; nothing waits for the owner. |
| O86 | Owner: **one review pass at the end** of the run, by a reviewer subagent over the whole diff, not at every gate. |
| O87 | Owner: during a gate the forks **freeze** (commit a type-clean state, pause edits until the hub says go); the hub gates the shared folder, never a second checkout. |
| O88 | Owner: the run goes **to completion**: it stops when the O4 gate passes or a phase has only BROKEN items left. |
| O89 | Owner: `ONLINE.md` **stands as the brief**, with the day's three changes (O39 revised, O79, O80). |
| O90 | **(agent)** A dev-only **`?player=<name>` query namespaces the identity key**, so two tabs of one browser are two players in the gate and in `__room()`. Reason: `localStorage` is per origin, not per tab; without it a one-machine test is one player. |
| O91 | **(agent)** **One vite and wrangler port pair per session** (hub 5173/8787, Server 5174/8788, Sync 5175/8789, Rules & UI 5176/8790), each wrangler with its own inspector port and `--persist-to` state folder, and a `.env.<mode>` per pair. Reason: four dev servers in one folder must not share ports or local Durable Object state. |
| O92 | **(agent)** The Worker deploys from **its own GitHub workflow** (`worker.yml`, on pushes touching `server/**` or `shared/**`), not a job the Pages deploy waits on. Reason: a missing Cloudflare secret or a failed deploy must never take the site down with it; the protocol version check covers a short mismatch. Replaces Section 3.5's first draft. |
| O93 | **(agent, hub, 2026-10-30, seed)** The contracts as seeded add four things to Sections 8.2 and 9: a **`batch` op** (several ops judged, confirmed, applied and refused as one: an undo swap, a spill's `move` + `mat remove`, any action that writes the store more than once); the undo precondition as **`pre`** on the `op` envelope (uid → last seq seen); a **`propose`** server message carrying another player's op to the crown (with `from`), distinct from a confirmed `op` (with `seq`); and **`needSnapshot`** from the server to the crown after a hibernation wake. **`CardMove`** also carries `stand`, `side`, `pileId`, `spreadOf` and `laidAt` (null clears), since landings set them and every browser must agree; `Mat.owner` and `TableDoc.cards[].hidden` are in `types.ts`. `TableState` is plain arrays; snapshot part 0 carries everything but the cards plus `count`. Reason: each was implied by the design (8.6's set of undo ops, 4.5's queued proposals, 10.2's wake, 11.1's routed writes) but had no shape; fixing them before the forks start keeps three areas compiling against one contract. |
| O94 | **(agent, hub, seed)** **`@cloudflare/workers-types`** as a dev dependency for `server/tsconfig.json` (decision 35), beside wrangler 4.156 and concurrently 10. Shared numbers both sides check (8 players, 5,000 cards, message sizes, 1,000 cards a part, name and chat lengths, the eight colours) and `playerIdOf(token)` live in `shared/protocol.ts`; the server's own rates stay in `server/src/limits.ts`. |
| O95 | **(agent, hub, seed)** The hub's vite runs on **5177**, not 5173: the owner's own `start.bat` dev server (started 2026-10-29 from Explorer) holds 5173, and the run does not stop the owner's processes. Wrangler stays on 8787. `npm run dev` and `start.bat` are unchanged (5173 + 8787). Replaces O91's hub port. |
| O96 | **(agent, Rules & UI, 2026-10-30)** Phase O1's UI choices: (1) there is no welcome *screen* (decision 153 is only the welcome table), so 12.6's line goes in a small **first-visit welcome note** over the welcome table, "Playing with friends? Join a table or press 🌐 Go online once your table is ready."; until Phase O3 its **Join a table** opens a box for pasting a room link or code (`codeFromText`), then the table browser. (2) **Esc closes the Online panel** only while the focus or the mouse is in it, so Esc on the table keeps cancelling drags and clearing the selection. (3) A page opened on a room link **pauses autosave from boot** (`Autosave.paused`) until its own table is back or the room takes over, since the camera settling would otherwise save the empty page over the browser's own table. (4) The Go online short form also asks **your nickname and colour** (the crown needs both); visibility and password join it in Phase O3. (5) Pages beyond 12.7 for joining: "The room server can't be reached" with Retry, and "The room is full (8 of 8)" with Retry (4.4). (6) Dev only, `?fakeroom` goes online and joins with `FakeSession` and no server, for building the UI. |
| O97 | **(agent, Server, 2026-10-30)** The Room's behaviour where 10.2 leaves it open: (1) **few row writes** on the free plan: confirmed ops go to the op log in batches (one row per burst, 1 s after the last op), a snapshot rewrites only the parts that changed, meta saves are coalesced to one per turn, and the Lobby keeps its rows in memory (every room heartbeats each minute, so an evicted Lobby is whole again within one); (2) pings are answered by Cloudflare's **auto-response** without waking the object, for the exact text `{"t":"ping"}`; (3) a room's **first crown** (mirror empty) gets `needSnapshot` after its welcome, and joiners who arrive before that get the table when it lands; (4) **proposals are kept until the crown answers**: a hand-over (election, maker reclaim) re-sends every unanswered one to the new crown, so each op is judged once; a confirm from anyone but the crown is ignored, and the crown that loses it to the maker's reclaim gets the mirror's table (its own unconfirmed ops are gone); (5) the same identity on a second socket **closes the older with code 4001** (no reconnect); every `bye` is followed by close code 4000; (6) a crown's `confirm` of **`replace`** may be up to 1 MiB and is relayed to everyone as an ordinary op, keeping `seq` continuous; `table` and `replace` set the room's name; (7) the **cap's backstop** drops a confirm that would add cards past 5,000 and sends `refused cap` to its proposer; (8) the Room's **alarm** (every minute while it exists) closes a room left with no sockets, which covers a maker who never connects and sockets lost to a restart; (9) seats are **reconciled with the open sockets** on each hello and on waking, so after a restart the first player back is crown until the maker returns. Reason: each keeps the room correct through hand-overs, reloads and restarts at the lowest cost on the free plan. |
| O98 | **(agent, Server, 2026-10-30)** Phase O2 on the server: (1) the **password is checked on hello from O2** (with its one-second delay and 10 wrong tries per 10 minutes per ip, counted per room), but only for **newcomers**: a seat already admitted keeps its place when the crown sets or changes the password, so reconnects and kicked players returning are not locked out (Ban is the tool for keeping someone out); an empty password takes it off; (2) **redaction** runs per recipient only for ops that carry identities (`add`, `replace`, through batches) and **visibility diffs** only for ops that can change them (`move`, `mat`), over the cards they name plus every card on a stand they change, remove or spill; (3) a **kick or ban** writes "Sam was kicked/banned" and no "Sam left"; a ban of an away player just blocks them; (4) **Pass crown** sends the old crown the table redacted (its browser forgets what it may no longer see) and sets it to Everything (O20); (5) a confirmed **spill** writes "Ann spilled Bea's stand" from the mirror's owner before the op ("an unowned stand", "their own stand"); (6) **rank changes and renames write no chat line**; other settings write "Room settings changed", Lock table its own two lines. Reason: closest to 4.6, 7.2 and 12.4 at the lowest cost per op; the password needed no more than the hash O2 stores. |
| O99 | **(agent, Server, 2026-10-30)** Phase O3 on the server: (1) the **creation and join limits are off in local development**: `server/.dev.vars` (git-ignored) sets `RATE_LIMITS=off`, `wrangler.toml` sets it on, so a gate's repeated Go online and joins from one machine never trip them; ip limits also skip requests with no `CF-Connecting-IP` (only local ones lack it); the limits are unit-tested (`tests/lobby.test.ts`); (2) a **join** is a new seat only (a seat coming back is not counted), checked in the Lobby so the 30 an hour is per ip across rooms; wrong passwords stay counted per room (O98); (3) the Lobby keeps **rows in memory, flags in SQLite** (reports, delisted), and forgets a room's flags when it closes or falls silent; (4) the **public list** is public and password rooms not delisted, most players first, then longest up; (5) a **report** needs an open room (404 otherwise) and counts against the reporter's 3 an hour; the admin's **Relist** clears its reports; the admin routes are `GET /api/admin/rooms` and `POST /api/admin/rooms/:code/delist`, `/relist`, `/close`, with a 401 for a wrong key, compared in constant time; (6) the **word list** (O79) matches anywhere in the name after stripping spaces, so it leaves out words common inside innocent names ("ass" in glass, "cock" in Cockatrice, "rape" in Grapeshot, "rapist" in therapist); a blocked room name becomes "Table CODE", a nickname "Player N". Reason: the gate and the owner's own testing must not lock themselves out, and the list must not refuse ordinary Magic table names. |
| O100 | **(agent, Sync, 2026-10-30)** Phase O1's sync choices: (1) **one op per action**: every store write of one turn of the event loop goes out as one op, a `batch` when there are several, and nothing goes out while the room's table is still arriving; (2) a **grab adds to the holder's hand** rather than letting go of what they held (8.4 said a grab of something else ends a hold): cards and dice picked up together arrive as two grabs in one turn, and holds still end with the holder's `move`, `remove`, `dice`, `release` or leaving; (3) an own op the crown confirmed **after someone else's on the same cards is applied again**, so every browser ends in the crown's order; (4) a **joiner's table is emptied on joining** (its own stays in its autosave, which stays paused for the whole visit, also if the crown passes to it) and comes back from the autosave on Leave; the maker keeps its table on its first welcome, and any later welcome (a reconnect, a reclaim) takes the room's; the crown ignores a snapshot it did not ask for; (5) **derived writes run only in the browser whose change caused them**: the stand lift of decision 222 acts on local changes only, and pile detection's merges stay local everywhere; (6) streams carry a card's pose as `[x, y, z, yaw, roll + tiltY, tiltX]` (the renderer's ZXY angles, nothing lost) and a die's as the ZXY angles of its turn; a streamed selection is capped at 1,500 uids; (7) `loadDoc` replaces the table in one `replaceTable`, offline too, so Load file online is one `replace` op; (8) socket close codes 4000 and 4001 end the session with no reconnect (O97). Reason: each keeps every browser's table equal to the crown's at the lowest number of ops, and keeps a visitor's own table safe. |
| O101 | **(agent, Server, 2026-10-30)** Phase O4 on the server: (1) **quota**: when the free plan refuses a Durable Object for the day, the Worker answers every route with 429 `{ error: 'quota' }`, and a socket upgrade with a socket that sends `bye quota` and closes (made by the Worker itself, so the client gets a clean signal); a Room whose storage writes are refused carries on from memory, unsaved, rather than failing the players in it; (2) the **wake path** asks the crown for a fresh table only when the mirror was rebuilt with ops replayed from the log past the last snapshot (the log is then compacted by the crown's answer); a room woken by its minute alarm with a snapshot-only mirror costs the crown nothing; exercised locally (workerd hibernates an idle room: woken at seq 3 with 3 ops replayed, then with 0); (3) **caps** so the meta stays far under its 128 KB: 32 seats (the longest-away seat with no stand, not the maker's or crown's, makes way for a new one; none can, `bye full`), 200 bans; (4) the **limits reviewed** against Section 15 and kept: 10 Hz streams with extras past 15 a second dropped; pings answered without waking the object; the minute alarm and Lobby heartbeat cost about 2,900 requests a day per open room (34 idle room-days of the free 100,000); SQLite writes stay in the low thousands a day for an active room (batched log, changed parts only, one meta save per turn); messages 64 KB, snapshot parts 256 KB, `replace` 1 MiB; 2,000 waiting proposals, 500 recent ops. A room with a moving cursor never hibernates, so Section 15's duration figure stands. Reason: a spent day must look like "Rooms are back after midnight UTC", not a broken page, and nothing in a long-lived public room may grow without bound. |
| O102 | **(agent, Rules & UI, 2026-10-30)** Phase O2's UI choices: (1) **one hidden rule on every browser**: `visibleTo(card, mats, me)` of 7.1 plus the `HIDDEN` sentinel, read through `Store.canSee` and `recordOf` (undefined when hidden), on the crown and the others alike, so a card a player has just covered is hidden at once, before the server's `forget`. (2) **Basic lands count as game pieces** wherever they come from: `addAction`/`removeAction` in `permissions.ts` make a set of cards Tokens rank when every one is a token (O67) or a basic land (O60), so the guard and the judge need not know which button spawned them. (3) **Delete on a stand that isn't yours spills it** (cards face down in front) instead of dropping them where they lay, so no removal ever shows a hidden card; the owner deleting their own stand is unchanged. (4) Stand ownership is a **👤 button in the middle of the stand's lip** in a room (whose it is; Claim, Release, the crown's Give to…, Spill), since the plate faces away and the lip already holds 🔒 and ✏️. (5) Hidden cards after **C, C C and E** lie in a face-down row under the layout, 24 mm apart from its left edge. (6) **Going online clears earlier owners** before the crown claims (O65's "other full stands stay unowned"), and stands loaded from a file come in unowned. (7) The table is **read-only while reconnecting** (4.7): the guard refuses table actions with "Reconnecting… the table is read-only for now". (8) Refused buttons stay clickable for their own logic but are **greyed, titled with the reason, and refuse clicks**; Downloads off **hides** Save, Save a copy and Export instead (4.3). (9) A View player can still **click to select** cards and dice; only drags are refused. |

## Appendix B: Open items

- A short grace period for an empty room (reload-proof links); see O61 and Section 17.
- Server tests beyond the gate (`@cloudflare/vitest-pool-workers`).
- The word list in `shared/words.ts` is the agent's short standard list (O79); the owner edits it before or after Phase O3 goes public.
