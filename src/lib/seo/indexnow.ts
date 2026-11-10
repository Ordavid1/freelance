// IndexNow tells participating search engines (Bing, Yandex, Naver, Seznam and others) that URLs were
// added, updated or deleted. Participants share submissions, so one POST to the shared endpoint
// reaches all of them. Protocol: https://www.indexnow.org/documentation (the endpoint and the
// 10,000-URL limit are from its FAQ). Ownership is proven by the public key file
// `/<key>.txt` (public/), which must contain the key.
// Pure module: nothing here reads project data; callers decide which URLs to announce.
import { SITE_URL, absoluteUrl, indexingEnabled, isPrivatePath } from './site';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const DEFAULT_INDEXNOW_KEY = '937d6e4c8033ee12864f2c5c27fcf898';
// The protocol allows at most 10,000 URLs per request.
export const INDEXNOW_MAX_URLS = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const DEFAULT_TIMEOUT_MS = 3_000;

// INDEXNOW_KEY may override the default (key rotation). A value the protocol would reject is ignored.
export function indexNowKey(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.INDEXNOW_KEY?.trim();
  return configured && KEY_PATTERN.test(configured) ? configured : DEFAULT_INDEXNOW_KEY;
}
export function indexNowKeyLocation(env: NodeJS.ProcessEnv = process.env): string {
  return absoluteUrl(`/${indexNowKey(env)}.txt`);
}

function isPrivateUrlPath(pathname: string) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep the raw path */ }
  return isPrivatePath(pathname) || isPrivatePath(decoded);
}

// Only absolute URLs on the site's own origin are announced: nothing foreign, nothing with
// credentials, no account or API path. Fragments are dropped, duplicates removed, and the list is
// capped (default and maximum: the protocol limit).
export function normalizeIndexNowUrls(urls: Iterable<unknown>, limit: number = INDEXNOW_MAX_URLS): string[] {
  // A limit that is not a number announces nothing instead of everything.
  const cap = Math.min(Math.max(0, Math.floor(limit) || 0), INDEXNOW_MAX_URLS);
  const origin = new URL(SITE_URL).origin;
  const accepted = new Set<string>();
  for (const candidate of urls) {
    if (accepted.size >= cap) break;
    if (typeof candidate !== 'string') continue;
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (url.origin !== origin || url.username || url.password || isPrivateUrlPath(url.pathname)) continue;
    url.hash = '';
    accepted.add(url.href);
  }
  return [...accepted];
}

export type IndexNowPayload = { host: string; key: string; keyLocation: string; urlList: string[] };
export function buildIndexNowPayload(urls: Iterable<unknown>, limit: number = INDEXNOW_MAX_URLS): IndexNowPayload {
  return { host: new URL(SITE_URL).host, key: indexNowKey(), keyLocation: indexNowKeyLocation(), urlList: normalizeIndexNowUrls(urls, limit) };
}

export type IndexNowOptions = { fetch?: typeof fetch; endpoint?: string; timeoutMs?: number; limit?: number };
export type IndexNowResult = { ok: boolean; submitted: number; status: number | null; reason?: 'disabled' | 'no-urls' | 'rejected' | 'failed' };

// Best effort and silent: a no-op unless indexing is enabled (production only), it never throws
// and logs only the HTTP status and the number of URLs (never URLs or the payload). 200 and 202
// both mean the submission was received.
export async function submitIndexNow(urls: Iterable<unknown>, options: IndexNowOptions = {}): Promise<IndexNowResult> {
  if (!indexingEnabled()) return { ok: false, submitted: 0, status: null, reason: 'disabled' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let count = 0;
  try {
    const payload = buildIndexNowPayload(urls, options.limit);
    count = payload.urlList.length;
    if (count === 0) return { ok: false, submitted: 0, status: null, reason: 'no-urls' };
    timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const response = await (options.fetch ?? fetch)(options.endpoint ?? INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // Never forward the payload to a host the endpoint redirects to.
      redirect: 'manual',
    });
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status === 200 || response.status === 202;
    console[ok ? 'info' : 'warn']('IndexNow submission', { status: response.status, count });
    return { ok, submitted: ok ? count : 0, status: response.status, ...(ok ? {} : { reason: 'rejected' as const }) };
  } catch {
    console.warn('IndexNow submission failed', { status: controller.signal.aborted ? 'timeout' : 'error', count });
    return { ok: false, submitted: 0, status: null, reason: 'failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
