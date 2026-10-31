// The rank ladder (ONLINE.md 6.1) and what each action needs (6.2). guard.ts
// uses it to gate keys, buttons and drags in the browser; authority.ts uses it
// to judge ops. Ownership (a stand's owner, one full stand each), holds, the
// size cap and the Tokens-removes-tokens rule need the table, so the judge
// checks those itself on top of the rank this table gives.
//
// Seeded by the hub; the Rules & UI fork owns its tests and any fix.

/** One rank per player, each including the ones below (O21). The crown stands above them. */
export type Rank = 'view' | 'move' | 'tokens' | 'cards' | 'everything';

/** Lowest first. */
export const RANKS: Rank[] = ['view', 'move', 'tokens', 'cards', 'everything'];

export const RANK_LABEL: Record<Rank, string> = {
  view: 'View',
  move: 'Move',
  tokens: 'Tokens',
  cards: 'Cards',
  everything: 'Everything',
};

/** What an action needs: a rank, or the crown itself. */
export type Need = Rank | 'crown';

/** Every action of 6.2, by the names the ops carry where there is one. */
export type Action =
  // Looking (View): always allowed, even while the table is locked.
  | 'camera'
  | 'hover'
  | 'inspect'
  | 'search'
  | 'refine'
  | 'select'
  | 'chat'
  /** Save a copy, Save as file, Export decklist / CSV, Ctrl + E: View while Downloads is on (crown always). */
  | 'download'
  /** `move` of cards not on a stand and not held by another. */
  | 'move'
  /** A `move` that puts cards on, or takes them off, a stand: Move, and the stand's owner only (the judge checks that). */
  | 'standCards'
  /** `grab`: Move; refused while another holds any of them (the judge checks that). */
  | 'grab'
  | 'named'
  | 'spread'
  /** `dice` set of existing dice: move, roll result, number, colour. */
  | 'dice'
  /** `dice` set that adds a die (D, D D). */
  | 'diceAdd'
  /** `dice` remove (O78). */
  | 'diceRemove'
  /** `mat` set of a playmat: life, lifeHidden, move, yaw, locked, name (O26). */
  | 'mat'
  /** `mat` set of a stand of yours: spawn, move, name, Release (O59; one full stand each, O27). */
  | 'standOwn'
  /** `mat` remove of your own stand. */
  | 'standRemoveOwn'
  /** `add` of token cards (layout token, emblem, double_faced_token) and the basic land chips (O60). */
  | 'addTokens'
  /** `remove` of token cards only (O67). */
  | 'removeTokens'
  /** `add` of any card: the Spawn panel, paste, tray restore. */
  | 'addCards'
  /** `remove` of any card (O25). */
  | 'removeCards'
  /** `mat` set that adds a playmat. */
  | 'matAdd'
  /** `mat` remove of a playmat. */
  | 'matRemove'
  /** `mat` set of `owner` on a stand that is not yours: Claim regardless, Give to (O24, O65). */
  | 'standClaim'
  /** `mat` spill or remove of a stand that is not yours (O31). */
  | 'standSpill'
  | 'basics'
  /** The table's name. */
  | 'table'
  /** New table, Load file. */
  | 'replace'
  | 'reuid'
  // The room (O23): the crown's alone.
  | 'rank'
  | 'kick'
  | 'ban'
  | 'pass'
  | 'settings'
  | 'close';

const NEEDS: Record<Action, Need> = {
  camera: 'view',
  hover: 'view',
  inspect: 'view',
  search: 'view',
  refine: 'view',
  select: 'view',
  chat: 'view',
  download: 'view',
  move: 'move',
  standCards: 'move',
  grab: 'move',
  named: 'move',
  spread: 'move',
  dice: 'move',
  diceAdd: 'tokens',
  diceRemove: 'tokens',
  mat: 'move',
  standOwn: 'move',
  standRemoveOwn: 'move',
  addTokens: 'tokens',
  removeTokens: 'tokens',
  addCards: 'cards',
  removeCards: 'cards',
  matAdd: 'everything',
  matRemove: 'everything',
  standClaim: 'everything',
  standSpill: 'everything',
  basics: 'everything',
  table: 'crown',
  replace: 'crown',
  reuid: 'crown',
  rank: 'crown',
  kick: 'crown',
  ban: 'crown',
  pass: 'crown',
  settings: 'crown',
  close: 'crown',
};

/** Actions that only look: unaffected by Lock table (O51). */
const LOOKING = new Set<Action>(['camera', 'hover', 'inspect', 'search', 'refine', 'select', 'chat', 'download']);

/** What the action needs, as the table of 6.2 says. */
export function needs(action: Action): Need {
  return NEEDS[action];
}

/** True when `rank` is `need` or above it on the ladder. */
export function rankAtLeast(rank: Rank, need: Rank): boolean {
  return RANKS.indexOf(rank) >= RANKS.indexOf(need);
}

/** The room switches that change what a rank may do. */
export interface RoomRules {
  /** Lock table (O51): every player below the crown is View for table actions. */
  locked?: boolean;
  /** Downloads (O50): off, only the crown may save or export. Defaults to on. */
  downloads?: boolean;
}

/**
 * May a player of this rank (or the crown) do this, given the room's switches?
 * Rank only: ownership, holds and the cap are the judge's on top.
 */
export function allowed(who: Rank | 'crown', action: Action, rules: RoomRules = {}): boolean {
  return refusal(who, action, rules) === null;
}

/**
 * Why a player may not do this, in the words of the toast (12.4), or null when
 * they may: "Move or higher needed", "Only the crown can do that", "The table
 * is locked", "Downloads are off in this room".
 */
export function refusal(who: Rank | 'crown', action: Action, rules: RoomRules = {}): string | null {
  if (who === 'crown') return null;
  const need = needs(action);
  if (need === 'crown') return 'Only the crown can do that';
  if (action === 'download' && rules.downloads === false) return 'Downloads are off in this room';
  if (rules.locked && !LOOKING.has(action) && need !== 'view') return 'The table is locked';
  return rankAtLeast(who, need) ? null : `${RANK_LABEL[need]} or higher needed`;
}

/** Scryfall layouts that count as tokens (O67): what a Tokens player may add and remove. */
export const TOKEN_LAYOUTS = ['token', 'emblem', 'double_faced_token'];

export function isTokenLayout(layout: string | undefined): boolean {
  return !!layout && TOKEN_LAYOUTS.includes(layout);
}

/** What a card record must have for the Tokens rank to add or remove it. */
export interface PieceRecord {
  layout: string;
  type_line: string;
}

/**
 * Token cards (O67) and basic lands (the Card tab's chips, O60) are game pieces
 * a Tokens player may add and take away; every other card needs Cards (O25).
 */
export function isGamePiece(r: PieceRecord | undefined): boolean {
  return !!r && (isTokenLayout(r.layout) || /\bBasic\b.*\bLand\b/.test(r.type_line));
}

/** The action an `add` of these cards is: Tokens rank when all are game pieces, else Cards. */
export function addAction(records: (PieceRecord | undefined)[]): 'addTokens' | 'addCards' {
  return records.length && records.every(isGamePiece) ? 'addTokens' : 'addCards';
}

/** The action a `remove` of these cards is (removing follows adding, O25). */
export function removeAction(records: (PieceRecord | undefined)[]): 'removeTokens' | 'removeCards' {
  return records.length && records.every(isGamePiece) ? 'removeTokens' : 'removeCards';
}
