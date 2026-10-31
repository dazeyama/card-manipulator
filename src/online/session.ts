// The room connection (ONLINE.md 11.2). `Session` is the contract the room
// layer is built against: send client messages, hear server messages, close.
// A session sends `hello` itself when it opens (and again on every reconnect)
// and hands each server message to its RoomState before telling listeners.
//
// FakeSession answers the hello with a one-player room (me, crown and maker)
// and confirms every op straight back, so the UI can be built before the
// server exists. WsSession is the real one: one WebSocket to the room server,
// the version check first (O48), reconnecting with backoff (4.7), a ping to
// keep it alive.

import { Emitter } from '../state/store';
import { defaultRoomSettings, isServerMsg, PLAYER_COLOURS, playerIdOf, PROTOCOL, type ByeReason, type ClientMsg, type Player, type PublicSettings, type ServerMsg, type VersionReply } from '../../shared/protocol';
import { RoomState, type Connection } from './room';
import { roomServer, socketUrl } from './link';

/** What a session says in its hello (9.1), besides the protocol version. */
export interface Hello {
  token: string;
  nickname: string;
  colour: string;
  /** The room's password, from the invite link or the join prompt. */
  key?: string;
  side: 0 | 1;
}

export interface SessionEvents {
  /** Every message from the server, after the RoomState has taken what it keeps. */
  message: ServerMsg;
  /** The connection opened, dropped (reconnecting) or ended. Also in room.connection. */
  state: Connection;
  /** The server said goodbye; the page shows the state of 12.7. */
  bye: ByeReason;
}

export interface Session {
  readonly room: RoomState;
  readonly events: Emitter<SessionEvents>;
  send(msg: ClientMsg): void;
  /** Leave the room: close for good, no reconnect. */
  close(): void;
}

/** Makes the session for a room: the real one, or a FakeSession. */
export type SessionFactory = (code: string, hello: Hello) => Session;

/** A one-player room with no server, for building the UI (and tests). */
export class FakeSession implements Session {
  readonly room: RoomState;
  readonly events = new Emitter<SessionEvents>();
  private seq = 0;
  private closed = false;
  private me = '';
  private players: Player[] = [];
  private settings: PublicSettings;

  /** `others`: extra players to show in the room (always away), for UI work. */
  constructor(code: string, private readonly hello: Hello, private readonly others: Partial<Player>[] = []) {
    this.room = new RoomState(code);
    this.settings = { ...defaultRoomSettings('Untitled table'), password: false };
    void this.open();
  }

  private async open(): Promise<void> {
    this.me = await playerIdOf(this.hello.token);
    const now = Date.now();
    this.players = [
      { id: this.me, nickname: this.hello.nickname || 'Me', colour: this.hello.colour || PLAYER_COLOURS[0], rank: 'everything', side: this.hello.side, connected: true, joinedAt: now, isCrown: true, isMaker: true },
      ...this.others.map((o, i): Player => ({
        id: `fake${i + 1}`, nickname: `Player ${i + 2}`, colour: PLAYER_COLOURS[(i + 1) % PLAYER_COLOURS.length], rank: 'move', side: 0,
        connected: false, joinedAt: now + i + 1, isCrown: false, isMaker: false, ...o,
      })),
    ];
    this.setState('open');
    this.receive({ t: 'welcome', me: this.me, crown: this.me, maker: this.me, rank: 'everything', settings: this.settings, code: this.room.code, players: this.players, chat: [], seq: 0 });
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    // Answered on a later turn, as a socket would.
    queueMicrotask(() => this.answer(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.setState('closed');
  }

  private answer(msg: ClientMsg): void {
    if (this.closed) return;
    switch (msg.t) {
      case 'op':
        this.receive({ t: 'op', seq: ++this.seq, by: this.me, id: msg.id, op: msg.op });
        break;
      case 'confirm':
        this.receive({ t: 'op', seq: ++this.seq, by: msg.by, id: msg.id, op: msg.op });
        break;
      case 'chat':
        this.receive({ t: 'chat', line: { at: Date.now(), from: this.me, text: msg.text } });
        break;
      case 'settings': {
        const { password, ...rest } = msg.set;
        this.settings = { ...this.settings, ...rest, ...(password !== undefined ? { password: !!password } : {}) };
        this.receive({ t: 'settings', settings: this.settings });
        break;
      }
      case 'colour':
        this.players = this.players.map((p) => (p.id === this.me ? { ...p, colour: msg.colour } : p));
        this.receive({ t: 'players', players: this.players });
        break;
      case 'rank':
        this.players = this.players.map((p) => (p.id === msg.player ? { ...p, rank: msg.rank } : p));
        this.receive({ t: 'players', players: this.players });
        break;
      case 'close':
        this.receive({ t: 'bye', reason: 'closed' });
        this.close();
        break;
      case 'ping':
        this.receive({ t: 'pong' });
        break;
      default:
        // hello (answered at open), streams, snapshots and the rest: nobody else to tell.
        break;
    }
  }

  private receive(msg: ServerMsg): void {
    this.room.apply(msg);
    if (msg.t === 'bye') this.events.emit('bye', msg.reason);
    this.events.emit('message', msg);
  }

  private setState(c: Connection): void {
    this.room.setConnection(c);
    this.events.emit('state', c);
  }
}

/**
 * Dev only (Phase O4): every message this browser sends waits this long first,
 * to feel the room under a slow network. Set with `__latency(ms)`.
 */
export const devLatency = { ms: 0 };

/** Waits between reconnect tries (4.7): 1, 2, 4, 8 s, then every 10 s. */
const BACKOFF_MS = [1000, 2000, 4000, 8000];
const RETRY_MS = 10_000;
/** A ping this often keeps the socket and the room awake, and finds a dead one. */
const PING_MS = 25_000;

/** The room server's socket (ONLINE.md 11.2): hello, reconnect, version check, dispatch. */
export class WsSession implements Session {
  readonly room: RoomState;
  readonly events = new Emitter<SessionEvents>();
  /** Brings the hello up to date just before it is sent (the side you are on now, after an M). */
  beforeHello: ((hello: Hello) => void) | null = null;
  private ws: WebSocket | null = null;
  private closed = false;
  private tries = 0;
  private retryTimer = 0;
  private pingTimer = 0;

  constructor(code: string, private readonly hello: Hello, private readonly server: string | null = roomServer()) {
    this.room = new RoomState(code);
    void this.open();
  }

  send(msg: ClientMsg): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(msg);
    if (import.meta.env.DEV && devLatency.ms > 0) {
      // In order, each after the delay, as a slow link would deliver them.
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      }, devLatency.ms);
      return;
    }
    ws.send(text);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.setState('closed');
  }

  private stop(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
  }

  private async open(): Promise<void> {
    if (this.closed) return;
    const url = this.server ? socketUrl(this.room.code, this.server) : null;
    if (!this.server || !url) return this.retry();
    // The server speaks one version (O48): a stale page is told to reload.
    try {
      const res = await fetch(`${this.server}/api/version`);
      if (res.status === 429 && !res.headers.get('content-type')?.includes('json')) return this.end('quota');
      if (!res.ok) return this.retry();
      const v = (await res.json()) as VersionReply;
      if (v.protocol !== PROTOCOL) return this.end('version');
    } catch {
      return this.retry();
    }
    if (this.closed) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.tries = 0;
      this.beforeHello?.(this.hello);
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, ...this.hello }));
      this.setState('open');
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), PING_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (isServerMsg(msg)) this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      // 4000 follows a bye; 4001: this identity connected again elsewhere (another tab), which keeps the seat (O97).
      if (e.code === 4000 || e.code === 4001) {
        this.closed = true;
        this.setState('closed');
        return;
      }
      if (!this.closed) this.retry();
    };
  }

  /** Try again after the next wait; meanwhile the room shows Reconnecting… */
  private retry(): void {
    if (this.closed) return;
    this.setState(this.room.me ? 'reconnecting' : 'connecting');
    const wait = this.tries < BACKOFF_MS.length ? BACKOFF_MS[this.tries] : RETRY_MS;
    this.tries++;
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.open(), wait);
  }

  private receive(msg: ServerMsg): void {
    this.room.apply(msg);
    this.events.emit('message', msg);
    // Every goodbye ends the session: kicked, banned, closed, full, a wrong password, too big, too fast, over quota.
    if (msg.t === 'bye') this.end(msg.reason);
  }

  /** The server (or the version check) said goodbye: no reconnecting. */
  private end(reason: ByeReason): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.events.emit('bye', reason);
    this.setState('closed');
  }

  private setState(c: Connection): void {
    if (this.room.connection === c) return;
    this.room.setConnection(c);
    this.events.emit('state', c);
  }
}
