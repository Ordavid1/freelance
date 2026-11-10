// Route-level tests for the guide pages, the guides index and the information pages (/pricing, /about,
// /how-it-works, /faq, /glossary): registry entries, rendered output, structured data, the schema
// builders and helpers they use, and the stylesheet contract. GuideArticle itself is covered by
// seo-guide-article.test.mjs. Routes are rendered with fixture content (tests/fixtures), which exercises
// every optional block, and with the content modules that exist in the repository, so the same
// contract is checked on the real text as soon as it lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';
import {
  ORIGIN, assertInOrder, assertStructuredDataPolicy, assertUniqueNodeIds, assertWellFormed, baseEnv, billingOnEnv, bylineTime, count,
  createElement, decode, detailsFaq, faqPairs, groupedFaq, headings, ids, jsonLd, jsonTypes, load, ofType, plain, render, sectionHtml, text, uiStubs,
} from './helpers/seo-pages-harness.mjs';
import { bareGuide, bothGuide, contactFixture, faqFixture, fixtureGuides, glossaryFixture, infoContent, sampleGuide } from './fixtures/seo-pages.fixtures.mjs';

// ---- setup ----
const PAGES = [
  { path: '/how-it-works', kind: 'info', entry: 'src/app/how-it-works/page.tsx' },
  { path: '/pricing', kind: 'info', entry: 'src/app/pricing/page.tsx' },
  { path: '/faq', kind: 'info', entry: 'src/app/faq/page.tsx' },
  { path: '/about', kind: 'info', entry: 'src/app/about/page.tsx' },
  { path: '/glossary', kind: 'info', entry: 'src/app/glossary/page.tsx' },
  { path: '/guides', kind: 'hub', entry: 'src/app/guides/page.tsx' },
];
const GUIDE_ROUTE = 'src/app/guides/[slug]/page.tsx';
const read = (file) => readFileSync(`${projectRoot}/${file}`, 'utf8');
const rendered = (route) => render(createElement(route.default));
const slugParams = (slug) => ({ params: Promise.resolve({ slug }) });
const renderGuide = async (route, slug) => render(await route.default(slugParams(slug)));
const pairs = (items) => items.map(({ question, answer }) => [question, answer]);
const isNotFound = (error) => error?.digest === 'NEXT_NOT_FOUND';

const factsModule = load('src/lib/seo/facts.ts');
const cardcom = load('src/lib/billing/cardcom.ts');
const identity = load('src/lib/legal/identity.ts');
const registry = load('src/lib/seo/registry.ts'); // the guide data that is in the repository
const fixtureRegistry = load('src/lib/seo/registry.ts', { guides: fixtureGuides });
const { formatHebrewDate } = load('src/lib/seo/dates.ts');
const guidesIndex = load('src/lib/seo/guides-index.ts');
const schema = load('src/lib/seo/schema.ts');
const { articleLabels, articleActions, crumbs } = load('src/components/discovery/guide-article.tsx');

// Content modules replaced by fixtures. `factsCalls` records the facts each content builder received.
const H1 = { pricing: 'מה עולה השימוש בשירות לדוגמה', about: 'מי מפעיל את השירות לדוגמה', howItWorks: 'איך השירות עובד לדוגמה' };
const factsCalls = [];
const contentStubs = {
  '@/lib/seo/info-content': {
    pricingContent: (facts) => { factsCalls.push({ page: 'pricing', facts }); return infoContent(H1.pricing); },
    aboutContent: () => infoContent(H1.about),
    howItWorksContent: () => infoContent(H1.howItWorks),
    faqContent: (facts) => { factsCalls.push({ page: 'faq', facts }); return faqFixture; },
  },
  '@/lib/seo/glossary-data': { glossaryIntro: glossaryFixture.intro, glossaryTerms: glossaryFixture.terms },
  '@/lib/seo/facts': { ...factsModule, contactFacts: () => contactFixture },
};
const fixtureRoutes = Object.fromEntries(PAGES.map((page) => [page.path, load(page.entry, { guides: fixtureGuides, stubs: contentStubs })]));
const guideRoute = load(GUIDE_ROUTE, { guides: fixtureGuides });
const loadGlossary = (terms) => load('src/app/glossary/page.tsx', { stubs: { '@/lib/seo/glossary-data': { glossaryIntro: glossaryFixture.intro, glossaryTerms: terms } } });

// The visible breadcrumb trail as [text, ...] and the JSON-LD names, which must be the same list.
const crumbTexts = (html) => [...(/<nav class="ga-crumbs"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => text(match[1]));

// ---- registry ----
test('registry: the information pages and the guides index are registered with a route, the length windows and dates', () => {
  for (const { path, kind, entry } of PAGES) {
    const page = registry.pageByPath(path);
    assert.ok(page, `${path} is registered`);
    assert.equal(page.kind, kind, `${path}: kind`);
    assert.ok(existsSync(`${projectRoot}/${entry}`), `${path}: the route exists`);
    assert.ok(page.title.length >= 20 && page.title.length <= 60, `${path}: title length ${page.title.length}`);
    assert.ok(page.description.length >= 70 && page.description.length <= 165, `${path}: description length ${page.description.length}`);
    assert.notEqual(page.indexable, false, `${path}: indexable`);
    assert.equal(page.published, '2026-11-10', `${path}: published`);
    assert.ok(page.modified >= page.published, `${path}: modified is not before published`);
    if (kind === 'info') assert.equal(page.modified, '2026-11-10', `${path}: info pages carry the creation date`);
    assert.ok(['Product', 'Guides'].includes(page.llms?.section), `${path}: llms section`);
    assert.match(page.llms.note, /^[\x20-\x7E]{20,}$/, `${path}: the llms note is a plain English sentence`);
    // Prices, trial length and billing state are statements from facts.ts, never part of a title or description.
    assert.doesNotMatch(`${page.title} ${page.description}`, /[\d₪$€%]/, `${path}: no figure in the registry copy`);
  }
  const all = registry.allPages();
  for (const { path } of PAGES) assert.equal(all.filter((page) => page.path === path).length, 1, `${path} is registered once`);
});

test('the guides index date follows the newest guide and never goes below its own creation date', () => {
  const hub = (guides) => loadModule('src/lib/seo/info-pages.ts', { env: baseEnv, stubs: { './guides': { guides } } }).infoPages.find((page) => page.path === '/guides');
  const guide = (modified) => ({ ...bareGuide, slug: `g-${modified}`, modified });
  assert.equal(hub([]).modified, '2026-11-10');
  assert.equal(hub([guide('2026-11-02')]).modified, '2026-11-10', 'older guides do not move the date back');
  assert.equal(hub(fixtureGuides).modified, '2026-11-10');
  assert.equal(hub([guide('2026-11-02'), guide('2026-12-03'), guide('2026-11-20')]).modified, '2026-12-03', 'the newest guide date wins');
  assert.equal(hub([guide('2026-12-03')]).published, '2026-11-10', 'the published date never moves');
  assert.equal(guidesIndex.newestDate('2026-11-10', []), '2026-11-10');
  assert.equal(guidesIndex.newestDate('2026-11-10', ['2027-01-01', '2026-11-11']), '2027-01-01');
});

test('guideListItems and guideGroups: every indexable guide page is listed once, grouped by audience in a fixed order', () => {
  const page = (path, over = {}) => ({ path, kind: 'guide', title: `כותרת ${path}`, description: `תיאור ${path}`, modified: '2026-11-08', ...over });
  const pages = [
    page('/guides/project-brief'), page('/guides/sample-guide'), page('/guides/bare-guide'), page('/guides/both-guide'),
    page('/guides/hidden', { indexable: false }), page('/guides/unlisted-new'), { ...page('/pricing'), kind: 'info' },
  ];
  const items = guidesIndex.guideListItems(pages, [sampleGuide, bareGuide, bothGuide]);
  assert.deepEqual(plain(items.map((item) => [item.path, item.audience])), [
    ['/guides/project-brief', 'clients'], ['/guides/sample-guide', 'clients'], ['/guides/bare-guide', 'freelancers'], ['/guides/both-guide', 'both'], ['/guides/unlisted-new', 'both'],
  ], 'hidden and non-guide pages are left out; hand-built and unknown pages get a declared or neutral audience');
  const byPath = Object.fromEntries(items.map((item) => [item.path, item]));
  assert.equal(byPath['/guides/sample-guide'].summary, sampleGuide.summary, 'authored guides use their own summary');
  assert.equal(byPath['/guides/project-brief'].summary, 'תיאור /guides/project-brief', 'hand-built pages fall back to the registry description');
  assert.equal(byPath['/guides/sample-guide'].modified, '2026-11-08');
  const groups = guidesIndex.guideGroups(items);
  assert.deepEqual(plain(groups.map((group) => [group.audience, group.items.map((item) => item.path)])), [
    ['clients', ['/guides/project-brief', '/guides/sample-guide']], ['freelancers', ['/guides/bare-guide']], ['both', ['/guides/both-guide', '/guides/unlisted-new']],
  ]);
  for (const group of groups) assert.ok(group.heading.length > 0 && group.description.length > 0);
  assert.deepEqual(plain(guidesIndex.guideGroups(items.filter((item) => item.audience === 'both')).map((group) => group.audience)), ['both'], 'empty groups are dropped');
  assert.deepEqual(plain(guidesIndex.guideGroups([])), []);
});

// ---- formatting ----
test('formatHebrewDate writes a real calendar date in Hebrew and leaves anything else untouched', () => {
  assert.equal(formatHebrewDate('2026-11-10'), '10 בנובמבר 2026');
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  months.forEach((name, index) => assert.equal(formatHebrewDate(`2026-${String(index + 1).padStart(2, '0')}-05`), `5 ב${name} 2026`));
  assert.equal(formatHebrewDate('2028-02-29'), '29 בפברואר 2028', 'a leap day is a date');
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '10/11/2026', '2026-11-10T00:00:00Z', '']) assert.equal(formatHebrewDate(value), value, value);
});

// ---- schema builders ----
test('definedTermSetNode: one set whose terms point at their anchors, absolute on the site origin', () => {
  const terms = [{ name: 'בריף', description: 'הגדרה ראשונה.', anchor: 'term-1' }, { name: 'ריטיינר', description: 'הגדרה שנייה.', anchor: 'term-2' }];
  const node = schema.definedTermSetNode({ path: '/glossary', name: 'מילון לדוגמה', description: 'תיאור המילון.', terms });
  assert.equal(node['@type'], 'DefinedTermSet');
  assert.equal(node['@id'], `${ORIGIN}/glossary#terms`);
  assert.equal(node.url, `${ORIGIN}/glossary`);
  assert.equal(node.name, 'מילון לדוגמה');
  assert.equal(node.description, 'תיאור המילון.');
  assert.equal(node.inLanguage, 'he-IL');
  assert.deepEqual(plain(node.isPartOf), { '@id': `${ORIGIN}/#website` });
  assert.deepEqual(plain(node.publisher), { '@id': `${ORIGIN}/#organization` });
  assert.deepEqual(plain(node.hasDefinedTerm), terms.map((term) => ({
    '@type': 'DefinedTerm', '@id': `${ORIGIN}/glossary#${term.anchor}`, name: term.name, description: term.description,
    url: `${ORIGIN}/glossary#${term.anchor}`, inDefinedTermSet: { '@id': `${ORIGIN}/glossary#terms` },
  })));
  assertStructuredDataPolicy([schema.withContext(node)], 'definedTermSetNode');
  assertUniqueNodeIds([schema.withContext(node)], 'definedTermSetNode');
  assert.equal('description' in schema.definedTermSetNode({ path: '/glossary', name: 'מילון', terms }), false, 'no empty description key');
  assert.deepEqual(plain(schema.definedTermSetNode({ path: '/glossary', name: 'מילון', terms: [] }).hasDefinedTerm), []);
  const unsafe = schema.definedTermSetNode({ path: '/glossary', name: 'מילון', terms: [{ name: 'א', description: 'ב', anchor: 'a b/ü' }] });
  assert.equal(unsafe.hasDefinedTerm[0].url, `${ORIGIN}/glossary#a%20b%2F%C3%BC`, 'an anchor is URL-encoded');
});

test('webPageNode names the organization as the main entity of an AboutPage only; collectionPageNode carries the modified date when given', () => {
  const about = schema.webPageNode({ type: 'AboutPage', path: '/about', name: 'אודות', description: 'תיאור' });
  assert.equal(about['@type'], 'AboutPage');
  assert.deepEqual(plain(about.mainEntity), { '@id': `${ORIGIN}/#organization` });
  const plainPage = schema.webPageNode({ path: '/pricing', name: 'מחירים', description: 'תיאור' });
  assert.equal(plainPage['@type'], 'WebPage');
  assert.equal('mainEntity' in plainPage, false);
  const dated = schema.collectionPageNode({ path: '/guides', name: 'מדריכים', modified: '2026-11-10', items: [{ name: 'א', path: '/guides/a' }] });
  assert.equal(dated.dateModified, '2026-11-10');
  assert.equal('dateModified' in schema.collectionPageNode({ path: '/guides', name: 'מדריכים', items: [] }), false);
  assertStructuredDataPolicy([schema.withContext(about), schema.withContext(dated)], 'builders');
});

// ---- /guides/[slug] ----
test('guide route: metadata comes from the registry; an unknown slug is noindex and a preview is noindex too', async () => {
  const meta = await guideRoute.generateMetadata(slugParams('sample-guide'));
  assert.equal(meta.title, sampleGuide.title);
  assert.equal(meta.description, sampleGuide.description);
  assert.equal(meta.alternates.canonical, `${ORIGIN}/guides/sample-guide`);
  assert.equal(meta.openGraph.type, 'article');
  assert.equal(meta.openGraph.publishedTime, sampleGuide.published);
  assert.equal(meta.openGraph.modifiedTime, sampleGuide.modified);
  assert.equal(meta.robots.index, true);
  const missing = await guideRoute.generateMetadata(slugParams('nope'));
  assert.equal(missing.robots.index, false);
  assert.equal(missing.alternates, undefined, 'an unknown guide has no canonical');
  const preview = load(GUIDE_ROUTE, { guides: fixtureGuides, env: { NEXT_PUBLIC_SITE_URL: ORIGIN } });
  assert.equal((await preview.generateMetadata(slugParams('sample-guide'))).robots.index, false, 'a preview deployment is not indexable');
});

test('guide route: unknown slugs call notFound and never render a page', async () => {
  // project-brief is a static page, not guide data: the dynamic route does not answer for it.
  for (const slug of ['nope', '', 'Sample-Guide', 'sample-guide/', '../sample-guide', 'project-brief', 'constructor', '__proto__']) {
    await assert.rejects(() => renderGuide(guideRoute, slug), isNotFound, `slug "${slug}"`);
  }
});

test('/guides/project-brief stays a static page next to the dynamic route', () => {
  assert.ok(existsSync(`${projectRoot}/src/app/guides/project-brief/page.tsx`), 'the static page file exists, so Next serves it before [slug]');
  assert.ok(existsSync(`${projectRoot}/${GUIDE_ROUTE}`));
  assert.equal(registry.pageByPath('/guides/project-brief').kind, 'guide');
});

async function assertGuideRoute(route, guide, registryOfRoute, label) {
  const path = `/guides/${guide.slug}`;
  const html = await renderGuide(route, guide.slug);
  assertWellFormed(html, label, formatHebrewDate);
  const nodes = jsonLd(html);
  assertStructuredDataPolicy(nodes, label);
  assertUniqueNodeIds(nodes, label);
  assert.deepEqual(jsonTypes(html), guide.faq.length ? ['Article', 'BreadcrumbList', 'FAQPage'] : ['Article', 'BreadcrumbList'], `${label}: one node of each kind`);
  assert.deepEqual(headings(html, 1), [guide.title], `${label}: one H1, the guide title`);
  // Answer-first: header, crumbs, H1, the direct answer, the byline, then the sections.
  assertInOrder(html, ['class="discovery-header"', 'class="ga-crumbs"', '<h1>', 'class="ga-summary"', 'class="ga-byline"', `<section id="${guide.sections[0].id}"`]);
  // Breadcrumbs: the visible trail and the BreadcrumbList are the same list, home > guides > this guide.
  const [trail] = ofType(html, 'BreadcrumbList');
  assert.deepEqual(plain(trail.itemListElement.map((item) => [item.position, item.name, item.item])), [[1, crumbs.home.name, `${ORIGIN}/`], [2, crumbs.guides.name, `${ORIGIN}/guides`], [3, guide.title, `${ORIGIN}${path}`]], `${label}: BreadcrumbList`);
  assert.deepEqual(crumbTexts(html), trail.itemListElement.map((item) => item.name), `${label}: the visible trail repeats the BreadcrumbList`);
  // Article: dates and headline are the registry's, and the visible date is the structured-data date.
  const [articleData] = ofType(html, 'Article');
  const page = registryOfRoute.pageByPath(path);
  assert.equal(articleData.headline, page.title);
  assert.equal(articleData.description, page.description);
  assert.equal(articleData.datePublished, guide.published);
  assert.equal(articleData.dateModified, guide.modified);
  assert.equal(articleData.mainEntityOfPage, `${ORIGIN}${path}`);
  assert.deepEqual(bylineTime(html), { iso: guide.modified, shown: formatHebrewDate(guide.modified) }, `${label}: byline date`);
  // FAQ: the single FAQPage repeats the visible questions and answers word for word.
  if (guide.faq.length) {
    assert.deepEqual(faqPairs(ofType(html, 'FAQPage')[0]), detailsFaq(html), `${label}: FAQPage equals the visible FAQ`);
    assert.deepEqual(detailsFaq(html), pairs(guide.faq), `${label}: the visible FAQ is the guide FAQ`);
  } else assert.doesNotMatch(html, /faq-heading/, `${label}: no empty FAQ block`);
  return html;
}

test('guide route: every fixture guide renders a complete page with matching structured data', async () => {
  for (const guide of [...fixtureGuides, { ...bareGuide, slug: 'no-faq', faq: [] }]) {
    const withoutFaq = guide.slug === 'no-faq';
    const route = withoutFaq ? load(GUIDE_ROUTE, { guides: [guide] }) : guideRoute;
    await assertGuideRoute(route, guide, withoutFaq ? load('src/lib/seo/registry.ts', { guides: [guide] }) : fixtureRegistry, `/guides/${guide.slug}`);
  }
});

test('guide route: the sample guide shows every block in the answer-first order, with the footer blocks last', async () => {
  const html = await renderGuide(guideRoute, 'sample-guide');
  assertInOrder(html, [
    '<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', ...sampleGuide.sections.map((section) => `<section id="${section.id}"`),
    'id="faq-heading"', 'class="ga-actions"', 'id="article-sources"', 'role="note"', 'id="article-related"',
  ]);
  assert.equal(count(html, /<caption>/g), 1, 'the table has a caption');
  assert.equal(count(html, /<main[ >]/g), 1, 'one main landmark');
  assert.ok(html.includes('<main class="discovery-content">'), 'the page uses the shared discovery container');
});

// ---- /guides ----
test('/guides: guides grouped by audience, every card with its answer, and an ItemList in the order shown', () => {
  const route = fixtureRoutes['/guides'];
  const html = rendered(route);
  assertWellFormed(html, '/guides', formatHebrewDate);
  const page = fixtureRegistry.pageByPath('/guides');
  const brief = fixtureRegistry.pageByPath('/guides/project-brief');
  assert.deepEqual(headings(html, 1), [guidesIndex.guidesIndexIntro.h1]);
  assert.deepEqual([...html.matchAll(/<section id="(audience-[a-z]+)"/g)].map((match) => match[1]), ['audience-clients', 'audience-freelancers', 'audience-both']);
  const cards = [...html.matchAll(/<li class="ga-card"><h3><a href="([^"]+)">([^<]*)<\/a><\/h3><p>([^<]*)<\/p>(?:<p class="ga-card-meta">[^<]*<time dateTime="([^"]+)">([^<]*)<\/time><\/p>)?<\/li>/g)]
    .map((match) => [match[1], decode(match[2]), decode(match[3]), match[4], match[5]]);
  assert.deepEqual(cards, [
    ['/guides/project-brief', brief.title, brief.description, brief.modified, formatHebrewDate(brief.modified)],
    ['/guides/sample-guide', sampleGuide.title, sampleGuide.summary, sampleGuide.modified, formatHebrewDate(sampleGuide.modified)],
    ['/guides/bare-guide', bareGuide.title, bareGuide.summary, bareGuide.modified, formatHebrewDate(bareGuide.modified)],
    ['/guides/both-guide', bothGuide.title, bothGuide.summary, bothGuide.modified, formatHebrewDate(bothGuide.modified)],
  ]);
  assert.equal(sectionHtml(html, 'audience-freelancers').includes('/guides/bare-guide'), true);
  assert.equal(sectionHtml(html, 'audience-clients').includes('/guides/bare-guide'), false, 'a guide is listed in its own group only');
  const nodes = jsonLd(html);
  assertStructuredDataPolicy(nodes, '/guides');
  assertUniqueNodeIds(nodes, '/guides');
  assert.deepEqual(jsonTypes(html), ['BreadcrumbList', 'CollectionPage']);
  const [collection] = ofType(html, 'CollectionPage');
  assert.equal(collection.url, `${ORIGIN}/guides`);
  assert.equal(collection.name, guidesIndex.guidesIndexIntro.h1);
  assert.equal(collection.description, page.description);
  assert.equal(collection.dateModified, page.modified, 'the date is the registry date, which follows the newest guide');
  assert.equal(collection.mainEntity['@type'], 'ItemList');
  assert.deepEqual(plain(collection.mainEntity.itemListElement.map((item) => [item.position, item.name, item.url])), cards.map(([href, title], index) => [index + 1, title, `${ORIGIN}${href}`]), 'the ItemList is the visible list, in the same order');
  assert.deepEqual(plain(ofType(html, 'BreadcrumbList')[0].itemListElement.map((item) => item.name)), [crumbs.home.name, crumbs.guides.name]);
  assert.deepEqual(bylineTime(html), { iso: page.modified, shown: formatHebrewDate(page.modified) });
});

test('/guides with the guide data in the repository lists every indexable guide page exactly once, project-brief included', () => {
  const html = rendered(load('src/app/guides/page.tsx'));
  const expected = registry.indexablePages().filter((page) => page.kind === 'guide').map((page) => page.path);
  const listed = [...html.matchAll(/<li class="ga-card"><h3><a href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(listed.includes('/guides/project-brief'));
  assert.deepEqual([...listed].sort(), [...expected].sort());
  assert.deepEqual(ofType(html, 'CollectionPage')[0].mainEntity.itemListElement.map((item) => item.url).sort(), plain(expected.map((path) => `${ORIGIN}${path}`)).sort());
});

// ---- the information pages ----
test('information pages: head, structured data and visible dates follow the registry; the copy comes from the content module', () => {
  for (const { path } of PAGES.filter((page) => ['/pricing', '/about', '/how-it-works'].includes(page.path))) {
    const route = fixtureRoutes[path];
    const html = rendered(route);
    const page = registry.pageByPath(path);
    assertWellFormed(html, path, formatHebrewDate);
    const nodes = jsonLd(html);
    assertStructuredDataPolicy(nodes, path);
    assertUniqueNodeIds(nodes, path);
    const pageType = path === '/about' ? 'AboutPage' : 'WebPage';
    assert.deepEqual(jsonTypes(html), ['BreadcrumbList', 'FAQPage', pageType].sort(), `${path}: no Service or Offer while billing is unavailable`);
    const h1 = { '/pricing': H1.pricing, '/about': H1.about, '/how-it-works': H1.howItWorks }[path];
    assert.deepEqual(headings(html, 1), [h1], `${path}: the H1 is the content module's`);
    const [webPage] = ofType(html, pageType);
    assert.deepEqual(plain({ url: webPage.url, name: webPage.name, description: webPage.description, published: webPage.datePublished, modified: webPage.dateModified }), { url: `${ORIGIN}${path}`, name: page.title, description: page.description, published: page.published, modified: page.modified }, `${path}: WebPage from the registry`);
    assert.deepEqual(bylineTime(html), { iso: page.modified, shown: formatHebrewDate(page.modified) }, `${path}: the visible date is dateModified`);
    assert.deepEqual(plain(ofType(html, 'BreadcrumbList')[0].itemListElement.map((item) => [item.name, item.item])), [[crumbs.home.name, `${ORIGIN}/`], [h1, `${ORIGIN}${path}`]], `${path}: Home > page`);
    assert.deepEqual(crumbTexts(html), [crumbs.home.name, h1]);
    assert.deepEqual(faqPairs(ofType(html, 'FAQPage')[0]), detailsFaq(html), `${path}: FAQPage equals the visible FAQ`);
    assert.deepEqual(detailsFaq(html).length, 3);
    // Head: title, description and canonical come from the registry; these are not articles.
    assert.equal(route.metadata.title, page.title);
    assert.equal(route.metadata.description, page.description);
    assert.equal(route.metadata.alternates.canonical, `${ORIGIN}${path}`);
    assert.equal(route.metadata.openGraph.type, 'website');
    assert.equal(route.metadata.robots.index, true);
    assertInOrder(html, ['<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', '<section id="first"', 'id="faq-heading"', 'class="ga-actions"', 'id="article-related"']);
    // Related reading: registry titles, own page and unknown paths skipped.
    const related = [...sectionHtml(html, 'article-related').matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)].map((match) => [match[1], decode(match[2])]);
    assert.deepEqual(related, ['/', '/guides', '/faq'].filter((related) => related !== path).map((related) => [related, registry.pageByPath(related).title]), `${path}: related reading`);
  }
});

test('information pages: a preview deployment is noindex', () => {
  for (const { entry } of PAGES) assert.equal(load(entry, { env: { NEXT_PUBLIC_SITE_URL: ORIGIN }, stubs: contentStubs }).metadata.robots.index, false, entry);
});

test('/pricing: Service and Offer exist only while billing is available, with the price and trial from the facts', () => {
  const off = rendered(fixtureRoutes['/pricing']);
  assert.equal(ofType(off, 'Service').length, 0);
  assert.doesNotMatch(JSON.stringify(jsonLd(off)), /Offer|"offers"|"price"|priceCurrency/, 'no price markup without billing');
  assert.equal(off.includes('₪'), false, 'the route adds no price of its own');
  assert.equal(factsCalls.at(-1).page, 'pricing');
  assert.equal(factsCalls.at(-1).facts.billingAvailable, false);

  // The facts stub is left out here: the route reads the facts from its own environment.
  const route = load('src/app/pricing/page.tsx', { env: billingOnEnv, stubs: { '@/lib/seo/info-content': contentStubs['@/lib/seo/info-content'] } });
  const on = rendered(route);
  assert.equal(factsCalls.at(-1).facts.billingAvailable, true);
  assert.deepEqual(plain(factsCalls.at(-1).facts), plain(factsModule.membershipFacts(billingOnEnv)), 'the content builder receives the live facts');
  const [service] = ofType(on, 'Service');
  assert.ok(service, 'a Service is described once the membership can be bought');
  assert.equal(ofType(on, 'Service').length, 1);
  assert.equal(service['@id'], `${ORIGIN}/#membership`);
  const price = (cardcom.PRICE_AGOROT / 100).toFixed(2);
  assert.deepEqual(plain({ type: service.offers['@type'], price: service.offers.price, currency: service.offers.priceCurrency }), { type: 'Offer', price, currency: 'ILS' });
  assert.ok(service.description.includes(String(factsCalls.at(-1).facts.trialDays)), 'the trial length is the fact value');
  assert.deepEqual(jsonTypes(on), ['BreadcrumbList', 'FAQPage', 'Service', 'WebPage']);
  assertStructuredDataPolicy(jsonLd(on), '/pricing (billing on)');
  assertUniqueNodeIds(jsonLd(on), '/pricing (billing on)');
  assertWellFormed(on, '/pricing (billing on)', formatHebrewDate);
});

test('/pricing and /faq read the facts on every request, so a payment configuration change needs no deploy', () => {
  let env = baseEnv;
  const stubs = { ...contentStubs, '@/lib/seo/facts': { ...factsModule, membershipFacts: () => factsModule.membershipFacts(env) } };
  const pricing = load('src/app/pricing/page.tsx', { stubs });
  const faq = load('src/app/faq/page.tsx', { stubs });
  for (const route of [pricing, faq]) assert.equal(route.dynamic, 'force-dynamic');
  for (const [name, state] of [['off', baseEnv], ['on', billingOnEnv], ['off again', baseEnv]]) {
    env = state;
    rendered(pricing);
    rendered(faq);
    const expected = state === billingOnEnv;
    assert.deepEqual(factsCalls.slice(-2).map((call) => [call.page, call.facts.billingAvailable]), [['pricing', expected], ['faq', expected]], `billing ${name}`);
    assert.equal(ofType(rendered(pricing), 'Service').length, expected ? 1 : 0, `Service while billing is ${name}`);
  }
});

test('/about: AboutPage points at the organization, and the operator details come from the contact facts', () => {
  const html = rendered(fixtureRoutes['/about']);
  const [about] = ofType(html, 'AboutPage');
  assert.deepEqual(plain(about.mainEntity), { '@id': `${ORIGIN}/#organization` });
  const block = /<section class="ga-operator"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(block, 'the operator block is rendered');
  assert.ok(text(block).includes(contactFixture.operator));
  assert.ok(block.includes(`href="mailto:${contactFixture.email}"`));
  assert.ok(block.includes(`<bdi lang="en">${contactFixture.operator}</bdi>`), 'the Latin operator name is isolated for bidi');
  assertInOrder(html, ['<section id="third"', 'class="ga-operator"', 'id="faq-heading"']);
  for (const path of ['/pricing', '/how-it-works', '/faq', '/glossary']) assert.doesNotMatch(rendered(fixtureRoutes[path]), /ga-operator/, `${path} has no operator block`);
  const real = rendered(load('src/app/about/page.tsx'));
  assert.ok(real.includes(`href="mailto:${identity.legalEmail}"`), 'without the stub the details are the legal identity');
  assert.ok(text(real).includes(identity.legalOperator));
});

test('/faq: answers are visible and grouped, each group and question has an anchor, and one FAQPage carries every question', () => {
  const html = rendered(fixtureRoutes['/faq']);
  assertWellFormed(html, '/faq', formatHebrewDate);
  const filled = faqFixture.groups.filter((group) => group.items.length > 0);
  const everyQuestion = filled.flatMap((group) => group.items);
  assert.deepEqual(headings(html, 1), [faqFixture.h1]);
  assert.deepEqual(headings(html, 2), [...filled.map((group) => group.heading), articleLabels.related], 'one H2 per non-empty group, then related reading');
  assert.deepEqual(headings(html, 3), everyQuestion.map((item) => item.question), 'every question is an H3');
  assert.equal(count(html, /<details/g), 0, 'answers are not collapsed');
  assert.equal(html.includes(faqFixture.groups.find((group) => group.items.length === 0).heading), false, 'an empty group is skipped');
  // Anchors: the contents list links every group, and every group and question has an id.
  assert.deepEqual([...html.matchAll(/<nav class="ga-toc"[\s\S]*?<\/nav>/g)].flatMap((nav) => [...nav[0].matchAll(/href="#([^"]+)"/g)].map((match) => match[1])), filled.map((group) => group.id));
  for (const [groupIndex, group] of filled.entries()) {
    const block = sectionHtml(html, group.id);
    group.items.forEach((item, itemIndex) => assert.ok(block.includes(`id="q-${groupIndex + 1}-${itemIndex + 1}"`), `${group.id} question ${itemIndex + 1}`));
  }
  assert.ok(ids(html).includes('q-1-1') && ids(html).includes('q-2-3') && ids(html).includes('q-3-2'));
  // One FAQPage, same questions, same answers, same order as the page.
  assert.equal(ofType(html, 'FAQPage').length, 1);
  assert.deepEqual(faqPairs(ofType(html, 'FAQPage')[0]), groupedFaq(html));
  assert.deepEqual(groupedFaq(html), pairs(everyQuestion));
  assert.deepEqual(jsonTypes(html), ['BreadcrumbList', 'FAQPage', 'WebPage']);
  assertStructuredDataPolicy(jsonLd(html), '/faq');
  assertUniqueNodeIds(jsonLd(html), '/faq');
  assert.deepEqual(bylineTime(html), { iso: '2026-11-10', shown: '10 בנובמבר 2026' });
  assertInOrder(html, ['<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', `<section id="${filled[0].id}"`, 'id="article-related"']);
});

test('/faq: no FAQPage without questions, and the contents list needs at least three groups', () => {
  const route = (groups) => load('src/app/faq/page.tsx', { stubs: { ...contentStubs, '@/lib/seo/info-content': { ...contentStubs['@/lib/seo/info-content'], faqContent: () => ({ ...faqFixture, groups }) } } });
  const two = rendered(route(faqFixture.groups.slice(0, 2)));
  assert.doesNotMatch(two, /class="ga-toc"/, 'two groups need no contents list');
  assert.equal(ofType(two, 'FAQPage').length, 1);
  const none = rendered(route([{ id: 'empty', heading: 'ריקה', items: [] }]));
  assert.equal(ofType(none, 'FAQPage').length, 0, 'no empty FAQPage');
  assert.doesNotMatch(none, /ריקה/);
  assertWellFormed(none, '/faq without questions', formatHebrewDate);
});

test('/glossary: a definition list with an anchor per term taken from its position, and a DefinedTermSet that points at them', () => {
  const html = rendered(fixtureRoutes['/glossary']);
  assertWellFormed(html, '/glossary', formatHebrewDate);
  const { terms, intro } = glossaryFixture;
  assert.deepEqual(headings(html, 1), [intro.h1]);
  assert.equal(count(html, /<dl class="ga-glossary">/g), 1);
  assert.equal(count(html, /<div id="term-\d+" class="ga-term"><dt>[^<]*<\/dt><dd>[^<]*<\/dd><dd class="ga-practical"><strong>[^<]*<\/strong>[^<]*<\/dd><\/div>/g), terms.length, 'each term is one dt and two dd');
  assert.deepEqual([...html.matchAll(/<div id="(term-\d+)" class="ga-term">/g)].map((match) => match[1]), terms.map((_, index) => `term-${index + 1}`), 'anchors follow the position, never the Hebrew text');
  assert.deepEqual([...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => decode(match[1])), terms.map((term) => term.term));
  assert.deepEqual([...html.matchAll(/<dt>[^<]*<\/dt><dd>([^<]*)<\/dd>/g)].map((match) => decode(match[1])), terms.map((term) => term.definition));
  assert.deepEqual([...html.matchAll(/<dd class="ga-practical"><strong>[^<]*<\/strong>([^<]*)<\/dd>/g)].map((match) => decode(match[1])), terms.map((term) => term.practical));
  // Jump list: one link per term, to its anchor.
  assert.deepEqual([...html.matchAll(/<li><a href="#(term-\d+)">([^<]*)<\/a><\/li>/g)].map((match) => [match[1], decode(match[2])]), terms.map((term, index) => [`term-${index + 1}`, term.term]));
  assert.deepEqual(headings(html, 2), [articleLabels.related], 'the terms are not headings');
  assertInOrder(html, ['<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-toc"', '<dl class="ga-glossary">', 'id="article-related"']);
  // Structured data: BreadcrumbList, WebPage and one DefinedTermSet that matches the page.
  const nodes = jsonLd(html);
  assertStructuredDataPolicy(nodes, '/glossary');
  assertUniqueNodeIds(nodes, '/glossary');
  assert.deepEqual(jsonTypes(html), ['BreadcrumbList', 'DefinedTermSet', 'WebPage']);
  const [set] = ofType(html, 'DefinedTermSet');
  assert.equal(set['@id'], `${ORIGIN}/glossary#terms`);
  assert.equal(set.name, intro.h1);
  assert.equal(set.description, intro.summary);
  assert.equal(set.hasDefinedTerm.length, terms.length);
  const pageIds = ids(html);
  set.hasDefinedTerm.forEach((entry, index) => {
    assert.deepEqual(plain({ name: entry.name, description: entry.description }), { name: terms[index].term, description: terms[index].definition });
    assert.equal(entry.url, `${ORIGIN}/glossary#term-${index + 1}`);
    assert.ok(pageIds.includes(new URL(entry.url).hash.slice(1)), `${entry.url} points at an element of the page`);
    assert.equal(entry.inDefinedTermSet['@id'], set['@id']);
  });
  assert.equal(ofType(html, 'WebPage')[0].dateModified, '2026-11-10');
  assert.deepEqual(bylineTime(html), { iso: '2026-11-10', shown: '10 בנובמבר 2026' });
});

test('/glossary: special characters are escaped, repeated terms keep unique anchors, and no terms means no set', () => {
  const tricky = [
    { term: 'A & B <i>x</i>', definition: 'הגדרה עם "מירכאות" ו־<b>תגית</b> & סימן.', practical: "טיפ עם גרש ' ועם <em>תגית</em>." },
    { term: 'A & B <i>x</i>', definition: 'אותו מונח שנית, עם </script> בתוכו.', practical: 'הקישורים נשארים ייחודיים.' },
    { term: 'מונח שלישי', definition: 'הגדרה קצרה.', practical: 'טיפ קצר.' },
  ];
  const html = rendered(loadGlossary(tricky));
  assertWellFormed(html, '/glossary tricky', formatHebrewDate);
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ''), /<i>x<\/i>|<b>תגית|<em>/, 'text is never interpreted as markup');
  assert.ok(html.includes('A &amp; B &lt;i&gt;x&lt;/i&gt;'));
  assert.deepEqual([...html.matchAll(/id="(term-\d+)" class="ga-term"/g)].map((match) => match[1]), ['term-1', 'term-2', 'term-3']);
  const [set] = ofType(html, 'DefinedTermSet');
  assert.deepEqual(set.hasDefinedTerm.map((entry) => [entry.name, entry.description]), tricky.map((term) => [term.term, term.definition]), 'JSON-LD text round-trips exactly');
  assert.equal(set.hasDefinedTerm.length, 3);
  assert.equal(new Set(set.hasDefinedTerm.map((entry) => entry.url)).size, 3, 'repeated terms still get distinct urls');
  assert.doesNotMatch(html, /<script[^>]*>[^<]*<\/script>[^<]*<\/script>/, 'a closing script tag in the text cannot end the JSON-LD early');

  const empty = rendered(loadGlossary([]));
  assertWellFormed(empty, '/glossary without terms', formatHebrewDate);
  assert.doesNotMatch(empty, /<dl/, 'no empty definition list');
  assert.doesNotMatch(empty, /class="ga-toc"/);
  assert.equal(ofType(empty, 'DefinedTermSet').length, 0, 'a set without terms says nothing');
  assert.deepEqual(jsonTypes(empty), ['BreadcrumbList', 'WebPage']);
  assert.deepEqual(headings(empty, 1), [glossaryFixture.intro.h1]);

  const many = rendered(loadGlossary(Array.from({ length: 60 }, (_, index) => ({ term: `מונח ${index + 1}`, definition: `הגדרה ${index + 1}.`, practical: `טיפ ${index + 1}.` }))));
  assertWellFormed(many, '/glossary with 60 terms', formatHebrewDate);
  assert.equal(ofType(many, 'DefinedTermSet')[0].hasDefinedTerm.at(-1).url, `${ORIGIN}/glossary#term-60`);
});

// ---- the content that is in the repository ----
test('every route renders the content in the repository in both billing states with the same contract as the fixtures', () => {
  for (const [state, env] of [['billing off', baseEnv], ['billing on', billingOnEnv]]) {
    for (const { path, entry } of PAGES) {
      const label = `${path} (${state})`;
      const html = rendered(load(entry, { env }));
      const page = registry.pageByPath(path);
      assertWellFormed(html, label, formatHebrewDate);
      const nodes = jsonLd(html);
      assertStructuredDataPolicy(nodes, label);
      assertUniqueNodeIds(nodes, label);
      const [main] = nodes.filter((node) => ['WebPage', 'AboutPage', 'CollectionPage'].includes(node['@type']));
      assert.ok(main, `${label}: a page node`);
      assert.deepEqual(plain({ url: main.url, modified: main.dateModified }), { url: `${ORIGIN}${path}`, modified: page.modified }, `${label}: page node dates and url`);
      assert.equal(ofType(html, 'BreadcrumbList').length, 1, `${label}: one BreadcrumbList`);
      assert.equal(bylineTime(html)?.iso, page.modified, `${label}: the visible date is the registry date`);
      assert.equal(ofType(html, 'AboutPage').length, path === '/about' ? 1 : 0, `${label}: AboutPage only on /about`);
      assert.equal(ofType(html, 'Service').length, path === '/pricing' && env === billingOnEnv ? 1 : 0, `${label}: Service only on /pricing while billing is on`);
      assert.equal(ofType(html, 'DefinedTermSet').length, path === '/glossary' && load('src/lib/seo/glossary-data.ts').glossaryTerms.length ? 1 : 0, `${label}: DefinedTermSet only with glossary terms`);
      for (const faq of ofType(html, 'FAQPage')) assert.deepEqual(faqPairs(faq), path === '/faq' ? groupedFaq(html) : detailsFaq(html), `${label}: FAQPage equals the visible text`);
      if (['/pricing', '/about', '/how-it-works'].includes(path)) assert.equal(ofType(html, 'FAQPage').length, 1, `${label}: an information page carries its FAQ`);
    }
  }
});

test('every guide in the repository renders through the guide route with the same contract as the fixtures', async () => {
  const guides = load('src/lib/seo/guides/index.ts').guides;
  const route = load(GUIDE_ROUTE);
  for (const guide of guides) await assertGuideRoute(route, guide, registry, `/guides/${guide.slug}`);
  const hubItems = [...rendered(load('src/app/guides/page.tsx')).matchAll(/<li class="ga-card"><h3><a href="([^"]+)"/g)].map((match) => match[1]);
  for (const guide of guides) assert.ok(hubItems.includes(`/guides/${guide.slug}`), `${guide.slug} is listed on /guides`);
});

// ---- integration ----
test('the sitemap and the footer pick the new pages up from the registry', async () => {
  const sitemap = loadModule('src/app/sitemap.ts', { env: baseEnv, stubs: { '@/lib/seo/projects': { sitemapProjects: async () => [] } } });
  const byUrl = new Map((await sitemap.default()).map((entry) => [entry.url, entry]));
  const footer = loadModule('src/components/site-footer.tsx', { env: baseEnv, stubs: uiStubs });
  const product = footer.footerGroups().find((group) => group.id === 'product');
  for (const { path } of PAGES) {
    const entry = byUrl.get(`${ORIGIN}${path}`);
    assert.ok(entry, `${path} is in the sitemap`);
    assert.equal(entry.lastModified, registry.pageByPath(path).modified, `${path}: lastModified is the declared date`);
    const link = product.links.find((item) => item.href === path);
    assert.ok(link && link.label.trim().length > 0, `${path} is linked from the footer`);
  }
});

// ---- source and stylesheet contracts ----
const COMPONENTS = ['src/components/discovery/guide-article.tsx', 'src/components/discovery/info-blocks.tsx', 'src/components/discovery/breadcrumbs.tsx'];
const ROUTES = [...PAGES.map((page) => page.entry), GUIDE_ROUTE];
const LIBS = ['src/lib/seo/dates.ts', 'src/lib/seo/guides-index.ts', 'src/lib/seo/info-pages.ts'];

test('the new code does not hard-code the production origin or localhost and never injects raw HTML', () => {
  for (const file of [...COMPONENTS, ...ROUTES, ...LIBS, 'src/components/discovery/guide-article.css']) {
    const source = read(file);
    assert.doesNotMatch(source, /freelance-place\.com|localhost/, file);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/, file);
  }
});

test('routes carry no page copy and read params as a Promise (Next 16)', () => {
  for (const file of ROUTES) assert.doesNotMatch(read(file), /[֐-׿]/, `${file}: Hebrew copy belongs in the content modules`);
  const source = read(GUIDE_ROUTE);
  assert.match(source, /params: Promise<\{ slug: string \}>/);
  assert.doesNotMatch(source, /params\.slug/, 'params is awaited, never read directly');
  for (const file of ROUTES) assert.match(read(file), /metadataFor\(/, `${file}: metadata comes from the registry`);
});

test('interface strings and registry copy of these pages pass the typography and honesty rules of the content lint', () => {
  const BANNED = ['הכי טוב', 'מס׳ 1', 'מספר 1', 'מוביל', 'מובטח', 'מבטיחים', '100%', 'ללא סיכון', 'אחריות מלאה', 'כולם', 'תמיד'];
  const problems = [];
  const lint = (where, value) => {
    for (const phrase of BANNED) if (value.includes(phrase)) problems.push(`${where}: banned phrase ${phrase}`);
    if (/[א-ת][A-Za-z]/.test(value)) problems.push(`${where}: Latin text attached to a Hebrew letter (use ־)`);
    if (/[א-ת]-[A-Za-z]/.test(value)) problems.push(`${where}: use ־ before Latin text`);
    if (/[א-ת]"[א-ת]/.test(value)) problems.push(`${where}: use ״ inside a Hebrew word`);
    if (value !== value.trim() || /\s{2,}/.test(value)) problems.push(`${where}: stray whitespace`);
    if (/https?:\/\//.test(value)) problems.push(`${where}: URL in text`);
  };
  for (const [key, value] of Object.entries(articleLabels)) lint(`articleLabels.${key}`, value);
  for (const [key, value] of Object.entries(crumbs)) lint(`crumbs.${key}`, value.name);
  for (const [key, value] of Object.entries(articleActions)) lint(`articleActions.${key}`, value.label);
  lint('guidesIndexIntro.h1', guidesIndex.guidesIndexIntro.h1);
  lint('guidesIndexIntro.summary', guidesIndex.guidesIndexIntro.summary);
  const everyAudience = ['clients', 'freelancers', 'both'].map((audience) => ({ path: `/guides/${audience}`, kind: 'guide', title: audience, description: audience }));
  const groups = guidesIndex.guideGroups(guidesIndex.guideListItems(everyAudience, ['clients', 'freelancers', 'both'].map((audience) => ({ ...bareGuide, slug: audience, audience }))));
  assert.equal(groups.length, 3);
  for (const group of groups) { lint(`group ${group.audience} heading`, group.heading); lint(`group ${group.audience} description`, group.description); }
  for (const { path } of PAGES) { lint(`${path} title`, registry.pageByPath(path).title); lint(`${path} description`, registry.pageByPath(path).description); }
  assert.deepEqual(problems, []);
});

test('the stylesheet only adds ga- rules scoped under .discovery-content, and every ga- class in the markup is styled', () => {
  const css = read('src/components/discovery/guide-article.css');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }));
  assert.ok(rules.length > 30, 'the stylesheet has rules');
  for (const { selector, body } of rules) {
    for (const part of selector.split(',').map((item) => item.trim())) {
      assert.ok(part.startsWith('.discovery-content '), `scoped under .discovery-content: ${part}`);
      assert.match(part, /\.ga-[a-z-]+/, `names a ga- class: ${part}`);
    }
    assert.doesNotMatch(body, /!important/, `no !important in ${selector}`);
  }
  assert.doesNotMatch(css, /(^|[\s,}])(?:html|body|:root|\*)\s*[{,]/, 'no global selectors');
  // Right-to-left safety: spacing and borders use logical properties.
  assert.doesNotMatch(css, /(?:margin|padding)-(?:left|right)\s*:|border-(?:left|right)\s*:|(?:^|[;{\s])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)/, 'logical properties only');
  const used = new Set([...COMPONENTS, ...ROUTES].flatMap((file) => read(file).match(/\bga-[a-z-]+/g) ?? []));
  const defined = new Set((css.match(/\.ga-[a-z-]+/g) ?? []).map((name) => name.slice(1)));
  const hooks = new Set(['ga-section']); // a semantic hook that needs no rule of its own
  assert.deepEqual([...used].filter((name) => !defined.has(name) && !hooks.has(name)), [], 'every class used is styled');
  assert.deepEqual([...defined].filter((name) => !used.has(name)), [], 'no dead rules');
  for (const file of COMPONENTS) assert.match(read(file), /import '\.\/guide-article\.css';/, `${file} loads its stylesheet`);
});
