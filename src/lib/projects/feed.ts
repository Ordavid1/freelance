// One definition of "the projects a freelancer can browse", shared by the home feed,
// the personal KPI tiles and the tag-filter button, so the numbers on one screen can
// never disagree because each widget filtered a different list.
import { projectSkillMatch } from './skills';

export type FeedProject = {
  slug: string; title: string; description: string; skills: string[]; status?: string;
  createdAt?: number; posted: string;
};
export type FeedStatus = 'all' | 'open' | 'closed';
export type FeedPeriod = 'all' | '24h' | '72h' | 'week' | 'fortnight' | 'month';
export type FeedCriteria = {
  status?: FeedStatus; period?: FeedPeriod; query?: string;
  /** Keep only projects matching the freelancer's profile skills. */
  matchTags?: boolean; tags?: readonly string[]; includeAdjacent?: boolean; now?: number;
};

const HOUR = 60 * 60 * 1000;
export const PERIOD_MS: Record<Exclude<FeedPeriod, 'all'>, number> = { '24h': 24 * HOUR, '72h': 72 * HOUR, week: 168 * HOUR, fortnight: 336 * HOUR, month: 720 * HOUR };

/** Projects without a status are the legacy static cards, which are open. */
export const projectStatus = (project: { status?: string }) => project.status || 'open';
export const isOpenProject = (project: { status?: string }) => projectStatus(project) === 'open';

/** Real timestamp when known, otherwise the Hebrew relative label ("לפני 3 שעות"). */
export function projectDate(project: Pick<FeedProject, 'createdAt' | 'posted'>, now = Date.now()): number {
  if (project.createdAt) return project.createdAt;
  const text = project.posted;
  if (text.includes('אתמול')) return now - 24 * HOUR;
  const n = Number(text.match(/\d+/)?.[0] || 0);
  if (text.includes('דקות')) return now - n * 60 * 1000;
  if (text.includes('שעה')) return now - n * HOUR;
  return 0;
}

/** The browsable universe: database projects first, then static cards, each slug once. */
export function feedUniverse<T extends { slug: string }>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  return lists.flat().filter((project) => !seen.has(project.slug) && !!seen.add(project.slug));
}

export function filterFeed<T extends FeedProject>(projects: readonly T[], criteria: FeedCriteria = {}): T[] {
  const { status = 'all', period = 'all', query = '', matchTags = false, tags = [], includeAdjacent = true, now = Date.now() } = criteria;
  const needle = query.toLowerCase();
  return projects.filter((project) => {
    if (status !== 'all' && projectStatus(project) !== status) return false;
    if (period !== 'all' && now - projectDate(project, now) > PERIOD_MS[period]) return false;
    if (matchTags && projectSkillMatch(project, tags, includeAdjacent).kind === 'none') return false;
    return !needle || `${project.title} ${project.description} ${project.skills.join(' ')}`.toLowerCase().includes(needle);
  });
}

/** Projects the freelancer can bid on right now. */
export const countAvailable = (projects: readonly FeedProject[]) => projects.filter(isOpenProject).length;

/**
 * How many projects the tag filter would show: the current status, period and search
 * criteria applied, then profile-skill matching. It is a count of projects, never of tags.
 */
export const countTagMatches = (projects: readonly FeedProject[], criteria: Omit<FeedCriteria, 'matchTags'>) =>
  filterFeed(projects, { ...criteria, matchTags: true }).length;
