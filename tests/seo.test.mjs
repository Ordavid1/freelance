import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import { loadModule } from './helpers/load-ts.mjs';

// Run the actual TypeScript helpers with a mocked data boundary; no live account
// or Firestore writes are needed to exercise publication and outage behavior.
function load(path, stubs = {}, env = { SITE_INDEXABLE: 'true' }) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, process: { env }, console, require(name) { if (name in stubs) return stubs[name]; throw new Error(`Unexpected dependency: ${name}`); } }, { filename: path });
  return module.exports;
}
const publication = load('src/lib/seo/publication.ts');
const site = load('src/lib/seo/site.ts');
// content.ts and the registry import sibling modules, so they use the shared project loader.
const content = loadModule('src/lib/seo/content.ts');
const registry = loadModule('src/lib/seo/registry.ts');
const publicRecord = { status: 'open', title: 'A real project', description: 'A complete brief' };

test('publication excludes drafts, private/member-only records, showcase projects and empty content', () => {
  assert.equal(publication.isDiscoverableProject(publicRecord), true);
  assert.equal(publication.isDiscoverableProject({ ...publicRecord, visibility: 'public' }), true);
  for (const change of [{ status: 'draft' }, { status: 'closed' }, { visibility: 'private' }, { visibility: 'members' }, { sample: true }, { title: '' }, { description: ' ' }]) {
    assert.equal(publication.isDiscoverableProject({ ...publicRecord, ...change }), false);
  }
});

// Showcase projects (seeded, published by an AI agent) are product content, never SEO content. Every
// marker the seeding uses, alone or together, keeps a record out of the index, on a stored record and on
// the public model alike.
test('showcase projects are never discoverable, however they are marked', () => {
  const showcase = [
    { sample: true },
    { sample: true, owner: { kind: 'ai-agent' } },
    { sample: true, unreal: true, owner: { kind: 'ai-agent', name: 'x' } },
    { owner: { kind: 'ai-agent' } },
    { unreal: true },
    { ownerKind: 'ai-agent' },
    { sample: true, ownerKind: 'ai-agent' },
  ];
  for (const marker of showcase) {
    assert.equal(publication.isSyntheticProject({ ...publicRecord, ...marker }), true, JSON.stringify(marker));
    assert.equal(publication.isDiscoverableProject({ ...publicRecord, ...marker }), false, JSON.stringify(marker));
    // Inside the product they stay listable, with their label.
    assert.equal(publication.isListableProject({ ...publicRecord, ...marker }), true, JSON.stringify(marker));
  }
  for (const marker of [{}, { sample: false }, { owner: { kind: 'human' } }, { owner: null }, { ownerKind: undefined }]) {
    assert.equal(publication.isSyntheticProject({ ...publicRecord, ...marker }), false, JSON.stringify(marker));
    assert.equal(publication.isDiscoverableProject({ ...publicRecord, ...marker }), true, JSON.stringify(marker));
  }
});

test('listable projects include samples and closed records but never private or empty ones', () => {
  assert.equal(publication.isListableProject(publicRecord), true);
  assert.equal(publication.isListableProject({ ...publicRecord, sample: true }), true);
  assert.equal(publication.isDiscoverableProject({ ...publicRecord, sample: true }), false);
  assert.equal(publication.isDiscoverableProject({ ...publicRecord, sample: true, owner: { kind: 'ai-agent' } }), false);
  assert.equal(publication.isDiscoverableProject({ ...publicRecord, sample: true, owner: { kind: 'human' } }), false);
  assert.equal(publication.isListableProject({ ...publicRecord, status: 'closed' }), true);
  assert.equal(publication.isDiscoverableProject({ ...publicRecord, status: 'closed' }), false);
  for (const change of [{ status: 'draft' }, { status: 'archived' }, { visibility: 'private' }, { visibility: 'members' }, { title: '' }, { description: ' ' }]) {
    assert.equal(publication.isListableProject({ ...publicRecord, ...change }), false);
  }
});

test('canonical URLs reject external inputs and include per-page social metadata', () => {
  const metadata = site.pageMetadata('Example', 'Description', '/alternatives/xplace');
  assert.equal(metadata.alternates.canonical, 'https://freelance-place.com/alternatives/xplace');
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.equal(metadata.robots.index, true);
  assert.throws(() => site.absoluteUrl('//attacker.test/'));
  assert.throws(() => load('src/lib/seo/site.ts', {}, { NEXT_PUBLIC_SITE_URL: 'https://freelance-place.com/a' }));
  assert.equal(site.pageMetadata('Sample', 'Example', '/projects/sample', false).robots.index, false);
});

test('JSON-LD escapes script injection and round-trips text', () => {
  const unsafe = { text: '</script><script>alert(1)</script>&\u2028\u2029' };
  const output = site.serializeJsonLd(unsafe);
  assert.equal(output.includes('<'), false);
  assert.equal(output.includes('&'), false);
  assert.deepEqual(JSON.parse(output), unsafe);
});

test('preview environment blocks crawling and production keeps render assets crawlable', () => {
  const preview = load('src/lib/seo/site.ts', {}, {});
  // robots.ts imports the crawler registry, so it is loaded with the project loader.
  const robots = loadModule('src/app/robots.ts', { env: {} }).default();
  assert.equal(robots.rules.disallow, '/');
  assert.equal(preview.pageMetadata('Preview', 'Not public', '/').robots.index, false);
  const prod = loadModule('src/app/robots.ts').default();
  // The wildcard group comes first; the named crawler groups are covered by tests/seo-crawlers.test.mjs.
  const wildcard = prod.rules[0];
  assert.equal(wildcard.userAgent, '*');
  assert.equal(wildcard.allow, '/');
  assert.equal(wildcard.disallow.includes('/_next/'), false);
  assert.equal(wildcard.disallow.includes('/messages'), false);
  assert.equal(prod.sitemap, 'https://freelance-place.com/sitemap.xml');
});

test('canonical host redirects preserve path/query and account or alternate hosts are noindex', () => {
  const { proxy } = load('src/proxy.ts', { 'next/server': { NextResponse }, '@/lib/seo/site': site });
  const request = (host, path) => new NextRequest(`https://${host}${path}`, { headers: { host } });
  const redirect = proxy(request('www.freelance-place.com', '/alternatives/xplace?utm_source=test'));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://freelance-place.com/alternatives/xplace?utm_source=test');
  for (const path of ['/messages', '/membership', '/profile/import', '/projects/new', '/signin', '/api/marketplace/projects', '/?search=react']) {
    assert.match(proxy(request('freelance-place.com', path)).headers.get('x-robots-tag'), /noindex/);
  }
  assert.match(proxy(request('preview.run.app', '/')).headers.get('x-robots-tag'), /noindex/);
  assert.equal(proxy(request('freelance-place.com', '/?utm_source=test')).headers.get('x-robots-tag'), null);
});

function projectModule(batches, failure = false, open = []) {
  let calls = 0;
  const query = {
    where: () => query, orderBy: () => query, limit: () => query,
    startAfter(cursor) { assert.equal(typeof cursor, 'string'); return query; },
    async get() { if (failure) throw new Error('Database unavailable'); return batches[calls++]; },
  };
  const helpers = load('src/lib/seo/projects.ts', {
    'server-only': {}, react: { cache: (fn) => fn },
    'firebase-admin/firestore': { FieldPath: { documentId: () => '__name__' } },
    '@/lib/db/firestore': { firestore: () => ({ collection: () => query }) },
    '@/lib/db/projects': { getOpenProject: async () => null, listOpenProjects: async () => open },
    '@/lib/data': { getProject: () => undefined }, './publication': publication,
  });
  return { ...helpers, count: () => calls };
}
const doc = (id, extra = {}) => ({ id, data: () => ({ ...publicRecord, ...extra }) });

test('sitemap reads beyond the feed limit, paginates, and excludes private/demo data', async () => {
  const first = Array.from({ length: 1000 }, (_, i) => doc(`p-${i}`));
  const helpers = projectModule([
    { size: 1000, docs: first },
    { size: 4, docs: [doc('last'), doc('private', { visibility: 'private' }), doc('sample', { sample: true }), doc('members', { visibility: 'members' })] },
  ]);
  const entries = await helpers.sitemapProjects();
  assert.equal(entries.length, 1001);
  assert.equal(entries.at(-1).slug, 'last');
  assert.equal(helpers.count(), 2);
});

test('sitemap leaves out every kind of showcase record, however it is marked', async () => {
  const helpers = projectModule([{ size: 7, docs: [
    doc('real'),
    doc('seed-sample', { sample: true }),
    doc('seed-unreal', { unreal: true }),
    doc('seed-agent', { sample: true, unreal: true, owner: { kind: 'ai-agent', name: 'סוכן' } }),
    doc('owner-only', { owner: { kind: 'ai-agent' } }),
    doc('human-owner', { owner: { kind: 'human' } }),
    doc('closed', { status: 'closed' }),
  ] }]);
  assert.deepEqual(Array.from(await helpers.sitemapProjects(), (entry) => entry.slug), ['real', 'human-owner']);
});

test('public discovery lists drop showcase projects even if the data layer returns them', async () => {
  const real = { slug: 'real', title: 'A real project', description: 'A complete brief', status: 'open', skills: [] };
  const open = [
    real,
    { ...real, slug: 'sample', sample: true },
    { ...real, slug: 'agent', sample: true, ownerKind: 'ai-agent' },
    { ...real, slug: 'agent-only', ownerKind: 'ai-agent' },
    { ...real, slug: 'closed', status: 'closed' },
    { ...real, slug: 'untitled', title: ' ' },
  ];
  assert.deepEqual(Array.from(await projectModule([], false, open).discoveryProjects(), (project) => project.slug), ['real']);
  assert.equal((await projectModule([], false, []).discoveryProjects()).length, 0);
});

test('sitemap failures propagate and preview never touches the database', async () => {
  await assert.rejects(projectModule([], true).sitemapProjects(), /Database unavailable/);
  const preview = load('src/lib/seo/site.ts', {}, {});
  const route = load('src/app/sitemap.ts', {
    '@/lib/seo/site': preview, '@/lib/seo/registry': registry,
    '@/lib/seo/projects': { sitemapProjects: () => { throw new Error('Should not read preview data'); } },
  });
  assert.equal((await route.default()).length, 0);
});

test('sitemap uses source modification times and only real public/editorial pages', async () => {
  const updatedAt = new Date('2026-11-08T12:00:00Z');
  const route = load('src/app/sitemap.ts', {
    '@/lib/seo/site': site, '@/lib/seo/registry': registry,
    '@/lib/seo/projects': { sitemapProjects: async () => [{ slug: 'real-project', updatedAt }] },
  });
  const entries = await route.default();
  assert.equal(entries.length, content.editorialPaths.length + 1);
  assert.equal(entries.at(-1).lastModified, updatedAt);
  assert.equal(entries.some((item) => item.url.includes('brand-language')), false);
  assert.equal(entries.some((item) => item.url.includes('/signin')), false);
  // Static pages get a lastModified only when the registry declares a real modification date, and it is that date.
  const declared = new Map(registry.indexablePages().map((page) => [`https://freelance-place.com${page.path}`, page.modified]));
  assert.equal(entries.slice(0, -1).every((item) => item.lastModified === declared.get(item.url)), true);
  assert.equal(entries.slice(0, -1).some((item) => item.lastModified === undefined), true);
});


test('sitemap rejects oversize output before exceeding the protocol URL limit', async () => {
  const thousand = { size: 1000, docs: Array.from({ length: 1000 }, (_, i) => doc(`id-${i}`)) };
  const helpers = projectModule(Array.from({ length: 50 }, () => thousand));
  await assert.rejects(helpers.sitemapProjects(), /requires sharding/);
});
