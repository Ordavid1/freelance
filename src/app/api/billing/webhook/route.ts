import { failure, json } from '@/lib/billing/http';
import { confirmPayment, orderId } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
// Cardcom has no callback signature. Ignore ALL posted payment fields. Only a known
// order and its saved LowProfileId, fetched from Cardcom, can activate membership.
export const POST = route('billing.webhook', { sameOrigin: false }, async ({ request }) => {
  try { return json(await confirmPayment(orderId(new URL(request.url).searchParams.get('order')))); } catch (error) { return failure(error); }
});
