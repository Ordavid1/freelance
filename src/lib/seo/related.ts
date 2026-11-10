// Related projects for a project page: internal links to similar open projects. Pure and
// deterministic: the same input always gives the same list in the same order.
import { categoryForProject } from './categories';

type RelatableProject = { slug: string; category: string; skills: readonly string[]; createdAt?: number };

export const RELATED_PROJECT_LIMIT = 6;

const key = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// Candidates qualify when they are in the same category (by the shared category rule) or
// share at least one skill (case-insensitive); the project itself and duplicate slugs are
// excluded. Most relevant first: same category and shared skills, then same category only,
// then shared skills only; within a tier more shared skills come first, then the newest
// project, and the slug breaks any remaining tie.
export function relatedProjects<T extends RelatableProject>(project: T, candidates: readonly T[], limit: number = RELATED_PROJECT_LIMIT): T[] {
  if (limit <= 0) return [];
  const ownCategory = categoryForProject(project)?.slug;
  const ownSkills = new Set(project.skills.map(key).filter(Boolean));
  const seen = new Set<string>([project.slug]);
  const scored: { candidate: T; tier: number; shared: number }[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.slug)) continue;
    seen.add(candidate.slug);
    const sameCategory = ownCategory !== undefined && categoryForProject(candidate)?.slug === ownCategory;
    const shared = new Set(candidate.skills.map(key).filter((skill) => skill && ownSkills.has(skill))).size;
    if (!sameCategory && shared === 0) continue;
    scored.push({ candidate, tier: (sameCategory ? 2 : 0) + (shared > 0 ? 1 : 0), shared });
  }
  scored.sort((a, b) => b.tier - a.tier
    || b.shared - a.shared
    || (b.candidate.createdAt ?? 0) - (a.candidate.createdAt ?? 0)
    || (a.candidate.slug < b.candidate.slug ? -1 : a.candidate.slug > b.candidate.slug ? 1 : 0));
  return scored.slice(0, limit).map(({ candidate }) => candidate);
}
