// IndexNow announcement of minisite URLs (best effort: never throws, runs after the response, a no-op unless indexing is
// enabled, see `submitIndexNow`). Callers pass every handle whose page changed, e.g. both handles of a rename.
import 'server-only';
import { after } from 'next/server';
import { submitIndexNow } from '@/lib/seo/indexnow';
import { minisitePingUrls } from './pings';

export function announceMinisites(handles: readonly (string | null | undefined)[]): void {
  try {
    const urls = minisitePingUrls(handles);
    if (urls.length === 0) return;
    try { after(() => submitIndexNow(urls)); } catch { /* not inside a request */ }
  } catch (error) {
    console.warn('Minisite IndexNow ping failed', { error: error instanceof Error ? error.name : 'Error' });
  }
}
