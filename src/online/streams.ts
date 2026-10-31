// Ten times a second (ONLINE.md 8.3, O45), one stream message if anything
// changed: the table point under my cursor, my side (M), my selection at most
// twice a second, and the drawn poses of what I hold and what my physics has
// in flight. Relayed by the server to everyone else, never stored; nothing in
// it changes anyone's table. Moving it to WebRTC later changes this file only.

import * as THREE from 'three';
import { STREAM_HZ, type Pose6, type StreamOut } from '../../shared/protocol';
import type { Pose } from '../render/cards';
import type { RoomSync } from './connect';

/** The selection goes out at most this often, ms. */
const SELECTION_EVERY_MS = 500;
/** At most this many uids of a selection go out (a 5,000-card Ctrl + A would not fit a message). */
const SELECTION_MAX = 1500;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A card's drawn pose as a stream carries it: its turn, the roll and tilt about its long axis together, and its tilt across. */
export function cardPose6(p: Pose): Pose6 {
  return [r1(p.x), r1(p.y), r1(p.z), r2(p.yaw), r2(p.roll + p.tiltY), r2(p.tiltX)];
}

const euler = new THREE.Euler(0, 0, 0, 'ZXY');

/** A die's drawn pose: its place and its turn, as the card renderer's angles (ZXY). */
export function diePose6(at: THREE.Vector3, q: THREE.Quaternion): Pose6 {
  euler.setFromQuaternion(q, 'ZXY');
  return [r1(at.x), r1(at.y), r1(at.z), r2(euler.z), r2(euler.y), r2(euler.x)];
}

export class Streams {
  private timer = 0;
  private last = '';
  private lastSel = '';
  private selAt = 0;

  constructor(private readonly sync: RoomSync) {
    this.timer = window.setInterval(() => this.tick(), 1000 / STREAM_HZ);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private tick(): void {
    const { app, online, deps } = this.sync;
    if (!online.room.connected || !online.room.me) return;
    const out: StreamOut = { side: app.side };
    if (app.pointer.inside) out.cur = [r1(app.lastTablePoint.x), r1(app.lastTablePoint.y)];
    const hold: Record<string, Pose6> = {};
    const fly: Record<string, Pose6> = {};
    if (deps.drag.dragging) {
      for (const uid of deps.drag.heldUids) {
        const p = app.layer.pose(uid);
        if (p) hold[uid] = cardPose6(p);
      }
    }
    for (const uid of deps.dice.heldUids) {
      const d = deps.diceLayer.drawnAt(uid);
      if (d) hold[uid] = diePose6(d.position, d.quaternion);
    }
    const flying = app.physics?.flying();
    for (const uid of flying?.cards ?? []) {
      const p = app.layer.pose(uid);
      if (p) fly[uid] = cardPose6(p);
    }
    for (const uid of flying?.dice ?? []) {
      const d = deps.diceLayer.drawnAt(uid);
      if (d) fly[uid] = diePose6(d.position, d.quaternion);
    }
    if (Object.keys(hold).length) out.hold = hold;
    if (Object.keys(fly).length) out.fly = fly;
    const key = JSON.stringify(out);
    // The selection, cards and dice, when it changed, at most twice a second.
    const now = performance.now();
    const sel = [...app.store.selection, ...deps.dice.selected];
    const selKey = sel.join(',');
    if (selKey !== this.lastSel && now - this.selAt >= SELECTION_EVERY_MS) {
      this.lastSel = selKey;
      this.selAt = now;
      out.sel = sel.slice(0, SELECTION_MAX);
    }
    if (key === this.last && !out.sel) return;
    this.last = key;
    this.sync.session.send({ t: 'stream', ...out });
  }
}
