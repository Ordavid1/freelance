import 'server-only';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Limits are per verified account, shared by all Cloud Run instances. Membership
// and role changes never reset them. These are abuse budgets, not paid features.
export const actionLimits = {
  'safety.change': [{ windowMs: 10 * MINUTE, max: 20 }, { windowMs: DAY, max: 100 }],
  'safety.appeal': [{ windowMs: DAY, max: 3 }],
  'oauth.session': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 50 }],
  'oauth.import': [{ windowMs: 10 * MINUTE, max: 20 }, { windowMs: DAY, max: 100 }],
  'billing.checkout': [{ windowMs: 10 * MINUTE, max: 5 }, { windowMs: DAY, max: 30 }],
  'billing.confirm': [{ windowMs: 10 * MINUTE, max: 30 }, { windowMs: DAY, max: 200 }],
  'project.create': [{ windowMs: 10 * MINUTE, max: 5 }, { windowMs: DAY, max: 30 }],
  'proposal.create': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 100 }],
  'message.send': [{ windowMs: MINUTE, max: 30 }, { windowMs: DAY, max: 1000 }],
  'source.upload': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 50 }],
  'ai.profile': [{ windowMs: 10 * MINUTE, max: 3 }, { windowMs: DAY, max: 20 }],
  'ai.projectBrief': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 60 }],
  // Server-side reads of public XPlace pages (profile and project import share one budget).
  'import.xplace': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 60 }],
  // Payloads captured by the browser extension (no network access; cheaper than a fetch).
  'import.xplace.ingest': [{ windowMs: 10 * MINUTE, max: 20 }, { windowMs: DAY, max: 120 }],
  // Headhunter application and edits; handle availability checks (typing in the editor) and renames.
  'headhunter.edit': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 60 }],
  'headhunter.handle': [{ windowMs: 10 * MINUTE, max: 60 }, { windowMs: DAY, max: 500 }],
  // Profile writes carry images and drive the trial state; a person edits a few times an hour at most.
  'profile.update': [{ windowMs: 10 * MINUTE, max: 20 }, { windowMs: DAY, max: 200 }],
  // Signed-in visitors of the support chat (anonymous ones are limited per address below).
  'support.message': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 100 }],
} as const;

// Anonymous callers have no account, so their budget is per client address (see client-ip.ts: IPv4, or
// the IPv6 /64). Several people can share one address (office, campus, mobile carrier NAT), so these are
// generous for humans and still bound a single source.
export const anonymousLimits = {
  'support.message': [{ windowMs: 10 * MINUTE, max: 10 }, { windowMs: DAY, max: 60 }],
  'notifications.unsubscribe': [{ windowMs: 10 * MINUTE, max: 20 }, { windowMs: DAY, max: 100 }],
} as const;

const HOUR = 60 * MINUTE;
// Site-wide ceilings per cost feature, independent of who calls. They bound spend when many accounts or
// addresses act together. Override with GLOBAL_BUDGET_<FEATURE>_HOURLY / _DAILY (feature in upper snake
// case: AI_PROFILE, AI_PROJECT_BRIEF, AI_SUPPORT_TRIAGE, IMPORT_XPLACE).
export const globalBudgets = {
  'ai.profile': { hourly: 60, daily: 300 },
  'ai.projectBrief': { hourly: 120, daily: 1000 },
  'ai.supportTriage': { hourly: 120, daily: 600 },
  'import.xplace': { hourly: 120, daily: 600 },
} as const;

export type ActionKey = keyof typeof actionLimits;
export type AnonymousAction = keyof typeof anonymousLimits;
export type BudgetFeature = keyof typeof globalBudgets;
type Policy = { readonly windowMs: number; readonly max: number };


const tooMany = (retryAfter: number) => Response.json({ code: 'RATE_LIMITED', error: 'בוצעו יותר מדי פעולות. המתינו ונסו שוב.' }, {
  status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
});
// Never turn a limiter outage into unlimited AI spend or marketplace spam.
const unavailable = () => {
  console.warn('security_rate_limit_unavailable');
  return Response.json({ code: 'SECURITY_CHECK_UNAVAILABLE', error: 'לא ניתן לבצע את הפעולה כרגע. נסו שוב בהמשך.' }, {
    status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' },
  });
};

// One fixed document per key, shared by all instances: counts live in fixed windows inside it, are
// advanced in a transaction, and the document expires (Firestore TTL on expiresAt) after the longest window.
// Returns 0 when the call is allowed (and counted), otherwise the seconds until the blocking window ends.
async function consume(documentId: string, policies: readonly Policy[]): Promise<number> {
  const db = firestore();
  const ref = db.collection('securityRateLimits').doc(documentId);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const now = Date.now();
    const previous = snapshot.get('windows') as { start?: number; count?: number }[] | undefined;
    const windows = policies.map((policy, index) => {
      const start = Math.floor(now / policy.windowMs) * policy.windowMs;
      const saved = previous?.[index];
      const count = saved?.start === start && Number.isSafeInteger(saved.count) && saved.count! >= 0 ? saved.count! : 0;
      return { start, count, policy };
    });
    const blocked = windows.filter(window => window.count >= window.policy.max);
    if (blocked.length) return Math.max(...blocked.map(window => Math.ceil((window.start + window.policy.windowMs - now) / 1000)));
    tx.set(ref, {
      windows: windows.map(({ start, count }) => ({ start, count: count + 1 })),
      expiresAt: Timestamp.fromMillis(Math.max(...windows.map(window => window.start + window.policy.windowMs))),
    });
    return 0;
  });
}

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function enforceActionLimit(uid: string, action: ActionKey): Promise<Response | null> {
  try {
    // No raw identity or content in the document id.
    const retryAfter = await consume(sha256([uid, action]), actionLimits[action]);
    return retryAfter ? tooMany(retryAfter) : null;
  } catch { return unavailable(); }
}

/** Per-client-address budget for callers without an account. `ip` comes from `clientIp(request)`. */
export async function enforceAnonymousLimit(ip: string, action: AnonymousAction): Promise<Response | null> {
  try {
    const retryAfter = await consume(sha256(['ip', ip, action]), anonymousLimits[action]);
    return retryAfter ? tooMany(retryAfter) : null;
  } catch { return unavailable(); }
}

const envName = (feature: BudgetFeature) => feature.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\./g, '_').toUpperCase();
function tuned(feature: BudgetFeature, kind: 'HOURLY' | 'DAILY', fallback: number): number {
  const raw = process.env[`GLOBAL_BUDGET_${envName(feature)}_${kind}`];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
/** Effective ceilings of a feature: the defaults above unless the GLOBAL_BUDGET_* environment overrides them. */
export function globalBudgetPolicies(feature: BudgetFeature): Policy[] {
  const defaults = globalBudgets[feature];
  return [{ windowMs: HOUR, max: tuned(feature, 'HOURLY', defaults.hourly) }, { windowMs: DAY, max: tuned(feature, 'DAILY', defaults.daily) }];
}

/**
 * Counts one use of a cost feature against its site-wide hourly and daily ceilings (one document per
 * feature, both windows in one transaction). `unavailable` means the counter could not be read or written:
 * callers must treat it as "do not spend".
 */
export async function consumeGlobalBudget(feature: BudgetFeature): Promise<{ status: 'ok' } | { status: 'exhausted'; retryAfter: number } | { status: 'unavailable' }> {
  try {
    const retryAfter = await consume(`global:${feature}`, globalBudgetPolicies(feature));
    return retryAfter ? { status: 'exhausted', retryAfter } : { status: 'ok' };
  } catch {
    console.warn('security_rate_limit_unavailable');
    return { status: 'unavailable' };
  }
}

export async function enforceGlobalBudget(feature: BudgetFeature): Promise<Response | null> {
  const result = await consumeGlobalBudget(feature);
  if (result.status === 'ok') return null;
  if (result.status === 'unavailable') return unavailable();
  console.warn(JSON.stringify({ event: 'global_budget_exhausted', severity: 'WARNING', feature }));
  return Response.json({ code: 'FEATURE_BUDGET_EXHAUSTED', error: 'השירות עמוס כרגע. נסו שוב מאוחר יותר.' }, {
    status: 503, headers: { 'Retry-After': String(result.retryAfter), 'Cache-Control': 'no-store' },
  });
}
