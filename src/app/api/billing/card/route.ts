import { enforceActionLimit } from '@/lib/security/rate-limit';
import { billingUser, failure, json } from '@/lib/billing/http';
import { startCardUpdate } from '@/lib/billing/service';
export const runtime = 'nodejs';
// Opens Cardcom's hosted form to verify a replacement card. The saved card is kept until it succeeds.
export async function POST(request: Request) {
  try { const user = await billingUser(request); const limited = await enforceActionLimit(user.uid, 'billing.checkout'); if (limited) return limited; return json(await startCardUpdate(user)); } catch (error) { return failure(error); }
}
