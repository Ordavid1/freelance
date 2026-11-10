import { enforceActionLimit } from '@/lib/security/rate-limit';
import { billingUser, body, failure, json } from '@/lib/billing/http';
import { startCheckout } from '@/lib/billing/service';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const user = await billingUser(request); const limited = await enforceActionLimit(user.uid, 'billing.checkout'); if (limited) return limited; const data = await body(request); return json(await startCheckout(user, data?.consent)); } catch (error) { return failure(error); }
}
