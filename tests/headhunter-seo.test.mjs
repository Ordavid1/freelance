import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts.mjs';
import { switchStub } from './helpers/runtime-switch.mjs';

// WP5: share metadata, the generated share card, the sitemap and llms-full sources, JSON-LD and IndexNow for minisites.

const SITE = 'https://freelance-place.com';
const env = { SITE_INDEXABLE: 'true', NEXT_PUBLIC_SITE_URL: SITE };
const plain = (value) => JSON.parse(JSON.stringify(value));
const stamp = (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms });

const site = loadModule('src/lib/seo/site.ts', { env });
const minisite = loadModule('src/lib/headhunters/minisite.ts', { env });
const seo = loadModule('src/lib/headhunters/seo.ts', { env });
const pings = loadModule('src/lib/headhunters/pings.ts', { env });

const record = (extra = {}) => ({
  ownerUid: 'hh1', status: 'approved', eligibleAt: 1, displayName: 'Acme HR', handle: 'acme-hr', kind: 'agency', tagline: 'We place developers',
  contact: { email: 'jobs@acme.example', phone: '+972-3-555-0100', whatsapp: '972501234567', website: 'https://acme.example', linkedin: 'https://www.linkedin.com/company/acme' },
  counters: { published: 12 }, version: 1, ...extra,
});
const publicProject = (index, extra = {}) => ({ slug: `open-${index}`, title: `פרויקט ${index}`, category: 'פיתוח אתרים', description: 'תיאור הפרויקט המלא', budget: '₪1,000', skills: [], status: 'open', ...extra });
const deps = (over = {}) => ({
  enabled: async () => true,
  lookup: async (handle) => (handle === 'acme-hr' ? { kind: 'active', record: record() } : null),
  accountActive: async () => true,
  projects: async () => ({ openCount: 2, publishedCount: 3, items: [publicProject(1), publicProject(2)], closed: [] }),
  ...over,
});
const pageOf = (over, handle = 'acme-hr', page) => minisite.resolveMinisite(handle, page, deps(over));

// ---------------------------------------------------------------------------------------------
// Share override
// ---------------------------------------------------------------------------------------------

test('pageMetadata: callers without a share override are unchanged', () => {
  const meta = site.pageMetadata('כותרת', 'תיאור', '/about');
  assert.equal(meta.openGraph.title, 'כותרת | Freelance Place');
  assert.equal(meta.openGraph.images[0].url, `${SITE}/opengraph-image`);
  assert.equal(meta.twitter.images[0].url, `${SITE}/opengraph-image`);
});

test('pageMetadata: the share override replaces only the og and twitter tags; canonical, hreflang and robots stay shared', () => {
  const base = site.pageMetadata('כותרת', 'תיאור', '/acme-hr', true, { absoluteTitle: true });
  const meta = site.pageMetadata('כותרת', 'תיאור', '/acme-hr', true, { absoluteTitle: true, share: { title: 'Share title', description: 'Share description', image: `${SITE}/acme-hr/opengraph-image` } });
  assert.deepEqual(plain(meta.alternates), plain(base.alternates));
  assert.deepEqual(plain(meta.robots), plain(base.robots));
  assert.equal(meta.description, 'תיאור');
  assert.equal(meta.openGraph.url, `${SITE}/acme-hr`);
  for (const card of [meta.openGraph, meta.twitter]) {
    assert.equal(card.title, 'Share title');
    assert.equal(card.description, 'Share description');
    assert.equal(card.images[0].url, `${SITE}/acme-hr/opengraph-image`);
  }
});

test('minisiteMetadata: og and twitter use the resolved share values and the per-handle card; canonical stays /handle', async () => {
  const custom = await pageOf({ lookup: async () => ({ kind: 'active', record: record({ share: { title: 'Custom title', description: 'Custom description' } }) }) });
  const meta = minisite.minisiteMetadata(custom);
  for (const card of [meta.openGraph, meta.twitter]) {
    assert.equal(card.title, 'Custom title');
    assert.equal(card.description, 'Custom description');
    assert.equal(card.images[0].url, `${SITE}/acme-hr/opengraph-image`);
  }
  assert.equal(meta.alternates.canonical, `${SITE}/acme-hr`);
  const fallback = minisite.minisiteMetadata(await pageOf());
  assert.equal(fallback.openGraph.title, 'Acme HR | Freelance Place');
  assert.match(fallback.twitter.description, /We place developers/);
  assert.equal(minisite.minisiteMetadata(await pageOf({}, 'acme-hr', '1')).alternates.canonical, `${SITE}/acme-hr`);
});

// ---------------------------------------------------------------------------------------------
// The generated card route
// ---------------------------------------------------------------------------------------------

function loadCard({ over, reads } = {}) {
  const calls = [];
  class ImageResponse { constructor(element, options) { this.element = element; this.options = options; calls.push(this); } }
  const counted = deps({ ...over });
  const route = loadModule('src/app/[handle]/opengraph-image.tsx', { env, stubs: {
    'next/og': { ImageResponse },
    '@/lib/headhunters/og-font-loader': { loadCardFonts: async () => [{ name: 'Heebo', data: Buffer.alloc(1), weight: 700, style: 'normal' }, { name: 'Heebo', data: Buffer.alloc(1), weight: 800, style: 'normal' }] },
    '@/lib/headhunters/server-deps': { minisiteDeps: { ...counted, lookup: async (handle) => { reads?.push(handle); return counted.lookup(handle); } } },
  } });
  return { route, calls };
}
const cardRoute = (handle) => ({ params: Promise.resolve({ handle }) });

test('share card: a live handle gets a 1200x630 card with the name, the open count and the page address', async () => {
  const { route, calls } = loadCard();
  const response = await route.default(cardRoute('acme-hr'));
  assert.equal(response, calls[0]);
  assert.deepEqual(plain(route.size), { width: 1200, height: 630 });
  assert.equal(route.contentType, 'image/png');
  assert.equal(response.options.width, 1200);
  assert.deepEqual(response.options.fonts.map((font) => [font.name, font.weight]), [['Heebo', 700], ['Heebo', 800]]);
  assert.match(response.options.headers['Cache-Control'], /s-maxage=3600/);
  assert.doesNotMatch(response.options.headers['Cache-Control'], /immutable/);
  const html = renderToStaticMarkup(response.element);
  assert.match(html, /Acme HR/);
  // Satori has no bidi support: the Hebrew line is drawn in visual order (see visual-text.ts).
  const reversed = (word) => Array.from(word).reverse().join('');
  assert.ok(html.includes(`${['לפרילנסרים', 'פתוחים', 'פרויקטים'].map(reversed).join(' ')} 2`), html);
  assert.match(html, /freelance-place\.com\/acme-hr/);
  assert.doesNotMatch(html, /jobs@acme|972|linkedin|tel:/i, 'no contact data on the card');
});

test('share card: malformed, unknown, non-live and feature-off handles are a 404 and a malformed one reads nothing', async () => {
  const reads = [];
  const { route } = loadCard({ reads });
  for (const handle of ['.env', 'ab', 'Acme-HR', 'acme--hr', '-acme', 'a'.repeat(31), 'acme hr', '../etc', '%2e%2e']) {
    const response = await route.default(cardRoute(handle));
    assert.equal(response.status, 404, handle);
  }
  assert.deepEqual(reads, [], 'format is checked before any read');
  assert.equal((await route.default(cardRoute('unknown-one'))).status, 404);
  const notLive = (over) => loadCard({ over }).route.default(cardRoute('acme-hr'));
  for (const status of ['draft', 'pending', 'suspended', 'rejected']) {
    assert.equal((await notLive({ lookup: async () => ({ kind: 'active', record: record({ status }) }) })).status, 404, status);
  }
  assert.equal((await notLive({ lookup: async () => ({ kind: 'active', record: record({ eligibleAt: null }) }) })).status, 404, 'not eligible');
  assert.equal((await notLive({ accountActive: async () => false })).status, 404, 'restricted account');
  assert.equal((await notLive({ enabled: async () => false })).status, 404, 'feature off');
  assert.equal((await notLive({ lookup: async () => ({ kind: 'redirect', to: 'acme-hr' }) })).status, 404, 'retired handle');
  assert.equal((await notLive({ lookup: async () => { throw new Error('down'); } })).status, 404, 'a failed read');
});

test('share card: long names are clamped and rendered as text', async () => {
  const long = '<img src=x onerror=alert(1)>' + 'א'.repeat(200);
  const { route } = loadCard({ over: { lookup: async () => ({ kind: 'active', record: record({ displayName: long }) }) } });
  const html = renderToStaticMarkup((await route.default(cardRoute('acme-hr'))).element);
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.length < 3000);
});

test('share card text: Hebrew is put in visual order for Satori, Latin and digits keep theirs', () => {
  const { toVisualRtl } = loadModule('src/lib/headhunters/visual-text.ts');
  assert.equal(toVisualRtl('אבג'), 'גבא');
  assert.equal(toVisualRtl('6 אב'), 'בא 6', 'a number leads on the right');
  assert.equal(toVisualRtl('אב Acme-HR גד'), 'דג Acme-HR בא');
  assert.equal(toVisualRtl('(אב)'), '(בא)', 'brackets mirror');
  assert.equal(toVisualRtl('Acme HR'), 'Acme HR');
  assert.equal(toVisualRtl(''), '');
  assert.equal(toVisualRtl('\u05E9\u05C1\u05DC'), '\u05DC\u05E9\u05C1', 'a combining mark stays with its letter');
});

// ---------------------------------------------------------------------------------------------
// Sitemap and llms-full sources
// ---------------------------------------------------------------------------------------------

// A minimal Firestore: equality filters, document-ID order, startAfter and limit, plus getAll.
function fakeDb({ headhunters = {}, security = {}, projects = {}, failOn } = {}) {
  const tables = { headhunters, accountSecurity: security, projects };
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data, get: (field) => data?.[field] });
  const query = (name, filters = [], after, max = Infinity) => ({
    where: (field, op, value) => query(name, [...filters, [field, value]], after, max),
    orderBy: () => query(name, filters, after, max),
    startAfter: (cursor) => query(name, filters, cursor, max),
    limit: (n) => query(name, filters, after, n),
    get: async () => {
      if (failOn === name) throw new Error('read failed');
      const docs = Object.entries(tables[name]).filter(([id, data]) => filters.every(([field, value]) => data[field] === value) && (after === undefined || id > after)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, max).map(([id, data]) => snap(id, data));
      return { docs, size: docs.length };
    },
  });
  return {
    collection: (name) => ({ ...query(name), doc: (id) => ({ collection: name, id }) }),
    getAll: async (...refs) => refs.map((ref) => snap(ref.id, tables[ref.collection][ref.id])),
  };
}
function loadSource(db, { enabled = true } = {}) {
  return loadModule('src/lib/seo/headhunters.ts', { env, stubs: {
    'firebase-admin/firestore': { FieldPath: { documentId: () => '__name__' } },
    '@/lib/db/headhunters': { getHeadhunterConfig: async () => ({ enabled }) },
    '@/lib/db/firestore': { firestore: () => db },
    '@/lib/security/marketplace-policy': { accountState: (value) => (value === undefined || value === 'active' ? 'active' : 'suspended') },
  } });
}
const hh = (handle, extra = {}) => ({ status: 'approved', eligibleAt: 1, displayName: `Agency ${handle}`, handle, updatedAt: stamp(1_000), ...extra });
const open = (ownerUid, extra = {}) => ({ ownerUid, status: 'open', title: 'פרויקט', description: 'תיאור מלא', updatedAt: stamp(5_000), ...extra });
const world = () => fakeDb({
  headhunters: {
    a1: hh('alpha-hr'), b2: hh('bravo-hr', { updatedAt: stamp(9_000) }), c3: hh('charlie-hr'), d4: hh('delta-hr', { eligibleAt: null }),
    e5: hh('echo-hr', { status: 'suspended' }), f6: hh('foxtrot-hr'), g7: hh('golf-hr'), h8: hh('hotel-hr', { handle: 'Bad Handle' }),
  },
  security: { f6: { state: 'suspended' } },
  projects: {
    p1: open('a1'), p2: open('a1', { updatedAt: stamp(7_000) }), p3: open('a1', { status: 'closed', updatedAt: stamp(99_000) }),
    p4: open('b2', { updatedAt: stamp(2_000) }),
    p5: open('c3', { status: 'closed' }),
    p6: open('d4'), p7: open('e5'), p8: open('f6'),
    p9: open('h8'),
    // A headhunter-owned synthetic project (impossible through the API) must not count: golf has only this one.
    p10: open('g7', { sample: true }), p11: open('g7', { owner: { kind: 'ai-agent' } }), p12: open('g7', { unreal: true }),
  },
});

test('indexableHeadhunterPages: only approved, eligible, active accounts with an open project; page 1 only', async () => {
  const pages = await loadSource(world()).indexableHeadhunterPages();
  assert.deepEqual(plain(pages.map(({ handle, openProjects }) => [handle, openProjects])), [['alpha-hr', 2], ['bravo-hr', 1]]);
  const alpha = pages.find((page) => page.handle === 'alpha-hr');
  assert.equal(alpha.lastModified.getTime(), 7_000, 'newest open project change, a closed project does not count');
  assert.equal(pages.find((page) => page.handle === 'bravo-hr').lastModified.getTime(), 9_000, 'the record update when it is newer');
  for (const page of pages) assert.deepEqual(Object.keys(page).sort(), ['handle', 'lastModified', 'name', 'openProjects', 'path']);
});

test('indexableHeadhunterPages: none while the feature switch is off, and a failed read fails closed', async () => {
  assert.deepEqual(plain(await loadSource(world(), { enabled: false }).indexableHeadhunterPages()), []);
  for (const failOn of ['headhunters', 'accountSecurity', 'projects']) {
    const db = world();
    const failing = fakeDb({ ...{ headhunters: { a1: hh('alpha-hr') }, security: {}, projects: { p1: open('a1') } }, failOn });
    if (failOn === 'accountSecurity') failing.getAll = async () => { throw new Error('read failed'); };
    await assert.rejects(loadSource(failing).indexableHeadhunterPages(), /read failed/, failOn);
    void db;
  }
});

test('indexableHeadhunterEntries: the single public-state predicate decides', () => {
  const row = (over) => ({ handle: 'acme-hr', displayName: 'Acme', status: 'approved', eligible: true, accountActive: true, openProjects: 1, ...over });
  assert.equal(seo.indexableHeadhunterEntries([row()]).length, 1);
  for (const over of [{ status: 'pending' }, { eligible: false }, { accountActive: false }, { openProjects: 0 }, { handle: '../x' }, { displayName: ' ' }]) {
    assert.equal(seo.indexableHeadhunterEntries([row(over)]).length, 0, JSON.stringify(over));
  }
});

function loadSitemap({ agencies, projects = [], indexing = 'true', landing = true }) {
  const sitemapEnv = { ...env, SITE_INDEXABLE: indexing };
  return loadModule('src/app/sitemap.ts', { env: sitemapEnv, stubs: {
    '@/lib/seo/projects': { sitemapProjects: async () => projects },
    '@/lib/seo/headhunters': { indexableHeadhunterPages: agencies, headhunterLandingServed: async () => landing },
    ...switchStub(),
  } });
}

test('sitemap: lists the indexable minisites at /handle with lastmod, next to the projects', async () => {
  const sitemap = loadSitemap({ agencies: async () => [{ handle: 'alpha-hr', path: '/alpha-hr', name: 'Alpha', openProjects: 2, lastModified: new Date(7_000) }, { handle: 'bravo-hr', path: '/bravo-hr', name: 'Bravo', openProjects: 1 }], projects: [{ slug: 'p-1' }] });
  const entries = await sitemap.default();
  const alpha = entries.find((entry) => entry.url === `${SITE}/alpha-hr`);
  assert.equal(alpha.lastModified.getTime(), 7_000);
  assert.ok(entries.some((entry) => entry.url === `${SITE}/bravo-hr` && !('lastModified' in entry)));
  assert.ok(entries.some((entry) => entry.url === `${SITE}/projects/p-1`));
  assert.ok(entries.every((entry) => !entry.url.includes('?')), 'no query URLs: later pages are noindex');
});

test('sitemap: a failed minisite read fails the sitemap, and nothing is read or listed while indexing is off', async () => {
  await assert.rejects(loadSitemap({ agencies: async () => { throw new Error('read failed'); } }).default(), /read failed/);
  let reads = 0;
  assert.deepEqual(plain(await loadSitemap({ agencies: async () => { reads += 1; return []; }, indexing: 'false' }).default()), []);
  assert.equal(reads, 0);
});

test('llms-full: an "Agency pages" section with name, URL and open-project count only', () => {
  const llms = loadModule('src/lib/seo/llms.ts', { env });
  const text = llms.llmsFullTxt(undefined, [{ handle: 'alpha-hr', name: 'Alpha [HR]', openProjects: 2 }, { handle: 'bravo-hr', name: 'Bravo', openProjects: 1 }]);
  const section = text.split('\n## ').find((block) => block.startsWith('Agency pages'));
  assert.ok(section, 'the section exists');
  assert.deepEqual(section.trim().split('\n').filter(Boolean), ['Agency pages', `- [Alpha \\[HR\\]](${SITE}/alpha-hr): 2 open projects`, `- [Bravo](${SITE}/bravo-hr): 1 open project`]);
  assert.doesNotMatch(section, /@|tel:|mailto:|wa\.me|linkedin/i);
  assert.equal(llms.llmsFullTxt().includes('Agency pages'), false, 'no section without agencies');
  assert.equal(llms.llmsTxt().includes('Agency'), false, 'llms.txt is unchanged (decision D8 pending)');
});

// ---------------------------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------------------------

test('JSON-LD: page 1 has WebPage, CollectionPage with an ItemList of the open projects, and BreadcrumbList', async () => {
  const graph = seo.minisiteStructuredData(await pageOf());
  const nodes = graph['@graph'];
  assert.deepEqual(plain(nodes.map((node) => node['@type'])), ['WebPage', 'CollectionPage', 'BreadcrumbList']);
  const collection = nodes[1];
  assert.equal(collection.url, `${SITE}/acme-hr`);
  assert.deepEqual(plain(collection.mainEntity.itemListElement.map((item) => item.url)), [`${SITE}/projects/open-1`, `${SITE}/projects/open-2`]);
  assert.deepEqual(plain(nodes[2].itemListElement.map((item) => item.item)), [`${SITE}/`, `${SITE}/acme-hr`]);
});

test('JSON-LD: no Organization, LocalBusiness, JobPosting, Review, Rating or contact data', async () => {
  const text = JSON.stringify(seo.minisiteStructuredData(await pageOf()));
  assert.doesNotMatch(text, /"@type":"(Organization|LocalBusiness|JobPosting|Review|Rating|AggregateRating|ContactPoint|Person)"/);
  assert.doesNotMatch(text, /jobs@acme|\+972|972501234567|linkedin|acme\.example|"(email|telephone|sameAs|contactPoint)"/i);
  assert.doesNotMatch(text, /"@id":"[^"]*#organization"[^}]*"@type"/, 'no organization node, only references to the site publisher');
});

test('JSON-LD: not emitted for later pages, empty pages or non-live pages; a synthetic project is dropped from the list', async () => {
  assert.equal(seo.minisiteStructuredData(await pageOf({}, 'acme-hr', '1')) !== null, true);
  assert.equal(seo.minisiteStructuredData({ kind: 'not-found' }), null);
  const empty = await pageOf({ projects: async () => ({ openCount: 0, publishedCount: 3, items: [], closed: [] }) });
  assert.equal(seo.minisiteStructuredData(empty), null);
  const page2 = await pageOf({ projects: async () => ({ openCount: 40, publishedCount: 40, items: [publicProject(30)], closed: [] }) }, 'acme-hr', '2');
  assert.equal(seo.minisiteStructuredData(page2), null);
  const mixed = await pageOf({ projects: async () => ({ openCount: 3, publishedCount: 3, items: [publicProject(1), publicProject(2, { sample: true }), publicProject(3, { ownerKind: 'ai-agent' })], closed: [] }) });
  const urls = seo.minisiteStructuredData(mixed)['@graph'][1].mainEntity.itemListElement.map((item) => item.url);
  assert.deepEqual(plain(urls), [`${SITE}/projects/open-1`]);
});

test('the minisite page renders the JSON-LD once, with the breadcrumb only in the graph', async () => {
  const data = { openCount: 1, publishedCount: 1, items: [publicProject(1)], closed: [] };
  const ui = {
    'next/link': { __esModule: true, default: ({ href, children }) => createElement('a', { href }, children) },
    'next/image': { __esModule: true, default: ({ src, alt }) => createElement('img', { src, alt }) },
    '@/components/discovery/public-content': { PublicHeader: () => null },
    '@/lib/headhunters/server-deps': { minisiteDeps: deps({ projects: async () => data }) },
  };
  const page = loadModule('src/app/[handle]/page.tsx', { env, stubs: ui });
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ handle: 'acme-hr' }), searchParams: Promise.resolve({}) }));
  assert.equal(html.match(/application\/ld\+json/g).length, 1);
  assert.equal(html.match(/BreadcrumbList/g).length, 1);
});

test('a headhunter-owned synthetic project never reaches the sitemap, JSON-LD or llms', async () => {
  // Sitemap source: golf-hr owns only showcase records, so it has no open project and is not listed.
  const pages = await loadSource(world()).indexableHeadhunterPages();
  assert.ok(!pages.some((page) => page.handle === 'golf-hr'));
  // The projects sitemap uses the same predicate.
  const { isDiscoverableProject } = loadModule('src/lib/seo/publication.ts');
  for (const extra of [{ sample: true }, { unreal: true }, { owner: { kind: 'ai-agent' } }]) assert.equal(isDiscoverableProject(open('g7', extra)), false);
});

// ---------------------------------------------------------------------------------------------
// IndexNow
// ---------------------------------------------------------------------------------------------

test('minisitePingUrls: absolute minisite URLs only, deduplicated, malformed handles dropped', () => {
  assert.deepEqual(plain(pings.minisitePingUrls(['new-name', 'old-name', 'new-name', '../x', null, undefined, 'A'])), [`${SITE}/new-name`, `${SITE}/old-name`]);
  assert.equal(pings.liveMinisiteHandle({ get: (field) => ({ status: 'approved', eligibleAt: 1, handle: 'acme-hr' })[field] }), 'acme-hr');
  assert.equal(pings.liveMinisiteHandle({ get: (field) => ({ status: 'approved', fastTrack: true, handle: 'acme-hr' })[field] }), null, 'a fast-track trial page is noindex: not announced');
  assert.equal(pings.liveMinisiteHandle({ get: (field) => ({ status: 'pending', handle: 'acme-hr' })[field] }), null);
  assert.equal(pings.liveMinisiteHandle(null), null);
});

function loadAnnounce(log) {
  return loadModule('src/lib/headhunters/indexnow.ts', { env, stubs: {
    'next/server': { after: (task) => log.push(task) },
    '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { log.push(urls); } },
  } });
}

test('IndexNow: a project of a live headhunter also announces the minisite; nothing extra without one', () => {
  const events = loadModule('src/lib/projects/events.ts', { env, stubs: { 'next/cache': { revalidateTag() {} }, 'next/server': { after() {} } } });
  const record = { status: 'open', title: 'פרויקט', description: 'תיאור מלא' };
  assert.ok(events.projectEventUrls('p-1', record, { minisiteHandle: 'acme-hr' }).includes(`${SITE}/acme-hr`));
  assert.ok(!events.projectEventUrls('p-1', record).some((url) => url.endsWith('/acme-hr')));
  assert.ok(!events.projectEventUrls('p-1', record, { minisiteHandle: '../x' }).some((url) => url.includes('..')));
});

test('IndexNow: a headhunter decision announces the minisite URL', async () => {
  const submitted = [];
  const events = loadModule('src/lib/headhunters/events.ts', { env, stubs: { 'next/server': { after: (task) => task() }, '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { submitted.push(urls); } } } });
  for (const action of ['approve', 'suspend', 'reject', 'reinstate']) events.onHeadhunterDecision({ uid: 'u1', action, handle: 'acme-hr', displayName: 'Acme' });
  assert.deepEqual(plain(submitted), Array.from({ length: 4 }, () => [`${SITE}/acme-hr`]));
});

test('IndexNow: announceMinisites submits every URL once, after the response', async () => {
  const log = [];
  loadAnnounce(log).announceMinisites(['new-name', 'old-name']);
  assert.equal(log.length, 1);
  const submitted = [];
  const mod = loadModule('src/lib/headhunters/indexnow.ts', { env, stubs: { 'next/server': { after: (task) => task() }, '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { submitted.push(urls); } } } });
  mod.announceMinisites(['new-name', 'old-name']);
  mod.announceMinisites([]);
  assert.deepEqual(plain(submitted), [[`${SITE}/new-name`, `${SITE}/old-name`]]);
});

test('IndexNow: a rename announces both the new and the old URL; a header edit of a live record announces the page', async () => {
  const submitted = [];
  const stubs = (extra) => ({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) }, after: (task) => task() },
    '@/lib/seo/indexnow': { submitIndexNow: async (urls) => { submitted.push(urls); } },
    '@/lib/auth/session': { getCurrentUser: async () => ({ uid: 'u1' }), isSameOrigin: () => true },
    '@/lib/security/rate-limit': { enforceActionLimit: async () => null },
    '@/lib/security/marketplace-policy': { accountWriteDenied: async () => null },
    ...extra,
  });
  const gate = async () => ({ ok: true, config: { enabled: true, applicationsOpen: true } });
  const renameRoute = loadModule('src/app/api/headhunter/handle/route.ts', { env, stubs: stubs({
    '@/lib/db/headhunters': { headhunterGate: gate, invalidateHeadhunterCache() {}, checkHandleAvailability: async () => ({ ok: true }), renameHandle: async () => ({ ok: true, handle: 'new-name', previous: 'old-name', status: 'approved', eligible: true }) },
  }) });
  const response = await renameRoute.POST(new Request(`${SITE}/api/headhunter/handle`, { method: 'POST', body: JSON.stringify({ handle: 'new-name' }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(plain(submitted), [[`${SITE}/new-name`, `${SITE}/old-name`]]);

  submitted.length = 0;
  const live = record();
  const edit = (result) => loadModule('src/app/api/headhunter/route.ts', { env, stubs: stubs({
    '@/lib/db/headhunters': { headhunterGate: gate, invalidateHeadhunterCache() {}, applyAsHeadhunter: async () => ({}), isAccountActive: async () => true, getHeadhunter: async () => live, updateHeadhunter: async () => result },
  }) });
  const patch = (route) => route.PATCH(new Request(`${SITE}/api/headhunter`, { method: 'PATCH', body: JSON.stringify({ tagline: 'New tagline' }) }));
  assert.equal((await patch(edit({ ok: true, status: 'approved', handle: 'acme-hr', statusChanged: false, eligible: true }))).status, 200);
  assert.deepEqual(plain(submitted), [[`${SITE}/acme-hr`]]);
  submitted.length = 0;
  assert.equal((await patch(edit({ ok: true, status: 'approved', handle: 'acme-hr', statusChanged: false, eligible: false }))).status, 200);
  assert.deepEqual(submitted, [], 'a trial page (not eligible) announces nothing');
  submitted.length = 0;
  assert.equal((await patch(edit({ ok: true, status: 'draft', handle: 'acme-hr', statusChanged: false }))).status, 200);
  assert.deepEqual(submitted, [], 'a record without a public page announces nothing');
});

test('no new file builds an origin by hand', async () => {
  const { readFileSync } = await import('node:fs');
  const { projectRoot } = await import('./helpers/load-ts.mjs');
  for (const file of ['src/lib/headhunters/seo.ts', 'src/lib/headhunters/og.ts', 'src/lib/headhunters/og-card.tsx', 'src/lib/headhunters/og-font-loader.ts', 'src/lib/headhunters/pings.ts', 'src/lib/headhunters/indexnow.ts', 'src/lib/seo/headhunters.ts', 'src/app/[handle]/opengraph-image.tsx']) {
    assert.doesNotMatch(readFileSync(`${projectRoot}/${file}`, 'utf8').replaceAll('https://schema.org', ''), /https?:\/\/|localhost|freelance-place\.com/i, file);
  }
});
