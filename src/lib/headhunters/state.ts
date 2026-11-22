export type HeadhunterPublicState = {
  live: boolean;
  indexable: boolean;
  reason: 'live' | 'trial' | 'not-approved' | 'not-eligible' | 'account-restricted' | 'no-open-projects';
};

/**
 * The single predicate behind the tag, the page and the sitemap.
 * `trialRunning` (see trial.ts) makes an approved, not yet eligible page public but never indexable: during the trial the
 * page is served noindex and stays out of the sitemap, llms-full and IndexNow, and it becomes indexable only through the
 * standard rule (eligible, at least one open project). The project tag follows `live`, so it shows during the trial.
 */
export function headhunterPublicState(input: { status: unknown; eligible: boolean; accountActive: boolean; openProjects: number; trialRunning?: boolean }): HeadhunterPublicState {
  if (input.status !== 'approved') return { live: false, indexable: false, reason: 'not-approved' };
  if (!input.eligible && input.trialRunning !== true) return { live: false, indexable: false, reason: 'not-eligible' };
  if (!input.accountActive) return { live: false, indexable: false, reason: 'account-restricted' };
  if (!input.eligible) return { live: true, indexable: false, reason: 'trial' };
  // An approved, eligible page with no open project stays reachable, but an empty page is thin content.
  if (!(input.openProjects >= 1)) return { live: true, indexable: false, reason: 'no-open-projects' };
  return { live: true, indexable: true, reason: 'live' };
}
