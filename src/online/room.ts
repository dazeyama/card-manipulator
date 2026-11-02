// The client's view of the room (ONLINE.md 11.2): its code, who is in it, who
// is crown and maker, my rank, the settings and the connection, with events
// the Online panel, the top bar and the guard follow. It keeps the room's
// meta only; the table lives in the store.

import { Emitter } from '../state/store';
import { allowed, type Action, type Rank } from '../../shared/permissions';
import { defaultRoomSettings, type ChatLine, type Player, type PublicSettings, type ServerMsg, CHAT_LINES } from '../../shared/protocol';

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RoomEvents {
  /** The player list changed: a join, leave, rank, color, side or crown change. */
  players: void;
  settings: void;
  /** The crown moved to another player (or to me). */
  crown: void;
  /** My own rank or color changed. */
  me: void;
  /** The socket opened, dropped or closed for good. */
  connection: void;
  /** A chat line, mine, another player's or a system line. */
  chat: ChatLine;
  /** Someone started or ended a search (L L, decision 310): the cards before and after. */
  searches: string[];
}

export class RoomState {
  readonly events = new Emitter<RoomEvents>();
  /** Who is searching which cards (L L, decision 310): they glow in that player's color, and mine I may see. */
  readonly searches = new Map<string, Set<string>>();
  /** The six-character room code. */
  readonly code: string;
  /** My player id. */
  me = '';
  crown = '';
  maker = '';
  players: Player[] = [];
  settings: PublicSettings = { ...defaultRoomSettings('Untitled table'), password: false };
  /** My rank (kept while I am crown: what I fall back to when the crown passes). */
  rank: Rank = 'view';
  connection: Connection = 'connecting';
  /** The last CHAT_LINES lines. */
  chat: ChatLine[] = [];
  /** The server's seq when I was welcomed. */
  welcomeSeq = 0;

  constructor(code: string) {
    this.code = code;
  }

  get isCrown(): boolean {
    return !!this.me && this.me === this.crown;
  }

  get isMaker(): boolean {
    return !!this.me && this.me === this.maker;
  }

  get locked(): boolean {
    return this.settings.locked;
  }

  get downloads(): boolean {
    return this.settings.downloads;
  }

  get connected(): boolean {
    return this.connection === 'open';
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** May I do this, by rank, Lock table and Downloads (6.2)? Ownership and holds are the judge's. */
  canDo(action: Action): boolean {
    return allowed(this.isCrown ? 'crown' : this.rank, action, { locked: this.locked, downloads: this.downloads });
  }

  /** A player's nickname, or a stand-in for one who has gone. */
  nameOf(id: string): string {
    return this.player(id)?.nickname ?? 'Someone';
  }

  setConnection(c: Connection): void {
    if (this.connection === c) return;
    this.connection = c;
    this.events.emit('connection', undefined);
  }

  /** Take what the room keeps from a server message. True if it was a room message. */
  apply(msg: ServerMsg): boolean {
    switch (msg.t) {
      case 'welcome': {
        this.me = msg.me;
        this.crown = msg.crown;
        this.maker = msg.maker;
        this.rank = msg.rank;
        this.settings = msg.settings;
        this.players = msg.players;
        this.chat = msg.chat.slice(-CHAT_LINES);
        this.welcomeSeq = msg.seq;
        this.events.emit('settings', undefined);
        this.events.emit('players', undefined);
        this.events.emit('crown', undefined);
        this.events.emit('me', undefined);
        return true;
      }
      case 'players': {
        const before = this.player(this.me);
        this.players = msg.players;
        const now = this.player(this.me);
        const crown = msg.players.find((p) => p.isCrown)?.id;
        if (now) this.rank = now.rank;
        this.events.emit('players', undefined);
        if (crown && crown !== this.crown) {
          this.crown = crown;
          this.events.emit('crown', undefined);
        }
        if (now && (before?.rank !== now.rank || before?.colour !== now.colour)) this.events.emit('me', undefined);
        return true;
      }
      case 'settings':
        this.settings = msg.settings;
        this.events.emit('settings', undefined);
        return true;
      case 'crown':
        if (msg.player !== this.crown) {
          this.crown = msg.player;
          for (const p of this.players) p.isCrown = p.id === msg.player;
          this.events.emit('crown', undefined);
          this.events.emit('players', undefined);
        }
        return true;
      case 'searching': {
        const before = [...(this.searches.get(msg.player) ?? [])];
        if (msg.uids.length) this.searches.set(msg.player, new Set(msg.uids));
        else this.searches.delete(msg.player);
        this.events.emit('searches', [...before, ...msg.uids]);
        return true;
      }
      case 'chat':
        this.chat.push(msg.line);
        if (this.chat.length > CHAT_LINES) this.chat.splice(0, this.chat.length - CHAT_LINES);
        this.events.emit('chat', msg.line);
        return true;
      default:
        return false;
    }
  }
}
