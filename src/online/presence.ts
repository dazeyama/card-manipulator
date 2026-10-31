// The other players at the table (ONLINE.md 5.4, 8.3, 8.4): their cursors on
// the felt, the cards and dice in their hands and in flight drawn live from
// their streams, 100 ms behind, and their selections and holds glowing in
// their colour. Nothing here changes the store: holds come from confirmed
// `grab` ops and end with the holder's landing op, which eases the drawn pose
// to where the store now has the card.

import * as THREE from 'three';
import type { Op } from '../../shared/ops';
import { cardsTouched, diceTouched } from '../../shared/ops';
import type { Pose6, ServerMsg } from '../../shared/protocol';
import { dieSize } from '../state/dice';
import { remoteHeld } from '../state/remoteHeld';
import { CARD_T } from '../state/types';
import type { PresenceView } from './index';
import type { RoomSync } from './connect';

/** Remote poses are drawn this far behind their stream, so two samples are always at hand (8.3). */
const BUFFER_MS = 100;
/** A flight with no news for this long has ended (its landing op went astray). */
const FLY_STALE_MS = 1500;

type StreamMsg = Extract<ServerMsg, { t: 'stream' }>;

interface Sample {
  at: number;
  pose: Pose6;
}

interface Cursor {
  el: HTMLDivElement;
  tag: HTMLSpanElement;
  arrow: SVGPathElement;
  x: number;
  y: number;
  seen: number;
  shown: boolean;
}

const SVG = 'http://www.w3.org/2000/svg';

export class Presence implements PresenceView {
  /** Every card and die another player holds or has flying: picking and pile detection skip these. */
  readonly held = remoteHeld;
  /** Confirmed holds (8.4): uid → the player holding it. */
  readonly holders = new Map<string, string>();
  /** Flights seen in streams: uid → who threw it, and when last seen. */
  private readonly flying = new Map<string, { by: string; seen: number }>();
  private readonly samples = new Map<string, Sample[]>();
  private readonly cursors = new Map<string, Cursor>();
  /** Each player's selection, as last streamed. */
  private readonly selections = new Map<string, string[]>();
  /** What glows in whose colour now. */
  private readonly tints = new Map<string, string>();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly v = new THREE.Vector3();
  private stopped = false;

  constructor(private readonly sync: RoomSync) {
    this.held.clear();
    sync.app.onFrame((now) => this.frame(now));
  }

  /** Leaving the room: no one else's cursor, hold or glow stays. */
  stop(): void {
    this.stopped = true;
    this.reset();
    for (const c of this.cursors.values()) c.el.remove();
    this.cursors.clear();
    this.selections.clear();
    this.retint();
  }

  /** The table was replaced (a snapshot): nothing is in anyone's hand any more. */
  reset(): void {
    const { app, deps } = this.sync;
    for (const uid of this.held) {
      app.motion.held.delete(uid);
      deps.diceLayer.carried.delete(uid);
    }
    this.held.clear();
    this.holders.clear();
    this.flying.clear();
    this.samples.clear();
    this.retint();
  }

  // ---- streams in ----

  stream(msg: StreamMsg): void {
    if (this.stopped || msg.from === this.sync.online.room.me) return;
    const now = performance.now();
    if (msg.cur) this.cursorTo(msg.from, msg.cur[0], msg.cur[1], now);
    else this.hideCursor(msg.from);
    if (msg.sel) {
      this.selections.set(msg.from, msg.sel);
      this.retint();
    }
    let fresh = false;
    for (const [uid, pose] of Object.entries(msg.hold ?? {})) fresh = this.sample(uid, msg.from, pose, now, false) || fresh;
    for (const [uid, pose] of Object.entries(msg.fly ?? {})) fresh = this.sample(uid, msg.from, pose, now, true) || fresh;
    if (fresh) this.retint();
  }

  /** One streamed pose. True if the card or die has just come into that player's hand (its glow is due). */
  private sample(uid: string, by: string, pose: Pose6, now: number, fly: boolean): boolean {
    const store = this.sync.app.store;
    if (!store.cards.has(uid) && !store.dice.has(uid)) return false;
    // A hold others may see before its grab is confirmed: draw it from the stream now.
    const owner = this.holders.get(uid);
    if (owner && owner !== by) return false;
    if (fly) this.flying.set(uid, { by, seen: now });
    const fresh = this.take(uid, by);
    let list = this.samples.get(uid);
    if (!list) this.samples.set(uid, (list = []));
    list.push({ at: now, pose });
    if (list.length > 12) list.splice(0, list.length - 12);
    return fresh;
  }

  /** Another player has this card or die in hand: theirs, drawn from their stream. True if its glow is not theirs yet. */
  private take(uid: string, by: string): boolean {
    const { app, deps } = this.sync;
    if (!this.held.has(uid)) {
      this.held.add(uid);
      if (app.store.cards.has(uid)) {
        app.motion.cancel(uid);
        app.motion.held.add(uid);
        // What rested on it falls, as when you lift a card yourself (decision 100).
        app.rest?.lifted([uid]);
        if (app.store.selection.has(uid)) app.store.removeFromSelection([uid]);
      } else {
        deps.diceLayer.carried.add(uid);
        if (deps.dice.selected.delete(uid)) deps.dice.select(deps.dice.selected);
      }
    }
    return this.tints.get(uid) !== by;
  }

  /** It left their hand: back to the store's pose (the caller animates there). */
  private free(uid: string): void {
    const { app, deps } = this.sync;
    this.held.delete(uid);
    this.holders.delete(uid);
    this.flying.delete(uid);
    this.samples.delete(uid);
    app.motion.held.delete(uid);
    if (deps.diceLayer.carried.delete(uid)) {
      const d = app.store.dice.get(uid);
      if (d) deps.diceLayer.place(uid, d);
    }
  }

  // ---- confirmed ops ----

  /** A confirmed op: a grab puts things in its player's hand (8.4). */
  confirmed(op: Op, by: string): void {
    if (this.stopped || by === this.sync.online.room.me) return;
    if (op.t === 'batch') {
      for (const o of op.ops) this.confirmed(o, by);
      return;
    }
    if (op.t !== 'grab') return;
    // A grab adds to the hand (O100); the holder's landing, release or leaving ends it.
    let fresh = false;
    for (const uid of [...op.uids, ...(op.dice ?? [])]) {
      this.holders.set(uid, by);
      fresh = this.take(uid, by) || fresh;
    }
    if (fresh) this.retint();
  }

  /**
   * An op is about to be applied (8.3): what it lands, releases or removes
   * leaves the hand of whoever held it. Returns the cards that were held, so
   * the inbox eases them in quickly from where they were drawn.
   */
  landing(op: Op, _by: string): Set<string> {
    const eased = new Set<string>();
    if (op.t === 'grab' || !this.held.size) return eased;
    const store = this.sync.app.store;
    for (const uid of [...cardsTouched(op), ...diceTouched(op)]) {
      if (!this.held.has(uid)) continue;
      this.free(uid);
      if (store.cards.has(uid)) eased.add(uid);
    }
    if (eased.size || op.t === 'batch' || op.t === 'dice') this.retint();
    return eased;
  }

  /**
   * Where a departed player's cards and dice were last seen (4.7): the ops
   * that drop them there, for the crown to confirm on their behalf.
   */
  lastPoses(cards: string[], dice: string[]): Op[] {
    const last = (uid: string) => this.samples.get(uid)?.at(-1)?.pose;
    const store = this.sync.app.store;
    const moves = cards.map((uid) => {
      const p = last(uid);
      const c = store.cards.get(uid)!;
      return p ? { uid, x: p[0], y: p[1], z: CARD_T / 2, yaw: p[3], stand: null } : { uid, x: c.x, y: c.y, z: c.z, yaw: c.yaw };
    });
    const set = dice.map((uid) => {
      const d = store.dice.get(uid)!;
      const p = last(uid);
      return p ? { ...d, x: p[0], y: p[1], z: dieSize(d.kind) / 2 } : { ...d };
    });
    const out: Op[] = [];
    if (moves.length) out.push({ t: 'move', moves });
    if (set.length) out.push({ t: 'dice', set });
    return out;
  }

  /** The player list changed: cursors of players who have gone go too. */
  players(): void {
    const room = this.sync.online.room;
    for (const [id, c] of [...this.cursors]) {
      const p = room.player(id);
      if (!p || !p.connected) {
        c.el.remove();
        this.cursors.delete(id);
        this.selections.delete(id);
      } else {
        c.arrow.setAttribute('fill', p.colour);
        c.tag.style.background = p.colour;
        c.tag.textContent = p.nickname;
      }
    }
    this.retint();
  }

  // ---- drawing ----

  /** Glow every held and selected card or die in its player's colour; the rest plain. */
  private retint(): void {
    const { app, deps, online } = this.sync;
    const want = new Map<string, string>();
    if (!this.stopped) {
      for (const [id, uids] of this.selections) for (const u of uids) want.set(u, id);
      for (const [u, id] of this.holders) want.set(u, id);
      for (const [u, f] of this.flying) want.set(u, f.by);
    }
    for (const [uid] of this.tints) {
      if (want.has(uid)) continue;
      app.layer.setTint(uid, null);
      deps.diceLayer.setTint(uid, null);
    }
    for (const [uid, id] of want) {
      const colour = online.room.player(id)?.colour;
      if (!colour) continue;
      if (app.store.cards.has(uid)) app.layer.setTint(uid, new THREE.Color(colour));
      else if (app.store.dice.has(uid)) deps.diceLayer.setTint(uid, colour);
    }
    this.tints.clear();
    for (const [uid, id] of want) this.tints.set(uid, id);
  }

  private frame(now: number): void {
    if (this.stopped) return;
    const { app, deps } = this.sync;
    const at = now - BUFFER_MS;
    for (const [uid, list] of this.samples) {
      const p = poseAt(list, at);
      if (!p) continue;
      const pose = app.layer.pose(uid);
      if (pose) {
        pose.x = p[0];
        pose.y = p[1];
        pose.z = p[2];
        pose.yaw = p[3];
        pose.roll = p[4];
        pose.tiltX = p[5];
        pose.tiltY = 0;
        app.layer.touch(uid);
      } else if (app.store.dice.has(uid)) {
        this.e.set(p[5], p[4], p[3], 'ZXY');
        this.q.setFromEuler(this.e);
        deps.diceLayer.pose(uid, this.v.set(p[0], p[1], p[2]), this.q);
      }
    }
    // A flight that went quiet without landing has ended: back to the store's pose.
    for (const [uid, f] of [...this.flying]) {
      if (now - f.seen < FLY_STALE_MS || this.holders.has(uid)) continue;
      this.free(uid);
      const c = app.store.cards.get(uid);
      if (c) app.motion.animate(uid, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, roll: c.faceUp ? 0 : Math.PI, tiltX: 0, tiltY: 0 }, { duration: 190 });
      this.retint();
    }
    this.drawCursors();
  }

  // ---- cursors (5.4: always shown, never hideable, O18) ----

  private cursorTo(id: string, x: number, y: number, now: number): void {
    let c = this.cursors.get(id);
    if (!c) c = this.makeCursor(id);
    if (!c) return;
    c.x = x;
    c.y = y;
    c.seen = now;
    c.shown = true;
  }

  private hideCursor(id: string): void {
    const c = this.cursors.get(id);
    if (c) c.shown = false;
  }

  private makeCursor(id: string): Cursor | undefined {
    const p = this.sync.online.room.player(id);
    if (!p) return undefined;
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '6', willChange: 'transform' });
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 18 22');
    svg.style.display = 'block';
    svg.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))';
    const arrow = document.createElementNS(SVG, 'path');
    arrow.setAttribute('d', 'M1 1 L1 18 L5.5 13.8 L8.6 20.6 L11.6 19.2 L8.6 12.6 L15 12.4 Z');
    arrow.setAttribute('fill', p.colour);
    arrow.setAttribute('stroke', '#1d1d1f');
    arrow.setAttribute('stroke-width', '1.4');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow);
    const tag = document.createElement('span');
    tag.className = 'remote-cursor-tag';
    tag.textContent = p.nickname;
    Object.assign(tag.style, {
      position: 'absolute', left: '14px', top: '18px', padding: '1px 6px', borderRadius: '8px', whiteSpace: 'nowrap',
      font: '600 11px/16px system-ui, sans-serif', color: '#1d1d1f', background: p.colour, boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
    });
    el.append(svg, tag);
    this.sync.app.overlay.append(el);
    const c: Cursor = { el, tag, arrow, x: 0, y: 0, seen: 0, shown: false };
    this.cursors.set(id, c);
    return c;
  }

  /** Each cursor sits on the felt where its player points, through your camera; off screen, clamped to the edge. */
  private drawCursors(): void {
    if (!this.cursors.size) return;
    const { rig } = this.sync.app;
    const { width, height } = rig.viewport;
    for (const c of this.cursors.values()) {
      // No timeout: a resting mouse streams nothing new, and its cursor stays (O18). It goes
      // when its player's pointer leaves the table (a stream without `cur`) or the player does.
      const visible = c.shown;
      c.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const s = rig.worldToScreen(c.x, c.y, 0);
      const off = !Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.y < 0 || s.x > width || s.y > height;
      const x = Math.min(width - 10, Math.max(2, Number.isFinite(s.x) ? s.x : width / 2));
      const y = Math.min(height - 10, Math.max(2, Number.isFinite(s.y) ? s.y : height / 2));
      c.el.style.transform = `translate(${x}px, ${y}px)`;
      c.el.style.opacity = off ? '0.6' : '1';
    }
  }
}

/** A pose `at` a time, between the two samples about it; the last one once past it. */
export function poseAt(list: { at: number; pose: Pose6 }[], at: number): Pose6 | null {
  if (!list.length) return null;
  if (at <= list[0].at) return list[0].pose;
  for (let i = 1; i < list.length; i++) {
    const b = list[i];
    if (b.at < at) continue;
    const a = list[i - 1];
    const k = (at - a.at) / Math.max(1, b.at - a.at);
    return lerpPose(a.pose, b.pose, k);
  }
  return list[list.length - 1].pose;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

export function lerpPose(a: Pose6, b: Pose6, k: number): Pose6 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, lerpAngle(a[3], b[3], k), lerpAngle(a[4], b[4], k), lerpAngle(a[5], b[5], k)];
}
