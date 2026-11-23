import { failure, json } from '@/lib/billing/http';
import { startCardUpdate } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
// Opens Cardcom's hosted form to verify a replacement card. The saved card is kept until it succeeds.
export const POST = route('billing.card', {}, async ({ user }) => {
  try { return json(await startCardUpdate(user)); } catch (error) { return failure(error); }
});
