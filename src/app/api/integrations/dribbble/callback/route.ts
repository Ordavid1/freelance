import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { firestore } from '@/lib/db/firestore';
import { dribbbleConfig, DRIBBBLE_STATE_COOKIE, exchangeDribbbleCode, fetchDribbbleImport, validateDribbbleOAuthState } from '@/lib/integrations/dribbble';

export const runtime = 'nodejs';

function resultRedirect(request: Request, status: string) {
  const target = new URL('/profile/import', request.url);
  target.searchParams.set('dribbble', status);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(DRIBBBLE_STATE_COOKIE)?.value;
  const params = new URL(request.url).searchParams;

  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.redirect(new URL('/signin?next=%2Fprofile%2Fimport', request.url));
    if (!validateDribbbleOAuthState(stateCookie, params.get('state'), user.uid)) return resultRedirect(request, 'state-error');
    if (params.has('error')) return resultRedirect(request, params.get('error') === 'access_denied' ? 'denied' : 'failed');

    const code = params.get('code') || '';
    if (!code || code.length > 2048 || !dribbbleConfig()) return resultRedirect(request, 'failed');
    const accessToken = await exchangeDribbbleCode(code);
    const imported = await fetchDribbbleImport(accessToken);
    await firestore().collection('users').doc(user.uid).collection('profileSources').doc('dribbble').set({
      import: imported,
      ownerUid: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return resultRedirect(request, 'connected');
  } catch {
    return resultRedirect(request, 'failed');
  } finally {
    cookieStore.delete(DRIBBBLE_STATE_COOKIE);
  }
}
