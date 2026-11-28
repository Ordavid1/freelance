import { FieldValue } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { accountState, contactRef, contactStatus } from '@/lib/security/marketplace-policy';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export const GET = route('safety.read', {}, async ({ request, user }) => {
  try {
    const state = accountState((await firestore().collection('accountSecurity').doc(user.uid).get()).get('state'));
    const id = new URL(request.url).searchParams.get('conversationId');
    if (!id) return json({ state });
    if (!/^[a-f0-9]{64}$/.test(id)) return json({ error: 'השיחה לא נמצאה.' }, 404);
    const conversation = await firestore().collection('conversations').doc(id).get();
    const data = conversation.data();
    if (!data || ![data.clientUid, data.freelancerUid].includes(user.uid)) return json({ error: 'השיחה לא נמצאה.' }, 404);
    const peer = data.clientUid === user.uid ? data.freelancerUid : data.clientUid;
    return json({ state, ...await contactStatus(user.uid, peer) });
  } catch { return json({ error: 'לא ניתן לטעון הרשאות כרגע.' }, 503); }
});
export const POST = route('safety.block', { body: { type: 'json', maxBytes: 2048 } }, async ({ user, body }) => {
  const { conversationId, blocked } = body;
  if (typeof conversationId !== 'string' || !/^[a-f0-9]{64}$/.test(conversationId) || typeof blocked !== 'boolean') return json({ error: 'פרטי הבקשה אינם תקינים.' }, 400);
  try {
    const db = firestore();
    await db.runTransaction(async tx => {
      const data = (await tx.get(db.collection('conversations').doc(conversationId))).data();
      if (!data || ![data.clientUid, data.freelancerUid].includes(user.uid)) throw new Error('NOT_FOUND');
      const peer = data.clientUid === user.uid ? data.freelancerUid : data.clientUid;
      const ref = contactRef(user.uid, peer);
      const prior = await tx.get(ref);
      const existing: string[] = prior.get('blockedBy') || [];
      const next = blocked ? [...new Set([...existing, user.uid])] : existing.filter(uid => uid !== user.uid);
      tx.set(ref, { blockedBy: next, updatedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection('securityAuditEvents').doc(), { actorUid: user.uid, action: blocked ? 'contact.block' : 'contact.unblock', relationshipId: ref.id, createdAt: FieldValue.serverTimestamp() });
    });
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof Error && error.message === 'NOT_FOUND' ? 'השיחה לא נמצאה.' : 'לא ניתן לעדכן חסימה כרגע.' }, error instanceof Error && error.message === 'NOT_FOUND' ? 404 : 503); }
});
