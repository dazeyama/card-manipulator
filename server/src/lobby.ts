// The Lobby (ONLINE.md 10.3): one Durable Object that knows every open room
// from their heartbeats, for the public table browser and the admin page.
// Rows live in memory (O97): every room heartbeats at least once a minute, so
// after an eviction the list is whole again within a minute, and the free
// plan's row writes are kept for what must last (reports, Phase O3).
//
// Phase O1 keeps heartbeats only; the public list, reports and creation rate
// limits come in Phase O3.

import { DurableObject } from 'cloudflare:workers';
import type { LobbyRow, Visibility } from '../../shared/protocol';
import { LOBBY_STALE_MS } from './limits';
import type { Env } from './worker';

/** What a Room tells the Lobby about itself. */
export interface LobbyBeat extends LobbyRow {
  visibility: Visibility;
  locked: boolean;
}

interface Entry extends LobbyBeat {
  /** Server time of the last heartbeat. */
  seen: number;
}

export class Lobby extends DurableObject<Env> {
  private readonly rooms = new Map<string, Entry>();

  /** A room's heartbeat: on any change to its name, players, tag, visibility or lock, and every minute (8.8). */
  heartbeat(beat: LobbyBeat): void {
    this.rooms.set(beat.code, { ...beat, seen: Date.now() });
    this.prune();
  }

  /** A room closed. */
  remove(code: string): void {
    this.rooms.delete(code);
  }

  /** Every room still heartbeating, newest heartbeat data. */
  all(): LobbyBeat[] {
    this.prune();
    return [...this.rooms.values()].map(({ seen: _seen, ...row }) => row);
  }

  /** Drop rooms silent for three minutes. */
  private prune(): void {
    const now = Date.now();
    for (const [code, e] of this.rooms) if (now - e.seen > LOBBY_STALE_MS) this.rooms.delete(code);
  }
}
