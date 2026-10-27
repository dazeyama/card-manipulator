# Morning report: overnight build

## Summary

| | |
|---|---|
| **Phases finished** | 1 |
| **Phases with BROKEN items** | none so far |
| **Run it** | `npm install` once, then `npm run dev` and open http://localhost:5173 (or double-click `start.bat`) |

Run in progress: the build is working through the phases in order.

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

**Commit:** see `git log` ("Phase 1: table and camera").

---

## Owner's QA checklist

### Phase 1
- [ ] Page loads with the numbered cards.
- [ ] Middle-drag pans; Space + left-drag pans too.
- [ ] Wheel zooms toward the cursor.
- [ ] Right-drag on empty table orbits and stops at the limits.
- [ ] Home resets the view.
- [ ] Shadows under cards; the stack of ten shows thickness.
