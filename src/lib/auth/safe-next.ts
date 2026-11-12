// Post-sign-in redirect targets. The `next` query parameter is attacker-controllable, so only an exact
// allowlist of same-origin paths is honoured; anything else falls back to `/`.
// The XPlace hand-off needs `?xplace=<token>` to survive the sign-in detour, so the two hand-off pages are
// allowed with exactly that one query parameter (a UUID token), and nothing else.
import { HANDOFF_PATHS, HANDOFF_QUERY_PARAM, isHandoffToken } from '../imports/xplace/handoff.ts';

/** The redirect target for a raw `next` value; `/` unless it is on the allowlist. */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== 'string') return '/';
  if (next === HANDOFF_PATHS.profile) return HANDOFF_PATHS.profile;
  // Compare the raw path/query rather than normalizing an attacker-controlled URL.
  // Always build the result from constants; never send the supplied URL to navigation.
  const [path, query, extra] = next.split('?');
  if (extra !== undefined || query === undefined || !query.startsWith(`${HANDOFF_QUERY_PARAM}=`)) return '/';
  const token = query.slice(HANDOFF_QUERY_PARAM.length + 1);
  if (!isHandoffToken(token) || token.length !== 36) return '/';
  if (path === HANDOFF_PATHS.profile) return `${HANDOFF_PATHS.profile}?${HANDOFF_QUERY_PARAM}=${encodeURIComponent(token)}`;
  if (path === HANDOFF_PATHS.project) return `${HANDOFF_PATHS.project}?${HANDOFF_QUERY_PARAM}=${encodeURIComponent(token)}`;
  return '/';
}

/** `/signin?next=<path + query>` for the page the user is on (the query string is percent-encoded). */
export function signInHref(pathWithQuery: string): string {
  return `/signin?next=${encodeURIComponent(pathWithQuery)}`;
}

/** The `next` value for the page the user is on: its path plus, only when valid, the hand-off token. */
export function nextForPage(pathname: string, search: string): string {
  const token = new URLSearchParams(search).get(HANDOFF_QUERY_PARAM);
  return isHandoffToken(token) ? `${pathname}?${HANDOFF_QUERY_PARAM}=${token}` : pathname;
}
