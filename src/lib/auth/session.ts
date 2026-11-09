import 'server-only';
import { cookies } from 'next/headers';
import { adminAuth } from './firebase-admin';

export const SESSION_COOKIE = 'fz_session';
const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export function publicAppOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const url = new URL(configured || (process.env.NODE_ENV === 'production' ? 'https://freelance-place.com' : request.url));
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Public app origin must use HTTPS');
  return url.origin;
}

export function isSameOrigin(request: Request) {
  // The public HTTPS origin differs from the internal Cloud Run request URL.
  // Forwarding headers supplied by a caller never expand the trusted origins.
  let expected: string;
  try { expected = publicAppOrigin(request); } catch { return false; }
  const origin = request.headers.get('origin');
  if (origin) return origin === expected;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try { return new URL(referer).origin === expected; } catch { return false; }
}

export type AuthenticatedUser = {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
};

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const token = await adminAuth().verifySessionCookie(value, true);
    return {
      uid: token.uid,
      email: typeof token.email === 'string' ? token.email : null,
      name: typeof token.name === 'string' ? token.name : null,
      picture: typeof token.picture === 'string' ? token.picture : null,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: FIVE_DAYS_MS / 1000,
  };
}

export { FIVE_DAYS_MS };
