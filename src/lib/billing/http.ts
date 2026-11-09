import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { BillingError } from './cardcom';
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function failure(error: unknown) { return json({ error: error instanceof BillingError ? error.code : 'BILLING_UNAVAILABLE' }, error instanceof BillingError ? error.status : 503); }
export async function billingUser(request?: Request) {
  if (request && !isSameOrigin(request)) throw new BillingError('INVALID_ORIGIN', 403);
  const user = await getCurrentUser();
  if (!user) throw new BillingError('SIGN_IN_REQUIRED', 401);
  return user;
}
export async function body(request: Request) {
  if (Number(request.headers.get('content-length')) > 4096) throw new BillingError('BODY_TOO_LARGE', 413);
  const text = await request.text();
  if (text.length > 4096) throw new BillingError('BODY_TOO_LARGE', 413);
  try { return JSON.parse(text); } catch { throw new BillingError('INVALID_BODY', 400); }
}
