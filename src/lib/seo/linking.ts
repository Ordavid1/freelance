// Internal-link resolution for editorial pages. Skill and category pages name guides by
// slug; a link is produced only when the guide exists as an indexable page in the registry,
// so content can be written ahead of the guides without ever linking to a missing page.
import { indexablePages } from './registry';
import type { SeoPage } from './types';

export type GuideLink = { slug: string; path: string; title: string };

export function guideLinks(slugs: readonly string[] | undefined, pages: readonly SeoPage[] = indexablePages()): GuideLink[] {
  const guidePages = new Map(pages.filter((page) => page.kind === 'guide').map((page) => [page.path, page]));
  const seen = new Set<string>();
  const links: GuideLink[] = [];
  for (const slug of slugs ?? []) {
    const path = `/guides/${slug}`;
    const page = guidePages.get(path);
    if (!page || seen.has(path)) continue;
    seen.add(path);
    links.push({ slug, path, title: page.title });
  }
  return links;
}

// Which guides help a visitor of each category page, most useful first. Slugs that are not
// (yet) registered pages are skipped by guideLinks.
export const categoryGuideSlugs: Readonly<Record<string, readonly string[]>> = {
  'web-development': ['website-cost-factors', 'hire-a-freelancer', 'project-brief', 'compare-freelancer-quotes', 'write-a-winning-proposal'],
  design: ['project-brief', 'hire-a-freelancer', 'compare-freelancer-quotes', 'freelance-contract-checklist', 'write-a-winning-proposal'],
  'writing-marketing': ['project-brief', 'hire-a-freelancer', 'compare-freelancer-quotes', 'freelance-pricing-models', 'write-a-winning-proposal'],
  'video-animation': ['project-brief', 'hire-a-freelancer', 'compare-freelancer-quotes', 'freelancer-or-agency', 'freelance-contract-checklist'],
};

export const MAX_CATEGORY_GUIDES = 4;

export function guidesForCategory(category: string, pages: readonly SeoPage[] = indexablePages()): GuideLink[] {
  return guideLinks(categoryGuideSlugs[category], pages).slice(0, MAX_CATEGORY_GUIDES);
}
