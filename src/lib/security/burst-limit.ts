import { rateLimitedResponse } from '@/lib/security/rate-limited-response';

// Per-instance, in-memory ceiling per client address, for high-frequency reads that cost less than the
// check itself would. Pure on purpose (no Firestore, no `server-only`) so tests and every transport load it directly.
//
// Why not rate-limit.ts: a public, read-only endpoint such as the MCP server is called at a high rate and each
// call is cheap and cached. A Firestore transaction per request would cost more than the read it protects, and
// one Firestore document contends above about one sustained write per second. AI platforms also call from shared
// egress addresses, so a per-address budget has to be generous. So this limit lives in the memory of each Cloud
// Run instance: it protects the instance CPU and bounds a single source, nothing more. It is NOT shared between
// instances, so the effective ceiling is `max x instances`; total cost is bounded by caching of the public readers
// and by the Cloud Run max-instances setting, not by this module. Use the Firestore limits (`anonymousLimits`)
// for anything that costs money or writes data.
//
// Same fixed-window semantics as `consume()` in rate-limit.ts: every window is checked before anything is counted,
// and a blocked call is not counted.

const MINUTE = 60_000;
export const burstLimits = {
  'mcp.request': [{ windowMs: MINUTE, max: 120 }, { windowMs: 10 * MINUTE, max: 600 }],
} as const;
export type BurstAction = keyof typeof burstLimits;

/** Upper bound of tracked addresses per instance: memory never grows with the number of distinct callers. */
export const BURST_MAX_KEYS = 20_000;
// A full table is swept for expired entries at most this often, so a flood of new addresses cannot make every
// request scan the whole table.
const SWEEP_INTERVAL_MS = 1_000;

type Entry = { starts: number[]; counts: number[]; expiresAt: number };
// Insertion order is eviction order: an entry is never re-inserted when it is updated.
const entries = new Map<string, Entry>();
let lastSweep = 0;

function sweepExpired(now: number) {
  lastSweep = now;
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
}

function makeRoom(now: number) {
  if (entries.size < BURST_MAX_KEYS) return;
  if (now - lastSweep >= SWEEP_INTERVAL_MS || now < lastSweep) sweepExpired(now);
  // Still full of live entries: drop the oldest-inserted ones.
  for (const key of entries.keys()) {
    if (entries.size < BURST_MAX_KEYS) break;
    entries.delete(key);
  }
}

/** 0 when the call is allowed (and counted), otherwise the seconds until the blocking window ends. */
export function consumeBurst(key: string, action: BurstAction, now = Date.now()): number {
  const policies = burstLimits[action];
  const id = `${action}\u0000${key}`;
  const saved = entries.get(id);
  const windows = policies.map((policy, index) => {
    const start = Math.floor(now / policy.windowMs) * policy.windowMs;
    return { start, count: saved?.starts[index] === start ? saved.counts[index] : 0, policy };
  });
  const blocked = windows.filter(window => window.count >= window.policy.max);
  if (blocked.length) return Math.max(...blocked.map(window => Math.ceil((window.start + window.policy.windowMs - now) / 1000)));
  const entry: Entry = {
    starts: windows.map(window => window.start),
    counts: windows.map(window => window.count + 1),
    expiresAt: Math.max(...windows.map(window => window.start + window.policy.windowMs)),
  };
  if (saved) Object.assign(saved, entry);
  else { makeRoom(now); entries.set(id, entry); }
  return 0;
}

/** The 429 to answer with, or null when the call may proceed. `ip` comes from `clientIp(request)` (client-ip.ts). */
export function enforceBurstLimit(ip: string, action: BurstAction, now?: number): Response | null {
  const retryAfter = consumeBurst(ip, action, now);
  return retryAfter ? rateLimitedResponse(retryAfter) : null;
}

/** Test seam: forget every counter. */
export function resetBurstLimits() {
  entries.clear();
  lastSweep = 0;
}

/** Test seam: number of tracked addresses. */
export function burstTrackedKeys() {
  return entries.size;
}
