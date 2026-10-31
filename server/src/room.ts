// One room (ONLINE.md 10.2): a Durable Object per room code. It owns the
// room's meta (seats, ranks, crown, settings, chat) and a mirror of the table
// kept from the crown's confirmed ops and snapshots. It relays: proposals go
// to the crown, confirmed ops are stamped with `seq` and sent to everyone,
// streams fan out untouched. The rules of the table are the crown's browser's
// (O2); the server only enforces the room (6.4).
//
// Sockets use the Hibernation API, so an idle room costs nothing: each
// socket's attachment says which player it is, and on waking the Room
// rebuilds its mirror from storage and asks the crown for a fresh snapshot.

import { DurableObject } from 'cloudflare:workers';
import { applyOp } from '../../shared/apply';
import type { ConfirmedOp, Op } from '../../shared/ops';
import {
  PROTOCOL, byteLength, isClientMsg, joinSnapshot, maxBytes, playerIdOf, splitSnapshot,
  type ByeReason, type ClientMsg, type RoomInfo, type ServerMsg, type SnapshotPart, type Tag,
} from '../../shared/protocol';
import { SlidingWindow } from '../../shared/rateLimit';
import type { TableState } from '../../shared/table';
import {
  CHAT_RATE, CHAT_TEXT_MAX, CLOSE_BYE, CLOSE_REPLACED, HEARTBEAT_MS, MAX_CARDS, MAX_PLAYERS, MAX_REPLACE_BYTES,
  NO_CROWN_WAIT_MS, OPLOG_FLUSH_MS, SNAPSHOT_EVERY_OPS, STREAMS_PER_SECOND,
} from './limits';
import type { LobbyBeat } from './lobby';
import {
  addChat, cleanNickname, cleanRoomName, colourFree, electCrown, newMeta, pickColour, playersOf, publicSettings, roomInfo, say, seatOf,
  type Meta, type Seat,
} from './meta';
import { RoomStorage } from './storage';
import type { Env } from './worker';

type Hello = Extract<ClientMsg, { t: 'hello' }>;
type Propose = Extract<ServerMsg, { t: 'propose' }>;
type StreamIn = Extract<ClientMsg, { t: 'stream' }>;

/** What each socket remembers through hibernation. */
interface Attachment {
  /** The player id, once its hello was accepted. */
  id: string | null;
  ip: string;
}

/** A proposal on its way to the crown, kept until the crown confirms or refuses it (so a hand-over re-sends it). */
interface Pending {
  msg: Propose;
  /** Set while no crown is connected: refuses with noCrown when it fires (4.5). */
  timer: ReturnType<typeof setTimeout> | null;
}

/** What POST /api/rooms asks a new Room. */
export interface CreateRoom {
  code: string;
  maker: string;
  name: string;
  tag: Tag;
}

const OP_KINDS = new Set(['add', 'remove', 'move', 'grab', 'release', 'reuid', 'named', 'spread', 'mat', 'dice', 'basics', 'table', 'replace', 'batch']);

/** A light shape check before an op reaches the mirror or the crown; applyOp and the judge read the rest. */
function isOp(x: unknown): x is Op {
  return !!x && typeof x === 'object' && OP_KINDS.has((x as { t?: unknown }).t as string);
}

/** Cards an op would add that the table does not have yet (for the cap, 8.7). */
function cardsAdded(table: TableState, op: Op): number {
  if (op.t === 'replace') return op.table.cards.length - table.cards.length;
  if (op.t === 'batch') return op.ops.reduce((n, o) => n + cardsAdded(table, o), 0);
  if (op.t !== 'add') return 0;
  const have = new Set(table.cards.map((c) => c.uid));
  return op.cards.filter((c) => !have.has(c.uid)).length;
}

/** Most proposals kept waiting at once; beyond it the oldest are dropped. */
const MAX_PENDING = 2000;
/** Confirmed ops kept in memory to replay over a crown snapshot they crossed. */
const RECENT_OPS = 500;

export class Room extends DurableObject<Env> {
  private meta: Meta | null;
  private mirror: TableState | null = null;
  private seq = 0;
  private readonly store: RoomStorage;
  /** Confirmed ops not yet in the op log. */
  private unflushed: ConfirmedOp[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private opsSinceSnapshot = 0;
  private recent: ConfirmedOp[] = [];
  /** By `from:id`. */
  private readonly pending = new Map<string, Pending>();
  /** The crown's snapshot parts as they arrive, and the seq when the first came. */
  private incoming: { parts: SnapshotPart[]; seq: number } | null = null;
  /** Players welcomed before the mirror existed: they get the table when the crown's first snapshot lands. */
  private readonly awaiting = new Set<string>();
  private readonly chatRate = new SlidingWindow(CHAT_RATE.limit, CHAT_RATE.windowMs);
  private readonly streamRate = new SlidingWindow(STREAMS_PER_SECOND, 1000);
  private saveQueued = false;
  private beatQueued = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RoomStorage(ctx.storage);
    // Pings are answered without waking the object (the client sends exactly this text).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.meta = this.store.loadMeta();
    if (this.meta) {
      const m = this.store.loadMirror();
      if (m) {
        this.mirror = m.table;
        this.seq = m.seq;
      }
      this.wake();
    }
  }

  // ---- RPC from the Worker ----

  /** Start a room under this code. False if one is already open here (the Worker tries another code). */
  create(c: CreateRoom): boolean {
    if (this.meta) return false;
    this.store.init();
    this.meta = newMeta(c.code, c.maker, c.name, c.tag, Date.now());
    this.mirror = null;
    this.seq = 0;
    this.store.saveMeta(this.meta);
    // The alarm closes the room if the maker never connects, and heartbeats the Lobby while anyone is here.
    void this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    return true;
  }

  /** For the join prompt and the phone page (GET /api/rooms/:code). */
  info(): RoomInfo {
    return roomInfo(this.meta);
  }

  // ---- sockets ----

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const a: Attachment = { id: null, ip: req.headers.get('CF-Connecting-IP') ?? '' };
    server.serializeAttachment(a);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return this.bye(ws, 'size');
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isClientMsg(msg)) return;
    const a = ws.deserializeAttachment() as Attachment | null;
    const id = a?.id ?? null;
    const meta = this.meta;
    const isCrown = !!id && !!meta && id === meta.crown;
    // A crown's replace carries the whole table (O97); everything else keeps 9's limits.
    const limit = msg.t === 'confirm' && isCrown && isOp(msg.op) && msg.op.t === 'replace' ? MAX_REPLACE_BYTES : maxBytes(msg.t);
    if (raw.length > limit / 3 && byteLength(raw) > limit) return this.bye(ws, 'size');
    if (msg.t === 'hello') return this.hello(ws, msg, a?.ip ?? '');
    if (!id || !meta) return;
    const seat = seatOf(meta, id);
    if (!seat) return;
    switch (msg.t) {
      case 'op':
        return this.propose(id, msg);
      case 'confirm':
        if (isCrown) this.confirm(msg);
        return;
      case 'refuse':
        if (isCrown) this.refuse(msg);
        return;
      case 'snapshot':
        if (isCrown) this.snapshotPart(msg);
        return;
      case 'stream':
        return this.stream(seat, msg);
      case 'chat':
        return this.chat(ws, seat, msg.text);
      case 'colour':
        return this.colour(seat, msg.colour);
      case 'needSnapshot':
        return this.sendTable(ws, id);
      case 'close':
        if (isCrown) await this.closeRoom('closed');
        return;
      case 'ping':
        return this.send(ws, { t: 'pong' });
      default:
        // settings, rank, kick, ban, pass: Phase O2.
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, 'bye');
    } catch {
      // Already closed.
    }
    await this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  async alarm(): Promise<void> {
    if (!this.meta) return;
    if (!this.sockets().length) return this.closeRoom('empty');
    const now = Date.now();
    this.chatRate.prune(now);
    this.streamRate.prune(now);
    this.heartbeat();
    await this.ctx.storage.setAlarm(now + HEARTBEAT_MS);
  }

  // ---- joining ----

  private async hello(ws: WebSocket, h: Hello, ip: string): Promise<void> {
    if (h.v !== PROTOCOL) return this.bye(ws, 'version');
    if (!this.meta) return this.bye(ws, 'closed');
    if (typeof h.token !== 'string' || h.token.length < 16 || h.token.length > 128) {
      ws.close(1008, 'bad hello');
      return;
    }
    const id = await playerIdOf(h.token);
    const meta = this.meta;
    if (!meta) return this.bye(ws, 'closed');
    if (meta.bans.includes(id)) return this.bye(ws, 'banned');
    this.reconcile(ws);
    const existing = seatOf(meta, id);
    const others = meta.seats.filter((s) => s.connected && s.id !== id).length;
    if (others >= MAX_PLAYERS) return this.bye(ws, 'full');

    // The same identity on a newer socket replaces the older one (O97).
    const old = this.socketOf(id, ws);
    const wasHere = !!existing?.connected;
    if (old) {
      try {
        old.close(CLOSE_REPLACED, 'replaced');
      } catch {
        // Already gone.
      }
    }
    const a: Attachment = { id, ip };
    ws.serializeAttachment(a);

    const side: 0 | 1 = h.side === 1 ? 1 : 0;
    let seat: Seat;
    if (existing) {
      seat = existing;
      seat.connected = true;
      seat.nickname = cleanNickname(h.nickname, meta.seats.indexOf(existing) + 1);
      seat.side = side;
    } else {
      seat = { id, nickname: cleanNickname(h.nickname, meta.seats.length + 1), colour: pickColour(meta, h.colour, id), rank: meta.settings.newcomers, side, connected: true, joinedAt: Date.now() };
      meta.seats.push(seat);
    }

    // Who is crown now (4.5): the first in, a crown back after a restart, or the maker reclaiming (O6).
    const before = meta.crown;
    const crownLive = !!before && before !== id && !!this.socketOf(before);
    let reclaimedFrom: Seat | undefined;
    if (!before || (!crownLive && before !== id)) meta.crown = id;
    else if (before !== id && id === meta.maker) {
      reclaimedFrom = seatOf(meta, before);
      meta.crown = id;
    }
    const isCrown = meta.crown === id;
    this.markDirty();

    this.send(ws, {
      t: 'welcome', me: id, crown: meta.crown ?? '', maker: meta.maker, rank: seat.rank, settings: publicSettings(meta),
      code: meta.code, players: playersOf(meta), chat: meta.chat, seq: this.seq,
    });
    if (meta.crown !== before) this.broadcast({ t: 'crown', player: id });
    if (isCrown) this.giveCrown(ws);
    else this.sendTable(ws, id);
    // The crown it took back from gets the mirror's table: ops it applied but had not had confirmed are gone (O97).
    if (reclaimedFrom) {
      const was = this.socketOf(reclaimedFrom.id);
      if (was) this.sendTable(was, reclaimedFrom.id);
    }
    this.broadcastPlayers();
    if (!existing) this.say(say.joined(seat));
    else if (!wasHere) this.say(say.back(seat));
    if (reclaimedFrom) this.say(say.reclaimed(seat));
    this.queueHeartbeat();
  }

  /** Seats are connected exactly when they have an open socket (after a restart the stored flags can be stale). */
  private reconcile(except: WebSocket): void {
    const meta = this.meta!;
    const live = new Set(this.sockets(except).map((s) => s.id));
    for (const s of meta.seats) s.connected = live.has(s.id);
    if (meta.crown && !live.has(meta.crown)) meta.crown = null;
  }

  /** Woken from hibernation with players still connected: check the seats, and ask the crown for a fresh table (10.2). */
  private wake(): void {
    const meta = this.meta!;
    const live = this.sockets();
    if (!live.length) return;
    const ids = new Set(live.map((s) => s.id));
    for (const s of meta.seats) s.connected = ids.has(s.id);
    if (meta.crown && !ids.has(meta.crown)) {
      const next = electCrown(meta.seats);
      if (next) this.crownTo(next);
      this.markDirty();
      return;
    }
    const crown = meta.crown ? this.socketOf(meta.crown) : undefined;
    if (crown) this.send(crown, { t: 'needSnapshot' });
  }

  /**
   * Make this socket's player the crown's browser: the whole table from the
   * mirror, unredacted, then every proposal still waiting for a judge. With no
   * mirror yet (a room just gone online), ask for the crown's table instead.
   */
  private giveCrown(ws: WebSocket): void {
    if (!this.mirror) this.send(ws, { t: 'needSnapshot' });
    else {
      const parts = this.partsFor(null);
      this.send(ws, { t: 'youAreCrown', parts: parts.length });
      for (const p of parts) this.send(ws, p);
    }
    for (const p of this.pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      this.send(ws, p.msg);
    }
  }

  /** The crown passes to another connected player (4.5). */
  private crownTo(next: string): void {
    const meta = this.meta!;
    meta.crown = next;
    this.markDirty();
    this.broadcast({ t: 'crown', player: next });
    const seat = seatOf(meta, next);
    if (seat) this.say(say.crown(seat));
    const ws = this.socketOf(next);
    if (ws) this.giveCrown(ws);
  }

  /** The table for a player who is not crown, or a note to send it when the crown's first snapshot lands. */
  private sendTable(ws: WebSocket, id: string): void {
    if (!this.mirror) {
      this.awaiting.add(id);
      return;
    }
    for (const p of this.partsFor(id)) this.send(ws, p);
  }

  /**
   * The mirror in snapshot parts for one player (null: the crown, unredacted).
   * Part 0 says the seq it is current to. Phase O1 sends every identity; O2 redacts.
   */
  private partsFor(_player: string | null): SnapshotPart[] {
    const parts = splitSnapshot(this.mirror!);
    parts[0] = { ...parts[0], seq: this.seq };
    return parts;
  }

  // ---- leaving ----

  private async left(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    const id = a?.id;
    const meta = this.meta;
    if (!id || !meta) return;
    // Replaced by a newer socket of the same identity: still here.
    if (this.socketOf(id, ws)) return;
    const seat = seatOf(meta, id);
    if (!seat?.connected) return;
    seat.connected = false;
    this.awaiting.delete(id);
    // The last one out closes the room (O61).
    if (!this.sockets(ws).length) return this.closeRoom('empty');
    this.markDirty();
    this.say(say.left(seat));
    if (meta.crown === id) {
      const next = electCrown(meta.seats);
      meta.crown = null;
      if (next) this.crownTo(next);
    }
    this.broadcastPlayers();
    this.queueHeartbeat();
  }

  /** Close the room: 'closed' by the crown (Go offline, O8) says goodbye to everyone; 'empty' when the last socket went. */
  private async closeRoom(how: 'closed' | 'empty'): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (how === 'closed') for (const s of this.sockets()) this.bye(s.ws, 'closed');
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    this.awaiting.clear();
    this.meta = null;
    this.mirror = null;
    this.seq = 0;
    this.unflushed = [];
    this.recent = [];
    this.incoming = null;
    this.opsSinceSnapshot = 0;
    await this.store.deleteAll();
    this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName('lobby').remove(meta.code)).catch(() => {}));
  }

  // ---- ops ----

  /** A player's op, for the crown to judge (8.1). With no crown connected it waits up to 5 s (4.5). */
  private propose(from: string, msg: Extract<ClientMsg, { t: 'op' }>): void {
    if (typeof msg.id !== 'string' || !isOp(msg.op)) return;
    const p: Propose = { t: 'propose', id: msg.id, from, op: msg.op, ...(msg.pre && typeof msg.pre === 'object' ? { pre: msg.pre } : {}) };
    const key = `${from}:${msg.id}`;
    if (this.pending.size >= MAX_PENDING) {
      const [oldest] = this.pending.keys();
      const gone = this.pending.get(oldest);
      if (gone?.timer) clearTimeout(gone.timer);
      this.pending.delete(oldest);
    }
    const crown = this.meta?.crown ? this.socketOf(this.meta.crown) : undefined;
    if (crown) {
      this.pending.set(key, { msg: p, timer: null });
      this.send(crown, p);
      return;
    }
    const timer = setTimeout(() => {
      const waited = this.pending.get(key);
      if (!waited?.timer) return;
      this.pending.delete(key);
      const ws = this.socketOf(from);
      if (ws) this.send(ws, { t: 'refused', id: msg.id, reason: 'noCrown' });
    }, NO_CROWN_WAIT_MS);
    this.pending.set(key, { msg: p, timer });
  }

  /** The crown's verdict for an op: stamp it, apply it to the mirror, log it, send it to everyone (10.2). */
  private confirm(msg: Extract<ClientMsg, { t: 'confirm' }>): void {
    if (!isOp(msg.op) || typeof msg.by !== 'string') return;
    const op = msg.op;
    const id = typeof msg.id === 'string' ? msg.id : undefined;
    // The size cap's backstop (8.7): the crown's judge should have refused first.
    if (this.mirror && this.mirror.cards.length + cardsAdded(this.mirror, op) > MAX_CARDS && cardsAdded(this.mirror, op) > 0) {
      if (id) {
        this.pending.delete(`${msg.by}:${id}`);
        const ws = this.socketOf(msg.by);
        if (ws) this.send(ws, { t: 'refused', id, reason: 'cap' });
      }
      return;
    }
    this.seq++;
    const c: ConfirmedOp = { seq: this.seq, by: msg.by, ...(id ? { id } : {}), op };
    if (this.mirror) {
      try {
        this.mirror = applyOp(this.mirror, op);
      } catch (err) {
        console.warn('mirror: op did not apply, asking the crown for its table', err);
        const crown = this.meta?.crown ? this.socketOf(this.meta.crown) : undefined;
        if (crown) this.send(crown, { t: 'needSnapshot' });
      }
    }
    if (id) this.pending.delete(`${msg.by}:${id}`);
    // The room's name is the table's name (4.1).
    if (op.t === 'table') this.rename(op.name);
    else if (op.t === 'replace') this.rename(op.table.name);
    this.record(c);
    this.broadcast({ t: 'op', ...c });
  }

  private refuse(msg: Extract<ClientMsg, { t: 'refuse' }>): void {
    if (typeof msg.id !== 'string' || typeof msg.to !== 'string') return;
    this.pending.delete(`${msg.to}:${msg.id}`);
    const ws = this.socketOf(msg.to);
    if (ws) this.send(ws, { t: 'refused', id: msg.id, reason: msg.reason });
  }

  /** Keep a confirmed op: in memory for replays, in the op log in batches, a fresh snapshot every 50. */
  private record(c: ConfirmedOp): void {
    this.recent.push(c);
    if (this.recent.length > RECENT_OPS) this.recent.splice(0, this.recent.length - RECENT_OPS);
    this.unflushed.push(c);
    this.opsSinceSnapshot++;
    if (this.mirror && this.opsSinceSnapshot >= SNAPSHOT_EVERY_OPS) this.writeSnapshot();
    else if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), OPLOG_FLUSH_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    if (!this.meta) return;
    this.store.appendOps(this.unflushed);
    this.unflushed = [];
  }

  private writeSnapshot(): void {
    if (!this.mirror || !this.meta) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.store.writeSnapshot(this.mirror, this.seq);
    this.unflushed = [];
    this.opsSinceSnapshot = 0;
  }

  /** A part of the crown's table (Go online, every 30 s, after a wake). The whole replaces the mirror. */
  private snapshotPart(msg: SnapshotPart): void {
    if (!Number.isInteger(msg.part) || !Number.isInteger(msg.parts) || msg.parts < 1 || msg.parts > 32 || msg.part < 0 || msg.part >= msg.parts) return;
    if (msg.part === 0 || !this.incoming) this.incoming = { parts: [], seq: this.seq };
    this.incoming.parts[msg.part] = msg;
    const got = this.incoming.parts.filter((p) => !!p);
    if (got.length < msg.parts) return;
    const since = this.incoming.seq;
    this.incoming = null;
    const table = joinSnapshot(got);
    if (!table) return;
    const first = !this.mirror;
    // Ops confirmed while the parts were on their way are not in it.
    let mirror = table;
    for (const c of this.recent) {
      if (c.seq <= since) continue;
      try {
        mirror = applyOp(mirror, c.op);
      } catch (err) {
        console.warn('mirror: replay over the snapshot failed at seq', c.seq, err);
      }
    }
    this.mirror = mirror;
    this.writeSnapshot();
    if (mirror.name !== this.meta?.settings.name) this.rename(mirror.name);
    // Players who joined before the table was here.
    for (const id of [...this.awaiting]) {
      this.awaiting.delete(id);
      const ws = this.socketOf(id);
      if (ws) this.sendTable(ws, id);
    }
    if (first) this.queueHeartbeat();
  }

  private rename(name: string): void {
    const meta = this.meta;
    if (!meta) return;
    const clean = cleanRoomName(name, meta.code);
    if (clean === meta.settings.name) return;
    meta.settings.name = clean;
    this.markDirty();
    this.broadcast({ t: 'settings', settings: publicSettings(meta) });
    this.queueHeartbeat();
  }

  // ---- streams, chat, colour ----

  /** Fan a player's stream out to everyone else, with who sent it (8.3). Never stored. */
  private stream(seat: Seat, msg: StreamIn): void {
    if (!this.streamRate.hit(seat.id, Date.now())) return;
    const side: 0 | 1 = msg.side === 1 ? 1 : 0;
    const out: Extract<ServerMsg, { t: 'stream' }> = { t: 'stream', from: seat.id, side };
    if (msg.cur) out.cur = msg.cur;
    if (msg.sel) out.sel = msg.sel;
    if (msg.hold) out.hold = msg.hold;
    if (msg.fly) out.fly = msg.fly;
    const text = JSON.stringify(out);
    for (const s of this.sockets()) {
      if (s.id === seat.id) continue;
      try {
        s.ws.send(text);
      } catch {
        // Gone; its close comes separately.
      }
    }
    if (seat.side !== side) {
      seat.side = side;
      this.broadcastPlayers();
    }
  }

  private chat(ws: WebSocket, seat: Seat, text: unknown): void {
    if (typeof text !== 'string') return;
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_TEXT_MAX);
    if (!clean) return;
    // Five lines per five seconds; more are dropped with a line only you see (5.5).
    if (!this.chatRate.hit(seat.id, Date.now())) {
      this.send(ws, { t: 'chat', line: { at: Date.now(), text: 'Slow down: five messages every five seconds' } });
      return;
    }
    this.say(clean, seat.id);
  }

  /** Swap your own colour to a free one (5.2). */
  private colour(seat: Seat, colour: unknown): void {
    const meta = this.meta!;
    if (typeof colour !== 'string' || !colourFree(meta, colour, seat.id) || seat.colour === colour) return;
    seat.colour = colour;
    this.markDirty();
    this.broadcastPlayers();
  }

  /** A chat line from a player, or a grey system line (no `from`). */
  private say(text: string, from?: string): void {
    const meta = this.meta;
    if (!meta) return;
    const line = from ? { at: Date.now(), from, text } : { at: Date.now(), text };
    addChat(meta, line);
    this.markDirty();
    this.broadcast({ t: 'chat', line });
  }

  // ---- the Lobby ----

  /** Tell the Lobby how the room stands, once per burst of changes (8.8). */
  private queueHeartbeat(): void {
    if (this.beatQueued) return;
    this.beatQueued = true;
    queueMicrotask(() => {
      this.beatQueued = false;
      this.heartbeat();
    });
  }

  private heartbeat(): void {
    const meta = this.meta;
    if (!meta) return;
    const crown = meta.crown ? seatOf(meta, meta.crown) : undefined;
    const beat: LobbyBeat = {
      code: meta.code, name: meta.settings.name, players: meta.seats.filter((s) => s.connected).length, max: MAX_PLAYERS,
      password: meta.passwordHash !== null, tag: meta.settings.tag, crown: crown?.nickname ?? '', cards: this.mirror?.cards.length ?? 0,
      since: meta.createdAt, visibility: meta.settings.visibility, locked: meta.settings.locked,
    };
    this.ctx.waitUntil(Promise.resolve(this.env.LOBBY.getByName('lobby').heartbeat(beat)).catch(() => {}));
  }

  // ---- plumbing ----

  /** Save the meta once at the end of this turn, however many things changed (few row writes, O97). */
  private markDirty(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    queueMicrotask(() => {
      this.saveQueued = false;
      if (this.meta) this.store.saveMeta(this.meta);
    });
  }

  /** Open sockets that have said hello, with their player ids. */
  private sockets(except?: WebSocket): { ws: WebSocket; id: string }[] {
    const out: { ws: WebSocket; id: string }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.id) out.push({ ws, id: a.id });
    }
    return out;
  }

  private socketOf(id: string, except?: WebSocket): WebSocket | undefined {
    return this.sockets(except).find((s) => s.id === id)?.ws;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket is closing; its close handler tidies up.
    }
  }

  private broadcast(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    for (const s of this.sockets()) {
      try {
        s.ws.send(text);
      } catch {
        // As above.
      }
    }
  }

  private broadcastPlayers(): void {
    if (this.meta) this.broadcast({ t: 'players', players: playersOf(this.meta) });
  }

  /** Say why, then close (12.7). */
  private bye(ws: WebSocket, reason: ByeReason): void {
    this.send(ws, { t: 'bye', reason });
    try {
      ws.close(CLOSE_BYE, reason);
    } catch {
      // Already closed.
    }
  }
}
