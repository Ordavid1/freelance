import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { FIVE_DAYS_MS, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

export const runtime = 'nodejs';

function sameToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 24_000) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get('fz_csrf')?.value || '';
  let body: { idToken?: unknown; csrfToken?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (typeof body.csrfToken !== 'string' || !cookieToken || !sameToken(body.csrfToken, cookieToken)) {
    return NextResponse.json({ error: 'Refresh the page and try again.' }, { status: 403 });
  }
  if (typeof body.idToken !== 'string' || body.idToken.length > 20_000) {
    return NextResponse.json({ error: 'Invalid sign-in token.' }, { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(body.idToken, true);
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
