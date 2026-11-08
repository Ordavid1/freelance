import { NextResponse, type NextRequest } from 'next/server';
import { SITE_URL, indexingEnabled, isPrivatePath } from '@/lib/seo/site';

export function proxy(request: NextRequest) {
  const canonical = new URL(SITE_URL);
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host === `www.${canonical.hostname}`) {
    canonical.pathname = request.nextUrl.pathname;
    canonical.search = request.nextUrl.search;
    return NextResponse.redirect(canonical, 308);
  }
  const response = NextResponse.next();
  const hasContentQuery = [...request.nextUrl.searchParams.keys()].some((key) => !/^(utm_[a-z_]+|gclid|fbclid|msclkid)$/.test(key));
  if (!indexingEnabled() || host !== canonical.hostname || isPrivatePath(request.nextUrl.pathname) || hasContentQuery) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
