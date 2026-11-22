// Which minisite URLs an event makes stale (pure module). Used for IndexNow; the submission itself is `submitIndexNow`.
import { isHandleFormat } from './handle.ts';
import { minisiteUrl } from './urls.ts';

/** The handle of a record whose minisite is publicly served (status approved and eligible), from a document snapshot; otherwise null. */
export function liveMinisiteHandle(snapshot: { get(field: string): unknown } | null | undefined): string | null {
  // `eligibleAt` too: a fast-track trial page (approved, not yet eligible) is noindex and is never announced.
  if (!snapshot || snapshot.get('status') !== 'approved' || snapshot.get('eligibleAt') == null) return null;
  const handle = snapshot.get('handle');
  return typeof handle === 'string' && isHandleFormat(handle) ? handle : null;
}

/** Absolute minisite URLs for the given handles: malformed ones dropped, duplicates removed. */
export function minisitePingUrls(handles: readonly (string | null | undefined)[]): string[] {
  return [...new Set(handles.filter((handle): handle is string => typeof handle === 'string' && isHandleFormat(handle)).map(minisiteUrl))];
}

/**
 * The handle to announce after a project was created: the live minisite, or a page this very project made indexable (an
 * approved fast-track page that just reached the threshold; its record was read before the counter wrote `eligibleAt`).
 */
export function minisiteAfterCounter(live: string | null, outcome: { handle: string; becameEligible: boolean; status: string } | null | undefined): string | null {
  if (live) return live;
  return outcome && outcome.becameEligible && outcome.status === 'approved' && isHandleFormat(outcome.handle) ? outcome.handle : null;
}
