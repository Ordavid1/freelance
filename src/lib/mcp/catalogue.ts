import { categories, type Category } from '@/lib/seo/categories';
import { guides } from '@/lib/seo/guides';
import { indexablePages } from '@/lib/seo/registry';
import type { Guide } from '@/lib/seo/types';

// What the catalogue tools and resources may mention: the same rule as /llms-full.txt, which lists a category or a
// guide only while the page registry lists its page (indexable, and served when it sits behind a runtime switch).
// None of these pages is behind a switch, so the default (no switch served) is the right question here.
const listedPaths = () => new Set(indexablePages().map((page) => page.path));

export const listedCategories = (): Category[] => {
  const listed = listedPaths();
  return categories.filter((category) => listed.has(`/categories/${category.slug}`));
};
export const listedGuides = (): Guide[] => {
  const listed = listedPaths();
  return guides.filter((guide) => listed.has(`/guides/${guide.slug}`));
};

/** Slugs for a schema enum (a non-empty tuple, as zod requires). */
export const CATEGORY_SLUGS = listedCategories().map((category) => category.slug) as [string, ...string[]];

/** Shape of a catalogue slug in a request (guide slugs are ASCII kebab-case). */
export const CATALOGUE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
