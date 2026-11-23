import { NextResponse } from 'next/server';
import { failure } from '@/lib/billing/http';
import { invoiceUrl } from '@/lib/billing/service';
import { route } from '@/lib/security/policy';
export const runtime = 'nodejs';
// Signed-in owners are redirected to a freshly minted Cardcom document link; links are never stored.
export const GET = route('billing.invoice', {}, async ({ request, user }) => {
  try {
    const url = await invoiceUrl(user.uid, new URL(request.url).searchParams.get('order'));
    return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return failure(error); }
});
