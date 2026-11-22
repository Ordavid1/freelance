export type HeadhunterPublicState = {
  live: boolean;
  indexable: boolean;
  reason: 'live' | 'not-approved' | 'not-eligible' | 'account-restricted' | 'no-open-projects';
};

/** The single predicate behind the tag, the page and the sitemap. */
export function headhunterPublicState(input: { status: unknown; eligible: boolean; accountActive: boolean; openProjects: number }): HeadhunterPublicState {
  if (input.status !== 'approved') return { live: false, indexable: false, reason: 'not-approved' };
  if (!input.eligible) return { live: false, indexable: false, reason: 'not-eligible' };
  if (!input.accountActive) return { live: false, indexable: false, reason: 'account-restricted' };
  // An approved, eligible page with no open project stays reachable, but an empty page is thin content.
  if (!(input.openProjects >= 1)) return { live: true, indexable: false, reason: 'no-open-projects' };
  return { live: true, indexable: true, reason: 'live' };
}
