// Dev-only: a final pass over every phase's "Where to look" checklist
// (spec 18), driven through the same input paths a mouse uses. Run it in the
// dev build's console: await __regression(). It clears the table.

import type { App } from '../app';

// The boot object from main.ts; loosely typed because this is a dev-only script.
type Ui = Record<string, any>;

interface Result {
  phase: number;
  check: string;
  ok: boolean;
  detail: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));

export function installRegression(app: App, ui: Ui): void {
  (window as unknown as { __regression: () => Promise<Result[]> }).__regression = async () => {
    const results: Result[] = [];
    const check = (phase: number, name: string, ok: boolean, detail = '') => results.push({ phase, check: name, ok, detail });
    const store = app.store;
    const canvas = app.canvas;
    const rect = () => canvas.getBoundingClientRect();
    const o = { bubbles: true, pointerId: 1 };
    const screenOf = (uid: string) => {
      const c = store.cards.get(uid)!;
      return app.rig.worldToScreen(c.x, c.y, c.z);
    };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, mods: Partial<PointerEventInit> = {}, steps = 12) => {
      const r = rect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...o, ...mods, clientX: r.left + from.x, clientY: r.top + from.y, button: 0, buttons: 1 }));
      for (let i = 1; i <= steps; i++) {
        window.dispatchEvent(new PointerEvent('pointermove', { ...o, ...mods, clientX: r.left + from.x + ((to.x - from.x) * i) / steps, clientY: r.top + from.y + ((to.y - from.y) * i) / steps, buttons: 1 }));
        await frame();
      }
      await frame();
      window.dispatchEvent(new PointerEvent('pointerup', { ...o, ...mods, clientX: r.left + to.x, clientY: r.top + to.y, button: 0, buttons: 0 }));
      await wait(500);
      while (ui.physics.bodyCount) await wait(20);
      await wait(150);
    };
    const tableAt = (x: number, y: number) => app.rig.worldToScreen(x, y, 0);
    const piles = () => [...store.piles.values()];
    const errorsBefore = ((window as unknown as { __errors: string[] }).__errors ?? []).length;

    store.clear();
    app.rig.preset = 0;
    app.rig.reset(false);
    await wait(300);

    // ---- Phase 1 ----
    const grab = app.rig.screenToPlane(300, 300)!;
    app.rig.panTo(grab, 400, 350);
    const after = app.rig.screenToPlane(400, 350)!;
    check(1, 'pan keeps the grabbed point under the cursor', Math.hypot(after.x - grab.x, after.y - grab.y) < 0.01);
    const z0 = app.rig.screenToPlane(200, 200)!;
    app.rig.zoomAt(200, 200, 0.6);
    const z1 = app.rig.screenToPlane(200, 200)!;
    check(1, 'wheel zoom is toward the cursor', Math.hypot(z1.x - z0.x, z1.y - z0.y) < 0.01);
    app.rig.orbit(-99999, 99999);
    check(1, 'orbit stops at the limits', app.rig.pitch === 89 && Math.abs(app.rig.yaw) === 60, `pitch ${app.rig.pitch} yaw ${app.rig.yaw}`);
    app.rig.reset(false);
    check(1, 'Home resets the camera', app.rig.pitch === 55 && app.rig.yaw === 0 && app.rig.target.length() === 0);
    check(1, 'shadows are on', app.view.renderer.shadowMap.enabled && app.view.sun.castShadow);

    // ---- Phase 2 ----
    const t0 = performance.now();
    const cube = await (window as unknown as { __spawnFile: (f: string, o: object) => Promise<{ spawned: number; unresolved: number }> }).__spawnFile('cube.txt', { arrival: 'stack', at: { x: 0, y: 0 } });
    const spawnMs = performance.now() - t0;
    check(2, 'cube list spawns completely', cube.spawned === 1008 && cube.unresolved === 0, `${cube.spawned} spawned, ${cube.unresolved} unresolved, ${Math.round(spawnMs)} ms`);
    check(2, 'spawn of a big list is under 15 s warm (spec 17)', spawnMs < 15000, `${Math.round(spawnMs)} ms`);
    for (let i = 0; i < 100 && app.images.pending; i++) await wait(100);
    check(2, 'images fill in', app.images.pending === 0, `${app.images.loader.stats.cached} from cache, ${app.images.loader.stats.network} from network`);
    const bad = await (window as unknown as { __spawnFile: (f: string, o: object) => Promise<{ spawned: number; unresolved: number }> }).__spawnFile('bad-lines.txt', { arrival: 'stack', at: { x: 300, y: 0 } });
    check(2, 'bad lines come back unresolved', bad.unresolved === 5, `${bad.unresolved} unresolved`);

    // ---- Phase 3 ----
    const { applyQuery, runQuery } = await import('../state/selection');
    store.clearSelection();
    applyQuery(store, 't:creature');
    const creatures = store.selection.size;
    applyQuery(store, 'mv<=2');
    check(3, 'refine shrinks the selection', store.selection.size > 0 && store.selection.size < creatures, `${creatures} -> ${store.selection.size}`);
    store.clearSelection();
    applyQuery(store, 'c:r');
    check(3, 'table search selects matches wherever they are', store.selection.size > 50, `${store.selection.size} red cards`);
    const unsupported = runQuery(store, 'art:dragon');
    check(3, 'an unsupported term is an error', !unsupported.ok && unsupported.error.startsWith('Not supported on the table'));
    store.clearSelection();

    // ---- Phase 4 ----
    store.clear();
    await wait(200);
    await (window as unknown as { __spawnFile: (f: string, o: object) => Promise<unknown> }).__spawnFile('dfc.txt', { arrival: 'stack', at: { x: 0, y: 0 } });
    await wait(700);
    store.setSelection(store.cards.keys());
    ui.commands.spread();
    store.clearSelection();
    await wait(800);
    ui.commands.frame();
    await wait(300);
    const spreadUids = [...store.spreads.values()][0].uids;
    await drag(screenOf(spreadUids[0]), screenOf(spreadUids[1]));
    check(4, 'one card dropped on another makes a pile of 2', piles().some((p) => p.cardUids.length === 2));
    store.setSelection(spreadUids.slice(10, 40));
    const lead = spreadUids[20];
    const empty = tableAt(0, -600);
    await drag(screenOf(lead), empty);
    check(4, 'a gathered group stacks on release', piles().some((p) => p.kind === 'stack' && p.cardUids.length === 30));
    const five = spreadUids.slice(4, 9);
    store.setSelection(five);
    const before5 = five.map((u) => ({ ...store.cards.get(u)! }));
    await drag(screenOf(five[2]), { x: screenOf(five[2]).x, y: screenOf(five[2]).y + 60 }, { altKey: true });
    const dx = five.map((u, i) => store.cards.get(u)!.x - before5[i].x);
    check(4, 'Alt-drag keeps formation', Math.max(...dx) - Math.min(...dx) < 0.01);
    store.clearSelection();
    const p30 = piles().find((p) => p.cardUids.length === 30)!;
    const order = [...p30.cardUids];
    ui.commands.toggleSpread(order[0]);
    await wait(700);
    const spreadOk = store.spreads.size >= 1;
    ui.commands.restack([...store.spreads.values()].find((s) => s.uids.length === 30)!.id);
    await wait(800);
    const back = piles().find((p) => p.cardUids.length === 30);
    check(4, 'double-click spreads and restacks in the same order', spreadOk && !!back && JSON.stringify(back.cardUids) === JSON.stringify(order));
    await ui.autosave.save();
    check(4, 'autosave is under 50 ms (spec 17)', ui.autosave.lastMs < 50, `${ui.autosave.lastMs.toFixed(1)} ms`);

    // ---- Phase 5 ----
    store.clear();
    await wait(200);
    await (window as unknown as { __spawnFile: (f: string, o: object) => Promise<unknown> }).__spawnFile('deck-60.txt', { arrival: 'messy', at: { x: 0, y: 0 } });
    const physicsUsed = ui.physics.bodyCount > 0;
    while (ui.physics.bodyCount) await wait(20);
    await wait(200);
    check(5, 'a handful drops through physics into a messy pile', physicsUsed && piles().some((p) => p.kind === 'messy' && p.cardUids.length === 60));
    store.updateSettings({ tidyDrops: true });
    await (window as unknown as { __spawnFile: (f: string, o: object) => Promise<unknown> }).__spawnFile('bad-lines.txt', { arrival: 'stack', at: { x: -300, y: 0 } });
    await wait(700);
    const small = piles().find((p) => p.cardUids.length === 9)!;
    store.setSelection(small.cardUids);
    const messy = piles().find((p) => p.kind === 'messy')!;
    const top = store.cards.get(messy.cardUids[messy.cardUids.length - 1])!;
    await drag(screenOf(small.cardUids[8]), app.rig.worldToScreen(top.x, top.y, top.z));
    const squared = new Set(small.cardUids.map((u) => `${store.cards.get(u)!.x.toFixed(2)},${store.cards.get(u)!.y.toFixed(2)}`)).size === 1;
    check(5, 'with Tidy drops on a drop squares up', squared);
    store.updateSettings({ tidyDrops: false });
    store.setSelection(store.cards.keys());
    ui.commands.flip();
    await wait(1100);
    check(5, 'F flips the selection', [...store.cards.values()].every((c) => !c.faceUp));
    ui.commands.flip();
    await wait(1100);
    store.setSelection(store.cards.keys());
    ui.commands.stack();
    store.clearSelection();
    await wait(600);
    const big = piles()[0];
    const z = big.cardUids.map((u) => app.layer.pose(u)!.z.toFixed(4)).join();
    await wait(600);
    check(5, 'a stack does not jitter', z === big.cardUids.map((u) => app.layer.pose(u)!.z.toFixed(4)).join() && ui.physics.bodyCount === 0);

    // ---- Phase 6 ----
    const { applyQuery: aq } = await import('../state/selection');
    store.clearSelection();
    aq(store, 't:creature');
    const { land, stackAt, byHeight } = await import('../commands');
    land(app, stackAt(app, byHeight(app, store.selection), { x: 250, y: 0, yaw: 0 }));
    store.clearSelection();
    await wait(600);
    const keepPile = piles().find((p) => p.cardUids.length < 30 && p.cardUids.every((u) => /Creature/.test(store.records.get(store.cards.get(u)!.scryfallId)!.type_line)))!;
    check(6, 'a pile can be named with a filter', app.named.promote(keepPile.id, 'Keep', 't:creature') === null);
    const rest = piles().find((p) => p.id !== keepPile.id)!;
    const landCard = rest.cardUids.slice().reverse().find((u) => /Land/.test(store.records.get(store.cards.get(u)!.scryfallId)!.type_line))!;
    store.clearSelection();
    // Bring that land to the top so a plain drag picks it up.
    const restTop = store.cards.get(rest.cardUids[rest.cardUids.length - 1])!;
    land(app, [{ uid: landCard, x: restTop.x + 150, y: restTop.y, z: 0.15, yaw: 0 }]);
    await wait(500);
    const kTop = store.cards.get(store.piles.get(keepPile.id)!.cardUids.at(-1)!)!;
    await drag(screenOf(landCard), app.rig.worldToScreen(kTop.x, kTop.y, kTop.z));
    check(6, 'a land dropped on Keep slides off', !store.piles.get(keepPile.id)!.cardUids.includes(landCard));
    ui.tray.remove([...store.piles.get(keepPile.id)!.cardUids]);
    await wait(300);
    check(6, 'an emptied named pile keeps its label', app.named.empty().some((n: { name: string }) => n.name === 'Keep') && !!document.querySelector('.badge.outline'));

    // ---- Phase 7 ----
    const { decklistText } = await import('../io/exportDecklist');
    const exp = decklistText([{ title: null, cards: [...store.cards.values()].map((c) => {
      const r = store.records.get(c.scryfallId)!;
      return { name: r.name, set: r.set, number: r.collector_number, finish: c.finish };
    }) }], false);
    const { parseDecklist } = await import('../io/decklist');
    check(7, 'decklist export parses back to the same count', parseDecklist(exp).cards === store.cards.size, `${store.cards.size} cards`);
    const { toDoc, loadDoc } = await import('../io/saveFile');
    const doc = JSON.parse(JSON.stringify(toDoc(app, true)));
    const n0 = store.cards.size;
    store.clear();
    await loadDoc(app, doc);
    await wait(400);
    check(7, 'save, new table, load back', store.cards.size === n0 && app.named.empty().length === 1);
    ui.inspect.hover([...store.cards.keys()][0]);
    await wait(250);
    check(7, 'hover shows the inspect panel', !!document.querySelector('.inspect-images img'));
    ui.inspect.hover(null);

    // ---- Phase 8 ----
    const errors = ((window as unknown as { __errors: string[] }).__errors ?? []).slice(errorsBefore);
    check(8, 'no page errors during the pass', errors.length === 0, errors.join(' | '));
    return results;
  };
}
