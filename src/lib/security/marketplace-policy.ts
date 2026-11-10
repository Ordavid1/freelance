import 'server-only';
import { createHash } from 'node:crypto';
import { firestore } from '@/lib/db/firestore';
export type AccountState = 'active' | 'restricted' | 'suspended';
export const accountState = (value: unknown): AccountState => value === undefined || value === 'active' ? 'active' : value === 'restricted' ? 'restricted' : 'suspended';
export class ContactUnavailable extends Error {}
export function contactRef(left: string, right: string) {
  const key = createHash('sha256').update(JSON.stringify([left, right].sort())).digest('hex');
  return firestore().collection('userBlocks').doc(key);
}
export async function accountWriteDenied(uid: string): Promise<Response | null> {
  try {
    const record = await firestore().collection('accountSecurity').doc(uid).get();
    if (accountState(record.get('state')) === 'active') return null;
    return Response.json({ code: 'ACCOUNT_RESTRICTED', error: 'פעולה זו אינה זמינה כרגע בחשבון. אפשר לבקש בדיקה נוספת ולנהל את החברות.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ code: 'SECURITY_CHECK_UNAVAILABLE', error: 'לא ניתן לבדוק הרשאות כרגע.' }, { status: 503 });
  }
}
// Read in the SAME transaction as contact creation/message writes so blocks and
// restrictions committed concurrently cause a Firestore retry, not a bypass.
export async function assertContactAllowed(tx: FirebaseFirestore.Transaction, actor: string, peer: string) {
  const db = firestore();
  const [a, b, relationship] = await Promise.all([
    tx.get(db.collection('accountSecurity').doc(actor)), tx.get(db.collection('accountSecurity').doc(peer)), tx.get(contactRef(actor, peer)),
  ]);
  if (accountState(a.get('state')) !== 'active' || accountState(b.get('state')) !== 'active' || (relationship.get('blockedBy') || []).length > 0) throw new ContactUnavailable();
}
export async function contactStatus(actor: string, peer: string) {
  const [block, own, other] = await Promise.all([contactRef(actor, peer).get(), firestore().collection('accountSecurity').doc(actor).get(), firestore().collection('accountSecurity').doc(peer).get()]);
  const blockers = block.get('blockedBy') || [];
  return { blockedByMe: blockers.includes(actor), canContact: blockers.length === 0 && accountState(own.get('state')) === 'active' && accountState(other.get('state')) === 'active' };
}
