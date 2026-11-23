import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { cardcomConfig } from '@/lib/billing/cardcom';
import { failure, json } from '@/lib/billing/http';
import { renewSubscription } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
// Cloud Scheduler only: the policy layer verifies the OIDC token of BILLING_SCHEDULER_EMAIL. Invalid callers never trigger billing.
export const POST = route('billing.renew', {}, async () => {
  try {
    cardcomConfig();
    const due = await firestore().collection('billingSubscriptions').where('autoRenew', '==', true).where('nextChargeAt', '<=', Timestamp.now()).orderBy('nextChargeAt').limit(10).get();
    const unresolved = await firestore().collection('billingSubscriptions').where('renewalPending', '==', true).limit(10).get();
    const ids = new Set([...due.docs, ...unresolved.docs].map(doc => doc.id));
    const results = await Promise.allSettled([...ids].map(uid => renewSubscription(uid)));
    // 503 retries keep the same per-cycle gateway id; never log tokens or raw errors.
    const failed = results.filter(result => result.status === 'rejected').length;
    console.info(JSON.stringify({ event: 'billing_renewal_batch', severity: failed ? 'ERROR' : 'INFO', processed: results.length - failed, failed }));
    return json({ processed: results.length - failed, failed }, failed ? 503 : 200);
  } catch (error) { return failure(error); }
});
