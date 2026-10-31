// Ten times a second (ONLINE.md 8.3, O45), one stream message if anything
// changed: the table point under my cursor, my side (M), my selection at most
// twice a second, and the drawn poses of what I hold and what my physics has
// in flight. Relayed by the server to everyone else, never stored; nothing in
// it changes anyone's table. Moving it to WebRTC later changes this file only.

import * as THREE from 'three';
import { byteLength, STREAM_HZ, type Pose6, type StreamOut } from '../../shared/protocol';
import type { Pose } from '../render/cards';
import type { RoomSync } from './connect';

/** The selection goes out at most this often, ms. */
const SELECTION_EVERY_MS = 500;
/**
 * What one stream may carry, so it stays well under the server's 64 KB for a
 * message (O104): at most this many uids of a selection (a 5,000-card Ctrl + A
 * would not fit), and at most this many poses of held and flying cards and
 * dice. Past the cap, held cards are not streamed: others see them lift (the
 * grab marks them held) and land, not travel.
 */
export const SELECTION_MAX = 1000;
export const POSES_MAX = 400;
/** A last guard: a stream bigger than this drops its selection, then its poses. */
const STREAM_BYTES_MAX = 56 * 1024;

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

/**
 * One stream as it goes out (8.3): the flights first (only the thrower's
 * physics knows them), then the top of the hand (the end of `hold`, bottom to
 * top), within POSES_MAX; the selection within SELECTION_MAX.
 */
export function composeStream(side: 0 | 1, cur: [number, number] | undefined, hold: [string, Pose6][], fly: [string, Pose6][], sel?: string[]): StreamOut {
  const out: StreamOut = { side };
  if (cur) out.cur = cur;
  const flying = fly.slice(0, POSES_MAX);
  const room = POSES_MAX - flying.length;
  const holding = room > 0 ? hold.slice(Math.max(0, hold.length - room)) : [];
  if (holding.length) out.hold = Object.fromEntries(holding);
  if (flying.length) out.fly = Object.fromEntries(flying);
  if (sel) out.sel = sel.slice(0, SELECTION_MAX);
  return out;
}

/** The stream within STREAM_BYTES_MAX: without its selection, then without its poses, if it must. */
export function fitStream(out: StreamOut): StreamOut {
  const size = (s: StreamOut) => byteLength(JSON.stringify({ t: 'stream', ...s }));
  if (size(out) <= STREAM_BYTES_MAX) return out;
  const { sel: _sel, ...rest } = out;
  if (size(rest) <= STREAM_BYTES_MAX) return rest;
  const { hold: _hold, fly: _fly, ...bare } = rest;
  return bare;
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
    const cur: [number, number] | undefined = app.pointer.inside ? [r1(app.lastTablePoint.x), r1(app.lastTablePoint.y)] : undefined;
    // The cards bottom to top, then the dice (few), so the cap keeps the top of the hand and the dice.
    const hold: [string, Pose6][] = [];
    if (deps.drag.dragging) {
      const uids = deps.drag.heldUids;
      // Only what the cap can carry is worked out.
      for (const uid of uids.slice(Math.max(0, uids.length - POSES_MAX))) {
        const p = app.layer.pose(uid);
        if (p) hold.push([uid, cardPose6(p)]);
      }
    }
    for (const uid of deps.dice.heldUids) {
      const d = deps.diceLayer.drawnAt(uid);
      if (d) hold.push([uid, diePose6(d.position, d.quaternion)]);
    }
    const fly: [string, Pose6][] = [];
    const flying = app.physics?.flying();
    for (const uid of flying?.dice ?? []) {
      const d = deps.diceLayer.drawnAt(uid);
      if (d) fly.push([uid, diePose6(d.position, d.quaternion)]);
    }
    for (const uid of flying?.cards ?? []) {
      const p = app.layer.pose(uid);
      if (p) fly.push([uid, cardPose6(p)]);
    }
    // The selection, cards and dice, when it changed, at most twice a second.
    const now = performance.now();
    const all = [...app.store.selection, ...deps.dice.selected];
    const selKey = all.join(',');
    let sel: string[] | undefined;
    if (selKey !== this.lastSel && now - this.selAt >= SELECTION_EVERY_MS) {
      this.lastSel = selKey;
      this.selAt = now;
      sel = all;
    }
    const out = fitStream(composeStream(app.side, cur, hold, fly, sel));
    const { sel: sent, ...moving } = out;
    const key = JSON.stringify(moving);
    if (key === this.last && !sent) return;
    this.last = key;
    this.sync.session.send({ t: 'stream', ...out });
  }
}
