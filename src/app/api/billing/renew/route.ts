import { OAuth2Client } from 'google-auth-library';
import { Timestamp } from 'firebase-admin/firestore';
import { firestore } from '@/lib/db/firestore';
import { BillingError, cardcomConfig } from '@/lib/billing/cardcom';
import { failure, json } from '@/lib/billing/http';
import { renewSubscription } from '@/lib/billing/service';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const config = cardcomConfig();
    const expected = process.env.BILLING_SCHEDULER_EMAIL;
    if (!expected) throw new BillingError('SCHEDULER_UNAVAILABLE');
    let authorized = false;
    try {
      const ticket = await new OAuth2Client().verifyIdToken({ idToken: request.headers.get('authorization')?.replace(/^Bearer /, '') || '', audience: `${config.siteUrl}/api/billing/renew` });
      const token = ticket.getPayload(); authorized = token?.email === expected && token.email_verified === true;
    } catch { /* Invalid tokens must never trigger billing. */ }
    if (!authorized) throw new BillingError('UNAUTHORIZED', 401);
    const due = await firestore().collection('billingSubscriptions').where('autoRenew', '==', true).where('nextChargeAt', '<=', Timestamp.now()).orderBy('nextChargeAt').limit(10).get();
    const unresolved = await firestore().collection('billingSubscriptions').where('renewalPending', '==', true).limit(10).get();
    const ids = new Set([...due.docs, ...unresolved.docs].map(doc => doc.id));
    const results = await Promise.allSettled([...ids].map(uid => renewSubscription(uid)));
    // 503 retries keep the same per-cycle gateway id; never log tokens or raw errors.
    const failed = results.filter(result => result.status === 'rejected').length;
    console.info(JSON.stringify({ event: 'billing_renewal_batch', severity: failed ? 'ERROR' : 'INFO', processed: results.length - failed, failed }));
    return json({ processed: results.length - failed, failed }, failed ? 503 : 200);
  } catch (error) { return failure(error); }
}
