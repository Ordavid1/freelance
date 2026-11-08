import type { MetadataRoute } from 'next';
import { editorialPaths } from '@/lib/seo/content';
import { absoluteUrl, indexingEnabled } from '@/lib/seo/site';
import { sitemapProjects } from '@/lib/seo/projects';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingEnabled()) return [];
  const projects = await sitemapProjects();
  return [
    ...editorialPaths.map((path) => ({ url: absoluteUrl(path) })),
    ...projects.map(({ slug, updatedAt }) => ({ url: absoluteUrl(`/projects/${encodeURIComponent(slug)}`), ...(updatedAt ? { lastModified: updatedAt } : {}) })),
  ];
}
