// The single place that knows which XPlace addresses the importer understands.
// Isomorphic on purpose: the profile studio builds its "open XPlace" link from a username with this code,
// and the project composer validates pasted links with it before the server validates them again.
import type { XPlaceTarget } from '../types';

export const XPLACE_ORIGIN = 'https://www.xplace.com';
export const XPLACE_HOSTS: readonly string[] = ['www.xplace.com', 'xplace.com'];

const MAX_INPUT_LENGTH = 500;
// XPlace handles are plain account names; numeric project IDs are 4 to 10 digits.
const PROFILE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{1,79}$/u;
const PROJECT_ID = /^[1-9]\d{3,9}$/;

function decodeSegment(segment: string): string | null {
  try { return decodeURIComponent(segment); } catch { return null; }
}

/**
 * Recognises XPlace profile links (`/il/u/<name>`, `/u/<name>`, `/il/en/u/<name>`) and project
 * links (`/project?id=<id>`, `/il/job-bids/<id>`, `/job-bids/<id>`), with or without scheme.
 * Everything else, including other hosts, look-alike hosts, credentials, ports, search pages
 * and the internal `/rest/` API, returns null.
 */
export function parseXPlaceUrl(input: unknown): XPlaceTarget | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw || raw.length > MAX_INPUT_LENGTH || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!XPLACE_HOSTS.includes(url.hostname) || url.port || url.username || url.password) return null;

  const decoded = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  if (decoded.some((segment) => segment === null)) return null;
  let segments = decoded as string[];
  if (segments[0] === 'il') segments = segments.slice(1);
  if (segments[0] === 'en') segments = segments.slice(1);

  if (segments.length === 2 && segments[0] === 'u' && PROFILE_SLUG.test(segments[1])) {
    const canonicalUrl = `${XPLACE_ORIGIN}/il/u/${encodeURIComponent(segments[1])}`;
    return { kind: 'profile', slug: segments[1], canonicalUrl };
  }
  const projectId = segments.length === 2 && segments[0] === 'job-bids' ? segments[1]
    : segments.length === 1 && segments[0] === 'project' ? url.searchParams.get('id') ?? '' : '';
  if (PROJECT_ID.test(projectId)) {
    return {
      kind: 'project', projectId,
      canonicalUrl: `${XPLACE_ORIGIN}/il/job-bids/${projectId}`,
      fetchUrl: `${XPLACE_ORIGIN}/project?id=${projectId}`,
    };
  }
  return null;
}

/** The canonical profile page for a bare XPlace username or any supported XPlace profile link; null when it is neither. */
export function resolveXPlaceProfileUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  const target = parseXPlaceUrl(raw);
  if (target) return target.kind === 'profile' ? target.canonicalUrl : null;
  if (/[\s/\\:?#@]/.test(raw) || XPLACE_HOSTS.includes(raw.toLowerCase()) || !PROFILE_SLUG.test(raw)) return null;
  return `${XPLACE_ORIGIN}/il/u/${encodeURIComponent(raw)}`;
}

/** Stable per-owner idempotency key for an imported project. */
export function xplaceProjectKey(projectId: string): string {
  return `xplace:project:${projectId}`;
}
