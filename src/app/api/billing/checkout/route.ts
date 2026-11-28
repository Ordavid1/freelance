import { failure, json } from '@/lib/billing/http';
import { startCheckout } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
export const POST = route('billing.checkout', { body: { type: 'json', maxBytes: 4096 } }, async ({ user, body }) => {
  try { return json(await startCheckout(user, body.consent)); } catch (error) { return failure(error); }
});
