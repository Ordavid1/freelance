import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { createDribbbleOAuthState, dribbbleConfig, DRIBBBLE_STATE_COOKIE, DRIBBBLE_STATE_TTL_SECONDS } from '@/lib/integrations/dribbble';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/signin?next=%2Fprofile%2Fimport', request.url));
  const config = dribbbleConfig();
  if (!config) return NextResponse.redirect(new URL('/profile/import?dribbble=unconfigured', request.url));

  const { state, cookieValue } = createDribbbleOAuthState(user.uid);
  const cookieStore = await cookies();
  cookieStore.set(DRIBBBLE_STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DRIBBBLE_STATE_TTL_SECONDS,
  });

  const authorize = new URL('https://dribbble.com/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', config.redirectUri);
  authorize.searchParams.set('scope', 'public');
  authorize.searchParams.set('state', state);
  return NextResponse.redirect(authorize);
}
