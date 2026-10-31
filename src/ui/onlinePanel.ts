// Rooms in the browser (ONLINE.md 12.1, 12.2, 4.4, 12.7): the Go online /
// Online button and the avatar row in the top bar, the floating Online panel
// (Room, Players, Chat; Settings in Phase O2), and the flows behind them:
// going online, joining by link, leaving, going offline, and the whole-page
// states a room can end in. The room layer itself (the session, the store's
// hook, presence) is the Sync fork's, reached through RoomControl.

import type { App } from '../app';
import { Online } from '../online';
import { FakeSession, type Hello } from '../online/session';
import { getIdentity, setColour, setNickname } from '../online/identity';
import { checkServer, copyText, createRoom, inviteLink, parseHash, roomHash, roomInfo, roomLink, setHash, type RoomRoute, type ServerTrouble } from '../online/link';
import { NICKNAME_MAX, PASSWORD_MAX, PLAYER_COLOURS, ROOM_NAME_MAX, type ByeReason, type Player, type RoomInfo, type RoomSettings, type ServerMsg, type Tag, type Visibility } from '../../shared/protocol';
import { RANK_LABEL, RANKS, type Rank } from '../../shared/permissions';
import { isFullStand, isSmallStand, isStand } from '../state/stand';
import type { TopBar } from './topBar';
import { confirmDialog } from './confirm';
import { h } from './dom';
import { roomToast, type Guard } from '../online/guard';
import { ChatStrip } from './chatStrip';
import { PlayerRows } from './playerRows';
import { ColourPicker, joinPrompt } from './joinPrompt';
import { hideRoomState, roomNameLine, showRoomState } from './roomStates';
import { isPhoneOrTablet, showDesktopOnly } from './desktopOnly';
import type { HiddenGate } from '../online/hidden';
import { TableBrowser } from './tableBrowser';
import { isBlocked } from '../../shared/words';
import { AdminPage } from './adminPage';

/** How this browser came into the room: it made it (Go online), or joined by a link. */
export type Role = 'maker' | 'joiner';

/**
 * Starting and stopping the room layer. The Sync fork's connectRoom and
 * disconnectRoom: connect makes the session and the Online, attaches it as
 * app.online and starts syncing (a maker sends its table once welcomed; a
 * joiner's autosave pauses). Disconnect stops it all; 'leave' brings back this
 * browser's own table, 'offline' (the crown closing the room) keeps the table.
 */
export interface RoomControl {
  connect(code: string, hello: Hello, role: Role): Online;
  disconnect(how: 'leave' | 'offline'): void;
}

/** Until the real room layer lands: a FakeSession room of one, nothing synced. */
export function standInControl(app: App): RoomControl {
  return {
    connect(code, hello) {
      const online = new Online(app, new FakeSession(code, hello));
      app.online = online;
      return online;
    },
    disconnect() {
      app.online?.session.close();
      app.online = null;
    },
  };
}

export interface OnlineDeps {
  control: RoomControl;
  /** Download the table as a file (Save a copy, 12.2). */
  saveCopy: () => void;
  /** Bring this browser's own table back (its autosave), when the page opened on a room link and never showed it. */
  ownTable: () => Promise<void>;
  /** The hidden gate (7.3), told when a room starts, welcomes me, or ends. */
  hidden: HiddenGate;
  /** Rank gating (6.4): its buttons follow every rank, lock, crown and connection change. */
  guard?: Guard;
}

/** Dev only: `?fakeroom` goes online and joins with FakeSession, no room server needed. */
function fakeRooms(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).has('fakeroom');
}

const FAKE_INFO: RoomInfo = { name: 'Fake room', players: 1, max: 8, password: false, tag: 'cube', open: true, crown: 'Nobody', taken: [] };

export class OnlineUi {
  readonly panel: OnlinePanel;
  /** The public table browser (12.5). */
  readonly browser: TableBrowser;
  /** The owner's admin page, #/admin (12.8). */
  readonly admin = new AdminPage();
  /** Whether the room server answers, and speaks our protocol. */
  server: 'checking' | 'ok' | ServerTrouble = 'checking';
  /** The page opened on a room link, so this browser's own table hasn't been loaded. */
  needOwnTable = false;
  /** The room's password as the crown typed it this session (the server keeps only its hash), for Copy invite link. */
  password: string | null = null;
  private lastLocked = false;
  private role: Role | null = null;
  /** The room layer in use: the real one, or the FakeSession stand-in with ?fakeroom. */
  private control: RoomControl | null = null;
  private route: RoomRoute | null = null;
  private welcomed = false;
  /** The server said goodbye (a bye always comes before its close); a close without one is close code 4001. */
  private byeSeen = false;
  private stops: (() => void)[] = [];
  private known = new Map<string, Player>();
  private lastCrown = '';
  private joining: { total: number; got: number } | null = null;
  private readonly button: HTMLButtonElement;
  private readonly avatars: HTMLElement;
  private readonly status: HTMLElement;

  constructor(readonly app: App, private readonly topBar: TopBar, private readonly deps: OnlineDeps) {
    this.button = h('button', { class: 'btn small online-btn' });
    this.button.addEventListener('click', () => this.panel.toggle());
    this.avatars = h('div', { class: 'avatars' });
    this.status = h('span', { class: 'room-status' });
    topBar.roomSlot.append(this.button, this.avatars, this.status);
    this.panel = new OnlinePanel(this);
    this.browser = new TableBrowser((r) => void this.join(r), () => this.showQuota());
    void this.check();
    // While offline and without a server, look again now and then.
    window.setInterval(() => {
      if (!this.app.online && this.server !== 'ok') void this.check();
    }, 30_000);
    // A room link pasted into the address bar of an open page.
    window.addEventListener('hashchange', () => {
      const r = parseHash(location.hash);
      if (r?.kind === 'room') void this.join(r);
      else if (r?.kind === 'admin' && !this.admin.isOpen) void this.admin.open();
    });
    // The crown renames the table: the room's name follows (4.1).
    app.store.events.on('name', () => {
      const online = this.app.online;
      if (online?.room.isCrown && online.room.settings.name !== app.store.name) online.session.send({ t: 'settings', set: { name: app.store.name } });
      if (online) this.panel.refresh();
    });
    this.renderBar();
  }

  get online(): Online | null {
    return this.app.online;
  }

  /** Ask the room server whether it is there. */
  async check(): Promise<void> {
    this.server = fakeRooms() ? 'ok' : await checkServer();
    this.renderBar();
    this.panel.refresh();
  }

  // ---- the top bar (12.1) ----

  renderBar(): void {
    const online = this.online;
    const b = this.button;
    if (!online) {
      b.textContent = '🌐 Go online';
      b.classList.remove('on');
      const ok = this.server === 'ok';
      b.disabled = !ok && this.server !== 'checking';
      b.title = ok || this.server === 'checking' ? 'Share this table by link: up to eight players at once' : serverTitle(this.server);
      this.avatars.replaceChildren();
      this.status.textContent = '';
      this.status.className = 'room-status';
      this.topBar.setNameEditable(true);
      this.deps.guard?.refresh();
      return;
    }
    const room = online.room;
    b.disabled = false;
    b.textContent = '🌐 Online';
    b.classList.add('on');
    b.title = `Room ${room.code}: the link, the players and the chat`;
    const players = [...room.players].sort((a, b2) => a.joinedAt - b2.joinedAt).slice(0, 8);
    this.avatars.replaceChildren(...players.map((p) => {
      const a = h('button', { class: 'avatar' + (p.connected ? '' : ' away') + (p.id === room.me ? ' mine' : ''), title: `${p.nickname}${p.isCrown ? ' (crown)' : ` (${RANK_LABEL[p.rank]})`}${p.connected ? '' : ', away'}` }, (p.nickname.trim()[0] ?? '?').toUpperCase());
      a.style.background = p.colour;
      if (isLight(p.colour)) a.classList.add('light');
      if (p.isCrown) a.append(h('span', { class: 'avatar-crown' }, '👑'));
      a.addEventListener('click', () => this.panel.open());
      return a;
    }));
    const reconnecting = room.connection === 'reconnecting' || room.connection === 'connecting';
    this.status.className = 'room-status' + (reconnecting ? ' amber' : '');
    this.status.textContent = reconnecting ? (this.welcomed ? 'Reconnecting…' : 'Connecting…') : room.locked ? '🔒' : '';
    this.status.title = room.locked && !reconnecting ? 'The table is locked: only the crown can change it' : '';
    this.topBar.setNameEditable(room.isCrown);
    this.deps.guard?.refresh();
  }

  // ---- going online (12.2's short form) ----

  async goOnline(form: { name: string; nickname: string; colour: string; tag: Tag }): Promise<boolean> {
    if (this.online) return false;
    setNickname(form.nickname);
    setColour(form.colour);
    const store = this.app.store;
    if (form.name && form.name !== store.name) store.setName(form.name);
    const id = getIdentity();
    let code = 'TEST22';
    if (!fakeRooms()) {
      const r = await createRoom({ token: id.token, nickname: form.nickname, name: store.name, tag: form.tag });
      if (typeof r === 'string') {
        if (r === 'quota') this.showQuota();
        else if (r === 'rate') roomToast('Too many new rooms from this browser: try again within the hour', 'warn');
        else if (r === 'version') this.showReload();
        else roomToast('Could not reach the room server', 'error');
        if (r !== 'rate') void this.check();
        return false;
      }
      code = r.code;
    }
    this.enter(code, { token: id.token, nickname: form.nickname, colour: form.colour, side: this.app.side }, 'maker');
    return true;
  }

  // ---- joining by link (4.4) ----

  /** Open a room link: the checks of 4.4, the join prompt, then in. */
  async join(route: RoomRoute, error?: string): Promise<void> {
    const here = this.online;
    if (here) {
      if (here.room.code === route.code) this.panel.open();
      else roomToast('Leave this room first, then open the other link', 'warn');
      return;
    }
    hideRoomState();
    if (isPhoneOrTablet()) {
      const info = fakeRooms() ? FAKE_INFO : await roomInfo(route.code);
      showDesktopOnly(info && typeof info === 'object' ? info.name : null);
      return;
    }
    let info: RoomInfo = FAKE_INFO;
    if (!fakeRooms()) {
      const s = await checkServer();
      this.server = s;
      if (s !== 'ok') return this.troublePage(s, route);
      const got = await roomInfo(route.code);
      if (got === null) return this.closedLinkPage();
      if (typeof got === 'string') return this.troublePage(got, route);
      if (got.players >= got.max) return this.fullPage(route, got);
      info = got;
    }
    const id = getIdentity();
    const wrongKey = error === 'Wrong password';
    const answer = await joinPrompt({
      info,
      needPassword: info.password && (!route.key || wrongKey),
      nickname: id.nickname,
      colour: id.colour || PLAYER_COLOURS[0],
      error,
    });
    if (!answer) {
      setHash('');
      await this.backToOwnTable();
      return;
    }
    setNickname(answer.nickname);
    setColour(answer.colour);
    const key = answer.key ?? (wrongKey ? undefined : route.key);
    this.route = { ...route, ...(key ? { key } : {}) };
    // Everyone arrives on the near side (O64).
    this.enter(route.code, { token: id.token, nickname: answer.nickname, colour: answer.colour, side: 0, ...(key ? { key } : {}) }, 'joiner');
  }

  /** Join a table from the welcome note: the public browser, which also takes a link or code (12.6). */
  joinFromWelcome(): void {
    this.browser.open();
  }

  /** Tables (12.2): the public browser. */
  openTables(): void {
    this.browser.open();
  }

  // ---- in the room ----

  private enter(code: string, hello: Hello, role: Role): void {
    this.control = fakeRooms() ? standInControl(this.app) : this.deps.control;
    const online = this.control.connect(code, hello, role);
    // From here, leaving brings this browser's own table back (RoomControl.disconnect).
    this.needOwnTable = false;
    this.deps.hidden.attach(online);
    this.role = role;
    this.welcomed = false;
    this.byeSeen = false;
    this.known = new Map();
    this.lastCrown = '';
    this.joining = null;
    setHash(roomHash(code));
    this.watch(online);
    this.renderBar();
    this.panel.refresh();
    if (role === 'maker') this.panel.open();
  }

  private watch(online: Online): void {
    this.unwatch();
    const room = online.room;
    const ev = room.events;
    const bar = () => this.renderBar();
    this.stops.push(
      ev.on('players', () => {
        this.playerToasts();
        bar();
      }),
      ev.on('crown', () => {
        this.crownToast();
        bar();
        this.panel.refresh();
      }),
      ev.on('settings', () => {
        // Everyone hears when the table is locked or unlocked (12.4).
        if (this.welcomed && room.locked !== this.lastLocked) roomToast(room.locked ? 'The table is locked' : 'The table is unlocked', room.locked ? 'warn' : 'info');
        this.lastLocked = room.locked;
        bar();
        this.panel.refresh();
      }),
      ev.on('connection', () => {
        bar();
        // Closed for good with no goodbye: this identity opened the room in another tab (close code 4001).
        if (room.connection === 'closed') setTimeout(() => this.replacedElsewhere(), 0);
      }),
      ev.on('me', bar),
      online.session.events.on('message', (m) => this.onMessage(m)),
      online.session.events.on('bye', (r) => this.onBye(r)),
    );
  }

  private unwatch(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  private onMessage(m: ServerMsg): void {
    if (m.t === 'welcome') {
      const first = !this.welcomed;
      this.welcomed = true;
      const room = this.online!.room;
      this.known = new Map(room.players.map((p) => [p.id, { ...p }]));
      this.lastCrown = room.crown;
      this.lastLocked = room.locked;
      // Now I know who I am: my own stands' cards show (7.1).
      this.deps.hidden.attach(this.online);
      if (first && this.role === 'maker' && room.isCrown) this.stampOwners();
      if (first && this.role === 'joiner') {
        // A joiner starts at the default offline view, on the near side (O37, O36).
        this.app.rig.setMirrored(false);
        this.app.rig.reset(false);
        const mine = room.player(room.me);
        const asked = getIdentity().nickname;
        if (mine && asked && mine.nickname !== asked) roomToast(`That name is not allowed here: you are ${mine.nickname}`, 'warn');
      }
      this.renderBar();
      this.panel.refresh();
    } else if (m.t === 'snapshot') {
      this.progress(m.part, m.parts, m.count, m.cards?.length ?? 0);
    }
  }

  /**
   * Going online (O65): stands from before have no owner; the crown takes the
   * full stand nearest its side and every small stand, so they mean something at once.
   */
  private stampOwners(): void {
    const room = this.online?.room;
    if (!room) return;
    const store = this.app.store;
    const stands = [...store.mats.values()].filter(isStand);
    for (const m of stands) if (m.owner) store.setMatOwner(m.uid, null);
    for (const m of stands) if (isSmallStand(m)) store.setMatOwner(m.uid, room.me);
    // The near side is toward lower y; the far side (mirror mode) toward higher (decision 267).
    const toward = this.app.side ? -1 : 1;
    const nearest = stands.filter(isFullStand).sort((a, b) => toward * (a.y - b.y))[0];
    if (nearest) store.setMatOwner(nearest.uid, room.me);
  }

  /** The thin "Joining: 2,000 of 4,300 cards" line while a table arrives (4.4). */
  private progress(part: number, parts: number, count: number | undefined, cards: number): void {
    const line = this.topBar.progress;
    if (part === 0) this.joining = { total: count ?? 0, got: 0 };
    if (!this.joining) return;
    this.joining.got += cards;
    const { total, got } = this.joining;
    const done = part >= parts - 1 || got >= total;
    if (total < 200 || done) {
      line.hidden = true;
      if (done) this.joining = null;
      return;
    }
    line.hidden = false;
    line.textContent = `Joining: ${got.toLocaleString()} of ${total.toLocaleString()} cards`;
    line.style.setProperty('--done', String(got / total));
  }

  private playerToasts(): void {
    const room = this.online?.room;
    if (!room || !this.welcomed) return;
    for (const p of room.players) {
      if (p.id === room.me) continue;
      const before = this.known.get(p.id);
      if (!before) roomToast(`${p.nickname} joined as ${RANK_LABEL[p.rank]}`);
      else if (before.connected && !p.connected) roomToast(`${p.nickname} left`);
      else if (!before.connected && p.connected) roomToast(`${p.nickname} is back`);
    }
    this.known = new Map(room.players.map((p) => [p.id, { ...p }]));
  }

  private crownToast(): void {
    const room = this.online?.room;
    if (!room || !this.welcomed || room.crown === this.lastCrown) return;
    const was = this.lastCrown;
    this.lastCrown = room.crown;
    if (room.crown === room.me) roomToast('You are the crown now', 'ok');
    else if (room.crown === room.maker && was !== room.maker) roomToast(`${room.nameOf(room.crown)} took the crown back`);
    else roomToast(`${room.nameOf(room.crown)} is the crown now`);
  }

  /** The server said goodbye (9.2): before the welcome it is about joining; after it, the room ended for us. */
  private onBye(reason: ByeReason): void {
    this.byeSeen = true;
    const online = this.online;
    const wasCrown = !!online?.room.isCrown;
    // Leaving by who made the room, not who wears the crown: the maker's table is the room's, a joiner's own waits in autosave (O9).
    const how = this.exitHow();
    // A wrong password or a full room, on joining or on a reconnect (a newcomer took the eighth seat, or a pruned seat met the password).
    if (reason === 'password' || reason === 'full') {
      const route: RoomRoute = this.route ?? { kind: 'room', code: online?.room.code ?? '' };
      this.exit(how, false);
      if (reason === 'password') void this.join({ kind: 'room', code: route.code }, 'Wrong password');
      else void this.fullPage(route, null);
      return;
    }
    const back = () => this.exit(how);
    switch (reason) {
      case 'closed': {
        const canSave = wasCrown || !!online?.room.downloads;
        showRoomState({
          title: 'The room has closed.',
          lines: [],
          buttons: [
            ...(canSave ? [{ label: 'Save a copy', run: () => this.deps.saveCopy() }] : []),
            { label: 'Back to my table', primary: true, run: back },
          ],
        });
        break;
      }
      case 'kicked':
        showRoomState({ title: 'You were kicked from the room', lines: ['You can open the link again to rejoin.'], buttons: [{ label: 'Back to my table', primary: true, run: back }] });
        break;
      case 'banned':
        showRoomState({ title: 'You were banned from this room.', lines: [], buttons: [{ label: 'Back to my table', primary: true, run: back }] });
        break;
      case 'version':
        this.exit(how, false);
        this.showReload();
        break;
      case 'quota':
        this.showQuota(back);
        break;
      case 'rate':
        showRoomState({ title: 'Too many tries', lines: ['Too many joins or wrong passwords from this connection. Try again in a few minutes.'], buttons: [{ label: 'Back to my table', primary: true, run: back }] });
        break;
      case 'size':
        showRoomState({ title: 'The room server closed the connection', lines: ['This browser sent more than a room allows at once.'], buttons: [{ label: 'Back to my table', primary: true, run: back }] });
        break;
      default:
        showRoomState({ title: 'The room server closed the connection', lines: [], buttons: [{ label: 'Back to my table', primary: true, run: back }] });
        break;
    }
  }

  /**
   * How leaving ends here: the maker keeps the table as it stands ('offline',
   * O8); anyone else, crown or not, gets their own table back ('leave', O9).
   * A maker back by a link (a reload) is still the maker (O6).
   */
  private exitHow(): 'leave' | 'offline' {
    return this.role === 'maker' || this.online?.room.isMaker ? 'offline' : 'leave';
  }

  /** Leave the room layer and go back to this browser's table. */
  private exit(how: 'leave' | 'offline', clearState = true): void {
    this.unwatch();
    if (this.online) (this.control ?? this.deps.control).disconnect(how);
    this.control = null;
    this.deps.hidden.attach(null);
    this.role = null;
    this.route = null;
    this.password = null;
    this.welcomed = false;
    this.joining = null;
    this.topBar.progress.hidden = true;
    setHash('');
    if (clearState) hideRoomState();
    this.renderBar();
    this.panel.refresh();
  }

  private async backToOwnTable(): Promise<void> {
    hideRoomState();
    if (!this.needOwnTable) return;
    this.needOwnTable = false;
    await this.deps.ownTable();
  }

  /** Leave (12.2): asks first when you own a stand with cards on it, which waits for you. */
  async leave(): Promise<void> {
    const online = this.online;
    if (!online) return;
    const me = online.room.me;
    const store = this.app.store;
    const waiting = [...store.mats.values()].some((m) => isStand(m) && m.owner === me && [...store.cards.values()].some((c) => c.stand === m.uid));
    if (waiting && !(await confirmDialog('Leave the room? Your stand waits for you until the room closes.', 'Leave'))) return;
    // The maker keeps the table as it stands; anyone else gets their own back (O9).
    this.exit(this.exitHow());
    roomToast('You left the room');
  }

  /**
   * Go offline (O8): the crown closes the room for everyone. The maker's table
   * stays as it is; a crown who joined goes back to their own table (O9).
   */
  async goOffline(): Promise<void> {
    const online = this.online;
    if (!online?.room.isCrown) return;
    const how = this.exitHow();
    const ask = how === 'offline' ? 'Close the room for everyone? Your table stays as it is.' : 'Close the room for everyone? You go back to your own table: Save a copy first to keep this one.';
    if (!(await confirmDialog(ask, 'Go offline'))) return;
    online.session.send({ t: 'close' });
    this.exit(how);
    roomToast(how === 'offline' ? 'The room is closed. Your table is offline, as it was.' : 'The room is closed. Your own table is back.', 'ok');
  }

  async copyLink(): Promise<void> {
    const online = this.online;
    if (!online) return;
    const ok = await copyText(roomLink(online.room.code));
    roomToast(ok ? 'Room link copied' : 'Could not copy: the link is in the address bar', ok ? 'ok' : 'warn');
  }

  saveCopy(): void {
    this.deps.saveCopy();
  }

  /** The password to put in an invite link: the crown's own, or the one I joined with. */
  inviteKey(): string | null {
    return this.password ?? this.route?.key ?? null;
  }

  async copyInvite(): Promise<void> {
    const online = this.online;
    const key = this.inviteKey();
    if (!online || !key) return;
    const ok = await copyText(inviteLink(online.room.code, key));
    roomToast(ok ? 'Invite link copied: it opens straight in, password included' : 'Could not copy the invite link', ok ? 'ok' : 'warn');
  }

  // ---- pages (12.7) ----

  /**
   * The Quota page (12.7, Section 15): any call refused for the free plan's spent
   * day, or bye quota. Back to my table leaves the room if in one.
   */
  showQuota(back?: () => void): void {
    this.browser.close();
    showRoomState({
      title: 'Rooms are resting',
      lines: ['The room server is over its free daily limit. Rooms are back after midnight UTC.'],
      buttons: [{ label: 'Back to my table', primary: true, run: back ?? (() => {
        if (this.online) this.exit(this.exitHow());
        else {
          hideRoomState();
          setHash('');
          void this.backToOwnTable();
        }
      }) }],
    });
    void this.check();
  }

  /** This identity opened the room in another tab, which took the seat (close code 4001, O97). */
  private replacedElsewhere(): void {
    const online = this.online;
    if (!online || this.byeSeen || online.room.connection !== 'closed') return;
    const how = this.exitHow();
    const route: RoomRoute = this.route ?? { kind: 'room', code: online.room.code };
    showRoomState({
      title: 'This room is open in another tab',
      lines: ['Your seat moved to the newest tab you opened it in.'],
      buttons: [
        { label: 'Back to my table', run: () => this.exit(how) },
        { label: 'Use it here', primary: true, run: () => {
          this.exit(how);
          void this.join(route);
        } },
      ],
    });
  }

  private showReload(): void {
    showRoomState({
      title: 'Reload to update',
      lines: ['This page is older than the room server. Reload to update.'],
      buttons: [{ label: 'Reload', primary: true, run: () => location.reload() }],
    });
  }

  private troublePage(t: ServerTrouble, route: RoomRoute): void {
    if (t === 'version') return this.showReload();
    const back = { label: 'Back to my table', run: () => {
      setHash('');
      void this.backToOwnTable();
    } };
    if (t === 'quota') return this.showQuota(back.run);
    showRoomState({
      title: 'The room server can’t be reached',
      lines: ['It may be down for a moment. Try again shortly.'],
      buttons: [back, { label: 'Retry', primary: true, run: () => void this.join(route) }],
    });
  }

  private closedLinkPage(): void {
    showRoomState({
      title: 'This room has closed',
      lines: ['A room lives while someone is in it.'],
      buttons: [{ label: 'Back to my table', primary: true, run: () => {
        setHash('');
        void this.backToOwnTable();
      } }],
    });
  }

  private fullPage(route: RoomRoute, info: RoomInfo | null): void {
    showRoomState({
      title: `The room is full (${info ? `${info.players} of ${info.max}` : '8 of 8'})`,
      lines: info ? [roomNameLine('Room: ', info.name)] : [],
      buttons: [
        { label: 'Back to my table', run: () => {
          setHash('');
          void this.backToOwnTable();
        } },
        { label: 'Retry', primary: true, run: () => void this.join(route) },
      ],
    });
  }
}

function serverTitle(s: OnlineUi['server']): string {
  if (s === 'version') return 'This page is older than the room server: reload to update';
  if (s === 'quota') return 'The room server is over its free daily limit. Rooms are back after midnight UTC.';
  return 'No room server';
}

/** Light colours (yellow, white) take dark letters. */
function isLight(colour: string): boolean {
  const n = parseInt(colour.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

/** The floating Online panel (12.2, O58): 380 px, docked right under the top bar, dragged by its header. */
export class OnlinePanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly rows: PlayerRows;
  private readonly chat = new ChatStrip();
  private attachedTo: Online | null = null;
  private moved = false;

  constructor(private readonly ui: OnlineUi) {
    this.rows = new PlayerRows(ui.app);
    const close = h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close' }, '✕');
    close.addEventListener('click', () => this.close());
    this.title = h('span', { class: 'panel-title' }, 'Online');
    const head = h('div', { class: 'online-head' }, this.title, close);
    this.body = h('div', { class: 'online-body' });
    this.el = h('div', { class: 'online-panel', role: 'dialog', 'aria-label': 'Online' }, head, this.body);
    this.el.hidden = true;
    document.body.append(this.el);
    this.dragBy(head);
    // Esc closes it when you are working in it (keys on the table keep their meaning otherwise).
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.el.hidden) return;
      if (!this.el.contains(document.activeElement) && !this.el.matches(':hover')) return;
      e.stopImmediatePropagation();
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.close();
    }, true);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.el.hidden = false;
    this.refresh();
  }

  close(): void {
    this.el.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Rebuild for the current state: the short form offline, the room online. */
  refresh(): void {
    const online = this.ui.online;
    if (online !== this.attachedTo) {
      this.attachedTo = online;
      this.rows.attach(online?.room ?? null, online?.session ?? null);
      this.chat.attach(online?.room ?? null, online?.session ?? null);
    }
    if (this.el.hidden) return;
    // Not while you are typing in it: the rows and the chat update themselves.
    const focus = document.activeElement;
    if (focus && this.body.contains(focus) && /^(INPUT|SELECT|TEXTAREA)$/.test(focus.tagName)) {
      focus.addEventListener('blur', () => setTimeout(() => this.refresh(), 0), { once: true });
      return;
    }
    if (online) this.showRoom(online);
    else this.showForm();
  }

  /** Offline: the short form (12.2): the room's name, your name and colour, the tag, Go online. */
  private showForm(): void {
    this.title.textContent = 'Go online';
    const app = this.ui.app;
    const id = getIdentity();
    const name = h('input', { class: 'grow', value: app.store.name, maxlength: String(ROOM_NAME_MAX), spellcheck: 'false', 'aria-label': 'Room name' });
    const nick = h('input', { class: 'grow', value: id.nickname, maxlength: String(NICKNAME_MAX), spellcheck: 'false', placeholder: 'Your name at the table', 'aria-label': 'Your nickname' });
    const colours = new ColourPicker([], id.colour || PLAYER_COLOURS[0]);
    // Play when the table has a playmat or stand, else Cube (O73).
    const play = [...app.store.mats.values()].length > 0;
    const tagCube = h('input', { type: 'radio', name: 'room-tag', value: 'cube' });
    const tagPlay = h('input', { type: 'radio', name: 'room-tag', value: 'play' });
    (play ? tagPlay : tagCube).checked = true;
    const error = h('div', { class: 'join-error' });
    const go = h('button', { class: 'btn primary' }, '🌐 Go online');
    // Or join someone else's: the public tables (12.5).
    const tables = h('button', { class: 'btn small', title: 'Join a public table, or one by its link or code' }, '🗂 Tables');
    tables.addEventListener('click', () => this.ui.openTables());
    const server = this.ui.server;
    const ok = server === 'ok';
    go.disabled = !ok;
    const note = ok ? null : h('p', { class: 'muted small' }, server === 'checking' ? 'Looking for the room server…' : serverTitle(server));
    go.addEventListener('click', async () => {
      const nickname = nick.value.trim();
      if (!nickname) {
        error.textContent = 'Pick a nickname first';
        nick.focus();
        return;
      }
      // The word filter (10.4): the server would rename either anyway.
      if (isBlocked(nickname)) {
        error.textContent = 'That name is not allowed';
        nick.focus();
        return;
      }
      if (isBlocked(name.value)) {
        error.textContent = 'That room name is not allowed';
        name.focus();
        return;
      }
      go.disabled = true;
      go.textContent = 'Going online…';
      const done = await this.ui.goOnline({ name: name.value.trim() || app.store.name, nickname, colour: colours.value, tag: tagPlay.checked ? 'play' : 'cube' });
      if (!done) {
        go.disabled = false;
        go.textContent = '🌐 Go online';
      }
    });
    this.body.replaceChildren(
      h('p', { class: 'muted small first' }, 'Share this table by link: up to eight players, each with their own cursor. Your table stays yours; Go offline brings it back as it is.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Room name'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Your nickname'), nick),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Your colour'), colours.el),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tag'),
        h('div', { class: 'row tight' }, h('label', { class: 'inline' }, tagCube, 'Cube'), h('label', { class: 'inline' }, tagPlay, 'Play'))),
      error,
      h('div', { class: 'row end' }, tables, h('span', { class: 'grow' }), go),
      ...(note ? [note] : []),
    );
  }

  /** Online: Room, Players and Chat (Settings from Phase O2). */
  private showRoom(online: Online): void {
    const room = online.room;
    this.title.textContent = 'Online';
    const copy = h('button', { class: 'btn small', title: 'Copy the room link to send to friends' }, '🔗 Copy link');
    copy.addEventListener('click', () => void this.ui.copyLink());
    const buttons: HTMLElement[] = [copy];
    // The invite link carries the password (O12): only with one set, and known here.
    const key = this.ui.inviteKey();
    if (room.settings.password && key) {
      const invite = h('button', { class: 'btn small', title: 'Copy a link that carries the password: it opens straight in' }, '🔑 Copy invite link');
      invite.addEventListener('click', () => void this.ui.copyInvite());
      buttons.push(invite);
    }
    const tables = h('button', { class: 'btn small', title: 'The public tables' }, '🗂 Tables');
    tables.addEventListener('click', () => this.ui.openTables());
    buttons.push(tables);
    if (room.isCrown || room.downloads) {
      const save = h('button', { class: 'btn small', title: 'Download this table as a file' }, '💾 Save a copy');
      save.addEventListener('click', () => this.ui.saveCopy());
      buttons.push(save);
    }
    if (room.isCrown) {
      const off = h('button', { class: 'btn small danger', title: room.isMaker ? 'Close the room for everyone; your table stays as it is' : 'Close the room for everyone; you go back to your own table' }, 'Go offline');
      off.addEventListener('click', () => void this.ui.goOffline());
      buttons.push(off);
    }
    // A crown who joined may also just leave: the crown passes on (4.5).
    if (!room.isCrown || !room.isMaker) {
      const leave = h('button', { class: 'btn small danger', title: 'Leave the room and go back to your own table' }, 'Leave');
      leave.addEventListener('click', () => void this.ui.leave());
      buttons.push(leave);
    }
    // The room's name is the table's name (4.1).
    const name = this.ui.app.store.name;
    this.body.replaceChildren(
      h('div', { class: 'online-section' },
        h('div', { class: 'room-title' }, h('span', { class: 'room-name' }, name), h('span', { class: 'muted' }, ' · '), h('code', { class: 'room-code' }, room.code)),
        h('div', { class: 'row wrap' }, ...buttons),
        h('p', { class: 'muted small' }, 'The room lives while someone is in it.'),
      ),
      this.settingsSection(online),
      h('div', { class: 'online-section' }, h('div', { class: 'online-section-title' }, `Players (${room.players.filter((p) => p.connected).length} of 8)`), this.rows.el),
      h('div', { class: 'online-section grow-section' }, h('div', { class: 'online-section-title' }, 'Chat'), this.chat.el),
    );
    this.rows.render();
  }

  /** Settings (12.2, 4.3): the crown changes them (O23); everyone else sees them greyed. */
  private settingsSection(online: Online): HTMLElement {
    const room = online.room;
    const s = room.settings;
    const crown = room.isCrown;
    const send = (set: Partial<RoomSettings>) => online.session.send({ t: 'settings', set });
    const radios = <T extends string>(name: string, options: [T, string][], value: T, onPick: (v: T) => void) =>
      h('div', { class: 'row tight wrap' }, ...options.map(([v, label]) => {
        const input = h('input', { type: 'radio', name, value: v });
        input.checked = v === value;
        input.disabled = !crown;
        input.addEventListener('change', () => input.checked && onPick(v));
        return h('label', { class: 'inline' }, input, label);
      }));
    // The password: typed by the crown, sent with Public + password; the server keeps only its hash.
    const pass = h('input', { class: 'grow', type: 'text', maxlength: String(PASSWORD_MAX), placeholder: 'A password, 1 to 32 characters', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Room password', value: this.ui.password ?? '' });
    const passRow = h('div', { class: 'row tight' }, pass);
    passRow.hidden = !crown || s.visibility !== 'password';
    const sendPassword = () => {
      const pw = pass.value.trim();
      if (!pw) return;
      this.ui.password = pw;
      send({ visibility: 'password', password: pw });
    };
    pass.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') sendPassword();
    });
    pass.addEventListener('change', sendPassword);
    const visibility = radios<Visibility>('room-visibility', [['unlisted', 'Unlisted'], ['public', 'Public'], ['password', 'Public + password']], s.visibility, (v) => {
      passRow.hidden = v !== 'password';
      // Leaving Public + password removes the password (the server takes '' as none).
      if (v !== 'password') {
        send({ visibility: v, ...(s.password ? { password: '' } : {}) });
        this.ui.password = null;
      }
      else if (pass.value.trim()) sendPassword();
      else pass.focus();
    });
    const tag = radios<Tag>('room-tag-set', [['cube', 'Cube'], ['play', 'Play']], s.tag, (v) => send({ tag: v }));
    const newcomers = h('select', { 'aria-label': 'Newcomers start as' });
    for (const r of RANKS) {
      const o = h('option', { value: r }, RANK_LABEL[r]);
      o.selected = r === s.newcomers;
      newcomers.append(o);
    }
    newcomers.disabled = !crown;
    newcomers.addEventListener('change', () => send({ newcomers: newcomers.value as Rank }));
    const toggle = (label: string, on: boolean, title: string, set: (v: boolean) => Partial<RoomSettings>) => {
      const box = h('input', { type: 'checkbox', class: 'switch' });
      box.checked = on;
      box.disabled = !crown;
      box.addEventListener('change', () => send(set(box.checked)));
      return h('label', { class: 'setting-row', title }, h('span', {}, label), box);
    };
    return h('div', { class: 'online-section settings-section' + (crown ? '' : ' readonly') },
      h('div', { class: 'online-section-title' }, crown ? 'Settings' : 'Settings (the crown’s)'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Visibility'), visibility, passRow),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tag'), tag),
      h('label', { class: 'setting-row' }, h('span', {}, 'Newcomers start as'), newcomers),
      toggle('🔒 Lock table', s.locked, 'Everyone but the crown can only look while it is locked; ranks come back on unlock', (v) => ({ locked: v })),
      toggle('Downloads for everyone', s.downloads, 'Off hides Save a copy, Save as file and Export for everyone but the crown', (v) => ({ downloads: v })),
    );
  }

  /** Drag the panel by its header; it stays inside the window. */
  private dragBy(head: HTMLElement): void {
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev: PointerEvent) => {
        const x = Math.min(window.innerWidth - r.width, Math.max(0, ev.clientX - dx));
        const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dy));
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.el.style.right = 'auto';
        this.moved = true;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** True once dragged away from its dock. */
  get undocked(): boolean {
    return this.moved;
  }
}

/** The first-visit welcome note (12.6): shown over the welcome table, with Join a table. */
export function showWelcomeNote(app: App, ui: OnlineUi): void {
  const join = h('button', { class: 'linkish' }, 'Join a table');
  join.addEventListener('click', () => {
    note.remove();
    void ui.joinFromWelcome();
  });
  const close = h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close' }, '✕');
  const note = h('div', { class: 'welcome-note' },
    h('div', { class: 'welcome-head' }, h('strong', {}, 'Welcome to Card Manipulator'), close),
    h('p', {}, 'Playing with friends? ', join, ' or press 🌐 Go online once your table is ready.'),
  );
  close.addEventListener('click', () => note.remove());
  app.canvas.parentElement!.append(note);
}
