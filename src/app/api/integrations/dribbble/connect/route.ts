import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { publicAppOrigin } from '@/lib/auth/session';
import { createDribbbleOAuthState, dribbbleConfig, DRIBBBLE_STATE_COOKIE, DRIBBBLE_STATE_TTL_SECONDS } from '@/lib/integrations/dribbble';
import { route } from '@/lib/security/policy';

export const runtime = 'nodejs';

// A browser navigation, so a signed-out visit goes to the sign-in page instead of getting a JSON 401.
const signInRedirect = (request: Request) => NextResponse.redirect(new URL('/signin?next=%2Fprofile%2Fimport', publicAppOrigin(request)));

export const GET = route('dribbble.connect', { onUnauthenticated: signInRedirect }, async ({ request, user }) => {
  const config = dribbbleConfig();
  if (!config) return NextResponse.redirect(new URL('/profile/import?dribbble=unconfigured', publicAppOrigin(request)));

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
});
