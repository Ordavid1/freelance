import { billingUser, failure, json } from '@/lib/billing/http';
import { startCardUpdate } from '@/lib/billing/service';
export const runtime = 'nodejs';
// Opens Cardcom's hosted form to verify a replacement card. The saved card is kept until it succeeds.
export async function POST(request: Request) {
  try { return json(await startCardUpdate(await billingUser(request))); } catch (error) { return failure(error); }
}
