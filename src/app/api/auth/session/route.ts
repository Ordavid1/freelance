import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { FIVE_DAYS_MS, SESSION_COOKIE, sessionCookieOptions, isSameOrigin } from '@/lib/auth/session';
import { readJsonBody } from '@/lib/security/request-body';

export const runtime = 'nodejs';

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get('fz_csrf')?.value || '';
  const parsedBody = await readJsonBody(request, 24_000);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.value;
  if (typeof body.csrfToken !== 'string' || !cookieToken || !sameToken(body.csrfToken, cookieToken)) {
    return NextResponse.json({ error: 'Refresh the page and try again.' }, { status: 403 });
  }
  if (typeof body.idToken !== 'string' || body.idToken.length > 20_000) {
    return NextResponse.json({ error: 'Invalid sign-in token.' }, { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(body.idToken, true);
    if (decoded.firebase?.sign_in_provider !== 'google.com') return NextResponse.json({ error: 'יש להתחבר באמצעות Google.' }, { status: 401 });
    if (!decoded.email_verified || Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ error: 'Verify your email and sign in again.' }, { status: 401 });
    }
    const session = await adminAuth().createSessionCookie(body.idToken, { expiresIn: FIVE_DAYS_MS });
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    response.cookies.set('fz_csrf', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign-in could not be completed. Try again.' }, { status: 401 });
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  if (!value) return NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const token = await adminAuth().verifySessionCookie(value, true);
    if (token.firebase?.sign_in_provider !== 'google.com') return NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ user: {
      uid: token.uid,
      email: typeof token.email === 'string' ? token.email : null,
      name: typeof token.name === 'string' ? token.name : null,
      picture: typeof token.picture === 'string' ? token.picture : null,
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ user: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  response.cookies.set('fz_csrf', '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
