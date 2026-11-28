// The 429 every limiter answers with. Pure (no imports), so the Firestore-backed limits (rate-limit.ts) and
// the in-memory burst limit (burst-limit.ts) share one body and one set of headers instead of two copies.
export const rateLimitedResponse = (retryAfter: number) => Response.json({ code: 'RATE_LIMITED', error: 'בוצעו יותר מדי פעולות. המתינו ונסו שוב.' }, {
  status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
});
