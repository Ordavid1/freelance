// The name of the session cookie. Pure constants on purpose: session.ts is server-only, and the proxy needs the names too,
// to tell a request that carries a session from one that does not (see isPrivatePath in lib/seo/site.ts).
//
// Production uses the `__Host-` prefix (browser-enforced Secure, Path=/, no Domain), so a sibling subdomain cannot plant or
// shadow the session. Development keeps the plain name because `__Host-` needs HTTPS. The pre-prefix cookie stays accepted
// until it expires, so deploying the rename does not sign anyone out; it is cleared on sign-in and sign-out.
export const LEGACY_SESSION_COOKIE = 'fz_session';
export const HOST_SESSION_COOKIE = `__Host-${LEGACY_SESSION_COOKIE}`;

export function sessionCookieName(production: boolean): string {
  return production ? HOST_SESSION_COOKIE : LEGACY_SESSION_COOKIE;
}

export const SESSION_COOKIE = sessionCookieName(process.env.NODE_ENV === 'production');
/** Every name a session may arrive under, current name first. */
export const SESSION_COOKIE_NAMES: readonly string[] = [...new Set([SESSION_COOKIE, LEGACY_SESSION_COOKIE])];

/** The first session cookie value found under any accepted name, current name first. */
export function pickSessionCookie(read: (name: string) => string | undefined): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = read(name);
    if (value) return value;
  }
  return undefined;
}

/** Every session cookie value present (current and legacy), for revocation on sign-out. */
export function allSessionCookies(read: (name: string) => string | undefined): string[] {
  return SESSION_COOKIE_NAMES.map((name) => read(name)).filter((value): value is string => Boolean(value));
}
