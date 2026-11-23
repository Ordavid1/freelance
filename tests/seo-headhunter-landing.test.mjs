// The public landing of /profile/headhunter (the free agency page): what signed-out visitors and crawlers get at that URL, while a
// signed-in session gets the private editor at the same URL (tests/headhunter-editor.test.mjs). Covers the registry entry, the proxy
// carve-out (indexable without a session cookie, noindex with one), the rendered page and its structured data, the link between the
// copy and the headhunter constants, the labelled mock-ups, and the page's place in the sitemap, llms.txt, llms-full.txt, the footer,
// IndexNow and the other pages' related links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server.js';
import { loadModule, projectRoot } from './helpers/load-ts.mjs';
import {
  ORIGIN, assertInOrder, assertStructuredDataPolicy, assertUniqueNodeIds, assertWellFormed, count, createElement, decode, detailsFaq,
  faqPairs, headings, jsonLd, jsonTypes, load, ofType, plain, render,
} from './helpers/seo-pages-harness.mjs';

const PATH = '/profile/headhunter';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: ORIGIN };
const read = (file) => readFileSync(`${projectRoot}/${file}`, 'utf8');
const supportStub = { '@/components/support-chat': { SupportHeaderActions: ({ children }) => createElement('div', { className: 'actions' }, children) } };

const registry = load('src/lib/seo/registry.ts');
const constants = load('src/lib/headhunters/constants.ts');
const contentModule = load('src/lib/seo/headhunter-content.ts');
const { formatHebrewDate } = load('src/lib/seo/dates.ts');
const { crumbs } = load('src/components/discovery/guide-article.tsx');
const { EDITOR_TEXT } = load('src/lib/headhunters/editor-copy.ts');
const landingModule = load('src/components/headhunter-landing.tsx', { stubs: supportStub });
const entry = registry.pageByPath(PATH);
const content = contentModule.headhunterLandingContent();
const { LANDING } = contentModule;
const page = (applicationsOpen = true) => render(createElement(landingModule.HeadhunterLanding, { applicationsOpen }));

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

test('registry: the landing is an indexable information page whose title, description and dates follow the rules', () => {
  assert.ok(entry, 'the page is registered');
  assert.equal(entry.kind, 'info');
  assert.notEqual(entry.indexable, false);
  assert.equal(entry.needsHeadhunterSwitch, true, 'left out of the sitemap while the feature switch is off');
  assert.ok(entry.title.length >= 20 && entry.title.length <= 60, `title is 20-60 chars (is ${entry.title.length})`);
  assert.ok(entry.description.length >= 70 && entry.description.length <= 165, `description is 70-165 chars (is ${entry.description.length})`);
  // Thresholds and durations live in the page text, where they come from the constants, never in a title or description.
  assert.doesNotMatch(`${entry.title} ${entry.description}`, /\d/);
  assert.match(entry.published, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(entry.modified, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(entry.modified >= entry.published);
  const others = registry.allPages().filter((other) => other.path !== PATH);
  assert.equal(others.some((other) => other.title === entry.title), false, 'the title is unique');
  assert.equal(others.some((other) => other.description === entry.description), false, 'the description is unique');
  assert.equal(entry.llms.section, 'Product');
  assert.ok(existsSync(`${projectRoot}/src/app/profile/headhunter/page.tsx`), 'the route exists');
  assert.ok(registry.indexablePages().some((other) => other.path === PATH));
});

// ---------------------------------------------------------------------------------------------
// Proxy: one URL, two audiences
// ---------------------------------------------------------------------------------------------

function robotsHeader({ indexable = 'true', ...request } = {}) {
  const { proxy } = loadModule('src/proxy.ts', { stubs: { 'next/server': { NextResponse } }, env: { NODE_ENV: 'production', ...env, SITE_INDEXABLE: indexable } });
  return (path, { host = 'freelance-place.com', cookie } = {}) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } })).headers.get('x-robots-tag');
}

test('proxy: the landing is indexable for a request without a session and noindex for a request with one', () => {
  const robots = robotsHeader();
  assert.equal(robots(PATH), null, 'a crawler sends no cookie and gets the indexable page');
  assert.equal(robots(`${PATH}?utm_source=newsletter&gclid=x`), null, 'campaign parameters do not make it a different page');
  assert.equal(robots(PATH, { cookie: 'theme=dark; other=1' }), null, 'an unrelated cookie is not a session');
  assert.match(robots(PATH, { cookie: 'fz_session=abc' }), /noindex/, 'the signed-in view is the private editor');
  assert.match(robots(PATH, { cookie: 'theme=dark; fz_session=abc' }), /noindex/);
  assert.match(robots(`${PATH}?page=2`), /noindex/, 'a parameter that changes the content keeps the header');
  assert.match(robots(PATH, { host: 'preview.run.app' }), /noindex/, 'only the canonical host is indexable');
  assert.match(robotsHeader({ indexable: 'false' })(PATH), /noindex/, 'nothing is indexable while indexing is off');
});

test('proxy: every other account page stays private, and the carve-out is the exact path only', () => {
  const robots = robotsHeader();
  for (const path of [`${PATH}/x`, '/profile/import', '/profile', '/messages', '/membership', '/projects/new', '/signin', '/api/headhunter']) {
    assert.match(robots(path), /noindex/, path);
  }
});

test('the session cookie name has one owner, shared by the session code and the proxy', () => {
  assert.equal(load('src/lib/auth/session-cookie.ts').SESSION_COOKIE, 'fz_session');
  const session = read('src/lib/auth/session.ts');
  assert.match(session, /from '\.\/session-cookie'/);
  assert.doesNotMatch(session, /SESSION_COOKIE\s*=\s*'/, 'session.ts does not define the name again');
  assert.doesNotMatch(read('src/proxy.ts'), /fz_session/, 'the proxy imports the name');
});

// ---------------------------------------------------------------------------------------------
// The rendered landing
// ---------------------------------------------------------------------------------------------

test('landing: an answer-first page with one h1, the summary right after it and the sections in the content order', () => {
  const html = page();
  assertWellFormed(html, PATH, formatHebrewDate);
  assert.deepEqual(headings(html, 1), [content.h1]);
  assert.equal(count(html, /<main[ >]/g), 1, 'one main landmark');
  assertInOrder(html, [
    'class="discovery-header"', 'class="ga-crumbs"', '<h1>', 'class="ga-summary"', 'class="ga-byline"', 'class="ga-actions"', 'class="ga-toc"',
    ...content.sections.map((section) => `<section id="${section.id}"`), 'id="faq-heading"', 'id="article-related"',
  ]);
  assert.deepEqual(plain(headings(html, 2)).slice(0, 2), [content.sections[0].heading, LANDING.gallery.heading], 'the illustrations follow the first section');
  assert.ok(html.includes(`>${content.summary.replace(/"/g, '&quot;')}</p>`), 'the summary is the content summary');
  assert.match(html, new RegExp(`<time dateTime="${entry.modified}">${formatHebrewDate(entry.modified)}</time>`), 'the visible date is the registry date');
  for (const section of content.sections) assert.ok(html.includes(`class="ga-answer">${decodeless(section.answer)}</p>`), `${section.id}: the direct answer is shown`);
});

// The markup escapes quotes only; the content has plain text otherwise.
function decodeless(value) {
  return value.replace(/"/g, '&quot;');
}

test('landing: the apply button signs in and comes back to this URL, where a signed-in visitor finds the form', () => {
  const html = page();
  const links = [...html.matchAll(/<a href="([^"]+)" class="discovery-cta">([^<]*)<\/a>/g)].map((match) => [decode(match[1]), decode(match[2])]);
  assert.deepEqual(plain(links), [[`/signin?next=${encodeURIComponent(PATH)}`, LANDING.cta.apply], [`/signin?next=${encodeURIComponent(PATH)}`, LANDING.cta.apply]], 'one at the top, one after the FAQ');
  assert.ok(html.includes('href="/projects/new"'), 'a visitor who only wants to post a project has the way too');
  assert.match(html, /<header class="discovery-header">[\s\S]*href="\/signin\?next=%2Fprofile%2Fheadhunter">כניסה לחשבון<\/a>/, 'the header sign-in also returns to this page');
});

test('landing: while applications are closed the page says so, offers no sign-up and still answers the questions', () => {
  const html = page(false);
  assert.ok(html.includes(EDITOR_TEXT.closedTitle), 'the closed note is shown');
  assert.doesNotMatch(html, new RegExp(LANDING.cta.apply), 'no apply button');
  assert.equal(count(html, /href="\/signin\?next=%2Fprofile%2Fheadhunter"/g), 1, 'only the header sign-in remains');
  assert.deepEqual(headings(html, 1), [content.h1]);
  assert.equal(count(html, /<section id="[a-z-]+" class="ga-section"/g), content.sections.length, 'every section is still there');
  assert.deepEqual(plain(detailsFaq(html)), plain(content.faq.map(({ question, answer }) => [question, answer])), 'and the FAQ');
});

// ---------------------------------------------------------------------------------------------
// Mock-ups
// ---------------------------------------------------------------------------------------------

function webpSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('latin1', 0, 4), 'RIFF', file);
  assert.equal(bytes.toString('latin1', 8, 12), 'WEBP', file);
  const kind = bytes.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const bits = bytes.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
  throw new Error(`${file}: unknown WebP chunk ${kind}`);
}

test('landing: the mock-ups say they are illustrations in the note, the alt text, the badge and the caption', () => {
  const html = page();
  const start = html.indexOf('<section class="hh-lp-gallery"');
  assert.notEqual(start, -1);
  const gallery = html.slice(start, html.indexOf('</section>', start));
  assert.match(gallery, /<p class="hh-lp-note" role="note">/);
  assert.ok(decode(gallery).includes(LANDING.gallery.note));
  assert.match(LANDING.gallery.note, /דוגמה בדויה/, 'the note names the example as fictional');
  const figures = gallery.match(/<figure[\s\S]*?<\/figure>/g);
  assert.equal(figures.length, LANDING.gallery.items.length);
  for (const figure of figures) {
    assert.match(figure, /alt="הדמיה: /, 'the alt text starts with the label');
    assert.match(figure, /<figcaption><span class="hh-lp-badge">הדמיה<\/span>/, 'the caption starts with the badge');
    assert.match(figure, /loading="lazy"/);
    assert.match(figure, /decoding="async"/);
  }
});

test('landing: each image is a file that exists, with the width and height the page declares', () => {
  const html = page();
  for (const item of LANDING.gallery.items) {
    const file = `${projectRoot}/public${item.src}`;
    assert.ok(existsSync(file), `${item.src} exists`);
    assert.deepEqual(webpSize(file), { width: item.width, height: item.height }, `${item.src}: declared size is the file's own`);
    assert.ok(html.includes(`src="${item.src}" width="${item.width}" height="${item.height}"`), `${item.src}: the markup carries the size`);
  }
  assert.equal(new Set(LANDING.gallery.items.map((item) => item.src)).size, LANDING.gallery.items.length);
});

// ---------------------------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------------------------

test('landing: structured data is a WebPage about one free Service, the breadcrumb and the FAQ, and nothing the policy forbids', () => {
  const html = page();
  const nodes = jsonLd(html);
  assertStructuredDataPolicy(nodes, PATH);
  assertUniqueNodeIds(nodes, PATH);
  assert.deepEqual(jsonTypes(html), ['BreadcrumbList', 'FAQPage', 'Service', 'WebPage']);
  const [web] = ofType(html, 'WebPage');
  const [service] = ofType(html, 'Service');
  assert.equal(web['@id'], `${ORIGIN}${PATH}#page`);
  assert.equal(web.url, `${ORIGIN}${PATH}`);
  assert.equal(web.name, entry.title);
  assert.equal(web.description, entry.description);
  assert.equal(web.datePublished, entry.published);
  assert.equal(web.dateModified, entry.modified);
  assert.deepEqual(plain(web.mainEntity), { '@id': service['@id'] }, 'the page is about the service');
  assert.equal(service['@id'], `${ORIGIN}${PATH}#service`);
  assert.equal(service.url, `${ORIGIN}${PATH}`);
  assert.equal(service.offers.price, '0', 'the page says the service is free, and so does the offer');
  assert.equal(service.offers.priceCurrency, 'ILS');
  assert.deepEqual(plain(service.provider), { '@id': `${ORIGIN}/#organization` });
  assert.equal(service.name, LANDING.service.name);
  const [trail] = ofType(html, 'BreadcrumbList');
  assert.deepEqual(plain(trail.itemListElement.map((item) => [item.position, item.name, item.item])), [[1, crumbs.home.name, `${ORIGIN}/`], [2, LANDING.breadcrumb, `${ORIGIN}${PATH}`]]);
});

test('landing: the FAQPage repeats the visible questions and answers word for word', () => {
  const html = page();
  assert.deepEqual(faqPairs(ofType(html, 'FAQPage')[0]), detailsFaq(html));
  assert.deepEqual(plain(detailsFaq(html)), plain(content.faq.map(({ question, answer }) => [question, answer])));
  assert.ok(content.faq.length >= 6, 'the questions people ask before applying are all there');
  // The visible FAQ has no pair twice, and the markup holds one FAQPage.
  assert.equal(new Set(content.faq.map((item) => item.question)).size, content.faq.length);
  assert.equal(count(jsonTypes(html).join(' '), /FAQPage/g), 1);
});

// ---------------------------------------------------------------------------------------------
// The copy follows the rules, and promises nothing
// ---------------------------------------------------------------------------------------------

test('copy: every number comes from the headhunter constants, so a changed rule changes the page', () => {
  const numbers = {
    HEADHUNTER_MIN_PROJECTS: constants.HEADHUNTER_MIN_PROJECTS + 3, HEADHUNTER_FAST_TRACK_HOURS: constants.HEADHUNTER_FAST_TRACK_HOURS + 3,
    HEADHUNTER_MIN_DESCRIPTION: constants.HEADHUNTER_MIN_DESCRIPTION + 3, HEADHUNTER_RENAME_COOLDOWN_DAYS: constants.HEADHUNTER_RENAME_COOLDOWN_DAYS + 3,
  };
  const shifted = load('src/lib/seo/headhunter-content.ts', { stubs: { '@/lib/headhunters/constants': { HEADHUNTER_EDITOR_PATH: PATH, ...numbers } } });
  const copy = [...strings([shifted.headhunterLandingContent(), shifted.LANDING.service, shifted.LANDING.breadcrumb, shifted.LANDING.cta])].join('\n');
  for (const [value, unit] of [[numbers.HEADHUNTER_MIN_PROJECTS, 'פרויקטים'], [numbers.HEADHUNTER_FAST_TRACK_HOURS, 'שעות'], [numbers.HEADHUNTER_MIN_DESCRIPTION, 'תווים'], [numbers.HEADHUNTER_RENAME_COOLDOWN_DAYS, 'ימים']]) {
    assert.ok(copy.includes(`${value} ${unit}`), `${value} ${unit} is in the copy`);
  }
  for (const key of Object.keys(numbers)) {
    const real = constants[key];
    assert.equal(new RegExp(`(?<!\\d)${real}(?!\\d)`).test(copy), false, `${key}: the real value ${real} is not typed by hand`);
  }
  // No other digit is left: any number that is not one of the four constants would be typed by hand.
  const left = copy.replace(new RegExp(Object.values(numbers).join('|'), 'g'), '').match(/.{0,20}\d.{0,20}/g);
  assert.equal(left, null, `a number that is not a constant: ${left}`);
});

// Every string value inside a structure (keys such as "h1" are not text).
function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) yield* strings(item);
}

test('copy: the page promises no ranking, lead or hire, and states the limits and the conditional indexing', () => {
  const copy = JSON.stringify([content, LANDING.service]);
  for (const phrase of ['מובטח', 'מבטיחים', 'מבטיח', 'ראשון בגוגל', 'עמוד ראשון', 'לידים', 'גיוס מובטח', 'מקום ראשון', 'בלעדי']) assert.equal(copy.includes(phrase), false, `no "${phrase}"`);
  const text = JSON.stringify(content);
  assert.match(text, /אין התחייבות/, 'the exposure answer says there is no commitment to appear in search results');
  assert.match(text, /מנועי חיפוש מחליטים בעצמם/);
  assert.match(text, /אינו חברת השמה/, 'the page says the site is not a placement agency');
  const limits = content.sections.find((section) => section.id === 'limits');
  assert.ok(limits && limits.list.items.length >= 3, 'a section states what the page does not include');
  const cost = content.sections.find((section) => section.id === 'cost');
  assert.match(cost.answer, /חינם/);
  assert.match(cost.answer, /אינו עובר/, 'payment for work does not pass through the site');
  assert.doesNotMatch(JSON.stringify(content), /ללא עמלה|בלי עמלה|0 ₪|0%/, 'no unmeasured commission claim');
});

test('copy: the page links only to pages that exist, and the related list is within the 3-6 window', () => {
  const known = new Set(registry.allPages().map((other) => other.path));
  assert.ok(content.related.length >= 3 && content.related.length <= 6);
  for (const related of content.related) assert.ok(known.has(related), `${related} is a registry path`);
  assert.equal(content.related.includes(PATH), false, 'the page does not relate to itself');
  for (const section of content.sections) assert.match(section.id, /^[a-z]+(?:-[a-z]+)*$/, `${section.id}: ASCII kebab-case anchor`);
});

// ---------------------------------------------------------------------------------------------
// Where the page is listed
// ---------------------------------------------------------------------------------------------

const loadSitemap = (served, indexable = 'true') => loadModule('src/app/sitemap.ts', { env: { ...env, SITE_INDEXABLE: indexable }, stubs: {
  '@/lib/seo/projects': { sitemapProjects: async () => [] },
  '@/lib/seo/headhunters': { indexableHeadhunterPages: async () => [], headhunterLandingServed: typeof served === 'function' ? served : async () => served },
} });

test('sitemap: the landing is listed with its modification date while the feature switch is on, and left out while it is off', async () => {
  const on = await loadSitemap(true).default();
  const listed = on.find((item) => item.url === `${ORIGIN}${PATH}`);
  assert.ok(listed, 'listed');
  assert.equal(listed.lastModified, entry.modified);
  const off = await loadSitemap(false).default();
  assert.equal(off.some((item) => item.url === `${ORIGIN}${PATH}`), false);
  assert.equal(off.length, on.length - 1, 'nothing else is left out');
  await assert.rejects(loadSitemap(async () => { throw new Error('switch unreadable'); }).default(), /switch unreadable/, 'an unreadable switch fails the sitemap instead of publishing a partial one');
  assert.deepEqual(plain(await loadSitemap(true, 'false').default()), [], 'nothing is listed while indexing is off');
});

function loadServed(config) {
  return loadModule('src/lib/seo/headhunters.ts', { env, stubs: {
    'firebase-admin/firestore': { FieldPath: { documentId: () => '__name__' } },
    '@/lib/db/headhunters': { getHeadhunterConfig: async () => { if (config instanceof Error) throw config; return config; } },
    '@/lib/db/firestore': { firestore: () => { throw new Error('the landing never reads Firestore'); } },
    '@/lib/security/marketplace-policy': { accountState: () => 'active' },
  } });
}

test('headhunterLandingServed: follows the feature switch and fails closed when it cannot be read', async () => {
  assert.equal(await loadServed({ enabled: true, applicationsOpen: false }).headhunterLandingServed(), true, 'closed applications still serve the information page');
  assert.equal(await loadServed({ enabled: false, applicationsOpen: true }).headhunterLandingServed(), false);
  await assert.rejects(loadServed(new Error('down')).headhunterLandingServed(), /down/);
});

test('llms.txt and llms-full.txt list the landing, and its text matches the page', () => {
  const llms = loadModule('src/lib/seo/llms.ts', { env });
  const index = llms.llmsTxt();
  const product = index.slice(index.indexOf('## Product'), index.indexOf('## Guides'));
  assert.ok(product.includes(`(${ORIGIN}${PATH})`), 'listed under Product');
  const full = llms.llmsFullTxt();
  const block = full.slice(full.indexOf(`### ${content.h1}`));
  assert.ok(block.length > 0 && full.includes(`### ${content.h1}`), 'the answer-first block is in llms-full.txt');
  assert.ok(block.includes(`Source: ${ORIGIN}${PATH}`));
  assert.ok(block.includes(`Last updated: ${entry.modified}`));
  assert.ok(block.includes(content.summary));
  for (const section of content.sections) assert.ok(block.includes(section.answer), `${section.id}: the direct answer`);
  for (const { question, answer } of content.faq) assert.ok(block.includes(answer), `FAQ: ${question}`);
});

test('footer and related links: the landing is one click from every page and from the pricing page', () => {
  const linkStub = { 'next/link': { __esModule: true, default: ({ href, children }) => createElement('a', { href }, children) } };
  const footer = loadModule('src/components/site-footer.tsx', { stubs: linkStub, env });
  const product = footer.footerGroups().find((group) => group.id === 'product');
  assert.deepEqual(plain(product.links.find((link) => link.href === PATH)), { href: PATH, label: 'לסוכנויות גיוס' });
  assert.ok(render(footer.SiteFooter()).includes(`href="${PATH}"`));
  const facts = load('src/lib/seo/facts.ts').membershipFacts({});
  const pricing = load('src/lib/seo/info-content.ts').pricingContent({ ...facts, billingAvailable: true });
  assert.ok(pricing.related.includes(PATH), 'the pricing page, where a recruiter looks for the price, points at it');
});

test('IndexNow: the landing can be announced, and no other account page can', () => {
  const { normalizeIndexNowUrls } = loadModule('src/lib/seo/indexnow.ts', { env });
  assert.deepEqual(plain(normalizeIndexNowUrls([`${ORIGIN}${PATH}`, `${ORIGIN}${PATH}#faq-heading`])), [`${ORIGIN}${PATH}`]);
  assert.deepEqual(plain(normalizeIndexNowUrls([`${ORIGIN}/profile/import`, `${ORIGIN}${PATH}/x`, `${ORIGIN}/profile`, `${ORIGIN}/messages`])), []);
});

// ---------------------------------------------------------------------------------------------
// The share card of the landing (og:image and twitter:image)
// ---------------------------------------------------------------------------------------------

const CARD_PATH = `${PATH}/opengraph-image`;
const platformCard = `${ORIGIN}/opengraph-image`;

test('share card: the landing declares its own card, and every other page keeps the platform card', () => {
  assert.equal(constants.HEADHUNTER_LANDING_CARD_PATH, CARD_PATH);
  assert.equal(entry.shareImage, CARD_PATH);
  assert.ok(existsSync(`${projectRoot}/src/app/profile/headhunter/opengraph-image.tsx`), 'the card route exists beside the page');
  const meta = registry.metadataFor(PATH);
  assert.equal(meta.openGraph.images[0].url, `${ORIGIN}${CARD_PATH}`);
  assert.equal(meta.twitter.images[0].url, `${ORIGIN}${CARD_PATH}`);
  assert.deepEqual(plain({ width: meta.openGraph.images[0].width, height: meta.openGraph.images[0].height }), { width: 1200, height: 630 });
  assert.equal(meta.openGraph.title, `${entry.title} | Freelance Place`, 'only the image is overridden: the title and description stay the registry ones');
  assert.equal(meta.alternates.canonical, `${ORIGIN}${PATH}`, 'canonical, hreflang and robots never change with the card');
  const others = registry.allPages().filter((other) => other.path !== PATH);
  assert.equal(others.some((other) => other.shareImage !== undefined), false, 'no other page declares a card of its own yet');
  for (const other of others) {
    const otherMeta = registry.metadataFor(other.path);
    assert.equal(otherMeta.openGraph.images[0].url, platformCard, other.path);
    assert.equal(otherMeta.twitter.images[0].url, platformCard, other.path);
  }
});

test('share card: the card URL is public like the landing for a request without a session, and private with one', () => {
  const site = load('src/lib/seo/site.ts');
  assert.equal(site.isPrivatePath(CARD_PATH), false);
  assert.equal(site.isPrivatePath(CARD_PATH, true), true);
  assert.equal(site.isPrivatePath(`${CARD_PATH}/x`), true, 'the carve-out is the exact path');
  assert.equal(site.isPrivatePath(`${PATH}/opengraph-image-2`), true);
  const robots = robotsHeader();
  assert.equal(robots(CARD_PATH), null, 'link previews and crawlers fetch it without a noindex header');
  assert.match(robots(CARD_PATH, { cookie: 'fz_session=abc' }), /noindex/);
  for (const path of site.signedOutPublicPaths) assert.ok(path === PATH || path === CARD_PATH, `${path} is a known public path under /profile`);
});

test('share card: its words are the landing headline cut into lines, plus one short line that restates what the page lists', () => {
  const { headline, line } = LANDING.card;
  assert.equal(headline.join(' '), content.h1, 'the card cannot drift from the h1');
  assert.ok(headline.length === 2 && headline.every((text) => text.trim() === text && text.length > 0));
  assert.ok(headline.every((text) => Array.from(text).length <= 28), 'each headline line fits the card on one line');
  assert.ok(line.length > 0 && Array.from(line).length <= 44);
  assert.doesNotMatch([...headline, line].join(' '), /\d/, 'no number is typed into the card: the rules live in the constants');
  assert.doesNotMatch([...headline, line].join(' '), /מובטח|מבטיח|הכי|מס׳ 1|מספר 1|ראשון|מוביל/, 'no superlative or promise');
  assert.match(line, /פרויקטים/);
  assert.ok(content.summary.includes('כל הפרויקטים ופרטי הקשר') && content.summary.includes('תג'), 'the line restates what the summary says the page has');
});

test('share card: 1200x630 PNG with the headline, the line and the page address, drawn in the brand fonts', async () => {
  const calls = [];
  class ImageResponse { constructor(element, options) { this.element = element; this.options = options; calls.push(this); } }
  const fonts = [{ name: 'Heebo', data: Buffer.alloc(1), weight: 700, style: 'normal' }, { name: 'Heebo', data: Buffer.alloc(1), weight: 800, style: 'normal' }];
  const route = loadModule('src/app/profile/headhunter/opengraph-image.tsx', { env, stubs: { 'next/og': { ImageResponse }, '@/lib/headhunters/og-font-loader': { loadCardFonts: async () => fonts } } });
  assert.deepEqual(plain(route.size), { width: 1200, height: 630 });
  assert.equal(route.contentType, 'image/png');
  assert.equal(route.dynamic, undefined, 'no request data: generated once, like the platform card');
  const response = await route.default();
  assert.equal(response, calls[0]);
  assert.equal(response.options.width, 1200);
  assert.equal(response.options.height, 630);
  assert.deepEqual(response.options.fonts.map((font) => [font.name, font.weight]), [['Heebo', 700], ['Heebo', 800]]);
  assert.deepEqual(plain(response.element.props.headline), plain(LANDING.card.headline));
  assert.equal(response.element.props.line, LANDING.card.line);
  assert.equal(response.element.props.address, 'freelance-place.com/profile/headhunter');
});

test('share card: Hebrew goes through the visual-order step, one unwrapped line each, and the headline size fits the longest line', () => {
  const card = loadModule('src/lib/headhunters/landing-card.tsx', { env });
  const { toVisualRtl } = loadModule('src/lib/headhunters/visual-text.ts', { env });
  const { headline, line } = LANDING.card;
  const html = render(createElement(card.LandingCardElement, { headline, line, address: 'freelance-place.com/profile/headhunter' }));
  for (const text of [...headline, line]) {
    assert.ok(html.includes(toVisualRtl(text)), `drawn in visual order: ${text}`);
    assert.notEqual(toVisualRtl(text), text, 'the visual order differs from the logical one, so Satori would otherwise mirror it');
  }
  assert.ok(html.includes('freelance-place.com/profile/headhunter'), 'the address is drawn as it is (Latin)');
  assert.equal(count(html, /white-space:nowrap/g), headline.length + 2, 'every text is a single unwrapped line');
  const size = card.headlineSize(headline);
  assert.ok(size >= 60 && size <= 92, `headline size ${size}`);
  assert.ok(card.headlineSize(['א'.repeat(60)]) >= 48, 'a very long headline never shrinks below the minimum');
  assert.ok(card.headlineSize(['א']) <= 92, 'a short one never exceeds the maximum');
});
