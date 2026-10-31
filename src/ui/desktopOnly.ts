// The phone page (ONLINE.md 4.4, O53): rooms are for Chrome and Edge on a
// desktop. A phone or tablet opening a room link, told apart by a coarse
// pointer and a viewport under the spec's 1,280 px, gets a page naming the
// room instead of the table.

import { MIN_WIDTH } from './fit';
import { roomNameLine, showRoomState } from './roomStates';

/** A phone or tablet: a coarse pointer and a viewport narrower than the interface needs. */
export function isPhoneOrTablet(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse && window.innerWidth < MIN_WIDTH;
}

/** The desktop-only page for a room (its name if the server told us). */
export function showDesktopOnly(roomName: string | null): void {
  showRoomState({
    title: 'Desktop only',
    lines: [
      'Card Manipulator rooms need Chrome or Edge on a desktop.',
      ...(roomName ? [roomNameLine('Room: ', roomName)] : []),
    ],
    buttons: [],
  });
}
