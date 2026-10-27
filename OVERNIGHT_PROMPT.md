# Overnight build prompt

Paste everything below the line into a new Claude Code session opened in `C:\ClaudeProjects\card-manipulator`. Before you start it:

1. Paste your cube list into `test-data/cube.txt`, below the comment lines.
2. Start the session in **auto** permission mode. The pre-approved commands in `.claude/settings.local.json` cover npm, node, local git and the built-in browser; auto mode covers the rest.
3. Leave the computer awake. The desktop app's keep-awake setting helps.

---

You are building the 3D Card Manipulator overnight, unattended. I am asleep and cannot answer questions. Do not stop to ask me anything: the spec already holds every answer I could give, and where it doesn't, you decide.

**Read first, in this order:** `CLAUDE.md`, then `design_spec.md` in full, paying special attention to Section 0.1 (autonomous build mode), Section 18 (the phases, the morning report, test data) and Appendix A (every decision, 1–43). If `MORNING_REPORT.md` already exists, a previous run got partway: read it and `git log`, and resume at the first phase not marked done.

**The job:** build Phases 1 through 8 of Section 18, in order, to completion.

**For every phase:**

1. Build everything the phase lists, to the behaviour Sections 1–17 describe. Not a sketch: the real feature.
2. Pass the phase gate in Section 0.1: typecheck clean, `npm test` green with tests for every pure module the phase adds, `npm run build` succeeds, and a browser check. For the browser check, start the dev server with the built-in browser (`preview_start` with name `card-manipulator`), walk the phase's "Where to look" list yourself with real clicks, drags and keys, save screenshots to `reports/screenshots/phase-N/`, and confirm the console has no errors.
3. Fix what the gate finds and run the gate again until it passes.
4. Commit locally with a message naming the phase.
5. Update `MORNING_REPORT.md` as Section 18.1 describes, then start the next phase straight away.

**Rules for the whole run:**

- **Unclear?** Pick what best fits the spec and my decisions, add an Appendix A row marked **(agent)** with your reasoning, and carry on.
- **Stuck?** After a genuine effort, stub the item so later phases still work, mark it **BROKEN** in the report with what you tried, and carry on. Never let one item stop the run.
- **Packages:** add any you need; log each one's reason as an agent decision.
- **Git:** local commits only. Never add a remote, push, or run `gh`. Nothing gets deployed.
- **Network:** Scryfall's API and image CDN only, through the app's own client, plus the one card back download in Phase 2. Reuse caches and don't hammer the API in loops.
- **Test data:** use `test-data/cube.txt` if it has card lines; otherwise build a 540-card stand-in from a Scryfall query. Generate the other files Section 18.2 lists.
- **Context:** this is a long run. Keep `MORNING_REPORT.md` current after every phase so that if your context is compacted, you can re-read it and the spec and continue without losing your place.
- **Don't narrow the scope.** Every phase, every feature. If you run low on anything, finish the current phase cleanly and report exactly what remains rather than skipping silently.

**When all eight phases are done:** do a final pass of every phase's checklist against the finished app, measure performance with `stress-2000.txt` against Section 17, finish `MORNING_REPORT.md` with an honest summary at the top (what works, what is BROKEN, what I need to check by hand), make the final commit, and stop.
