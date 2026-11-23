// The name of the session cookie. A pure constant on purpose: session.ts is server-only, and the proxy needs the name too,
// to tell a request that carries a session from one that does not (see isPrivatePath in lib/seo/site.ts).
export const SESSION_COOKIE = 'fz_session';
