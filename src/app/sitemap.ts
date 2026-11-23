import type { MetadataRoute } from 'next';
import { indexablePages } from '@/lib/seo/registry';
import { absoluteUrl, indexingEnabled } from '@/lib/seo/site';
import { sitemapProjects } from '@/lib/seo/projects';
import { headhunterLandingServed, indexableHeadhunterPages } from '@/lib/seo/headhunters';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingEnabled()) return [];
  // All three sources fail closed: a failed read fails the sitemap instead of publishing a partial one.
  const [projects, agencies, agencyLanding] = await Promise.all([sitemapProjects(), indexableHeadhunterPages(), headhunterLandingServed()]);
  return [
    // Static pages carry a lastModified only when the registry declares a real modification date.
    // A project list is advertised only while it has projects: the page itself is noindex when it is empty.
    // The agency-page landing is advertised only while it is served (the feature switch is on); it answers 404 otherwise.
    ...indexablePages().filter((page) => (!page.listsProjects || projects.length > 0) && (!page.needsHeadhunterSwitch || agencyLanding)).map((page) => ({ url: absoluteUrl(page.path), ...(page.modified ? { lastModified: page.modified } : {}) })),
    ...projects.map(({ slug, updatedAt }) => ({ url: absoluteUrl(`/projects/${encodeURIComponent(slug)}`), ...(updatedAt ? { lastModified: updatedAt } : {}) })),
    // Agency minisites: page 1 only (later ?page=n pages are noindex), never a URL that is served noindex.
    ...agencies.map(({ path, lastModified }) => ({ url: absoluteUrl(path), ...(lastModified ? { lastModified } : {}) })),
  ];
}
