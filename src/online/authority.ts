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
import { fullStandsOf, inFrontOf, isFullStand, isStand } from '../state/stand';
import { newUid, snapCard } from '../state/store';
import { getRecords } from '../scryfall/cardData';
import { fetchByIds } from '../scryfall/resolve';
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
  private timer: ReturnType<typeof setInterval> | undefined;
  private opsSince = 0;
  /** Players gone, and when their holds drop. */
  private readonly drops = new Map<string, ReturnType<typeof setTimeout>>();
  /** Proposals waiting their turn, in the order they came (one may wait for card data). */
  private readonly queue: Proposal[] = [];
  private judging = false;

  constructor(private readonly sync: RoomSync) {}

  /** Become the judge: the maker on going online, or a new crown once its table has arrived. */
  start(): void {
    if (this.active) return;
    this.active = true;
    // Holds already confirmed before the crown came here are presence's; they carry on.
    for (const [uid, by] of this.sync.presence.holders) this.heldBy.set(uid, by);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.snapshot(), SNAPSHOT_EVERY_MS);
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
    const reason = this.check(msg.op, msg.from, msg.pre, false);
    if (reason) {
      this.sync.session.send({ t: 'refuse', id: msg.id, to: msg.from, reason });
      return;
    }
    // A spill is laid out here, where every identity is known (6.3); the proposer takes the crown's version.
    const op = this.expandSpills(msg.op);
    this.take(op, msg.from);
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
      return;
    }
    this.take(op, me);
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
    // Undo (8.6): refused if anyone has touched those things since the undoer last saw them.
    if (pre) {
      const touched = this.sync.inbox.touched;
      for (const [uid, seq] of Object.entries(pre)) if ((touched.get(uid) ?? 0) !== seq) return 'touched';
    }
    const room = this.sync.online.room;
    const who: Rank | 'crown' = from === room.crown ? 'crown' : room.player(from)?.rank ?? 'view';
    return this.checkOp(op, from, who, applied);
  }

  /**
   * `freed`: stands the same batch removes or spills, whose cards it may take
   * off with them (a spill laid out by the spiller, 6.3); the removal itself is
   * judged as a removal.
   */
  private checkOp(op: Op, from: string, who: Rank | 'crown', applied: boolean, freed: Set<string> = new Set()): RefuseReason | null {
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
    const first = (...reasons: (RefuseReason | null)[]) => reasons.find((r) => r) ?? null;
    switch (op.t) {
      case 'batch': {
        const gone = new Set(freed);
        for (const o of op.ops) if (o.t === 'mat') for (const u of [...(o.remove ?? []), ...(o.spill ?? [])]) gone.add(u);
        for (const o of op.ops) {
          const r = this.checkOp(o, from, who, applied, gone);
          if (r) return r;
        }
        return null;
      }
      case 'add': {
        const fresh = op.cards.filter((c) => !store.cards.has(c.uid)).length;
        const total = applied ? store.cards.size : store.cards.size + fresh;
        if (total > MAX_CARDS && (fresh || applied)) return 'cap';
        if (crown) return null;
        return first(may(addAction(op.cards.map((c) => store.records.get(c.scryfallId)))), op.cards.some((c) => notMine(c.stand)) ? 'stand' : null);
      }
      case 'remove': {
        if (heldByOther(op.uids)) return 'held';
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
        return crown ? null : this.checkMat(op, from, may);
      case 'basics':
        return crown ? null : may('basics');
      case 'table':
        return crown ? null : may('table');
      case 'replace':
        return crown ? null : may('replace');
      case 'reuid':
        return crown ? null : may('reuid');
    }
  }

  /** Playmats and stands (6.2, 6.3): what a mat op needs from someone who is not the crown. */
  private checkMat(op: Extract<Op, { t: 'mat' }>, from: string, may: (a: Action) => RefuseReason | null): RefuseReason | null {
    const store = this.sync.app.store;
    const mats = [...store.mats.values()];
    const fullOf = (except?: string) => fullStandsOf(mats, from).filter((m) => m.uid !== except).length;
    for (const m of op.set ?? []) {
      const was = store.mats.get(m.uid);
      let r: RefuseReason | null;
      if (!was) {
        if (!isStand(m)) r = may('matAdd');
        else if (m.owner && m.owner !== from) r = may('standClaim');
        else {
          // Your own hand stand and small stands at Move; one full stand each (O27, O59).
          r = may('standOwn');
          if (!r && isFullStand(m) && fullOf()) r = 'oneStand';
        }
      } else if (!isStand(was)) r = may('mat');
      else {
        const owner = was.owner ?? null;
        const next = m.owner ?? null;
        if (owner !== next) {
          if (owner === from && next === null) r = may('standOwn');
          else if (owner === null && next === from) {
            // Claim (O65): Move if you have no full stand yet, Everything regardless.
            r = isFullStand(was) && fullOf(was.uid) ? may('standClaim') : may('standOwn');
          } else r = may('standClaim');
        } else if (owner === from) r = may('standOwn');
        else r = owner === null ? may('standClaim') : 'stand';
      }
      if (r) return r;
    }
    for (const uid of [...(op.remove ?? []), ...(op.spill ?? [])]) {
      const m = store.mats.get(uid);
      if (!m) continue;
      const r = isStand(m) ? (m.owner === from ? may('standRemoveOwn') : may('standSpill')) : may('matRemove');
      if (r) return r;
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
