import { contentSecurityPolicy } from '@/lib/security/csp';
import { NextResponse, type NextRequest } from 'next/server';
import { SITE_URL, indexingEnabled, isPrivatePath } from '@/lib/seo/site';

// Query parameters that do not make a URL a different page: campaign tags everywhere, and the
// pagination parameter on the project index only, where every page is indexable with its own
// canonical. Any other parameter (a filter, a search) keeps the noindex header.
const CAMPAIGN_PARAM = /^(utm_[a-z_]+|gclid|fbclid|msclkid)$/;
const PAGINATED_PATH = '/projects';
function isNeutralQuery(key: string, pathname: string) {
  return CAMPAIGN_PARAM.test(key) || (pathname === PAGINATED_PATH && key === 'page');
}

// Firebase's sign-in helper pages. Serving them from the site's own host lets FIREBASE_AUTH_DOMAIN be the
// canonical domain, so the Google sign-in popup shows it instead of <project>.firebaseapp.com.
const AUTH_HELPER_PATH = /^\/__\/auth\/[A-Za-z0-9._-]+$/;
function authHelperUpstream() {
  const explicit = process.env.FIREBASE_AUTH_UPSTREAM_DOMAIN?.trim();
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const host = explicit || (project ? `${project}.firebaseapp.com` : '');
  return /^[a-z0-9.-]+$/i.test(host) ? host : '';
}

export function proxy(request: NextRequest) {
  if (AUTH_HELPER_PATH.test(request.nextUrl.pathname)) {
    const upstream = authHelperUpstream();
    if (!upstream || !['GET', 'HEAD'].includes(request.method)) return new NextResponse(null, { status: 404 });
    const target = new URL(`https://${upstream}${request.nextUrl.pathname}${request.nextUrl.search}`);
    const rewritten = NextResponse.rewrite(target);
    // The iframe helper is embedded by this site's own pages; Firebase's scripts are not subject to the app CSP.
    rewritten.headers.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    rewritten.headers.set('X-Frame-Options', 'SAMEORIGIN');
    rewritten.headers.set('X-Robots-Tag', 'noindex, nofollow');
    rewritten.headers.set('Cache-Control', 'no-store');
    return rewritten;
  }
  const canonical = new URL(SITE_URL);
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host === `www.${canonical.hostname}`) {
    canonical.pathname = request.nextUrl.pathname;
    canonical.search = request.nextUrl.search;
    return NextResponse.redirect(canonical, 308);
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development', process.env.FIREBASE_AUTH_DOMAIN);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  const hasContentQuery = [...request.nextUrl.searchParams.keys()].some((key) => !isNeutralQuery(key, request.nextUrl.pathname));
  if (!indexingEnabled() || host !== canonical.hostname || isPrivatePath(request.nextUrl.pathname) || hasContentQuery) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
