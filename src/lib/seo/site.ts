import type { Metadata } from 'next';

export const SITE_NAME = 'Freelance Place';
const configuredOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://freelance-place.com');
if (configuredOrigin.protocol !== 'https:' || configuredOrigin.username || configuredOrigin.password || configuredOrigin.pathname !== '/' || configuredOrigin.search || configuredOrigin.hash) {
  throw new Error('NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.');
}
export const SITE_URL = configuredOrigin.origin;
export const SITE_DESCRIPTION = 'Freelance Place — פרויקטים לפרילנסרים ופרסום פרויקטים לעסקים בישראל. מרחב עבודה בעברית, פרופיל מקצועי והצעות מחיר. הכירו אלטרנטיבה ל־XPlace.com.';
export const privatePaths = ['/signin', '/messages', '/membership', '/profile', '/projects/new'];
export function isPrivatePath(path: string) {
  return privatePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) || path === '/api' || path.startsWith('/api/');
}
export function indexingEnabled() {
  return process.env.SITE_INDEXABLE === 'true';
}
export function absoluteUrl(path = '/') {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('A local absolute path is required.');
  return `${SITE_URL}${path}`;
}
export const noIndex: Metadata['robots'] = { index: false, follow: false, nocache: true };
export function pageMetadata(title: string, description: string, path: string, indexable = true): Metadata {
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    robots: indexable && indexingEnabled()
      ? { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 } }
      : noIndex,
    openGraph: { title: `${title} | ${SITE_NAME}`, description, url: absoluteUrl(path), siteName: SITE_NAME, type: 'website', locale: 'he_IL', images: [{ url: absoluteUrl('/opengraph-image'), width: 1200, height: 630, alt: SITE_NAME }] },
    twitter: { card: 'summary_large_image', title: `${title} | ${SITE_NAME}`, description, images: [absoluteUrl('/opengraph-image')] },
  };
}
export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function breadcrumbs(items: { name: string; path: string }[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(item.path) })) };
}
export const siteGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': absoluteUrl('/#organization'), name: SITE_NAME, url: SITE_URL, logo: { '@type': 'ImageObject', url: absoluteUrl('/freelance-place-logo.png'), width: 512, height: 512 } },
    { '@type': 'WebSite', '@id': absoluteUrl('/#website'), name: SITE_NAME, url: SITE_URL, description: SITE_DESCRIPTION, inLanguage: 'he-IL', publisher: { '@id': absoluteUrl('/#organization') } },
  ],
};
