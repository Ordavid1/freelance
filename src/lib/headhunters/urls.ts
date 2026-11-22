import { absoluteUrl, SITE_URL } from '../seo/site.ts';
import { isHandleFormat } from './handle.ts';

export function minisitePath(handle: string): string {
  if (!isHandleFormat(handle)) throw new Error('A valid headhunter handle is required.');
  // The format check already limits a handle to [a-z0-9-]; encoding is a no-op for valid handles and keeps any URL built
  // from client-held data (the feed state) provably free of markup or scheme characters.
  return `/${encodeURIComponent(handle)}`;
}

export function minisiteUrl(handle: string): string {
  return absoluteUrl(minisitePath(handle));
}

/** Short display form without scheme or `www.`, e.g. `freelance-place.com/ofek-hr`. */
export function minisiteDisplay(handle: string): string {
  return `${new URL(SITE_URL).host.replace(/^www\./, '')}${minisitePath(handle)}`;
}
