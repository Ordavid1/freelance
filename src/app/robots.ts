import type { MetadataRoute } from 'next';
import { absoluteUrl, indexingEnabled } from '@/lib/seo/site';
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled()) return { rules: { userAgent: '*', disallow: '/' } };
  // UI account routes remain crawlable so engines can read their noindex directive.
  // The same public-content rules apply to search and answer-engine crawlers.
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/'] }, sitemap: absoluteUrl('/sitemap.xml') };
}
