import { failure, json } from '@/lib/billing/http';
import { confirmPayment, orderId } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const POST = route('billing.confirm', { body: { type: 'json', maxBytes: 4096 } }, async ({ user, body }) => {
  try { return json(await confirmPayment(orderId(body.orderId), user.uid)); } catch (error) { return failure(error); }
});
