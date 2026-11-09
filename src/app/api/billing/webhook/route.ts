import { failure, json } from '@/lib/billing/http';
import { confirmPayment, orderId } from '@/lib/billing/service';
export const runtime = 'nodejs';
// Cardcom has no callback signature. Ignore ALL posted payment fields. Only a known
// order and its saved LowProfileId, fetched from Cardcom, can activate membership.
export async function POST(request: Request) {
  try { return json(await confirmPayment(orderId(new URL(request.url).searchParams.get('order')))); } catch (error) { return failure(error); }
}
