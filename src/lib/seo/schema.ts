// Typed JSON-LD builders. Pages never hand-write structured data: they call these, so
// entity ids, URLs, language and publisher stay identical everywhere. Policy (enforced by
// tests): no JobPosting, Review, AggregateRating or Rating markup is ever produced, and
// every URL is absolute on SITE_URL.
import { BRAND, contactFacts, type MembershipFacts } from './facts';
import { sameAs } from './profiles';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl, breadcrumbs } from './site';
import type { Question } from './types';

export type JsonLdNode = { '@type': string; [key: string]: unknown };

const ORGANIZATION_ID = absoluteUrl('/#organization');
const WEBSITE_ID = absoluteUrl('/#website');
const LANGUAGE = 'he-IL';
const ORGANIZATION_DESCRIPTION = 'Freelance Place הוא מרחב עבודה בעברית לפרילנסרים ולעסקים בישראל: פרסום פרויקטים, גילוי הזדמנויות, פרופיל מקצועי והצעות מחיר.';
const AREA_SERVED = { '@type': 'Country', name: 'IL' };

export function withContext<T extends JsonLdNode>(node: T) {
  return { '@context': 'https://schema.org', ...node };
}

export function organizationNode(): JsonLdNode {
  const contact = contactFacts();
  return {
    '@type': 'Organization', '@id': ORGANIZATION_ID,
    name: SITE_NAME, alternateName: BRAND.nameHe, legalName: contact.legalName,
    url: SITE_URL, description: ORGANIZATION_DESCRIPTION,
    logo: { '@type': 'ImageObject', url: absoluteUrl('/freelance-place-logo.png'), width: 512, height: 512 },
    areaServed: AREA_SERVED, knowsLanguage: 'he',
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: contact.email, availableLanguage: 'he' },
    ...(sameAs.length ? { sameAs: [...sameAs] } : {}),
  };
}

export function websiteNode(): JsonLdNode {
  return { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, alternateName: BRAND.nameHe, url: SITE_URL, description: SITE_DESCRIPTION, inLanguage: LANGUAGE, publisher: { '@id': ORGANIZATION_ID } };
}

export function siteGraph() {
  return { '@context': 'https://schema.org', '@graph': [organizationNode(), websiteNode()] };
}

export type WebPageInput = {
  path: string; name: string; description: string;
  type?: 'WebPage' | 'AboutPage';
  published?: string; modified?: string;
  keywords?: readonly string[];
  // The public pages a comparison relies on: one URL, or several.
  citation?: string | readonly string[];
};
export function webPageNode(input: WebPageInput): JsonLdNode {
  const url = absoluteUrl(input.path);
  const citations = (typeof input.citation === 'string' ? [input.citation] : [...(input.citation ?? [])]).filter(Boolean);
  return {
    '@type': input.type ?? 'WebPage', '@id': `${url}#page`, url, name: input.name, description: input.description,
    inLanguage: LANGUAGE, isPartOf: { '@id': WEBSITE_ID }, publisher: { '@id': ORGANIZATION_ID },
    // An about page is about the organization that operates the site (its node is in the site graph).
    ...(input.type === 'AboutPage' ? { mainEntity: { '@id': ORGANIZATION_ID } } : {}),
    ...(input.published ? { datePublished: input.published } : {}),
    ...(input.modified ? { dateModified: input.modified } : {}),
    ...(input.keywords?.length ? { keywords: input.keywords.join(', ') } : {}),
    ...(citations.length > 0 ? { citation: citations.length === 1 ? citations[0] : citations } : {}),
  };
}

export type ArticleInput = { path: string; headline: string; description: string; published: string; modified: string };
export function articleNode(input: ArticleInput): JsonLdNode {
  const url = absoluteUrl(input.path);
  return {
    '@type': 'Article', '@id': `${url}#article`, headline: input.headline, description: input.description, inLanguage: LANGUAGE,
    mainEntityOfPage: url, author: { '@id': ORGANIZATION_ID }, publisher: { '@id': ORGANIZATION_ID },
    datePublished: input.published, dateModified: input.modified, image: absoluteUrl('/opengraph-image'),
  };
}

export type ListItemInput = { name: string; path: string };
export function itemListNode(items: readonly ListItemInput[]): JsonLdNode {
  return { '@type': 'ItemList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, url: absoluteUrl(item.path) })) };
}

export function collectionPageNode(input: { path: string; name: string; description?: string; modified?: string; items: readonly ListItemInput[] }): JsonLdNode {
  return {
    '@type': 'CollectionPage', name: input.name, url: absoluteUrl(input.path), inLanguage: LANGUAGE,
    ...(input.description ? { description: input.description } : {}),
    ...(input.modified ? { dateModified: input.modified } : {}),
    isPartOf: { '@id': WEBSITE_ID }, mainEntity: itemListNode(input.items),
  };
}

// A glossary page: one DefinedTermSet whose terms point at their anchors on the page. `anchor` is the
// id of the term's element (ASCII, taken from the term's position, never from its Hebrew text).
export type DefinedTermInput = { name: string; description: string; anchor: string };
export function definedTermSetNode(input: { path: string; name: string; description?: string; terms: readonly DefinedTermInput[] }): JsonLdNode {
  const url = absoluteUrl(input.path);
  const setId = `${url}#terms`;
  return {
    '@type': 'DefinedTermSet', '@id': setId, name: input.name, url, inLanguage: LANGUAGE,
    ...(input.description ? { description: input.description } : {}),
    isPartOf: { '@id': WEBSITE_ID }, publisher: { '@id': ORGANIZATION_ID },
    hasDefinedTerm: input.terms.map((term) => {
      const termUrl = `${url}#${encodeURIComponent(term.anchor)}`;
      return { '@type': 'DefinedTerm', '@id': termUrl, name: term.name, description: term.description, url: termUrl, inDefinedTermSet: { '@id': setId } };
    }),
  };
}

export function breadcrumbNode(items: { name: string; path: string }[]): JsonLdNode {
  const { '@context': _context, ...node } = breadcrumbs(items);
  return node as JsonLdNode;
}

export function faqNode(items: readonly Question[]): JsonLdNode {
  return { '@type': 'FAQPage', mainEntity: items.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) };
}

// The paid membership is described in structured data only while it can actually be bought.
export function membershipServiceNode(facts: MembershipFacts): JsonLdNode | null {
  if (!facts.billingAvailable) return null;
  const price = facts.priceIls.toFixed(2);
  return {
    '@type': 'Service', '@id': absoluteUrl('/#membership'), name: 'חברות Freelance Place לפרילנסרים',
    serviceType: 'חברות להגשת הצעות לפרויקטים', provider: { '@id': ORGANIZATION_ID }, areaServed: AREA_SERVED,
    description: `פרילנסרים מקבלים ${facts.trialDays} ימי ניסיון להגשת הצעות; לאחריהם חברות חודשית בחידוש אוטומטי עד לביטול. פרסום פרויקטים חינם.`,
    offers: { '@type': 'Offer', price, priceCurrency: 'ILS', priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: 'ILS', unitCode: 'MON' } },
  };
}
