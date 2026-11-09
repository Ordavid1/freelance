import { billingUser, failure, json } from '@/lib/billing/http';
import { billingStatus, cancelSubscription } from '@/lib/billing/service';
export const runtime = 'nodejs';
export async function GET() {
  try { return json(await billingStatus((await billingUser()).uid)); } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try { await cancelSubscription((await billingUser(request)).uid); return json({ cancelled: true }); } catch (error) { return failure(error); }
}
