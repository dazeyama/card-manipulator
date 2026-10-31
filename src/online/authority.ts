// The crown's judge (ONLINE.md 3.1, 4.5, 8.4, 11.2). Only the crown's browser
// runs it: every other player's op arrives here as a proposal, is checked,
// applied to the crown's table and confirmed, or refused back to its sender.
// It does all of it in the socket's message handler, never in the frame loop,
// so a crown in a background tab still keeps the room going (3.3).
//
// Phase O1: everyone may do everything; the judge checks holds (first grab
// wins, O40), the 5,000-card cap (O43) and an undo's precondition (8.6). Ranks,
// Lock table and stand ownership come in Phase O2.
//
// It also keeps the server's mirror fresh: a full snapshot every 30 seconds
// or 50 confirmed ops (10.2), and whenever the server asks.

import type { Op } from '../../shared/ops';
import { cardsTouched, diceTouched } from '../../shared/ops';
import { MAX_CARDS, splitSnapshot, type RefuseReason, type ServerMsg } from '../../shared/protocol';
import type { RoomSync } from './connect';

/** A full snapshot for the mirror this often, ms, or after this many confirmed ops (10.2). */
const SNAPSHOT_EVERY_MS = 30_000;
const SNAPSHOT_EVERY_OPS = 50;
/** A player whose socket closed has their holds dropped after this long (4.7, O74). */
const DROP_HOLDS_MS = 3000;

type Proposal = Extract<ServerMsg, { t: 'propose' }>;

export class Authority {
  /** True while this browser is the crown and judging. */
  active = false;
  /** Who holds each card and die (8.4). Not table state: holds are never saved. */
  readonly heldBy = new Map<string, string>();
  private timer = 0;
  private opsSince = 0;
  /** Players gone, and when their holds drop. */
  private readonly drops = new Map<string, number>();

  constructor(private readonly sync: RoomSync) {}

  /** Become the judge: the maker on going online, or a new crown once its table has arrived. */
  start(): void {
    if (this.active) return;
    this.active = true;
    // Holds already confirmed before the crown came here are presence's; they carry on.
    for (const [uid, by] of this.sync.presence.holders) this.heldBy.set(uid, by);
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.snapshot(), SNAPSHOT_EVERY_MS);
  }

  /** The crown passed to someone else (or the room is left): stop judging. */
  stop(): void {
    this.active = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.heldBy.clear();
    for (const t of this.drops.values()) clearTimeout(t);
    this.drops.clear();
  }

  /** Send the whole table to the server's mirror (Go online, every 30 s, when asked). */
  snapshot(): void {
    if (!this.active) return;
    this.sync.outbox.flush();
    for (const part of splitSnapshot(this.sync.app.store.table())) this.sync.session.send(part);
    this.opsSince = 0;
  }

  /** Another player's op: judge it, then apply and confirm it, or refuse it to them. */
  judge(msg: Proposal): void {
    if (!this.active) {
      this.sync.session.send({ t: 'refuse', id: msg.id, to: msg.from, reason: 'noCrown' });
      return;
    }
    // My own changes of this turn go first: they happened first.
    this.sync.outbox.flush();
    const reason = this.check(msg.op, msg.from, msg.pre, false);
    if (reason) {
      this.sync.session.send({ t: 'refuse', id: msg.id, to: msg.from, reason });
      return;
    }
    this.take(msg.op, msg.from);
    this.sync.inbox.applyRemote(msg.op, msg.from);
    this.sync.session.send({ t: 'confirm', id: msg.id, by: msg.from, op: msg.op });
    this.counted();
  }

  /**
   * The crown's own op, already on its table (O63): confirmed on the spot, with
   * no round trip (8.6). Refused only for what another player holds, an undo
   * someone has overtaken, or the cap; then it comes back off the table.
   */
  own(id: string, op: Op, inverse: Op | null, opts: { pre?: Record<string, number>; refused?: (reason: RefuseReason) => void }): void {
    const me = this.sync.online.room.me;
    const reason = this.check(op, me, opts.pre, true);
    if (reason) {
      if (inverse) this.sync.inbox.applyRemote(inverse, me);
      opts.refused?.(reason);
      this.sync.refusedToast(reason, op);
      return;
    }
    this.take(op, me);
    this.sync.session.send({ t: 'confirm', id, by: me, op });
    this.counted();
  }

  private counted(): void {
    if (++this.opsSince >= SNAPSHOT_EVERY_OPS) this.snapshot();
  }

  /** Why the op may not go ahead, or null. `applied`: the crown's own, already on the table. */
  private check(op: Op, from: string, pre: Record<string, number> | undefined, applied: boolean): RefuseReason | null {
    // Undo (8.6): refused if anyone has touched those things since the undoer last saw them.
    if (pre) {
      const touched = this.sync.inbox.touched;
      for (const [uid, seq] of Object.entries(pre)) if ((touched.get(uid) ?? 0) !== seq) return 'touched';
    }
    return this.checkOp(op, from, applied);
  }

  private checkOp(op: Op, from: string, applied: boolean): RefuseReason | null {
    const heldByOther = (uids: string[]) => uids.some((u) => {
      const by = this.heldBy.get(u);
      return by !== undefined && by !== from;
    });
    switch (op.t) {
      case 'batch': {
        for (const o of op.ops) {
          const r = this.checkOp(o, from, applied);
          if (r) return r;
        }
        return null;
      }
      case 'grab':
      case 'move':
      case 'remove':
      case 'dice':
        // First grab wins (O40); nobody else moves or takes what is in a hand.
        return heldByOther([...cardsTouched(op), ...diceTouched(op)]) ? 'held' : null;
      case 'add': {
        // The cap (O43): the crown's own add is on its table already.
        const store = this.sync.app.store;
        const fresh = op.cards.filter((c) => !store.cards.has(c.uid)).length;
        const total = applied ? store.cards.size : store.cards.size + fresh;
        return total > MAX_CARDS && (fresh || applied) ? 'cap' : null;
      }
      default:
        return null;
    }
  }

  /** Keep the holds up to date with an op that is going ahead (8.4). */
  private take(op: Op, by: string): void {
    switch (op.t) {
      case 'batch':
        for (const o of op.ops) this.take(o, by);
        return;
      case 'grab':
        // Adds to the hand (O100): cards and dice picked up together come as two grabs.
        for (const u of [...op.uids, ...(op.dice ?? [])]) this.heldBy.set(u, by);
        return;
      case 'release':
      case 'move':
      case 'remove':
      case 'dice':
        for (const u of [...cardsTouched(op), ...diceTouched(op)]) if (this.heldBy.get(u) === by) this.heldBy.delete(u);
        return;
      case 'replace':
        this.heldBy.clear();
        return;
      default:
        return;
    }
  }

  /** A confirmed op came back from the server (everyone's, the crown's own included). Nothing to do yet. */
  confirmed(_op: Op, _by: string): void {}

  /**
   * The player list changed: a holder whose socket closed has their cards
   * dropped where they were last seen, three seconds on (4.7, O74), by a move
   * on their behalf, so cards never hang in the air.
   */
  players(): void {
    if (!this.active) return;
    const room = this.sync.online.room;
    for (const p of room.players) {
      const waiting = this.drops.get(p.id);
      if (p.connected) {
        if (waiting) {
          clearTimeout(waiting);
          this.drops.delete(p.id);
        }
        continue;
      }
      if (waiting || ![...this.heldBy.values()].includes(p.id)) continue;
      this.drops.set(p.id, window.setTimeout(() => {
        this.drops.delete(p.id);
        if (this.active && !room.player(p.id)?.connected) this.dropHolds(p.id);
      }, DROP_HOLDS_MS));
    }
  }

  private dropHolds(player: string): void {
    const uids = [...this.heldBy].filter(([, by]) => by === player).map(([u]) => u);
    if (!uids.length) return;
    const store = this.sync.app.store;
    const cards = uids.filter((u) => store.cards.has(u));
    const dice = uids.filter((u) => store.dice.has(u));
    const op: Op = { t: 'batch', ops: [{ t: 'release', uids: cards, ...(dice.length ? { dice } : {}) }, ...this.sync.presence.lastPoses(cards, dice)] };
    this.take(op, player);
    this.sync.inbox.applyRemote(op, player);
    this.sync.session.send({ t: 'confirm', by: player, op });
    this.counted();
  }
}
