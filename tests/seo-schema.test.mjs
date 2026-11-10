import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';

const ORIGIN = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN };
const plain = (value) => JSON.parse(JSON.stringify(value));
const schema = loadModule('src/lib/seo/schema.ts', { env });
const factsModule = loadModule('src/lib/seo/facts.ts', { env });
const site = loadModule('src/lib/seo/site.ts', { env });
const content = loadModule('src/lib/seo/content.ts', { env });
const factsOn = factsModule.membershipFacts({ ...env, BILLING_ENABLED: 'true', CARDCOM_TERMINAL_NUMBER: '1', CARDCOM_API_NAME: 'x' });
const factsOff = factsModule.membershipFacts(env);

const FORBIDDEN_TYPES = ['JobPosting', 'Review', 'AggregateRating', 'Rating'];
const FORBIDDEN_KEYS = ['aggregateRating', 'review', 'reviewRating', 'ratingValue', 'ratingCount', 'reviewCount', 'baseSalary', 'jobLocation', 'hiringOrganization'];

// Every builder output the app can emit, for several inputs.
function allOutputs() {
  const items = [{ name: 'פרויקט א', path: '/projects/a' }, { name: 'פרויקט ב', path: '/projects/b%20c' }];
  const questions = [{ question: 'שאלה?', answer: 'תשובה.' }];
  return {
    organization: schema.organizationNode(),
    website: schema.websiteNode(),
    siteGraph: schema.siteGraph(),
    webPage: schema.webPageNode({ path: '/projects/a', name: 'פרויקט', description: 'תיאור', published: '2026-11-01T10:00:00.000Z', modified: '2026-11-02T10:00:00.000Z', keywords: ['Figma', 'UX/UI'] }),
    webPageMinimal: schema.webPageNode({ path: '/alternatives/xplace', name: 'השוואה', description: 'תיאור', citation: 'https://www.xplace.com/' }),
    article: schema.articleNode({ path: '/guides/project-brief', headline: 'מדריך', description: 'תיאור', published: '2026-11-08', modified: '2026-11-08' }),
    collection: schema.collectionPageNode({ path: '/categories/design', name: 'עיצוב', items }),
    itemList: schema.itemListNode(items),
    breadcrumb: schema.breadcrumbNode([{ name: 'דף הבית', path: '/' }, { name: 'עיצוב', path: '/categories/design' }]),
    faq: schema.faqNode(questions),
    faqHome: schema.faqNode(content.getHomeQuestions(factsOn)),
    membership: schema.membershipServiceNode(factsOn),
  };
}

function walk(value, visit, key = '') {
  visit(value, key);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => walk(child, visit, childKey));
}

test('policy: no builder ever emits JobPosting, Review, AggregateRating or Rating', () => {
  const outputs = allOutputs();
  assert.ok(Object.keys(outputs).length >= 12);
  for (const [name, node] of Object.entries(outputs)) {
    walk(plain(node), (value, key) => {
      if (key === '@type') for (const type of [].concat(value)) assert.ok(!FORBIDDEN_TYPES.includes(type), `${name} emits ${type}`);
      assert.ok(!FORBIDDEN_KEYS.includes(key), `${name} emits ${key}`);
    });
  }
  const source = ['schema.ts', 'facts.ts'].map((file) => readFileSync(`${projectRoot}/src/lib/seo/${file}`, 'utf8')).join('\n');
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ''), /JobPosting|AggregateRating|'Review'|'Rating'/);
});

test('policy: every URL in builder output is absolute on SITE_URL (or an external citation)', () => {
  const urlKeys = new Set(['url', 'item', '@id', 'mainEntityOfPage', 'image']);
  for (const [name, node] of Object.entries(allOutputs())) {
    walk(plain(node), (value, key) => {
      if (typeof value === 'string' && urlKeys.has(key)) {
        assert.ok(value.startsWith(`${ORIGIN}/`) || value === ORIGIN, `${name}.${key}: ${value}`);
        assert.doesNotMatch(value, /localhost/);
      }
      if (key === 'logo' && value && value.url) assert.ok(value.url.startsWith(ORIGIN));
    });
  }
  assert.equal(allOutputs().webPageMinimal.citation, 'https://www.xplace.com/');
});

test('organization carries the entity fields and sameAs only when profiles exist', () => {
  const org = plain(schema.organizationNode());
  const contact = factsModule.contactFacts();
  assert.equal(org['@type'], 'Organization');
  assert.equal(org['@id'], `${ORIGIN}/#organization`);
  assert.equal(org.name, 'Freelance Place');
  assert.equal(org.alternateName, 'פרילנס פלייס');
  assert.equal(org.legalName, contact.legalName);
  assert.equal(org.contactPoint.email, contact.email);
  assert.equal(org.contactPoint['@type'], 'ContactPoint');
  assert.equal(org.knowsLanguage, 'he');
  assert.equal(org.areaServed.name, 'IL');
  assert.ok(org.description.length > 40);
  assert.equal(org.url, ORIGIN);
  assert.equal('sameAs' in org, false, 'no sameAs while profiles.ts is empty');

  const profiles = loadModule('src/lib/seo/profiles.ts', { env });
  assert.equal(profiles.sameAs.length, 0);
  const withProfiles = loadModule('src/lib/seo/schema.ts', { env, stubs: { './profiles': { sameAs: ['https://www.linkedin.com/company/example'] } } });
  assert.deepEqual(plain(withProfiles.organizationNode().sameAs), ['https://www.linkedin.com/company/example']);
});

test('site graph is a function returning Organization and WebSite with consistent ids', () => {
  const graph = plain(schema.siteGraph());
  assert.equal(graph['@context'], 'https://schema.org');
  assert.deepEqual(graph['@graph'].map((node) => node['@type']), ['Organization', 'WebSite']);
  const website = graph['@graph'][1];
  assert.equal(website.publisher['@id'], graph['@graph'][0]['@id']);
  assert.equal(website.inLanguage, 'he-IL');
  assert.equal(website.description, site.SITE_DESCRIPTION);
  assert.equal(typeof schema.siteGraph, 'function');
  assert.equal(site.breadcrumbs([{ name: 'a', path: '/' }])['@type'], 'BreadcrumbList', 'site.ts keeps breadcrumbs for compatibility');
});

test('webPage and article builders carry dates, keywords and publisher references', () => {
  const page = plain(allOutputs().webPage);
  assert.equal(page['@type'], 'WebPage');
  assert.equal(page.url, `${ORIGIN}/projects/a`);
  assert.equal(page.datePublished, '2026-11-01T10:00:00.000Z');
  assert.equal(page.dateModified, '2026-11-02T10:00:00.000Z');
  assert.equal(page.keywords, 'Figma, UX/UI');
  assert.deepEqual(page.isPartOf, { '@id': `${ORIGIN}/#website` });
  assert.deepEqual(page.publisher, { '@id': `${ORIGIN}/#organization` });
  const minimal = plain(allOutputs().webPageMinimal);
  for (const key of ['datePublished', 'dateModified', 'keywords']) assert.equal(key in minimal, false, `${key} omitted when unknown`);
  const article = plain(allOutputs().article);
  assert.equal(article['@type'], 'Article');
  assert.equal(article.datePublished, '2026-11-08');
  assert.equal(article.mainEntityOfPage, `${ORIGIN}/guides/project-brief`);
  assert.equal(article.image, `${ORIGIN}/opengraph-image`);
});

test('list, collection, breadcrumb and FAQ builders', () => {
  const list = plain(allOutputs().itemList);
  assert.deepEqual(list.itemListElement.map((item) => item.position), [1, 2]);
  assert.equal(list.itemListElement[1].url, `${ORIGIN}/projects/b%20c`);
  const collection = plain(allOutputs().collection);
  assert.equal(collection['@type'], 'CollectionPage');
  assert.equal(collection.mainEntity['@type'], 'ItemList');
  const crumbs = plain(allOutputs().breadcrumb);
  assert.equal('@context' in crumbs, false, 'context is added with withContext');
  assert.deepEqual(crumbs.itemListElement.map((item) => item.item), [`${ORIGIN}/`, `${ORIGIN}/categories/design`]);
  const home = content.getHomeQuestions(factsOn);
  const faq = plain(schema.faqNode(home));
  assert.deepEqual(plain(faq.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text])), plain(home.map((item) => [item.question, item.answer])), 'FAQ markup mirrors the visible text');
  assert.equal(schema.withContext({ '@type': 'Thing' })['@context'], 'https://schema.org');
});

test('membership service is emitted only while billing is available and uses the facts', () => {
  assert.equal(schema.membershipServiceNode(factsOff), null);
  const node = plain(schema.membershipServiceNode(factsOn));
  assert.equal(node['@type'], 'Service');
  assert.equal(node.offers.price, factsOn.priceIls.toFixed(2));
  assert.equal(node.offers.priceCurrency, 'ILS');
  assert.match(node.description, new RegExp(`${factsOn.trialDays} ימי ניסיון`));
  assert.equal(schema.membershipServiceNode({ ...factsOn, priceIls: 24.5, trialDays: 30 }).offers.price, '24.50');
});

test('rendered structured data components emit parseable, escaped JSON-LD from the builders', () => {
  const stubs = { 'next/image': { __esModule: true, default: () => null }, 'next/link': { __esModule: true, default: ({ href, children }) => createElement('a', { href }, children) } };
  const { Questions, CollectionData } = loadModule('src/components/discovery/public-content.tsx', { env, stubs });
  const blocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const faqHtml = renderToStaticMarkup(Questions({ items: [{ question: 'האם <b>x</b> & y?', answer: 'כן.' }] }));
  const [faq] = blocks(faqHtml);
  assert.equal(faq['@context'], 'https://schema.org');
  assert.equal(faq['@type'], 'FAQPage');
  assert.doesNotMatch(faqHtml.match(/<script[^>]*>(.*?)<\/script>/)[1], /[<>&]/);
  const projects = [
    { slug: 'real', title: 'אמיתי', sample: false, skills: [] },
    { slug: 'agent', title: 'סוכן', sample: true, ownerKind: 'ai-agent', skills: [] },
    { slug: 'demo', title: 'דמו', sample: true, skills: [] },
  ];
  const [collection] = blocks(renderToStaticMarkup(CollectionData({ title: 'פרויקטים', path: '/', projects })));
  assert.deepEqual(collection.mainEntity.itemListElement.map((item) => item.url), [`${ORIGIN}/projects/real`, `${ORIGIN}/projects/agent`]);
});

test('pages build structured data only through the builders', () => {
  const pages = ['src/app/alternatives/xplace/page.tsx', 'src/app/guides/project-brief/page.tsx', 'src/app/categories/[slug]/page.tsx', 'src/app/projects/[slug]/page.tsx', 'src/components/discovery/public-content.tsx', 'src/app/layout.tsx'];
  for (const file of pages) {
    const source = readFileSync(`${projectRoot}/${file}`, 'utf8');
    assert.doesNotMatch(source, /'@type'\s*:/, `${file} hand-writes JSON-LD`);
    assert.doesNotMatch(source, /\bbreadcrumbs\(/, `${file} uses the legacy breadcrumbs helper`);
  }
  const project = readFileSync(`${projectRoot}/src/app/projects/[slug]/page.tsx`, 'utf8');
  assert.match(project, /categoryForProject\(project\)/);
  assert.match(project, /keywords: project\.skills/);
  assert.doesNotMatch(project, /slice\(0, 135\)/, 'meta descriptions are no longer cut mid-word');
});

test('toPublicProject exposes createdAt and updatedAt as milliseconds', () => {
  const projectsModule = loadModule('src/lib/db/projects.ts', {
    env,
    stubs: {
      './firestore': { firestore: () => { throw new Error('not used'); } },
      'next/cache': { unstable_cache: (fn) => fn },
    },
  });
  const timestamp = (millis) => ({ toMillis: () => millis });
  const record = { title: 'כותרת', description: 'תיאור', status: 'open', createdAt: timestamp(1_000), updatedAt: timestamp(2_000) };
  const project = projectsModule.toPublicProject('slug', record);
  assert.equal(project.createdAt, 1_000);
  assert.equal(project.updatedAt, 2_000);
  assert.equal(projectsModule.toPublicProject('slug', { ...record, updatedAt: undefined }).updatedAt, undefined);
});
