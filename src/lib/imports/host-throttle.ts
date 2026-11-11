import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { ImportError } from './errors';

// XPlace's robots.txt asks for a 10 second crawl delay. One document per host, shared by
// every Cloud Run instance, hands out request slots at least `spacingMs` apart.
const DEFAULT_SPACING_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 15_000;
const EXPIRY_GRACE_MS = 60_000;

export type HostSlotOptions = {
  spacingMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reserves the next request slot for `host` and waits for it. Throws RATE_LIMITED (without
 * reserving anything) when the slot is further away than `maxWaitMs`.
 */
export async function acquireHostSlot(host: string, options: HostSlotOptions = {}): Promise<void> {
  const spacingMs = options.spacingMs ?? DEFAULT_SPACING_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const clock = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const db = firestore();
  // Fixed per-host document id, no raw URL or user data (same style as rate-limit.ts).
  const id = createHash('sha256').update(JSON.stringify(['host', host])).digest('hex');
  const ref = db.collection('securityRateLimits').doc(id);

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = clock();
    const saved = snapshot.get('nextSlotAt') as unknown;
    const nextSlotAt = typeof saved === 'number' && Number.isFinite(saved) ? saved : 0;
    const slot = Math.max(now, nextSlotAt);
    const wait = slot - now;
    if (wait > maxWaitMs) return { wait, reserved: false };
    tx.set(ref, {
      nextSlotAt: slot + spacingMs,
      expiresAt: Timestamp.fromMillis(slot + spacingMs + EXPIRY_GRACE_MS),
    });
    return { wait, reserved: true };
  });

  if (!outcome.reserved) throw new ImportError('RATE_LIMITED', Math.ceil(outcome.wait / 1000));
  await sleep(outcome.wait);
}
