import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUser, isSameOrigin } from '@/lib/auth/session';
import { BillingError } from './cardcom';
import { readJsonBody } from '@/lib/security/request-body';
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function failure(error: unknown) { return json({ error: error instanceof BillingError ? error.code : 'BILLING_UNAVAILABLE' }, error instanceof BillingError ? error.status : 503); }
export async function billingUser(request?: Request) {
  if (request && !isSameOrigin(request)) throw new BillingError('INVALID_ORIGIN', 403);
  const user = await getCurrentUser();
  if (!user) throw new BillingError('SIGN_IN_REQUIRED', 401);
  return user;
}
export async function body(request: Request) {
  const parsedBody = await readJsonBody(request, 4096);
  if (!parsedBody.ok) throw new BillingError(parsedBody.response.status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_BODY', parsedBody.response.status);
  return parsedBody.value;
}
