import { billingUser, body, failure, json } from '@/lib/billing/http';
import { startCheckout } from '@/lib/billing/service';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { const user = await billingUser(request); const data = await body(request); return json(await startCheckout(user, data?.consent)); } catch (error) { return failure(error); }
}
