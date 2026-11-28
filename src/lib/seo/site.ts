import type { Metadata } from 'next';

export const SITE_NAME = 'Freelance Place';
const configuredOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://freelance-place.com');
if (configuredOrigin.protocol !== 'https:' || configuredOrigin.username || configuredOrigin.password || configuredOrigin.pathname !== '/' || configuredOrigin.search || configuredOrigin.hash) {
  throw new Error('NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.');
}
export const SITE_URL = configuredOrigin.origin;
export const SITE_DESCRIPTION = 'Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקטים לעסקים בישראל. מרחב עבודה בעברית, פרופיל מקצועי והצעות מחיר. הכירו אלטרנטיבה ל־XPlace.com.';
// Machine endpoints: not pages, so never indexed or announced (isPrivatePath) and closed to crawlers (robots.ts).
export const apiPrefixes = ['/api', '/mcp'];
export const privatePaths = ['/signin', '/messages', '/membership', '/profile', '/projects/new'];
// Exact URLs inside a private prefix that are public on purpose: a signed-out visitor (a crawler included) gets an indexable page,
// and the same URL answers a signed-in session with the private editor. Only a request that carries a session cookie is private there.
// The second entry is that landing's share card, which every crawler and link preview must be able to fetch.
export const signedOutPublicPaths: readonly string[] = ['/profile/headhunter', '/profile/headhunter/opengraph-image'];
export function isPrivatePath(path: string, hasSession = false) {
  if (signedOutPublicPaths.includes(path)) return hasSession;
  return privatePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) || apiPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
export function indexingEnabled() {
  return process.env.SITE_INDEXABLE === 'true';
}
export function absoluteUrl(path = '/') {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('A local absolute path is required.');
  return `${SITE_URL}${path}`;
}
export const noIndex: Metadata['robots'] = { index: false, follow: false, nocache: true };

export type PageMetadataOptions = {
  type?: 'website' | 'article';
  published?: string;
  modified?: string;
  // The title is already complete (it carries the brand), so the layout's title template is skipped.
  absoluteTitle?: boolean;
  // Social-card override (og and twitter only): title and description are used as given, the image is an absolute URL.
  // Canonical, hreflang and robots never change with it.
  share?: { title?: string; description?: string; image?: string };
};
export function pageMetadata(title: string, description: string, path: string, indexable = true, options: PageMetadataOptions = {}): Metadata {
  const { type = 'website', published, modified, absoluteTitle = false, share } = options;
  const canonical = absoluteUrl(path);
  const socialTitle = share?.title || (absoluteTitle ? title : `${title} | ${SITE_NAME}`);
  const socialDescription = share?.description || description;
  const image = share?.image || absoluteUrl('/opengraph-image');
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    // The site is Hebrew-only today: hreflang is self-referencing and must grow with real translations.
    alternates: { canonical, languages: { 'he-IL': canonical, 'x-default': canonical } },
    robots: indexable && indexingEnabled()
      ? { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 } }
      : noIndex,
    openGraph: {
      title: socialTitle, description: socialDescription, url: canonical, siteName: SITE_NAME, locale: 'he_IL',
      images: [{ url: image, width: 1200, height: 630, alt: title }],
      ...(type === 'article'
        ? { type: 'article' as const, ...(published ? { publishedTime: published } : {}), ...(modified ? { modifiedTime: modified } : {}) }
        : { type: 'website' as const }),
    },
    twitter: { card: 'summary_large_image', title: socialTitle, description: socialDescription, images: [{ url: image, alt: title }] },
  };
}

// Shortens text for a snippet without cutting a word in half: prefers the last full
// sentence inside the limit (when it keeps at least half the allowance), otherwise the
// last word, and marks the cut with an ellipsis. The result never exceeds `max`.
export function summarize(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const limit = Math.max(1, max - 1);
  let end = -1;
  for (let index = Math.min(limit, clean.length) - 1; index >= Math.floor(max / 2); index--) {
    if (/[.!?]/.test(clean[index]) && (index + 1 === clean.length || clean[index + 1] === ' ')) { end = index + 1; break; }
  }
  if (end === -1) {
    const space = clean[limit] === ' ' ? limit : clean.lastIndexOf(' ', limit);
    end = space > 0 ? space : limit;
  }
  return `${clean.slice(0, end).replace(/[\s,;:־–—-]+$/u, '')}…`;
}
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function breadcrumbs(items: { name: string; path: string }[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(item.path) })) };
}
