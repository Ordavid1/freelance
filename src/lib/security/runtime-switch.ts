import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';

// Runtime kill switches. A feature is enabled only when BOTH the deployment variable and the Firestore
// document `runtimeSwitches/<feature>` allow it, so it can be stopped without a deploy: by hand in the
// console, or automatically by the budget guard (POST /api/maintenance/budget).
//
// Re-enabling is deliberately manual (docs/security-operations.md): nothing in the app turns a switch back on.

export type RuntimeFeature = 'ai';

const COLLECTION = 'runtimeSwitches';
const CACHE_MS = 30_000;
// A failed read is remembered only briefly so an outage is not turned into a read per request.
const ERROR_CACHE_MS = 5_000;
const cache = new Map<RuntimeFeature, { enabled: boolean; until: number }>();

function envEnabled(feature: RuntimeFeature): boolean {
  switch (feature) {
    case 'ai': return process.env.AI_GENERATION_ENABLED !== 'false';
  }
}

/**
 * Whether the feature may run now: the environment value, then the Firestore switch (cached for 30 s per
 * instance). When the switch cannot be read the environment value stands, so a Firestore outage cannot
 * stop a feature the operator left on, and cannot re-enable one the environment turned off.
 */
export async function featureEnabled(feature: RuntimeFeature): Promise<boolean> {
  if (!envEnabled(feature)) return false;
  const now = Date.now();
  const cached = cache.get(feature);
  if (cached && cached.until > now) return cached.enabled;
  try {
    const snapshot = await firestore().collection(COLLECTION).doc(feature).get();
    const enabled = snapshot.get('enabled') !== false;
    cache.set(feature, { enabled, until: now + CACHE_MS });
    return enabled;
  } catch {
    console.warn(JSON.stringify({ event: 'runtime_switch_unavailable', severity: 'WARNING', feature }));
    cache.set(feature, { enabled: true, until: now + ERROR_CACHE_MS });
    return true;
  }
}

/**
 * Turns a feature off and records who did it. Idempotent: when the switch is already off for the same
 * reason nothing is rewritten (the first `at` is kept) and `changed` is false. Other instances notice
 * within the 30 s cache window.
 */
export async function disableFeature(feature: RuntimeFeature, reason: string, details: Record<string, string | number | boolean> = {}): Promise<{ changed: boolean }> {
  const db = firestore();
  const ref = db.collection(COLLECTION).doc(feature);
  const changed = await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.get('enabled') === false && current.get('reason') === reason) return false;
    tx.set(ref, { enabled: false, reason, at: FieldValue.serverTimestamp(), ...details });
    tx.create(db.collection('securityAuditEvents').doc(), { actorUid: `system:${reason}`, action: 'runtime.switch.disable', feature, reason, ...details, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
  cache.set(feature, { enabled: false, until: Date.now() + CACHE_MS });
  return { changed };
}

/** Test seam: forget cached switch values. */
export function resetRuntimeSwitchCache() { cache.clear(); }
