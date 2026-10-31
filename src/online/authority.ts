// The crown's judge (ONLINE.md 3.1, 4.5, 6, 8.4, 11.2). Only the crown's
// browser runs it: every other player's op arrives here as a proposal, is
// checked, applied to the crown's table and confirmed, or refused back to its
// sender. It does all of it in the socket's message handler, never in the
// frame loop, so a crown in a background tab still keeps the room going (3.3).
//
// The checks (6.2, 6.4): the sender's rank for each action and Lock table
// (shared/permissions.ts), holds (first grab wins, O40), stand ownership and
// one full stand each (6.3, O27), Tokens removing only tokens (O67), the
// 5,000-card cap (O43) and an undo's precondition (8.6). The crown itself may
// do anything; only holds, the cap and its own undo's precondition apply to it.
//
// The crown also does what only it can, knowing every identity: it lays out a
// spilled stand's cards (6.3) and re-keys hidden cards after a shuffle (7.2).
// And it keeps the server's mirror fresh: a full snapshot every 30 seconds or
// 50 confirmed ops (10.2), and whenever the server asks.

import type { Op } from '../../shared/ops';
import { cardsTouched, diceTouched } from '../../shared/ops';
import { addAction, refusal, removeAction, type Action, type Rank } from '../../shared/permissions';
import { MAX_CARDS, splitSnapshot, type RefuseReason, type ServerMsg } from '../../shared/protocol';
import { HIDDEN } from '../../shared/table';
import { inSpace, placeSequential } from '../commands';
import { messyLayout, shuffled } from '../state/piles';
import { inFrontOf, isFullStand, isStand } from '../state/stand';
import { newUid, snapCard } from '../state/store';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
import type { Finish, Mat } from '../state/types';
import type { RoomSync } from './connect';

/** A full snapshot for the mirror this often, ms, or after this many confirmed ops (10.2). */
const SNAPSHOT_EVERY_MS = 30_000;
const SNAPSHOT_EVERY_OPS = 50;
/** A player whose socket closed has their holds dropped after this long (4.7, O74). */
const DROP_HOLDS_MS = 3000;

type Proposal = Extract<ServerMsg, { t: 'propose' }>;

/** What the earlier parts of one op have done to the table, so each part is judged as the op goes (6.4). */
interface JudgeCtx {
  /** Cards on the table so far. */
  cards: number;
  added: Set<string>;
  gone: Set<string>;
  /** Mats as the op has set them (null: taken away). */
  mats: Map<string, Mat | null>;
}

/** At most this many identities of removed cards are kept, for an undo of a Delete from someone who never saw them. */
const KEPT_IDENTITIES = 10_000;
/** The last few confirmed ops that touched each card or die, for undo's precondition (8.6). */
const HISTORY_PER_UID = 6;

export class Authority {
  /** True while this browser is the crown and judging. */
  active = false;
  /** Who holds each card and die (8.4). Not table state: holds are never saved. */
  readonly heldBy = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private opsSince = 0;
  /** Players gone, and when their holds drop. */
  private readonly drops = new Map<string, ReturnType<typeof setTimeout>>();
  /** Proposals waiting their turn, in the order they came (one may wait for card data). */
  private readonly queue: Proposal[] = [];
  private judging = false;
  /**
   * Every browser keeps, for each card and die, who touched it at which seq
   * lately (8.6), so a crown judges an undo by its own order, also right after a
   * handover; and the crown marks what it has applied and not yet seen echoed.
   */
  private readonly history = new Map<string, { seq: number; by: string }[]>();
  private readonly pendingTouch = new Map<string, string[]>();
  /** Identities of cards others removed, kept by the crown (review 6): an undo of that Delete gets them back. */
  private readonly removedIds = new Map<string, { scryfallId: string; finish: Finish }>();

  constructor(private readonly sync: RoomSync) {}

  /** Become the judge: the maker on going online, or a new crown once its table has arrived. */
  start(): void {
    if (this.active) return;
    this.active = true;
    // Holds already confirmed before the crown came here are presence's (kept through the snapshot); they carry on,
    // and so do this browser's own, if it is holding something as the crown comes to it (review N7).
    for (const [uid, by] of this.sync.presence.holders) this.heldBy.set(uid, by);
    const me = this.sync.online.room.me;
    const { drag, dice } = this.sync.deps ?? {};
    for (const uid of [...(drag?.dragging ? drag.heldUids : []), ...(dice?.heldUids ?? [])]) this.heldBy.set(uid, me);
    clearInterval(this.timer);
    // Only when something changed since the last one: each snapshot counts against the free plan (15).
    this.timer = setInterval(() => {
      if (this.opsSince) this.snapshot();
    }, SNAPSHOT_EVERY_MS);
    if (this.queue.length) void this.pump();
  }

  /** The crown passed to someone else (or the room is left): stop judging. */
  stop(): void {
    this.active = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.heldBy.clear();
    for (const t of this.drops.values()) clearTimeout(t);
    this.drops.clear();
    this.queue.length = 0;
    this.pendingTouch.clear();
  }

  /** Send the whole table to the server's mirror (Go online, every 30 s, when asked). */
  snapshot(): void {
    if (!this.active) return;
    this.sync.outbox.flush();
    for (const part of splitSnapshot(this.sync.app.store.table())) this.sync.session.send(part);
    this.opsSince = 0;
  }

  /** Another player's op: judged in turn, then applied and confirmed, or refused to them. */
  judge(msg: Proposal): void {
    this.queue.push(msg);
    if (!this.judging && this.active) void this.pump();
  }

  /** Judge the waiting proposals in order; synchronous unless one needs card data first. */
  private async pump(): Promise<void> {
    this.judging = true;
    try {
      while (this.active && this.queue.length) {
        const msg = this.queue[0];
        const ids = this.unknownRecords(msg);
        if (ids.length) await this.fetchRecords(ids);
        this.queue.shift();
        if (this.active) this.judgeNow(msg);
      }
    } finally {
      this.judging = false;
    }
  }

  private judgeNow(msg: Proposal): void {
    // My own changes of this turn go first: they happened first.
    this.sync.outbox.flush();
    // An undo of a Delete from someone who never saw those cards gets their printings back from the crown (review 6).
    const asked = this.restoreIdentities(msg.op);
    const reason = this.check(asked, msg.from, msg.pre, false);
    if (reason) {
      this.sync.session.send({ t: 'refuse', id: msg.id, to: msg.from, reason });
      // A refused landing still empties the hand: the cards must not hang in the air for everyone (reviews 5, 11).
      this.endHolds(msg.op, msg.from);
      return;
    }
    // A spill is laid out here, where every identity is known (6.3); the proposer takes the crown's version.
    const op = this.expandSpills(asked);
    this.take(op, msg.from);
    this.markPending(op, msg.from);
    this.sync.inbox.applyRemote(op, msg.from);
    this.sync.session.send({ t: 'confirm', id: msg.id, by: msg.from, op });
    this.counted();
    this.afterShuffle(op);
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
      this.endHolds(op, me);
      return;
    }
    this.take(op, me);
    this.markPending(op, me);
    this.sync.session.send({ t: 'confirm', id, by: me, op });
    this.counted();
    this.afterShuffle(op);
  }

  private counted(): void {
    if (++this.opsSince >= SNAPSHOT_EVERY_OPS) this.snapshot();
  }

  // ---- the checks ----

  /** Why the op may not go ahead, or null. `applied`: the crown's own, already on its table. */
  private check(op: Op, from: string, pre: Record<string, number> | undefined, applied: boolean): RefuseReason | null {
    // Undo (8.6): refused if anyone else has touched those things, in the crown's order, since the undoer last saw them.
    if (pre && this.touchedSince(pre, from)) return 'touched';
    const room = this.sync.online.room;
    const who: Rank | 'crown' = from === room.crown ? 'crown' : room.player(from)?.rank ?? 'view';
    const store = this.sync.app.store;
    const ctx: JudgeCtx = { cards: store.cards.size, added: new Set(), gone: new Set(), mats: new Map() };
    return this.checkOp(op, from, who, applied, new Set(), ctx);
  }

  /**
   * Whether another player touched any of these since the undoer's seq (8.6):
   * a confirmed op after it, or one the crown has applied and not yet seen
   * echoed. The undoer's own later ops are theirs to take back.
   */
  private touchedSince(pre: Record<string, number>, from: string): boolean {
    for (const [uid, seq] of Object.entries(pre)) {
      if (this.pendingTouch.get(uid)?.some((by) => by !== from)) return true;
      if (this.history.get(uid)?.some((e) => e.seq > seq && e.by !== from)) return true;
    }
    return false;
  }

  /**
   * `freed`: stands the same batch removes or spills, whose cards it may take
   * off with them (a spill laid out by the spiller, 6.3); the removal itself is
   * judged as a removal. `ctx`: what the earlier parts of the same op have
   * done, so the cap and the one-stand rule count the whole op (6.4).
   */
  private checkOp(op: Op, from: string, who: Rank | 'crown', applied: boolean, freed: Set<string>, ctx: JudgeCtx): RefuseReason | null {
    const store = this.sync.app.store;
    const settings = this.sync.online.room.settings;
    const crown = who === 'crown';
    /** The rank (and Lock table) for an action, as a refusal reason. */
    const may = (action: Action): RefuseReason | null => {
      const why = refusal(who, action, { locked: settings.locked, downloads: settings.downloads });
      if (!why) return null;
      if (why === 'Only the crown can do that') return 'crownOnly';
      return why === 'The table is locked' ? 'locked' : 'rank';
    };
    const heldByOther = (uids: string[]) => uids.some((u) => {
      const by = this.heldBy.get(u);
      return by !== undefined && by !== from;
    });
    /** A stand is its owner's (6.3); the crown may touch any. */
    const notMine = (standUid: string | null | undefined) => {
      if (crown || !standUid || freed.has(standUid)) return false;
      const m = store.mats.get(standUid);
      return !!m && isStand(m) && m.owner !== from;
    };
    /** On the table now, counting the earlier parts of this op. */
    const exists = (uid: string) => ctx.added.has(uid) || (store.cards.has(uid) && !ctx.gone.has(uid));
    const first = (...reasons: (RefuseReason | null)[]) => reasons.find((r) => r) ?? null;
    switch (op.t) {
      case 'batch': {
        const gone = new Set(freed);
        for (const o of op.ops) if (o.t === 'mat') for (const u of [...(o.remove ?? []), ...(o.spill ?? [])]) gone.add(u);
        for (const o of op.ops) {
          const r = this.checkOp(o, from, who, applied, gone, ctx);
          if (r) return r;
        }
        return null;
      }
      case 'add': {
        // An add from anyone but the crown names new cards only, never one already here (review 14),
        // and never a card nobody here may know (review 6: the crown put back what it kept).
        if (!crown && op.cards.some((c) => exists(c.uid) || c.scryfallId === HIDDEN)) return 'unknown';
        const fresh = op.cards.filter((c) => !exists(c.uid));
        const total = applied ? store.cards.size : ctx.cards + fresh.length;
        if (total > MAX_CARDS && (fresh.length || applied)) return 'cap';
        if (!applied) {
          ctx.cards = total;
          for (const c of fresh) ctx.added.add(c.uid);
        }
        if (crown) return null;
        return first(may(addAction(op.cards.map((c) => store.records.get(c.scryfallId)))), op.cards.some((c) => notMine(c.stand)) ? 'stand' : null);
      }
      case 'remove': {
        if (heldByOther(op.uids)) return 'held';
        for (const u of op.uids) {
          if (!exists(u)) continue;
          ctx.gone.add(u);
          ctx.added.delete(u);
          ctx.cards--;
        }
        if (crown) return null;
        const cards = op.uids.map((u) => store.cards.get(u)).filter((c) => !!c);
        return first(may(removeAction(cards.map((c) => store.records.get(c!.scryfallId)))), cards.some((c) => notMine(c!.stand)) ? 'stand' : null);
      }
      case 'move': {
        if (heldByOther(op.moves.map((m) => m.uid))) return 'held';
        if (crown) return null;
        let r = may('move');
        if (r) return r;
        for (const m of op.moves) {
          const c = store.cards.get(m.uid);
          const to = m.stand ?? null;
          if (!c?.stand && !to) continue;
          r = may('standCards');
          if (r) return r;
          if (notMine(c?.stand) || notMine(to)) return 'stand';
        }
        return null;
      }
      case 'grab': {
        if (heldByOther([...op.uids, ...(op.dice ?? [])])) return 'held';
        if (crown) return null;
        return first(may('grab'), op.uids.some((u) => notMine(store.cards.get(u)?.stand)) ? 'stand' : null);
      }
      case 'release':
        return null;
      case 'named':
        return crown ? null : may('named');
      case 'spread':
        return crown ? null : may('spread');
      case 'dice': {
        if (heldByOther(diceTouched(op))) return 'held';
        if (crown) return null;
        const adds = (op.set ?? []).some((d) => !store.dice.has(d.uid));
        const changes = (op.set ?? []).some((d) => store.dice.has(d.uid));
        return first(adds ? may('diceAdd') : null, changes ? may('dice') : null, op.remove?.length ? may('diceRemove') : null);
      }
      case 'mat':
        return crown ? null : this.checkMat(op, from, may, ctx);
      case 'basics':
        return crown ? null : may('basics');
      case 'table':
        return crown ? null : may('table');
      case 'replace':
        // The cap holds for the crown's New table and Load file too (review 12): a table past it stays off the room.
        if (op.table.cards.length > MAX_CARDS) return 'cap';
        return crown ? null : may('replace');
      case 'reuid':
        return crown ? null : may('reuid');
    }
  }

  /**
   * Playmats and stands (6.2, 6.3): what a mat op needs from someone who is
   * not the crown, judged against the table as the op's earlier parts leave it.
   */
  private checkMat(op: Extract<Op, { t: 'mat' }>, from: string, may: (a: Action) => RefuseReason | null, ctx: JudgeCtx): RefuseReason | null {
    const store = this.sync.app.store;
    const now = (uid: string): Mat | undefined => (ctx.mats.has(uid) ? ctx.mats.get(uid) ?? undefined : store.mats.get(uid));
    /** Full stands the sender owns, as this op has left them so far, apart from one. */
    const fullMine = (except: string): number => {
      let n = 0;
      for (const [uid, m] of ctx.mats) if (uid !== except && m && isFullStand(m) && m.owner === from) n++;
      for (const m of store.mats.values()) if (m.uid !== except && !ctx.mats.has(m.uid) && isFullStand(m) && m.owner === from) n++;
      return n;
    };
    const fullOfMine = (m: Mat | undefined) => !!m && isStand(m) && isFullStand(m) && m.owner === from;
    for (const m of op.set ?? []) {
      const was = now(m.uid);
      let r: RefuseReason | null = null;
      /** Everything may claim an unowned stand even with a full stand already (O65). */
      let regardless = false;
      if (was && isStand(was) !== isStand(m)) {
        // A playmat turned stand or a stand turned playmat: no honest page sends one, and it could
        // take another player's stand and show its cards (review N5). The crown's alone.
        r = 'crownOnly';
      } else if (!was) {
        if (!isStand(m)) r = may('matAdd');
        // A stand made for someone else is Give to, the crown's (6.3).
        else if (m.owner && m.owner !== from) r = 'stand';
        else r = may('standOwn');
      } else if (!isStand(m)) r = may('mat');
      else {
        const owner = was.owner ?? null;
        const next = m.owner ?? null;
        if (owner !== next) {
          // Only Release your own, and Claim an unowned one for yourself (O65);
          // Give to and taking another's are the crown's (review 8).
          if (owner === from && next === null) r = may('standOwn');
          else if (owner === null && next === from) {
            if (isFullStand(m) && fullMine(m.uid) > 0) {
              r = may('standClaim');
              regardless = true;
            } else r = may('standOwn');
          } else r = 'stand';
        } else if (owner === from) r = may('standOwn');
        else r = owner === null ? may('standClaim') : 'stand';
      }
      // One full stand each (O27): a spawn, a claim, a widened small stand or a playmat turned stand alike (review 15).
      if (!r && !regardless && fullOfMine(m) && !fullOfMine(was) && fullMine(m.uid) > 0) r = 'oneStand';
      if (r) return r;
      ctx.mats.set(m.uid, m);
    }
    for (const uid of [...(op.remove ?? []), ...(op.spill ?? [])]) {
      const m = now(uid);
      if (!m) continue;
      const r = isStand(m) ? (m.owner === from ? may('standRemoveOwn') : may('standSpill')) : may('matRemove');
      if (r) return r;
      ctx.mats.set(uid, null);
    }
    return null;
  }

  /** Printings a Tokens player's add or remove needs the crown to know before it can judge them (O67). */
  private unknownRecords(msg: Proposal): string[] {
    const room = this.sync.online.room;
    if (msg.from === room.crown || room.player(msg.from)?.rank !== 'tokens') return [];
    const store = this.sync.app.store;
    const ids = new Set<string>();
    const walk = (op: Op) => {
      if (op.t === 'batch') op.ops.forEach(walk);
      else if (op.t === 'add') for (const c of op.cards) ids.add(c.scryfallId);
      else if (op.t === 'remove') for (const u of op.uids) ids.add(store.cards.get(u)?.scryfallId ?? '');
    };
    walk(msg.op);
    return [...ids].filter((id) => id && id !== HIDDEN && !store.records.has(id));
  }

  private async fetchRecords(ids: string[]): Promise<void> {
    const store = this.sync.app.store;
    try {
      const cached = await getRecords(ids);
      store.addRecords([...cached.values()].filter((r) => !store.records.has(r.id)));
      const missing = ids.filter((id) => !store.records.has(id));
      if (missing.length) store.addRecords(await fetchByIds(missing));
    } catch (err) {
      console.warn('The crown could not fetch card data to judge an op', err);
    }
  }

  // ---- what only the crown can do ----

  /** Spills in an op, laid out (6.3): each spilled stand's cards face down in a messy pile at its foot, then the stand removed. */
  private expandSpills(op: Op): Op {
    if (op.t === 'batch') return { t: 'batch', ops: op.ops.map((o) => this.expandSpills(o)) };
    if (op.t !== 'mat' || !op.spill?.length) return op;
    const { spill, ...rest } = op;
    const ops: Op[] = [];
    if (rest.set?.length || rest.remove?.length) ops.push(rest);
    ops.push(...spillOps(this.sync.app.store, spill, this.sync.app));
    return ops.length === 1 ? ops[0] : { t: 'batch', ops };
  }

  /**
   * After a shuffle (S S) of cards some players may not see (face down, or on
   * a stand), the crown gives those cards fresh uids (7.2, O66), so no browser
   * can follow a card it once saw through the shuffle: they are taken off and
   * put back under new uids in a random order, an `add` the server redacts per
   * player. Visible cards keep theirs.
   */
  private afterShuffle(op: Op): void {
    const moved = shuffleMoves(op);
    if (!moved.length) return;
    const store = this.sync.app.store;
    const hidden = moved.filter((u) => {
      const c = store.cards.get(u);
      return !!c && (!c.faceUp || !!c.stand);
    });
    if (hidden.length < 2) return;
    const fresh = shuffled(hidden.map((u) => ({ ...snapCard(store.cards.get(u)!), uid: newUid('c') })));
    const rekey: Op = { t: 'batch', ops: [{ t: 'remove', uids: hidden }, { t: 'add', cards: fresh }] };
    const me = this.sync.online.room.me;
    this.markPending(rekey, me);
    this.sync.inbox.applyRemote(rekey, me);
    this.sync.session.send({ t: 'confirm', by: me, op: rekey });
    this.counted();
  }

  // ---- holds ----

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
      case 'remove': {
        const store = this.sync.app.store;
        for (const u of op.uids) {
          const c = store.cards.get(u);
          if (c && c.scryfallId !== HIDDEN) this.removedIds.set(u, { scryfallId: c.scryfallId, finish: c.finish });
        }
        while (this.removedIds.size > KEPT_IDENTITIES) this.removedIds.delete(this.removedIds.keys().next().value!);
        for (const u of op.uids) if (this.heldBy.get(u) === by) this.heldBy.delete(u);
        return;
      }
      case 'release':
      case 'move':
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

  /**
   * A confirmed op came back from the server (everyone's, the crown's own
   * included): who touched what at which seq, and the crown's mark of it as
   * applied but not yet echoed is cleared.
   */
  confirmed(op: Op, by: string, seq: number): void {
    for (const u of [...cardsTouched(op), ...diceTouched(op)]) {
      let list = this.history.get(u);
      if (!list) this.history.set(u, (list = []));
      list.push({ seq, by });
      if (list.length > HISTORY_PER_UID) list.shift();
      const waiting = this.pendingTouch.get(u);
      if (waiting) {
        const i = waiting.indexOf(by);
        if (i >= 0) waiting.splice(i, 1);
        if (!waiting.length) this.pendingTouch.delete(u);
      }
    }
  }

  /** The crown applied this op and has not yet seen it echoed: a quick undo by someone else must not pass it (reviews 10, 20). */
  private markPending(op: Op, by: string): void {
    if (!this.active) return;
    for (const u of [...cardsTouched(op), ...diceTouched(op)]) {
      const list = this.pendingTouch.get(u);
      if (list) list.push(by);
      else this.pendingTouch.set(u, [by]);
    }
  }

  /** A refused op still ends its sender's hold on what it named, by a release on their behalf (8.4; reviews 5, 11). */
  private endHolds(op: Op, by: string): void {
    const store = this.sync.app.store;
    const uids = [...cardsTouched(op), ...diceTouched(op)].filter((u) => this.heldBy.get(u) === by);
    if (!uids.length) return;
    const dice = uids.filter((u) => store.dice.has(u));
    const release: Op = { t: 'release', uids: uids.filter((u) => !store.dice.has(u)), ...(dice.length ? { dice } : {}) };
    this.take(release, by);
    this.sync.inbox.applyRemote(release, by);
    this.sync.session.send({ t: 'confirm', by, op: release });
    this.counted();
  }

  /** Cards in an add that the crown removed for someone who could not see them: their kept printings put back (review 6). */
  private restoreIdentities(op: Op): Op {
    if (op.t === 'batch') return { t: 'batch', ops: op.ops.map((o) => this.restoreIdentities(o)) };
    if (op.t !== 'add' || !op.cards.some((c) => c.scryfallId === HIDDEN && this.removedIds.has(c.uid))) return op;
    return {
      t: 'add',
      cards: op.cards.map((c) => {
        const kept = c.scryfallId === HIDDEN ? this.removedIds.get(c.uid) : undefined;
        return kept ? { ...c, scryfallId: kept.scryfallId, finish: kept.finish } : c;
      }),
    };
  }

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
      this.drops.set(p.id, setTimeout(() => {
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
    this.markPending(op, player);
    this.sync.inbox.applyRemote(op, player);
    this.sync.session.send({ t: 'confirm', by: player, op });
    this.counted();
  }
}

/** The cards an op's shuffled moves land (a move flagged `shuffle`, anywhere in a batch). */
function shuffleMoves(op: Op): string[] {
  if (op.t === 'move') return op.shuffle ? op.moves.map((m) => m.uid) : [];
  if (op.t !== 'batch') return [];
  if (!op.ops.some((o) => o.t === 'move' && o.shuffle)) return op.ops.flatMap(shuffleMoves);
  // A shuffle's batch: every card it moves was shuffled.
  return [...new Set(op.ops.flatMap((o) => (o.t === 'move' ? o.moves.map((m) => m.uid) : [])))];
}

/**
 * Spilling stands (6.3, O31): their cards land face down in a messy pile on the
 * table in front of each, then the stand goes. As ops, for the room; offline
 * and for the crown they are applied through the store like any change.
 */
export function spillOps(store: RoomSync['app']['store'], uids: string[], app: RoomSync['app']): Op[] {
  const ops: Op[] = [];
  for (const uid of uids) {
    const m = store.mats.get(uid);
    if (!m || !isStand(m)) continue;
    const cards = [...store.cards.values()].filter((c) => c.stand === uid).sort((a, b) => a.z - b.z).map((c) => c.uid);
    if (cards.length) {
      const spots = inFrontOf(m, messyLayout(cards.length, { x: m.x, y: m.y, yaw: m.yaw }));
      const landings = inSpace(null, () => placeSequential(app, cards, spots));
      ops.push({ t: 'move', moves: landings.map((l) => ({ uid: l.uid, x: l.x, y: l.y, z: l.z, yaw: l.yaw, faceUp: false, stand: null })) });
    }
    // A spill, not a removal: the server writes the spill's chat line (5.5) with the stand still in its mirror.
    ops.push({ t: 'mat', spill: [uid] });
  }
  return ops;
}
