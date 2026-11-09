import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { firestore } from '@/lib/db/firestore';
import { accessFromRecord } from './state';

// Stable release cutoff: deployment restarts must never move existing accounts into preview.
const DEFAULT_ROLLOUT = '2026-11-08T21:47:24Z';
export async function getMembershipAccess(uid: string) {
  const ref = firestore().collection('memberships').doc(uid);
  let snapshot = await ref.get();
  if (!snapshot.exists) {
    const rollout = Date.parse(process.env.MEMBERSHIP_TRIAL_ROLLOUT_AT || DEFAULT_ROLLOUT);
    if (!Number.isFinite(rollout)) throw new Error('Invalid MEMBERSHIP_TRIAL_ROLLOUT_AT');
    const account = await adminAuth().getUser(uid);
    const created = Date.parse(account.metadata.creationTime);
    if (!Number.isFinite(created)) throw new Error('Account creation time unavailable');
    await firestore().runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (!current.exists) transaction.create(ref, { state: created < rollout ? 'legacy' : 'preview', createdAt: Timestamp.now() });
    });
    snapshot = await ref.get();
  }
  const data = snapshot.data()!;
  return accessFromRecord({ state: data.state, paidUntil: data.paidUntil?.toMillis?.() ?? null, trialStartedAt: data.trialStartedAt?.toMillis?.() ?? null, trialEndsAt: data.trialEndsAt?.toMillis?.() ?? null });
}
export async function requireMarketplaceAccess(uid: string) {
  try {
    const access = await getMembershipAccess(uid);
    if (access.canUseMarketplace) return null;
    return NextResponse.json({ code: access.state === 'preview' ? 'PROFILE_REQUIRED' : 'MEMBERSHIP_REQUIRED', error: access.state === 'preview' ? 'הקימו פרופיל בקלות וקבלו 14 ימים של פעילות מלאה בחינם.' : 'תקופת הניסיון הסתיימה. החברות היא ₪19.99 לחודש. אפשר להצטרף בעמוד החברות.', access }, { status: 402, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'לא ניתן לבדוק את מצב החברות כרגע. נסו שוב.' }, { status: 503 });
  }
}
