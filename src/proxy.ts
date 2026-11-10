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

export function proxy(request: NextRequest) {
  const canonical = new URL(SITE_URL);
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host === `www.${canonical.hostname}`) {
    canonical.pathname = request.nextUrl.pathname;
    canonical.search = request.nextUrl.search;
    return NextResponse.redirect(canonical, 308);
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
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
