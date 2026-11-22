// Which minisite URLs an event makes stale (pure module). Used for IndexNow; the submission itself is `submitIndexNow`.
import { isHandleFormat } from './handle.ts';
import { minisiteUrl } from './urls.ts';

/** The handle of a record whose minisite is publicly served (status approved), from a document snapshot; otherwise null. */
export function liveMinisiteHandle(snapshot: { get(field: string): unknown } | null | undefined): string | null {
  if (!snapshot || snapshot.get('status') !== 'approved') return null;
  const handle = snapshot.get('handle');
  return typeof handle === 'string' && isHandleFormat(handle) ? handle : null;
}

/** Absolute minisite URLs for the given handles: malformed ones dropped, duplicates removed. */
export function minisitePingUrls(handles: readonly (string | null | undefined)[]): string[] {
  return [...new Set(handles.filter((handle): handle is string => typeof handle === 'string' && isHandleFormat(handle)).map(minisiteUrl))];
}
