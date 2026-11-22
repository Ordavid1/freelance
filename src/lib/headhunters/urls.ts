import { absoluteUrl, SITE_URL } from '../seo/site.ts';
import { isHandleFormat } from './handle.ts';

export function minisitePath(handle: string): string {
  if (!isHandleFormat(handle)) throw new Error('A valid headhunter handle is required.');
  return `/${handle}`;
}

export function minisiteUrl(handle: string): string {
  return absoluteUrl(minisitePath(handle));
}

/** Short display form without scheme or `www.`, e.g. `freelance-place.com/ofek-hr`. */
export function minisiteDisplay(handle: string): string {
  return `${new URL(SITE_URL).host.replace(/^www\./, '')}${minisitePath(handle)}`;
}
