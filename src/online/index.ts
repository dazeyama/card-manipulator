// The room layer on the app (ONLINE.md 11.2): `app.online`, null while the
// table is offline. It holds the room's state and session, what presence
// tells the rest of the app (who holds what), and the hidden gate every
// module reads a card's identity through (7.3). The areas fill it in:
// Sync the session, presence and the store's hook; Rules & UI the gate.

import type { App } from '../app';
import type { Card } from '../state/types';
import type { RoomState } from './room';
import type { Session } from './session';

/** What presence tells the rest of the app (the Sync fork's presence.ts fills it). */
export interface PresenceView {
  /** Card and die uids another player holds or has flying: not pickable, left out of pile detection (8.4). */
  held: Set<string>;
}

export class Online {
  readonly room: RoomState;
  presence: PresenceView = { held: new Set() };
  /**
   * May this browser show the card's identity (7.3)? Always true offline (O32,
   * app.online is null then); hidden.ts sets the real gate for a room.
   */
  canSee: (card: Card) => boolean = () => true;

  constructor(readonly app: App, readonly session: Session) {
    this.room = session.room;
  }
}
