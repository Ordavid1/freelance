// The minisite route decision and the public view of a headhunter (pure: no server-only imports, so it is unit-testable
// with stubbed dependencies). The page and its metadata both go through `resolveMinisite`, so they cannot disagree.
import type { Metadata } from 'next';
import type { Project } from '../data.ts';
import { absoluteUrl, noIndex, pageMetadata, SITE_NAME } from '../seo/site.ts';
import { parsePageParam } from '../seo/pagination.ts';
import { HEADHUNTER_PAGE_SIZE } from './constants.ts';
import { isHandleFormat } from './handle.ts';
import { isTrialRunning } from './trial.ts';
import { headhunterPublicState, type HeadhunterPublicState } from './state.ts';
import { resolveHeadhunterShare } from './share.ts';
import type { ContactLink, HeadhunterKind, HeadhunterRecord } from './types.ts';
import { minisitePath } from './urls.ts';
import { contactLinks } from './validation.ts';

export type MinisiteLookup = { kind: 'active'; record: HeadhunterRecord } | { kind: 'redirect'; to: string };
export type MinisiteProjects = { openCount: number; publishedCount: number; items: Project[]; closed: Project[] };

export type MinisiteDeps = {
  /** The feature switch (`getHeadhunterConfig().enabled`). */
  enabled(): Promise<boolean>;
  lookup(handle: string): Promise<MinisiteLookup | null>;
  accountActive(ownerUid: string): Promise<boolean>;
  projects(ownerUid: string, handle: string, page: number): Promise<MinisiteProjects>;
  /** The clock (epoch ms), injectable for tests; defaults to `Date.now`. */
  now?(): number;
};

/** The only headhunter fields a public page may use. No owner uid, counters, flags, review reasons or timestamps. */
export type MinisiteView = {
  displayName: string;
  handle: string;
  kind: HeadhunterKind;
  city?: string;
  tagline?: string;
  about?: string;
  contact: ContactLink[];
  share: { title?: string; description?: string };
};

export function toMinisiteView(record: HeadhunterRecord): MinisiteView {
  return {
    displayName: record.displayName,
    handle: record.handle,
    kind: record.kind,
    ...(record.city ? { city: record.city } : {}),
    ...(record.tagline ? { tagline: record.tagline } : {}),
    ...(record.about ? { about: record.about } : {}),
    contact: contactLinks(record.contact ?? {}),
    share: { ...(record.share?.title ? { title: record.share.title } : {}), ...(record.share?.description ? { description: record.share.description } : {}) },
  };
}

export type MinisiteResult =
  | { kind: 'not-found' }
  | { kind: 'redirect'; to: string }
  | { kind: 'page'; view: MinisiteView; state: HeadhunterPublicState; projects: MinisiteProjects; page: number; totalPages: number };

/** `/acme` for page 1, `/acme?page=2` after that: every page has one URL. */
export function minisitePagePath(handle: string, page: number): string {
  return page > 1 ? `${minisitePath(handle)}?page=${page}` : minisitePath(handle);
}

/**
 * Decide what `/{handle}?page=n` is. Order matters: the handle format is checked before any read (probes such as `/.env`
 * never reach the database), an upper-case handle is redirected without a read, then the feature switch, the ledger,
 * the record's public state and, last, the project page.
 *  - not-found: bad format or page, feature off, unknown or retired without a target, not live (not approved, not
 *    eligible, account restricted), page out of range.
 *  - redirect (308): upper-case handle to lower case; a retired handle to the owner's current handle.
 */
export async function resolveMinisite(rawHandle: string, rawPage: string | readonly string[] | undefined, deps: MinisiteDeps): Promise<MinisiteResult> {
  const handle = typeof rawHandle === 'string' ? rawHandle.toLowerCase() : '';
  if (!isHandleFormat(handle)) return { kind: 'not-found' };
  const page = parsePageParam(rawPage);
  if (page === undefined) return { kind: 'not-found' };
  if (rawHandle !== handle) return { kind: 'redirect', to: minisitePagePath(handle, page) };

  if (!(await deps.enabled())) return { kind: 'not-found' };
  const lookup = await deps.lookup(handle);
  if (!lookup) return { kind: 'not-found' };
  if (lookup.kind === 'redirect') return isHandleFormat(lookup.to) ? { kind: 'redirect', to: minisitePagePath(lookup.to, page) } : { kind: 'not-found' };

  const { record } = lookup;
  const eligible = record.eligibleAt !== undefined && record.eligibleAt !== null;
  // Evaluated against the clock on every request (the cached record holds the end time, not the verdict).
  const trialRunning = isTrialRunning({ status: record.status, fastTrack: record.fastTrack, eligible, trialEndsAt: typeof record.trialEndsAt === 'number' ? record.trialEndsAt : null }, (deps.now ?? Date.now)());
  if (!headhunterPublicState({ status: record.status, eligible, accountActive: true, openProjects: 0, trialRunning }).live) return { kind: 'not-found' };
  if (!(await deps.accountActive(record.ownerUid))) return { kind: 'not-found' };

  const projects = await deps.projects(record.ownerUid, handle, page);
  const totalPages = Math.max(1, Math.ceil(projects.openCount / HEADHUNTER_PAGE_SIZE));
  if (page > totalPages) return { kind: 'not-found' };
  const state = headhunterPublicState({ status: record.status, eligible, accountActive: true, openProjects: projects.openCount, trialRunning });
  return { kind: 'page', view: toMinisiteView(record), state, projects, page, totalPages };
}

/**
 * Title, description and robots of a resolved minisite. The social tags (og, twitter) take the title, description and image
 * of `resolveHeadhunterShare`, the same resolver the share image route uses; canonical, hreflang and robots stay on the
 * shared `pageMetadata` path. Page 1 is canonical at `/{handle}` and indexable when the page has open projects; a later page is noindex
 * (proxy.ts marks every `?page=` URL outside /projects noindex too).
 */
export function minisiteMetadata(result: MinisiteResult): Metadata {
  if (result.kind !== 'page') return { title: 'העמוד לא נמצא', robots: noIndex };
  const { view, projects, page } = result;
  const share = resolveHeadhunterShare({ displayName: view.displayName, handle: view.handle, tagline: view.tagline, openProjects: projects.openCount, share: view.share }, SITE_NAME);
  const suffix = page > 1 ? ` · עמוד ${page}` : '';
  const image = share.image.kind === 'custom' ? share.image.url : absoluteUrl(share.image.path);
  return pageMetadata(`${share.title}${suffix}`, share.description, minisitePagePath(view.handle, page), result.state.indexable && page === 1, {
    absoluteTitle: true,
    share: { title: share.title, description: share.description, image },
  });
}
