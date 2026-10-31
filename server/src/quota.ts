// The free plan's daily limits (ONLINE.md 15, O4). When Cloudflare refuses a
// Durable Object for the day (too many requests, too much duration, too many
// rows written), the call throws; the Worker answers 429 { error: 'quota' }
// (and a socket gets `bye quota`) so the client can show "Rooms are back after
// midnight UTC" (12.7). Pure.

/** The wording Cloudflare uses for a refused free-plan limit. */
const QUOTA = /free tier|daily limit|quota|exceeded allowed|exceeded the (?:daily|free)/i;

/** True when an error is the free plan saying no for the day. */
export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return QUOTA.test(msg);
}
