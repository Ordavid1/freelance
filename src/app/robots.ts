import type { MetadataRoute } from 'next';
import { crawlerAccess, crawlerPolicy, crawlers } from '@/lib/seo/crawlers';
import { absoluteUrl, indexingEnabled } from '@/lib/seo/site';
export const dynamic = 'force-dynamic';

// Paths no crawler may fetch. UI account routes stay crawlable on purpose: engines must be able
// to read their noindex directive, and robots.txt is not an access control.
// A crawler obeys only its most specific group and ignores the `*` group once it has its own, so
// every explicit group below repeats this list instead of relying on `*`.
// /mcp is the MCP endpoint: an API, not a page (see apiPrefixes in lib/seo/site.ts). It is matched exactly (`$`) plus its subpaths,
// not as a prefix, because agency handles live at /{handle} and /mcpshop must stay crawlable.
const disallow = ['/api/', '/mcp$', '/mcp/'];

export default function robots(): MetadataRoute.Robots {
  // Previews and any non-production deployment stay fully closed. No named group is emitted there:
  // every crawler then falls back to this one.
  if (!indexingEnabled()) return { rules: { userAgent: '*', disallow: '/' } };
  const policy = crawlerPolicy();
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow },
      // One group per documented token: search and user-triggered crawlers are allowed, training
      // crawlers follow AI_TRAINING_CRAWLERS (an opt-out disallows the whole site).
      ...crawlers.map((crawler) => crawlerAccess(crawler, policy) === 'allow'
        ? { userAgent: crawler.token, allow: '/', disallow }
        : { userAgent: crawler.token, disallow: '/' }),
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
