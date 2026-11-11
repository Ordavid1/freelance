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
} as const;
type Action = keyof typeof actionLimits;

export async function enforceActionLimit(uid: string, action: Action): Promise<Response | null> {
  try {
    const db = firestore();
    // One fixed document per account/action, with no raw identity or content.
    const id = createHash('sha256').update(JSON.stringify([uid, action])).digest('hex');
    const ref = db.collection('securityRateLimits').doc(id);
    const retryAfter = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const now = Date.now();
      const previous = snapshot.get('windows') as { start?: number; count?: number }[] | undefined;
      const windows = actionLimits[action].map((policy, index) => {
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
    if (!retryAfter) return null;
    return Response.json({ code: 'RATE_LIMITED', error: 'בוצעו יותר מדי פעולות. המתינו ונסו שוב.' }, {
      status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
    });
  } catch {
    // Never turn a limiter outage into unlimited AI spend or marketplace spam.
    console.warn('security_rate_limit_unavailable');
    return Response.json({ code: 'SECURITY_CHECK_UNAVAILABLE', error: 'לא ניתן לבצע את הפעולה כרגע. נסו שוב בהמשך.' }, {
      status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' },
    });
  }
}
