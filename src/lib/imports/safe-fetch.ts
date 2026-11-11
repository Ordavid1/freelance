import 'server-only';
import { createHash } from 'node:crypto';
import { SITE_URL } from '@/lib/seo/site';
import { ImportError } from './errors';
import { acquireHostSlot } from './host-throttle';
import { XPLACE_HOSTS } from './xplace/urls';

const MAX_REDIRECTS = 2;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchDeps = {
  fetch?: typeof fetch;
  acquireSlot?: (host: string) => Promise<void>;
};

function allowedUrl(value: string, base?: string): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new ImportError('UPSTREAM_UNAVAILABLE'); }
  if (url.protocol !== 'https:' || !XPLACE_HOSTS.includes(url.hostname) || url.port || url.username || url.password) {
    throw new ImportError('UPSTREAM_UNAVAILABLE');
  }
  return url;
}

async function discard(response: Response) {
  try { await response.body?.cancel(); } catch { /* connection is dropped either way */ }
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await discard(response);
    throw new ImportError('UPSTREAM_UNAVAILABLE');
  }
  if (!response.body) throw new ImportError('UPSTREAM_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new ImportError('UPSTREAM_UNAVAILABLE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Fetches one public XPlace HTML page. https only, allow-listed hosts, manual redirects
 * (re-validated every hop), a byte cap, a timeout and one throttle slot per network request.
 */
export async function safeFetchHtml(fetchUrl: string, deps: SafeFetchDeps = {}): Promise<string> {
  const doFetch = deps.fetch ?? fetch;
  const acquireSlot = deps.acquireSlot ?? acquireHostSlot;
  const startedAt = Date.now();
  let status: number | string = 'error';
  let requests = 0;
  try {
    let current = allowedUrl(fetchUrl);
    for (let redirects = 0; ; redirects += 1) {
      await acquireSlot(current.hostname);
      requests += 1;
      let response: Response;
      try {
        response = await doFetch(current.href, {
          method: 'GET',
          redirect: 'manual',
          cache: 'no-store',
          headers: {
            'User-Agent': `FreelancePlaceImporter/1.0 (+${SITE_URL})`,
            Accept: 'text/html',
            'Accept-Language': 'he,en;q=0.8',
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new ImportError('UPSTREAM_UNAVAILABLE');
      }
      status = response.status;

      if (REDIRECT_STATUSES.has(response.status)) {
        await discard(response);
        const location = response.headers.get('location');
        if (!location || redirects >= MAX_REDIRECTS) throw new ImportError('UPSTREAM_UNAVAILABLE');
        current = allowedUrl(location, current.href);
        continue;
      }
      if (response.status === 404 || response.status === 410) { await discard(response); throw new ImportError('NOT_FOUND'); }
      if (response.status !== 200) { await discard(response); throw new ImportError('UPSTREAM_UNAVAILABLE'); }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
        await discard(response);
        throw new ImportError('UPSTREAM_UNAVAILABLE');
      }
      try {
        return await readCapped(response);
      } catch (error) {
        if (error instanceof ImportError) throw error;
        throw new ImportError('UPSTREAM_UNAVAILABLE');
      }
    }
  } finally {
    // Never the raw URL: users paste links to their own pages.
    console.info(JSON.stringify({
      severity: 'INFO', event: 'xplace_fetch',
      urlSha256: createHash('sha256').update(fetchUrl).digest('hex'),
      status, requests, durationMs: Date.now() - startedAt,
    }));
  }
}
