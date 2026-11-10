import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { accountState } from '@/lib/security/marketplace-policy';
import { readJsonBody } from '@/lib/security/request-body';
import { enforceActionLimit } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: 'הבקשה נדחתה.' }, { status: 403 });
  const user = await getCurrentUser(); if (!user) return Response.json({ error: 'יש להתחבר לחשבון.' }, { status: 401 });
  const limited = await enforceActionLimit(user.uid, 'safety.appeal'); if (limited) return limited;
  const body = await readJsonBody(request, 16_000); if (!body.ok) return body.response;
  const message = body.value.message;
  if (typeof message !== 'string' || message.trim().length < 10 || message.length > 3000) return Response.json({ error: 'כתבו הסבר של 10 עד 3,000 תווים.' }, { status: 400 });
  try {
    const db = firestore();
    const id = await db.runTransaction(async tx => {
      const security = await tx.get(db.collection('accountSecurity').doc(user.uid));
      if (accountState(security.get('state')) === 'active') throw new Error('NO_RESTRICTION');
      const version = security.get('version') || 0;
      const key = createHash('sha256').update(JSON.stringify([user.uid, version])).digest('hex');
      const ref = db.collection('accountAppeals').doc(key);
      if (!(await tx.get(ref)).exists) {
        tx.create(ref, { ownerUid: user.uid, restrictionVersion: version, message: message.trim(), status: 'pending', createdAt: FieldValue.serverTimestamp() });
        tx.create(db.collection('securityAuditEvents').doc(), { actorUid: user.uid, action: 'account.appeal', appealId: key, createdAt: FieldValue.serverTimestamp() });
      }
      return key;
    });
    return Response.json({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error && error.message === 'NO_RESTRICTION' ? 'לא קיימת הגבלה פעילה.' : 'לא ניתן לשלוח בקשה כרגע.' }, { status: error instanceof Error && error.message === 'NO_RESTRICTION' ? 409 : 503 }); }
}
