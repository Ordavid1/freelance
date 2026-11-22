// Headhunter feature constants (pure module: no server-only imports, usable from scripts, UI and tests).

/** Published projects needed to unlock the headhunter page and tag. One value for the counter, the UI and public copy. */
export const HEADHUNTER_MIN_PROJECTS = 10;
/** Below this many published projects (after moderation removals) the record goes back to review. */
export const HEADHUNTER_REVIEW_FLOOR = 5;
/**
 * "Live now" option: an approved fast-track page is public from approval, and must reach HEADHUNTER_MIN_PROJECTS published
 * projects within this many hours of approval, or it is taken down (the record and the handle stay).
 */
export const HEADHUNTER_FAST_TRACK_HOURS = 40;
export const HEADHUNTER_RENAME_COOLDOWN_DAYS = 30;
export const HEADHUNTER_RETIRED_HOLD_DAYS = 365;
/** Minimum trimmed description length of a project that counts toward the threshold. */
export const HEADHUNTER_MIN_DESCRIPTION = 80;

export const HEADHUNTER_LIMITS = {
  displayName: { min: 2, max: 60 },
  city: 40,
  tagline: 90,
  about: 600,
  shareTitle: 70,
  shareDescription: 160,
  email: 120,
  url: 200,
} as const;

/** Minisite list sizes: open projects per page (`?page=`) and closed projects listed under them. */
export const HEADHUNTER_PAGE_SIZE = 24;
export const HEADHUNTER_CLOSED_LIMIT = 6;
/** Upper bound on the owner's project documents read for one minisite (a single-field query, no index needed). */
export const HEADHUNTER_PROJECT_READ_LIMIT = 1000;

export const HEADHUNTER_STATUSES = ['draft', 'pending', 'approved', 'suspended', 'rejected'] as const;
export const HEADHUNTER_KINDS = ['agency', 'independent'] as const;

export const HEADHUNTERS_COLLECTION = 'headhunters';
export const HANDLES_COLLECTION = 'handles';
/** Feature switch document. */
export const HEADHUNTER_CONFIG = { collection: 'config', doc: 'headhunters' } as const;

export const HEADHUNTERS_TAG = 'headhunters';
export function headhunterTag(handle: string) {
  return `headhunter:${handle}`;
}

/** The signed-in apply/edit screen (private path, under the /profile prefix). */
export const HEADHUNTER_EDITOR_PATH = '/profile/headhunter';
