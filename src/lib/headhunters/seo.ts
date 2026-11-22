// Search and AI-crawler surface of the minisites (pure module: no server-only imports, unit-testable).
// Rules (plan sections 10 and 11): only live, indexable pages are listed; structured data never carries an
// Organization/LocalBusiness/JobPosting/Review/Rating node or any contact detail; showcase projects never appear.
import type { Project } from '../data.ts';
import { isDiscoverableProject, isSyntheticProject } from '../seo/publication.ts';
import { projectPath } from '../seo/listing.ts';
import { collectionPageNode, webPageNode, breadcrumbNode, type JsonLdNode } from '../seo/schema.ts';
import { SITE_NAME } from '../seo/site.ts';
import { headhunterPublicState } from './state.ts';
import type { MinisiteResult } from './minisite.ts';
import { openProjectsLabel } from './presentation.ts';
import { minisitePath } from './urls.ts';
import { isHandleFormat } from './handle.ts';

/** An open, real project of a minisite page: the same predicate as the project index (open, listable, not showcase). */
function isListedOpenProject(project: Project) {
  return isDiscoverableProject({ status: project.status ?? 'open', title: project.title, description: project.description, sample: project.sample, ownerKind: project.ownerKind });
}

/**
 * JSON-LD graph of page 1 of an indexable minisite: WebPage, CollectionPage with an ItemList of the open projects on the
 * page (URLs of `/projects/{slug}`) and BreadcrumbList. Null for later pages, empty pages and anything not live.
 */
export function minisiteStructuredData(result: MinisiteResult): { '@context': string; '@graph': JsonLdNode[] } | null {
  if (result.kind !== 'page' || result.page !== 1 || !result.state.indexable) return null;
  const items = result.projects.items.filter((project) => !isSyntheticProject({ sample: project.sample, ownerKind: project.ownerKind }) && isListedOpenProject(project));
  if (items.length === 0) return null;
  const { view } = result;
  const path = minisitePath(view.handle);
  const description = `${openProjectsLabel(result.projects.openCount)} של ${view.displayName} ב־${SITE_NAME}.`;
  const crumbs = [{ name: 'דף הבית', path: '/' }, { name: view.displayName, path }];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      webPageNode({ path, name: view.displayName, description }),
      collectionPageNode({ path, name: view.displayName, description, items: items.map((project) => ({ name: project.title, path: projectPath(project.slug) })) }),
      breadcrumbNode(crumbs),
    ],
  };
}

export type IndexableHeadhunterPage = { handle: string; /** `/{handle}`: page 1, the canonical URL. */ path: string; name: string; openProjects: number; lastModified?: Date };

export type HeadhunterSitemapInput = {
  handle: unknown; displayName: unknown; status: unknown; eligible: boolean; accountActive: boolean; openProjects: number; lastModified?: Date;
};

/** The one filter behind the sitemap and llms-full: `headhunterPublicState(...).indexable`, plus a well-formed handle and name. */
export function indexableHeadhunterEntries(rows: readonly HeadhunterSitemapInput[]): IndexableHeadhunterPage[] {
  const entries: IndexableHeadhunterPage[] = [];
  for (const row of rows) {
    if (typeof row.handle !== 'string' || !isHandleFormat(row.handle) || typeof row.displayName !== 'string' || !row.displayName.trim()) continue;
    if (!headhunterPublicState({ status: row.status, eligible: row.eligible, accountActive: row.accountActive, openProjects: row.openProjects }).indexable) continue;
    entries.push({ handle: row.handle, path: minisitePath(row.handle), name: row.displayName.trim(), openProjects: row.openProjects, ...(row.lastModified ? { lastModified: row.lastModified } : {}) });
  }
  return entries.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
}
