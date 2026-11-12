import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Slack v0 signing: HMAC-SHA256 over `v0:${timestamp}:${rawBody}`, sent as `v0=<hex>`, with a 5 minute replay window.
export function verifySlackSignature(
  rawBody: string,
  headers: { timestamp: string | null; signature: string | null },
  signingSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = Buffer.from('v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex'));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
