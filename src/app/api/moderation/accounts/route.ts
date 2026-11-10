import { FieldValue } from 'firebase-admin/firestore';
import { isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { moderatorUid } from '@/lib/security/moderator';
import { readJsonBody } from '@/lib/security/request-body';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  const actor = await moderatorUid(); if (!actor) return Response.json({ error: 'RECENT_MFA_MODERATOR_REQUIRED' }, { status: 403 });
  const parsed = await readJsonBody(request, 4096); if (!parsed.ok) return parsed.response;
  const { uid, state, reason, appealId } = parsed.value;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !['active', 'restricted', 'suspended'].includes(String(state)) || typeof state !== 'string' || !['spam', 'abuse', 'account_security', 'review_complete'].includes(String(reason)) || typeof reason !== 'string' || uid === actor) return Response.json({ error: 'INVALID_DECISION' }, { status: 400 });
  try {
    if (appealId !== undefined && (typeof appealId !== 'string' || !/^[a-f0-9]{64}$/.test(appealId))) return Response.json({ error: 'INVALID_APPEAL' }, { status: 400 });
    const db = firestore();
    await db.runTransaction(async tx => {
      const ref = db.collection('accountSecurity').doc(uid);
      const current = await tx.get(ref);
      if (typeof appealId === 'string') {
        const appealRef = db.collection('accountAppeals').doc(appealId);
        const appeal = await tx.get(appealRef);
        if (appeal.get('ownerUid') !== uid || appeal.get('restrictionVersion') !== (current.get('version') || 0) || appeal.get('status') !== 'pending') throw new Error('STALE_APPEAL');
        tx.update(appealRef, { status: 'resolved', decision: state, reviewerUid: actor, resolvedAt: FieldValue.serverTimestamp() });
      }
      tx.set(ref, { state, reason, version: (Number(current.get('version')) || 0) + 1, reviewerUid: actor, updatedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('securityAuditEvents').doc(), { actorUid: actor, targetUid: uid, action: 'account.restrict', state, reason, createdAt: FieldValue.serverTimestamp() });
    });
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error && error.message === 'STALE_APPEAL' ? 'STALE_APPEAL' : 'DECISION_UNAVAILABLE' }, { status: error instanceof Error && error.message === 'STALE_APPEAL' ? 409 : 503 }); }
}
export async function GET() {
  const actor = await moderatorUid(); if (!actor) return Response.json({ error: 'RECENT_MFA_MODERATOR_REQUIRED' }, { status: 403 });
  try {
    const db = firestore();
    const snapshot = await db.collection('accountAppeals').where('status', '==', 'pending').limit(25).get();
    await db.collection('securityAuditEvents').add({ actorUid: actor, action: 'appeal.queue.read', createdAt: FieldValue.serverTimestamp() });
    return Response.json({ appeals: snapshot.docs.map(doc => ({ id: doc.id, ownerUid: doc.get('ownerUid'), message: doc.get('message'), restrictionVersion: doc.get('restrictionVersion') })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'QUEUE_UNAVAILABLE' }, { status: 503 }); }
}
