// Project lifecycle hooks, called from the code that publishes, changes, closes or deletes a project.
// Each hook does two independent things and never throws, so it cannot change the outcome of the
// request that triggered it:
//  1. It drops the cached public project reads at once (tags `projects` and `project:<slug>`), so the
//     feed, the project page and the category pages stop showing stale data.
//  2. After the response, it tells IndexNow about the affected URLs (the project page, its category
//     page and the hub pages the registry knows), but only for a project that search engines may
//     index (`isDiscoverableProject`).
// For `closed` and `deleted`, pass the record as it was before the change: a page only has to be
// announced as gone when it was discoverable while it was open.
import 'server-only';
import { revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { categoryForProject } from '@/lib/seo/categories';
import { submitIndexNow } from '@/lib/seo/indexnow';
import { isDiscoverableProject } from '@/lib/seo/publication';
import { pageByPath } from '@/lib/seo/registry';
import { absoluteUrl } from '@/lib/seo/site';

export type ProjectEventRecord = {
  [field: string]: unknown;
  status?: unknown; visibility?: unknown; sample?: unknown; owner?: { kind?: unknown } | null;
  title?: unknown; description?: unknown; category?: unknown; skills?: unknown;
};

// Cache tags the public project reads carry.
export const PROJECTS_TAG = 'projects';
export const projectTag = (slug: string) => `project:${slug}`;
// Hub pages that list projects; announced only once the registry knows them.
const HUB_PATHS = ['/projects'];
// The same slug rule the public project reader applies.
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const isSlug = (slug: unknown): slug is string => typeof slug === 'string' && SLUG.test(slug);

function warn(message: string, error: unknown) {
  console.warn(message, { error: error instanceof Error ? error.name : 'Error' });
}

// Runs in the request handler (revalidateTag cannot run in Proxy or Client Components). Expiring the
// tags immediately means the next read is a fresh one instead of a stale hit.
export function invalidateProjectCache(slug: string): void {
  if (!isSlug(slug)) return;
  for (const tag of [PROJECTS_TAG, projectTag(slug)]) {
    try { revalidateTag(tag, { expire: 0 }); }
    catch (error) { warn('Project cache invalidation failed', error); }
  }
}

// Absolute URLs whose content changes with this project.
export function projectEventUrls(slug: string, record: ProjectEventRecord): string[] {
  if (!isSlug(slug)) return [];
  const urls = [absoluteUrl(`/projects/${encodeURIComponent(slug)}`)];
  const skills = Array.isArray(record.skills) ? record.skills.filter((skill): skill is string => typeof skill === 'string') : [];
  const category = categoryForProject({ category: typeof record.category === 'string' ? record.category : '', skills });
  if (category && pageByPath(`/categories/${category.slug}`)) urls.push(absoluteUrl(`/categories/${category.slug}`));
  for (const path of HUB_PATHS) if (pageByPath(path)) urls.push(absoluteUrl(path));
  return urls;
}

// There is no response to wait for outside a request (scripts, tests), and the ping is best effort.
function afterResponse(task: () => Promise<unknown>) {
  try { after(task); } catch { /* not inside a request */ }
}

function announce(slug: string, record: ProjectEventRecord) {
  try {
    invalidateProjectCache(slug);
    if (!isDiscoverableProject(record)) return;
    const urls = projectEventUrls(slug, record);
    if (urls.length > 0) afterResponse(() => submitIndexNow(urls));
  } catch (error) {
    warn('Project event failed', error);
  }
}

export const onProjectPublished = (slug: string, record: ProjectEventRecord = {}) => announce(slug, record);
export const onProjectChanged = (slug: string, record: ProjectEventRecord = {}) => announce(slug, record);
export const onProjectClosed = (slug: string, record: ProjectEventRecord = {}) => announce(slug, record);
export const onProjectDeleted = (slug: string, record: ProjectEventRecord = {}) => announce(slug, record);
