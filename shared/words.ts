// The name filter (ONLINE.md 10.4, O15, O79): a short blocklist for room and
// player names, the owner's to edit. A name is normalised (lower case,
// accents dropped, 0→o 1→i 3→e 4→a 5→s 7→t @→a $→s, then everything but
// letters stripped) and blocked if any entry appears anywhere in it. Chat is
// not filtered (O68).
//
// Entries are chosen to be rare inside innocent words, since spaces are
// stripped and matching is by substring: no "ass" (glass), "cock"
// (Cockatrice), "rape" (Grapeshot) or "rapist" (therapist). Add or remove
// freely; keep them lower case, letters only.

export const BLOCKED: string[] = [
  // Profanity
  'fuck', 'shit', 'cunt', 'bitch', 'bastard', 'asshole', 'dickhead', 'whore', 'slut', 'twat', 'wanker', 'bollocks',
  // Sexual
  'jizz', 'pussy', 'cocksucker', 'blowjob', 'cumshot', 'dildo', 'porn', 'hentai', 'incest',
  // Slurs
  'nigger', 'nigga', 'faggot', 'retard', 'tranny', 'kike', 'chink', 'wetback', 'gook', 'raghead', 'towelhead', 'beaner',
  // Hate
  'nazi', 'hitler', 'kkk', 'siegheil', 'whitepower',
  // Abuse
  'pedophil', 'paedophil', 'molest', 'killyourself',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** A name as the filter reads it: lower case, look-alike digits turned to letters, nothing but a to z. */
export function normalise(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (ch) => LEET[ch])
    .replace(/[^a-z]/g, '');
}

/** True when the name holds a blocked word. */
export function isBlocked(name: string): boolean {
  const n = normalise(name);
  return BLOCKED.some((w) => n.includes(w));
}

/** The name, or `fallback` ("Table 7KQ2MX", "Player 3") when it is blocked. */
export function clean(name: string, fallback: string): string {
  return isBlocked(name) ? fallback : name;
}
