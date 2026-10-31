// Starting and stopping the room layer (ONLINE.md 4.1, 11.2): the Online
// panel's RoomControl. Connecting makes the session and the Online, attaches
// it as app.online and wires the parts together: the store's hook to the
// outbox, the server's messages to the inbox, the judge and presence, the
// stream out. A maker keeps its table and sends it once welcomed (Go online
// publishes the table you have, O7); a joiner's own table is kept aside in
// its autosave, which pauses (O9, O72), and comes back on leaving.

import type { App } from '../app';
import type { Autosave } from '../io/autosave';
import type { DragController } from '../physics/feel';
import type { Dice } from '../dice';
import type { DiceLayer } from '../render/dice';
import type { Op } from '../../shared/ops';
import { cardsTouched, diceTouched } from '../../shared/ops';
import { MAX_CARDS, type RefuseReason, type ServerMsg } from '../../shared/protocol';
import { toast } from '../ui/toasts';
import { Online } from './index';
import { Authority } from './authority';
import { Inbox } from './inbox';
import { Outbox } from './outbox';
import { Presence } from './presence';
import { FakeSession, WsSession, type Hello, type Session } from './session';
import { Streams } from './streams';

/** How this browser came into the room: it made it (Go online), or joined by a link. */
export type Role = 'maker' | 'joiner';

/** What the room layer needs from the rest of the app. */
export interface RoomDeps {
  drag: DragController;
  dice: Dice;
  diceLayer: DiceLayer;
  autosave: Autosave;
}

/** One room's sync, from connecting to leaving. */
export class RoomSync {
  readonly outbox: Outbox;
  readonly inbox: Inbox;
  readonly authority: Authority;
  readonly presence: Presence;
  readonly streams: Streams;
  private readonly stops: (() => void)[] = [];
  /** The maker keeps its own table on its first welcome; any later one brings the room's. */
  private keepTable: boolean;

  constructor(readonly app: App, readonly online: Online, readonly role: Role, readonly deps: RoomDeps) {
    this.keepTable = role === 'maker';
    this.outbox = new Outbox(this);
    this.inbox = new Inbox(this);
    this.authority = new Authority(this);
    this.presence = new Presence(this);
    this.streams = new Streams(this);
    online.presence = this.presence;
    const store = app.store;
    if (role === 'joiner') {
      // The joiner's own table stays in its autosave (O9): nothing of the room is written there.
      deps.autosave.paused = true;
      deps.drag.cancel();
      app.physics?.abandonAll();
      // An empty table while the room's arrives (4.2: a visitor by link skips the welcome table).
      store.remote(() => store.clear());
    }
    store.onLocalChange = this.outbox.record;
    const room = online.room;
    this.stops.push(
      online.session.events.on('message', (m) => this.onMessage(m)),
      // A dropped socket ends the judging: a crown back after a drop starts again from the table the server sends (review 18).
      online.session.events.on('state', (s) => {
        if (s !== 'open') this.authority.stop();
      }),
      room.events.on('players', () => {
        this.presence.players();
        this.authority.players();
      }),
      room.events.on('crown', () => this.crownMoved()),
    );
  }

  get session(): Session {
    return this.online.session;
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        if (this.keepTable && msg.crown === msg.me) {
          // Going online (O7): this table is the room's; the server's mirror takes it now.
          // The server asks for it (needSnapshot) and joiners get it when it lands (O97).
          this.keepTable = false;
          this.inbox.welcome(msg.seq);
          this.authority.start();
        } else {
          this.keepTable = false;
          this.inbox.welcome(msg.seq);
          this.inbox.expectTable();
        }
        break;
      case 'snapshot':
        this.inbox.snapshot(msg);
        break;
      case 'op':
        this.inbox.op(msg);
        break;
      case 'propose':
        this.authority.judge(msg);
        break;
      case 'refused':
        this.outbox.refused(msg.id, msg.reason);
        break;
      case 'stream':
        this.presence.stream(msg);
        break;
      case 'youAreCrown':
        this.inbox.takeCrown();
        break;
      case 'needSnapshot':
        this.authority.snapshot();
        break;
      case 'reveal':
        this.inbox.reveal(msg.cards);
        break;
      case 'forget':
        this.inbox.forget(msg.uids);
        break;
      default:
        break;
    }
  }

  /** The crown moved: a crown that has the whole table judges; one that has lost it stops. */
  private crownMoved(): void {
    const room = this.online.room;
    if (!room.isCrown) this.authority.stop();
    else if (!this.inbox.loading) this.authority.start();
  }

  /** One short toast for a refusal (12.4). */
  refusedToast(reason: RefuseReason, op: Op): void {
    const room = this.online.room;
    let text: string;
    switch (reason) {
      case 'held': {
        const uid = [...cardsTouched(op), ...diceTouched(op)].find((u) => this.presence.holders.has(u));
        const who = uid ? room.nameOf(this.presence.holders.get(uid)!) : 'someone';
        text = `That card is in ${who}'s hand`;
        break;
      }
      case 'locked': text = 'The table is locked'; break;
      case 'cap': text = `The table is full: ${MAX_CARDS.toLocaleString()} cards`; break;
      case 'crownOnly': text = 'Only the crown can do that'; break;
      case 'touched': text = 'Someone else has moved those since'; break;
      case 'oneStand': text = 'You already have a hand stand'; break;
      case 'stand': text = 'Only its owner can touch that stand'; break;
      case 'rank': text = 'Your rank does not allow that'; break;
      case 'noCrown': text = 'The room has no crown for a moment: try again'; break;
      default: text = 'The crown could not do that'; break;
    }
    toastOnce(text);
  }

  /**
   * Leave the room layer. A joiner gets its own table back whichever way it
   * goes; the maker keeps the table either way, since it was its own (O8).
   */
  stop(_how: 'leave' | 'offline'): void {
    for (const s of this.stops.splice(0)) s();
    this.streams.stop();
    this.presence.stop();
    this.authority.stop();
    this.outbox.stop();
    const app = this.app;
    if (app.store.onLocalChange === this.outbox.record) app.store.onLocalChange = null;
    this.online.session.close();
    if (app.online === this.online) app.online = null;
    // A joiner's way out, whatever it is (Leave, or Go offline with a crown it inherited, review 13), brings
    // its own table back: the room's was never its own. The autosave stays paused until it is back (O9, O72).
    if (this.role === 'joiner') {
      this.deps.drag.cancel();
      app.physics?.abandonAll();
      void this.deps.autosave.restore()
        .then((had) => {
          if (!had) {
            app.store.clear();
            app.store.setName('Untitled table');
          }
        })
        .finally(() => (this.deps.autosave.paused = false));
    }
  }
}

/** One toast per message for its two seconds, never a stack of the same one (12.4). */
const lastToast = new Map<string, number>();
function toastOnce(text: string): void {
  const now = performance.now();
  if (now - (lastToast.get(text) ?? -Infinity) < 2000) return;
  lastToast.set(text, now);
  toast(text, 'warn', 2000);
}

/** The Online panel's RoomControl: connect to a room, and leave it. */
export class RoomLayer {
  private current: RoomSync | null = null;

  constructor(private readonly app: App, private readonly deps: RoomDeps) {}

  connect(code: string, hello: Hello, role: Role): Online {
    this.current?.stop('leave');
    // Dev only: `?fakeroom` is a room of one with no server (O96).
    const fake = import.meta.env.DEV && new URLSearchParams(location.search).has('fakeroom');
    const session = fake ? new FakeSession(code, hello) : new WsSession(code, hello);
    // A reconnect says which side of the table you are on now (M, 5.3).
    if (session instanceof WsSession) session.beforeHello = (h) => (h.side = this.app.side);
    const online = new Online(this.app, session);
    this.app.online = online;
    this.current = new RoomSync(this.app, online, role, this.deps);
    return online;
  }

  disconnect(how: 'leave' | 'offline'): void {
    const sync = this.current;
    this.current = null;
    sync?.stop(how);
  }

  /** The room's sync now, for the dev tools. */
  get sync(): RoomSync | null {
    return this.current;
  }
}
