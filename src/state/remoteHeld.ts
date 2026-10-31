// The cards and dice another player holds or has flying (ONLINE.md 8.4).
// Presence fills it while a room is open; picking skips them ("That card is
// in Sam's hand"), the marquee leaves them out and pile detection treats them
// as not on the table until they land. Empty offline, so it costs nothing.

export const remoteHeld = new Set<string>();
