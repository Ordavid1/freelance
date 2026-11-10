import 'server-only';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/auth/firebase-admin';
import { SESSION_COOKIE } from '@/lib/auth/session';
export async function moderatorUid(): Promise<string | null> {
  try {
    const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!cookie) return null;
    const token = await adminAuth().verifySessionCookie(cookie, true);
    // Claims are issued by trusted Auth administrators, never by request bodies.
    if (token.moderator !== true || !token.firebase?.sign_in_second_factor || typeof token.auth_time !== 'number' || Date.now() / 1000 - token.auth_time > 300 || token.auth_time > Date.now() / 1000 + 30) return null;
    return token.uid;
  } catch { return null; }
}
