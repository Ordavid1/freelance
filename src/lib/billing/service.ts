import 'server-only';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { getMembershipAccess } from '@/lib/membership/access';
import { BillingError, PRICE_AGOROT, PRODUCT, cardcomConfig, cardcomPost, checkoutPayload, hostedUrl, nextMonth, success, verifyPayment, verifyRenewal } from './cardcom';
const CONSENT_VERSION = '2026-11-09-monthly-v1';
const idPattern = /^[a-f0-9-]{36}$/i;
export function orderId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new BillingError('INVALID_ORDER', 400);
  return value;
}
export async function startCheckout(user: AuthenticatedUser, consent: unknown) {
  const config = cardcomConfig();
  if (consent !== true) throw new BillingError('CONSENT_REQUIRED', 400);
  const access = await getMembershipAccess(user.uid);
  // No early debit, no charge to grandfathered accounts, no stacked subscriptions.
  if (access.profileType === 'publisher' || access.state !== 'expired') throw new BillingError('NOT_ELIGIBLE', 409);
  const profile = (await firestore().collection('profiles').doc(user.uid).get()).data();
  const name = typeof profile?.name === 'string' ? profile.name.trim() : user.name?.trim();
  if (!name || name.length > 50 || !user.email || user.email.length > 50) throw new BillingError('BILLING_IDENTITY_REQUIRED', 400);
  const db = firestore();
  const subscription = db.collection('billingSubscriptions').doc(user.uid);
  const ref = db.collection('billingOrders').doc(randomUUID());
  const existing = await db.runTransaction(async tx => {
    const sub = await tx.get(subscription);
    if (sub.data()?.renewalPending || sub.data()?.leaseUntil?.toMillis() > Date.now()) throw new BillingError('RENEWAL_IN_PROGRESS', 409);
    if (sub.data()?.autoRenew) throw new BillingError('SUBSCRIPTION_EXISTS', 409);
    const pendingId = sub.data()?.pendingOrderId;
    if (pendingId) {
      const pending = await tx.get(db.collection('billingOrders').doc(pendingId));
      const data = pending.data();
      if (data?.status === 'pending') {
        tx.update(subscription, { pendingCancelled: false });
        return { orderId: pending.id, redirectUrl: data.redirectUrl as string };
      }
      if (data?.status === 'creating' && Date.now() - data.createdAt.toMillis() < 60000) throw new BillingError('CHECKOUT_BUSY', 409);
    }
    tx.create(ref, { uid: user.uid, status: 'creating', amountAgorot: PRICE_AGOROT, terminal: config.terminal, createdAt: Timestamp.now(), consentVersion: CONSENT_VERSION, consentAt: Timestamp.now(), name, email: user.email });
    tx.set(subscription, { pendingOrderId: ref.id, pendingCancelled: false }, { merge: true });
    return null;
  });
  if (existing) return existing;
  try {
    const result = await cardcomPost(config, 'LowProfile/Create', checkoutPayload(config, ref.id, name, user.email));
    if (!success(result.ResponseCode) || typeof result.LowProfileId !== 'string' || !idPattern.test(result.LowProfileId)) throw new BillingError('CHECKOUT_FAILED');
    const redirectUrl = hostedUrl(result.Url);
    await ref.update({ status: 'pending', lowProfileId: result.LowProfileId, redirectUrl });
    return { orderId: ref.id, redirectUrl };
  } catch (error) { await ref.update({ status: 'create_failed' }); throw error; }
}
export async function confirmPayment(id: string, uid?: string) {
  const db = firestore();
  const ref = db.collection('billingOrders').doc(orderId(id));
  const snapshot = await ref.get(); const order = snapshot.data();
  if (!order || (uid && order.uid !== uid)) throw new BillingError('ORDER_NOT_FOUND', 404);
  if (order.status === 'paid') return { paid: true };
  if (order.status !== 'pending') throw new BillingError('PAYMENT_INCOMPLETE', 409);
  const config = cardcomConfig();
  if (config.terminal !== order.terminal) throw new BillingError('TERMINAL_CHANGED');
  const result = await cardcomPost(config, 'LowProfile/GetLpResult', { LowProfileId: order.lowProfileId });
  const payment = verifyPayment(result, { id: ref.id, lowProfileId: order.lowProfileId, terminal: order.terminal, amountAgorot: order.amountAgorot });
  if (!payment.token || !payment.expiry) throw new BillingError('TOKEN_MISSING');
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.status === 'paid') return;
    const subRef = db.collection('billingSubscriptions').doc(order.uid);
    const sub = await tx.get(subRef);
    if (sub.data()?.pendingOrderId !== ref.id) throw new BillingError('ORDER_SUPERSEDED', 409);
    const claim = db.collection('billingTransactions').doc(`${config.terminal}-${payment.transactionId}`);
    if ((await tx.get(claim)).exists) throw new BillingError('TRANSACTION_ALREADY_USED', 409);
    const now = Date.now(); const paidUntil = Timestamp.fromMillis(nextMonth(now));
    tx.create(claim, { uid: order.uid, orderId: ref.id, createdAt: Timestamp.now() });
    tx.update(ref, { status: 'paid', paidAt: Timestamp.now(), transactionId: payment.transactionId, documentNumber: payment.documentNumber, invoicePending: payment.invoicePending, last4: payment.last4 });
    // Tokens stay exclusively in server-side Firestore, never public profiles or API responses.
    tx.set(subRef, { autoRenew: sub.data()?.pendingCancelled !== true, status: sub.data()?.pendingCancelled ? 'cancelled' : 'active', token: sub.data()?.pendingCancelled ? null : payment.token, expiry: sub.data()?.pendingCancelled ? null : payment.expiry, terminal: config.terminal, name: order.name, email: order.email, last4: payment.last4, paidUntil, nextChargeAt: paidUntil, pendingOrderId: null, consentVersion: order.consentVersion, consentAt: order.consentAt });
    tx.set(db.collection('memberships').doc(order.uid), { paidUntil }, { merge: true });
  });
  return { paid: true };
}
export async function cancelSubscription(uid: string) {
  const db = firestore(); const ref = db.collection('billingSubscriptions').doc(uid);
  await db.runTransaction(async tx => {
    const sub = await tx.get(ref);
    if (!sub.exists) return;
    // A renewal already sent to the gateway can finish; never start a later one.
    tx.update(ref, { autoRenew: false, status: 'cancelled', cancelledAt: Timestamp.now(), pendingCancelled: true, token: null, expiry: null });
  });
}
export async function billingStatus(uid: string) {
  let available = true; try { cardcomConfig(); } catch { available = false; }
  const db = firestore();
  const sub = (await db.collection('billingSubscriptions').doc(uid).get()).data();
  const history = await db.collection('billingOrders').where('uid', '==', uid).where('status', '==', 'paid').orderBy('paidAt', 'desc').limit(50).get();
  return { available, priceAgorot: PRICE_AGOROT, autoRenew: sub?.autoRenew === true, status: sub?.status ?? 'none', last4: sub?.last4 ?? null, paidUntil: sub?.paidUntil?.toMillis() ?? null,
    payments: history.docs.filter(doc => doc.data().status === 'paid').map(doc => { const d = doc.data(); return { id: doc.id, amountAgorot: d.amountAgorot, paidAt: d.paidAt.toMillis(), documentNumber: d.documentNumber ?? null, invoicePending: d.invoicePending === true }; }).sort((a,b) => b.paidAt-a.paidAt) };
}
export async function renewSubscription(uid: string) {
  const config = cardcomConfig(); const db = firestore();
  const subRef = db.collection('billingSubscriptions').doc(uid);
  const lease = randomUUID();
  const attempt = await db.runTransaction(async tx => {
    const sub = (await tx.get(subRef)).data(); const now = Date.now();
    if (!sub || (!sub.autoRenew && !sub.renewalPending) || sub.nextChargeAt.toMillis() > now || sub.leaseUntil?.toMillis() > now) return null;
    if (sub.terminal !== config.terminal || (sub.autoRenew && (!sub.token || !sub.expiry))) throw new BillingError('RENEWAL_CONFIG_MISMATCH');
    const due = sub.nextChargeAt.toMillis();
    const id = `${uid}-${due}`;
    const ref = db.collection('billingOrders').doc(id);
    const order = await tx.get(ref);
    if (order.data()?.status === 'paid') return null;
    tx.set(ref, { uid, status: 'renewing', amountAgorot: PRICE_AGOROT, createdAt: Timestamp.now(), terminal: config.terminal, due }, { merge: true });
    tx.update(subRef, { lease, renewalPending: true, leaseUntil: Timestamp.fromMillis(now + 120000) });
    return { id, due, autoRenew: sub.autoRenew === true, token: sub.token as string, expiry: sub.expiry as string, name: sub.name as string, email: sub.email as string };
  });
  if (!attempt) return;
  // Reuse the exact same gateway id on every retry, including unknown network outcomes.
  // Cardcom rejects duplicate successful ids with 608; only a verified lookup grants access.
  let result = attempt.autoRenew ? await cardcomPost(config, 'Transactions/Transaction', {
    Token: attempt.token, CardExpirationMMYY: attempt.expiry, Amount: PRICE_AGOROT / 100, ISOCoinId: 1, ExternalUniqTranId: attempt.id,
    Document: { DocumentTypeToCreate: 'Auto', Name: attempt.name, Email: attempt.email, IsSendByEmail: true, Languge: 'he', Products: [{ Description: PRODUCT, Quantity: 1, UnitCost: PRICE_AGOROT / 100 }] },
  }) : await cardcomPost(config, 'Transactions/GetTransactionByExternalUniqTran', { ExternalUniqTranId: attempt.id });
  if (attempt.autoRenew && (typeof result.ResponseCode === 'number' || (typeof result.ResponseCode === 'string' && /^\d+$/.test(result.ResponseCode))) && !success(result.ResponseCode) && Number(result.ResponseCode) !== 608) {
    await db.runTransaction(async tx => {
      const sub = (await tx.get(subRef)).data();
      if (sub?.lease !== lease) return;
      tx.update(subRef, { autoRenew: false, status: sub.status === 'cancelled' ? 'cancelled' : 'past_due', renewalPending: false, leaseUntil: Timestamp.fromMillis(0) });
      tx.update(db.collection('billingOrders').doc(attempt.id), { status: 'declined' });
    });
    return;
  }
  if (Number(result.ResponseCode) === 608) result = await cardcomPost(config, 'Transactions/GetTransactionByExternalUniqTran', { ExternalUniqTranId: attempt.id });
  const transactionId = verifyRenewal(result, config.terminal);
  await db.runTransaction(async tx => {
    const sub = (await tx.get(subRef)).data();
    const orderRef = db.collection('billingOrders').doc(attempt.id);
    const order = await tx.get(orderRef);
    if (order.data()?.status === 'paid') return;
    if (sub?.lease !== lease) throw new BillingError('RENEWAL_LEASE_LOST');
    const claim = db.collection('billingTransactions').doc(`${config.terminal}-${transactionId}`);
    if ((await tx.get(claim)).exists) throw new BillingError('TRANSACTION_ALREADY_USED');
    const paidUntil = Timestamp.fromMillis(nextMonth(Math.max(attempt.due, Date.now())));
    tx.create(claim, { uid, orderId: attempt.id, createdAt: Timestamp.now() });
    tx.update(orderRef, { status: 'paid', paidAt: Timestamp.now(), transactionId, documentNumber: typeof result.DocumentNumber === 'number' ? result.DocumentNumber : null, invoicePending: !result.DocumentNumber });
    tx.update(subRef, { paidUntil, nextChargeAt: paidUntil, renewalPending: false, leaseUntil: Timestamp.fromMillis(0) });
    tx.set(db.collection('memberships').doc(uid), { paidUntil }, { merge: true });
  });
}
