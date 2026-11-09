import { NextResponse } from 'next/server';
import { billingUser, failure } from '@/lib/billing/http';
import { invoiceUrl } from '@/lib/billing/service';
export const runtime = 'nodejs';
// Signed-in owners are redirected to a freshly minted Cardcom document link; links are never stored.
export async function GET(request: Request) {
  try {
    const url = await invoiceUrl((await billingUser()).uid, new URL(request.url).searchParams.get('order'));
    return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return failure(error); }
}
