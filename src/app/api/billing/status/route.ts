import { failure, json } from '@/lib/billing/http';
import { billingStatus, cancelSubscription } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const GET = route('billing.status', {}, async ({ user }) => {
  try { return json(await billingStatus(user.uid)); } catch (error) { return failure(error); }
});
export const DELETE = route('billing.cancel', {}, async ({ user }) => {
  try { await cancelSubscription(user.uid); return json({ cancelled: true }); } catch (error) { return failure(error); }
});
