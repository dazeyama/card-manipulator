# Rooms run: the hub prompt and the fork briefs

How `ONLINE.md` gets built in one unattended run: one **hub** session and three **area forks** (Server, Sync, Rules & UI) sharing this folder on `main`, the way the PUG Pricing Tool's main session and its area forks work. Decisions O77 to O92 in `ONLINE.md` Appendix A are the owner's answers that shaped this file.

## Before you start it (the owner, about ten minutes)

1. **Cloudflare.** A free account exists, the `workers.dev` subdomain is chosen, and you have signed wrangler in on this machine:
   ```bash
   npx wrangler@latest login
   ```
   Check with `npx wrangler@latest whoami`. The run deploys the Worker after each phase gate with this sign-in (O80). If it is missing, the run skips deploys and says so in the report; nothing else changes. The GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are only needed before your first push with server code.
2. **Model:** Opus 5.5 for the new session (O82); the forks inherit it.
3. **Permissions:** bypass (as this project's sessions run). **Keep awake** on. Leave the folder alone while it runs: four sessions edit it.
4. Start a new session in `C:\ClaudeProjects\card-manipulator` and paste everything below the line.

---

You are the **hub** of the rooms run: an unattended build of `ONLINE.md`, all four phases, with three area forks that you start and steer. I am asleep. Do not stop to ask me anything: `ONLINE.md` holds every answer I could give, and where it doesn't, you decide, log an **(agent)** decision there, and carry on.

## 1. Read first

`CLAUDE.md`; `ONLINE.md` whole (Appendix A included); `design_spec.md` whole, with care for Section 0.1 (autonomous build mode), 4, 6, 10.9, 14.3, 16 and Appendix A from decision 203 on; the top of `MORNING_REPORT.md`; this file whole. Then the code the forks will change, so that your reading is theirs: `src/state/store.ts`, `src/state/types.ts`, `src/state/history.ts`, `src/app.ts`, `src/main.ts`, the headers and public methods of `src/physics/feel.ts`, `src/dice.ts`, `src/mats.ts`, `src/commands.ts`, `src/named.ts`, and `src/io/saveFile.ts`, `src/io/autosave.ts`, `src/undo.ts`, `src/ui/topBar.ts`, `src/ui/standTab.ts`, `src/render/cards.ts` (the glow), `src/render/picking.ts`, `src/state/pileSync.ts`. The forks are forked from you and skip all of this.

## 2. Seed (you alone, before any fork starts)

One commit, "Rooms run: seed", that lets three forks start at once against fixed contracts.

1. `npm install -D wrangler concurrently` (O71).
2. **Scripts** in `package.json`:
   - `dev`: `concurrently "npm:dev:web" "npm:dev:server"`; `dev:web`: `vite`; `dev:server`: `wrangler dev --config server/wrangler.toml --port 8787 --inspector-port 9229 --persist-to .wrangler/state-8787`.
   - One pair per session so four dev servers run side by side (O91): `dev:hub` (vite 5173, wrangler 8787, inspector 9229), `dev:server-fork` (5174, 8788, 9230), `dev:sync-fork` (5175, 8789, 9231), `dev:ui-fork` (5176, 8790, 9232). Each vite gets `--port N --strictPort --mode <name>` and a `.env.<name>` file (committed) holding `VITE_ROOM_SERVER=http://localhost:<wrangler port>`; `.env.development` holds 8787.
   - `typecheck`: `tsc --noEmit && tsc --noEmit -p server`. `test` unchanged (vitest picks up `tests/`).
3. `.claude/launch.json`: entries `rooms-hub`, `rooms-server`, `rooms-sync`, `rooms-ui` running those scripts, `port` the vite port of each.
4. `.gitignore`: `.wrangler/`, `server/.dev.vars`, `server/.admin-key` (already there if this file's commit added them).
5. **Server skeleton** so `wrangler dev` runs from minute one: `server/wrangler.toml` as `ONLINE.md` 10.6, `server/tsconfig.json`, `server/src/worker.ts` answering `GET /api/version` with `{ protocol: 1 }`, empty `Room` and `Lobby` classes exported, `server/.dev.vars` with `ADMIN_KEY=dev-admin-key`.
6. **Contracts**, typed exactly as `ONLINE.md` has them, with doc comments pointing at the section: `shared/protocol.ts` (Section 9), `shared/ops.ts` (8.2), `shared/table.ts` (`TableState`, `HIDDEN`), `shared/permissions.ts` (the `Rank` type, `RANKS`, the `Action` union and `needs(action)` table of 6.2, so forks compile against it; the Rules & UI fork owns its tests and any fix), `src/online/room.ts` (`RoomState` with its `Emitter` events), `src/online/session.ts` with the `Session` interface and a `FakeSession` that answers `hello` with a one-player room and echoes ops as confirmed, so the UI fork can build before the server exists, and `src/online/index.ts` exporting an `Online` class that holds `room`, `session`, `presence` and `canSee`, attached as `app.online` (null offline). `tsconfig.json` includes `shared/**`.
7. **Two tabs in one browser** (O90): in `src/online/identity.ts` a dev-only `?player=<name>` query namespaces the identity key (`online.identity.v1:<name>`), so the gate's second tab is a second player. Production ignores it.
8. `npm run typecheck`, `npm test`, `npm run build` pass. Commit by path.

Then start the three forks (Section 3). From here on you are the hub (Section 6).

## 3. The forks

Start each with the app's `start_session` tool: context **fork**, initiation **user_asked** (my words: "start the three area forks"), `use_worktree` **false** (shared folder), the `name` below, and the brief in Section 7 with the blanks filled (your own session id, the fork's ports). One fork per area, never a second for the same area.

| Fork (`name`) | Area: the files it owns | Ports |
|---|---|---|
| **Server** (`server`) | `server/**`; `shared/redact.ts`, `shared/roomCode.ts`, `shared/words.ts`, `shared/rateLimit.ts`; `.github/workflows/worker.yml`; the `.env.*` files | vite 5174, wrangler 8788 |
| **Sync** (`sync`) | `shared/apply.ts`; `src/online/{session,identity,outbox,inbox,authority,streams,presence}.ts`; `src/state/store.ts`, `src/state/history.ts`; `src/physics/feel.ts`, `src/dice.ts`, `src/physics/world.ts`, `src/physics/restSync.ts`, `src/state/pileSync.ts`, `src/render/picking.ts`; the glow attribute in `src/render/cards.ts` and `src/render/dice.ts`; `src/undo.ts`, `src/io/autosave.ts`; the `replace` op in `src/io/saveFile.ts`; `src/dev/regression.ts` (`__room`, `__bots`, `__latency`) | vite 5175, wrangler 8789 |
| **Rules & UI** (`ui`) | `shared/permissions.ts` (tests and fixes); `src/online/{guard,hidden,link}.ts`; `src/ui/{onlinePanel,joinPrompt,chatStrip,tableBrowser,playerRows,desktopOnly}.ts`; `src/ui/topBar.ts`, `src/ui/helpPanel.ts`, `src/ui/standTab.ts`, `src/ui/playmatTab.ts`; `src/mats.ts` ownership; the hidden gate in `src/render/hires.ts`, `src/ui/inspectPanel.ts`, `src/ui/hud.ts`, `src/ui/handCount.ts`, `src/ui/exportPanel.ts`, `src/io/exportDecklist.ts`, `src/io/exportCsv.ts`, `src/ui/tokenMenu.ts`, `src/ui/tray.ts`, `src/ui/cubeTab.ts`, the identity-sorted layouts in `src/commands.ts`; hidden cards in `src/io/saveFile.ts`'s `toDoc`/`loadDoc`; `src/styles/app.css`; the welcome link; the admin page | vite 5176, wrangler 8790 |

**Shared and yours (the hub's):** `shared/protocol.ts`, `shared/ops.ts`, `shared/table.ts`, `src/online/room.ts`, `src/online/index.ts`, `package.json`, `tsconfig*.json`, `.claude/launch.json`, `MORNING_REPORT.md`'s run block headings. A fork that needs a contract changed asks you; you change it, commit, and tell the other two.

**`src/main.ts` is everyone's hotspot.** Each fork adds its wiring in its own clearly marked block (`// --- Rooms: <area> ---`), small edits only, after `git status --short src/main.ts` shows no other session mid-edit. Conflicts come to you.

### What each fork builds, by phase (from `ONLINE.md` Section 16)

**Phase O1, rooms by link**
- *Server:* `worker.ts` routes (`/api/version`, `POST /api/rooms`, `GET /api/rooms/:code`, the socket upgrade), the `Room` object (`hello`, players and meta, `welcome`, snapshot parts from the mirror, `op` forwarding to the crown, `confirm` with `seq`, `applyOp`, the op log and broadcast, `refuse`, `stream` fan-out with `side`, `chat`, crown election, maker reclaim, close on empty, `needSnapshot`, `ping`), `storage.ts`, `limits.ts`, the minimal `Lobby` (heartbeats only), CORS, `worker.yml`. No redaction yet: identities pass through.
- *Sync:* the store choke point (11.1: `origin`, `onLocalChange`, `setNamed`, `setSpreads`, `renameCards`, every direct write routed), `shared/apply.ts` with the store-equivalence test, `identity.ts`, the real `session.ts` (reconnect, version check), `outbox.ts` (inverses, rollback), `inbox.ts`, `authority.ts` (everyone Everything for now; holds; handover in and out; the 30-second snapshot), `streams.ts`, `presence.ts` (remote cursors, held and flying poses, selection colour through the glow attribute), `grab` and streaming in `feel.ts`, `dice.ts`, `world.ts`; held uids skipped in picking, `pileSync`, `restSync`; autosave paused for joiners; `replace` in `saveFile.ts`; `__room()`.
- *Rules & UI:* the Online button and avatars in the top bar, the Online panel's Room, Players (no rank pickers yet) and Chat sections, the Go online short form, the join prompt, `link.ts` and the hash route, Copy link, Save a copy, Leave and Go offline, the whole-page states (closed, kicked, reload, desktop only, quota), the welcome link, CSS.

**Phase O2, permissions and hidden information**
- *Server:* `shared/redact.ts` with the per-recipient visibility diffs (`reveal`, `forget`), `rank`, `kick`, `ban`, `settings`, `pass`, `close`, the newcomer rank, Lock table and Downloads in meta, bans on `hello`.
- *Sync:* the judge by rank, lock, holds, stand ownership, one full stand, Tokens-removes-tokens, the cap (6.2); `reuid` after shuffles of hidden cards; `reveal`/`forget` in the inbox; the undo precondition (`touchedSeq`); `spill` application; holds released on disconnect.
- *Rules & UI:* `permissions.test.ts`; `guard.ts` over keys, buttons and the drag start; rank pickers and the crown's menu (Pass crown, Kick, Ban, Give stand to); the Settings section (visibility, password, tag, newcomers, Lock table, Downloads); stand ownership in `mats.ts` (the nickname plate, owner-only grammar, Claim, Release, Give to, Spill, the one-full-stand button rule offline too, O32); the hidden gate in every module of 7.3; hidden cards in Save a copy and exports; the Cast window drawing backs for hidden cards (O39); the toasts of 12.4.

**Phase O3, the public browser**
- *Server:* the Lobby's public list and heartbeats, visibility, the password hash and the invite key on `hello`, the tag, `GET /api/rooms`, reports and delisting, the admin endpoints and key, `shared/rateLimit.ts` applied, `shared/words.ts` on names.
- *Sync:* the invite key in `hello`; gap handling; then the O4 pieces early (`__bots`, `__latency`, interpolation).
- *Rules & UI:* `tableBrowser.ts` with the chips, Join and Report, the password in the join prompt, Copy invite link, the admin page `#/admin`, Join a table on the welcome screen.

**Phase O4, polish**
- *Server:* the quota responses, the hibernation wake path (snapshot + op log rebuild, then a fresh snapshot from the crown) exercised, limits reviewed.
- *Sync:* interpolation and landing-ease tuning under `__latency(300)`, the `__bots(7)` performance pass on the 2,000-card table against spec Section 17.
- *Rules & UI:* the help panel's Online group, the quota state, panel polish, `design_spec.md` and `CLAUDE.md` updates for anything that moved (through you).

## 4. The folder rules (every session)

Borrowed from the PUG Pricing Tool, which runs this way daily.

- **Git: one index for all.** Stage by path and commit in the same call (`git add <paths> && git commit -m ...`); never `-A`, `.`, `-u` or `commit -a`; never `--amend` (the last commit may be another session's); never stash, reset, `checkout --`, `restore` or `clean`: the folder's uncommitted edits may be another session's half-done work. Undo your own edit with Edit. Check `git show --stat HEAD` after a commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commit often, type-clean.** Commit when your files typecheck; if the whole-folder typecheck fails in another area's file, that is their half-done work: say so to the hub, don't fix it, commit yours.
- **Numbers collide.** Right before writing a decision row, read the highest on disk: `grep -oE '^\| O[0-9]+ \|' ONLINE.md | tr -dc '0-9\n' | sort -n | tail -1` for `ONLINE.md`, the same with `[0-9]+` on `design_spec.md`. Take the next, write the row, commit it straight away so it's claimed. Never trust your memory's number.
- **Shared docs collide.** Re-read the part of `ONLINE.md` or `MORNING_REPORT.md` you'll touch, change only your own entries with small Edits, never a rewrite, and name your session in each entry.
- **Outside your area:** the small change your task needs in another area's file (a caller, a helper, a type), just do it, after `git status --short <path>` shows it clean; a file modified that you didn't touch is another session mid-edit: message that session (or the hub if unsure) and wait. A change to how another area behaves, or a large edit to its main file, goes through the hub.
- **Ports:** only your own pair (Section 3). `preview_start` with your `rooms-<name>` entry.
- **Checks** run on the whole folder: when a test or the build fails, look at which file first.
- **After a compaction**, before the next edit: re-read this file's area table and the phase list, your Done entries in `MORNING_REPORT.md`, and `git log --oneline -20`.
- **Never:** push, add a remote, run `gh`, deploy, start sessions, write memory notes, run the gate. Those are the hub's, and the push is the owner's alone.
- **Stuck** (spec 0.1): three failed tries at a check, or a genuine effort with no way through: stub it so the others still work, write it as **BROKEN** in your Done entry with what you tried, tell the hub, carry on.
- **Unclear:** pick what fits `ONLINE.md`; a reversible choice inside your own area is yours, logged as an **(agent)** O row; anything that changes what another area does, or what players see across areas, goes to the hub with your pick, and you keep working on the rest of your task meanwhile.

## 5. Messages

`SendMessage` to a session's `local_...` id. Short, one message per thing; never a progress report (the hub gets a note each time a fork ends a turn).

- **Fork to hub:** a contract change you need (with the exact TypeScript); a block, with your pick; a change of yours that touches another area's files or behaviour; "O<N> done" when your phase pieces are committed, naming your Done entry; "frozen" when asked.
- **Hub to fork:** a task; another fork's change that affects it; a contract change; "freeze for gate O<N>" and "go: O<N+1>".
- **Fork to fork directly:** only about a file both are changing right now; everything else through the hub.

## 6. The hub's jobs

You run the room; you don't build the areas. Between events, end your turn: the app wakes you when a fork reports or asks.

1. **Answer and decide.** A fork's question is answered from `ONLINE.md` and `design_spec.md` when they answer it; otherwise decide, write the O row **(agent)** with the reasoning, commit it, and tell the fork (and the others if it touches them). Never wait for the owner (O86).
2. **Contracts.** Change `shared/protocol.ts`, `ops.ts`, `table.ts`, `room.ts` on request, commit, tell all three forks in one message each.
3. **Watch the folder.** `git log` and the notes tell you what landed; pass on anything one area must know about another's change.
4. **The phase gate.** When all three have said "O<N> done":
   1. Message each fork: "freeze for gate O<N>: finish the edit in hand, make your files typecheck, commit by path, reply frozen". Wait for three "frozen" (or fifteen minutes; then `git status --short` and note any files left modified in the report, and gate without them).
   2. `npm run typecheck`, `npm test`, `npm run build`. Small integration fixes are yours during a freeze (any file); anything larger goes back to the fork after the gate.
   3. **The two-tab check:** `preview_start` with `rooms-hub`; tab A is the host; tab B opens the room link with `?player=B` (`__room()` does this). Walk the phase's Where to look list in `ONLINE.md` Section 16, screenshots to `reports/screenshots/online-<N>/`, console clean in both tabs. The built-in browser cannot hold modifiers during drags: use synthetic pointer events for those and say so.
   4. Fix and repeat until it passes; then commit "Phase O<N> gate" and tag `online-<N>`.
   5. **Deploy the Worker** (O80): `npx wrangler whoami`; if signed in, `npx wrangler deploy --config server/wrangler.toml`, read the printed `workers.dev` URL, write `.env.production` as `VITE_ROOM_SERVER=https://...` and commit it; the first time also make the admin key (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), save it to `server/.admin-key` (git-ignored) and set it with `npx wrangler secret put ADMIN_KEY --config server/wrangler.toml`. Not signed in: skip, and put the three commands in the owner's checklist.
   6. **Report** (Section 8), then message each fork "go: O<N+1>" with its pieces from Section 3.
5. **After the O4 gate:** the final review (O87): an `Agent` subagent (general-purpose) reads `git diff <seed commit>..HEAD` against `ONLINE.md` for correctness and conformance, nothing stylistic; fix what it finds or log it BROKEN with the reason; then the final report summary, your memory notes (the hub's alone), and stop. Do not push.
6. **Stop conditions** (O89): all four gates passed; or a phase has only BROKEN items left and the forks are out of things to try. Say which in the report.

## 7. The fork briefs

Fill `<hub id>` with your own `local_...` session id and `<ports>` from the table, then send as each fork's `prompt`. Context fork means they already hold your reading.

> You are the **<Fork>** fork of the rooms run, forked from the hub, so its reading is yours: `ONLINE.md`, `design_spec.md`, `ONLINE_PROMPT.md` and the code it read. Skip Start of a session. The hub's session id is `<hub id>`; I (the owner) am asleep and the hub decides for me.
>
> **Your area** (the files you own, the only ones you change without the folder rules' check): <the row from ONLINE_PROMPT.md Section 3>. Your ports: <ports>, `preview_start` with `rooms-<name>`.
>
> **Your work:** the phase O1 pieces for your area in `ONLINE_PROMPT.md` Section 3, built to `ONLINE.md`'s behaviour, not a sketch. When they are committed and type-clean, message the hub "O1 done" naming your Done entry, and start your O2 pieces unless the hub has asked you to freeze. Each later phase the same, when the hub says go.
>
> **Rules:** `ONLINE_PROMPT.md` Section 4 (the folder: stage by path, never -A/stash/reset/amend, numbers from disk, small Edits to shared docs, git status before another area's file, your own ports) and Section 5 (messages). Pure logic gets vitest tests in `tests/`. Never push, deploy, start sessions, write memory notes or run the gate.
>
> **Your record:** after each piece, a Done entry in `MORNING_REPORT.md` under the run block's "<Fork>" heading (Section 8 of `ONLINE_PROMPT.md`): what, where to look (two tabs), untested, decisions logged, BROKEN. The hub builds the report and the owner's QA list from these.

## 8. The report

`MORNING_REPORT.md` gets a new block at the very top, `## Rooms run (<date>)`, written by you at the seed and kept current:

1. **Summary table:** phases gated (with tags), BROKEN items, tests passing, how to run (`npm run dev`, two tabs, `?player=B`), the Worker's deploy state and URL, what the owner must still do (GitHub secrets, `.env.production` if not written, the word list in `shared/words.ts`).
2. **Per phase**, written at each gate: what was built (one line per area), gate results (typecheck, tests with counts, build, the two-tab check), screenshot folder, the gate commit and tag, agent decisions made (O numbers), BROKEN items with what was tried, files left modified at the freeze if any.
3. **Per area, the Done entries** (the forks write these themselves, small Edits, newest first, named): "- <Fork>, <date>: **<piece>**: what; where to look (tab A does X, tab B sees Y); untested; decisions O<n>; BROKEN: ...".
4. **The owner's QA checklist:** the four phases' Where to look lists from `ONLINE.md` Section 16 as checkboxes, plus everything nobody could judge (feel under real latency, the free-tier quota notice, the deploy when wrangler was not signed in).
5. **Performance:** the `__bots(7)` pass against spec Section 17.

The report is also how a compacted session finds its place: keep it current.
