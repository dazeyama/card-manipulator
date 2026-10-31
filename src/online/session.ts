// The room connection (ONLINE.md 11.2). `Session` is the contract the room
// layer is built against: send client messages, hear server messages, close.
// A session sends `hello` itself when it opens (and again on every reconnect)
// and hands each server message to its RoomState before telling listeners.
//
// FakeSession answers the hello with a one-player room (me, crown and maker)
// and confirms every op straight back, so the UI can be built before the
// server exists. The real WebSocket session (reconnect, version check) is the
// Sync fork's and lives here too.

import { Emitter } from '../state/store';
import { defaultRoomSettings, PLAYER_COLOURS, playerIdOf, type ByeReason, type ClientMsg, type Player, type PublicSettings, type ServerMsg } from '../../shared/protocol';
import { RoomState, type Connection } from './room';

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
