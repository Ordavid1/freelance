import { FieldValue } from 'firebase-admin/firestore';
import { decideHeadhunter, invalidateHeadhunterCache, listHeadhuntersForReview } from '@/lib/db/headhunters';
import { firestore } from '@/lib/db/firestore';
import { HEADHUNTER_STATUSES } from '@/lib/headhunters/constants';
import { onHeadhunterDecision } from '@/lib/headhunters/events';
import { parseDecision } from '@/lib/headhunters/moderation';
import type { HeadhunterStatus } from '@/lib/headhunters/types';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Moderators review headhunters whether or not the public feature switch is on, so approvals can be done before launch.
export const GET = route('moderation.headhunter.queue', {}, async ({ request, user: { uid: actor } }) => {
  const status = new URL(request.url).searchParams.get('status');
  if (status !== null && !(HEADHUNTER_STATUSES as readonly string[]).includes(status)) return Response.json({ error: 'INVALID_STATUS' }, { status: 400 });
  try {
    const items = await listHeadhuntersForReview({ ...(status ? { status: status as HeadhunterStatus } : {}), limit: 50 });
    await firestore().collection('securityAuditEvents').add({ actorUid: actor, action: 'headhunter.queue.read', ...(status ? { state: status } : {}), createdAt: FieldValue.serverTimestamp() });
    return Response.json({ items }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: 'QUEUE_UNAVAILABLE' }, { status: 503 });
  }
});

export const POST = route('moderation.headhunter.decide', { body: { type: 'json', maxBytes: 4_096 } }, async ({ user: { uid: actor }, body }) => {
  const parsed = parseDecision(body);
  if (!parsed.ok) return Response.json({ error: parsed.code }, { status: 400 });
  // Like account decisions: a moderator never decides on their own record.
  if (parsed.value.uid === actor) return Response.json({ error: 'INVALID_DECISION' }, { status: 400 });
  try {
    const result = await decideHeadhunter({ ...parsed.value, actor, via: 'api' });
    if (!result.ok) {
      const status = result.code === 'NOT_FOUND' ? 404 : 409;
      return Response.json({ error: result.code }, { status });
    }
    // The tag and the page are derived from this record: drop the cached reads at once.
    invalidateHeadhunterCache(result.handle);
    onHeadhunterDecision({ uid: parsed.value.uid, action: result.action, handle: result.handle, displayName: result.displayName, ...(result.fastTrack && !result.eligible ? { trial: true } : {}), ...(parsed.value.reason ? { reason: parsed.value.reason } : {}) });
    return Response.json({ ok: true, status: result.to, ...(result.fastTrack ? { fastTrack: true, ...(result.trialEndsAt !== undefined ? { trialEndsAt: result.trialEndsAt } : {}) } : {}) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: 'DECISION_UNAVAILABLE' }, { status: 503 });
  }
});
